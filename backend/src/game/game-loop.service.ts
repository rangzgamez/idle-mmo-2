import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { Server } from 'socket.io';
import { ZoneService, RuntimeCharacterData } from './zone.service';
import { CombatService } from './combat.service';
import { AIService } from './ai.service';
import { EnemyInstance } from './interfaces/enemy-instance.interface';
import { CharacterStateService, CharacterTickResult } from './character-state.service';
import { MovementService, MovementResult, Point } from './movement.service';
import { EnemyStateService, EnemyTickResult } from './enemy-state.service';
import { SpawningService } from './spawning.service';

@Injectable()
export class GameLoopService implements OnApplicationShutdown {
    private logger: Logger = new Logger('GameLoopService');
    private gameLoopTimeout: NodeJS.Timeout | null = null;
    private isLoopRunning = false;
    private server: Server | null = null; // To hold the WebSocket server instance

    // --- Constants moved from Gateway ---
    private readonly TICK_RATE = 100; // ms (10 FPS)
    private readonly CHARACTER_HEALTH_REGEN_PERCENT_PER_SEC = 1.0; // Regenerate 1% of max health per second
    // ------------------------------------

    constructor(
        private zoneService: ZoneService,
        private combatService: CombatService,
        private aiService: AIService,
        private characterStateService: CharacterStateService,
        private movementService: MovementService,
        private enemyStateService: EnemyStateService,
        private spawningService: SpawningService,
    ) {}

    // Method to start the loop, called by GameGateway
    startLoop(serverInstance: Server): void {
        if (!this.isLoopRunning) {
            this.server = serverInstance; // Store the server instance
            this.logger.log(`Starting game loop with tick rate ${this.TICK_RATE}ms`);
            this.isLoopRunning = true;
            this.scheduleNextTick();
        }
    }

    onApplicationShutdown(signal?: string) {
        this.logger.log(`Stopping game loop due to ${signal ? signal : 'shutdown'}...`);
        this.isLoopRunning = false; // Signal the loop to stop
        if (this.gameLoopTimeout) {
            clearTimeout(this.gameLoopTimeout);
            this.gameLoopTimeout = null;
        }
        this.logger.log('Game loop stopped.');
    }

    private scheduleNextTick(): void {
        // Clear previous timeout just in case
        if (this.gameLoopTimeout) {
            clearTimeout(this.gameLoopTimeout);
        }
        // Schedule the next tick
        this.gameLoopTimeout = setTimeout(async () => {
            if (this.isLoopRunning) { // Check if loop should still be running
                await this.tickGameLoop(); // Await the async tick
                this.scheduleNextTick(); // Schedule the next one after completion
            }
        }, this.TICK_RATE);
    }

    // --- The Core Game Loop Logic ---
    private async tickGameLoop(): Promise<void> {
        if (!this.server) {
            this.logger.error('Game loop running without a server instance!');
            return;
        }
        const startTime = Date.now();
        const now = startTime; // Use consistent timestamp for checks within the tick
        const deltaTime = this.TICK_RATE / 1000.0; // Delta time in seconds

        try {
            for (const [zoneId, zone] of (this.zoneService as any).zones.entries()) { // Use getter later
                if (zone.players.size === 0 && zone.enemies.size === 0 && zone.nests?.size === 0) continue; // Skip empty zones

                const updates: Array<{ id: string, x?: number | null, y?: number | null, health?: number | null, state?: string }> = [];
                const combatActions: Array<any> = [];
                const deaths: Array<{ entityId: string, type: 'character' | 'enemy' }> = [];
                const spawnedEnemies: EnemyInstance[] = []; // Track newly spawned enemies this tick

                const currentEnemiesInZone = this.zoneService.getZoneEnemies(zoneId); // Fetch once per tick

                // --- Character Processing (Refactored) ---
                for (const player of zone.players.values()) {
                    for (const character of player.characters) {
                        // Store initial state for comparison later
                        const initialHealth = character.currentHealth;
                        const initialState = character.state;

                        // Call the CharacterStateService to handle all state logic
                        const tickResult: CharacterTickResult = await this.characterStateService.processCharacterTick(
                            character, // Pass the mutable character object
                            player.user.id,
                            zoneId,
                            currentEnemiesInZone,
                            now,
                            deltaTime
                        );

                        // Update the character reference with the potentially modified data
                        // (processCharacterTick modifies the object directly for now)
                        // character = tickResult.characterData; // Not strictly needed if object is mutated

                        // --- Process Results from CharacterStateService ---
                        // Merge combat actions
                        combatActions.push(...tickResult.combatActions);

                        // Merge enemy health updates into the main updates array
                        tickResult.enemyHealthUpdates.forEach(enemyUpdate => {
                            const existingUpdateIndex = updates.findIndex(u => u.id === enemyUpdate.id);
                            if (existingUpdateIndex > -1) {
                                updates[existingUpdateIndex].health = enemyUpdate.health;
                            } else {
                                // Need enemy position if creating a new update entry
                                const enemy = this.zoneService.getEnemyInstanceById(zoneId, enemyUpdate.id);
                                updates.push({ id: enemyUpdate.id, x: enemy?.position.x, y: enemy?.position.y, health: enemyUpdate.health });
                            }
                        });

                        // Handle character death this tick
                        if (tickResult.diedThisTick) {
                             deaths.push({ entityId: character.id, type: 'character' });
                             // Ensure final death state is in updates
                             const updateIndex = updates.findIndex(u => u.id === character.id);
                             const deathUpdate = { id: character.id, health: 0, state: 'dead' };
                             if(updateIndex > -1) { Object.assign(updates[updateIndex], deathUpdate); } else { updates.push(deathUpdate); }
                             continue; // Skip movement/further updates if died
                        }

                         // Handle character respawn this tick
                         if (tickResult.respawnedThisTick) {
                              // Ensure respawn state is in updates
                              const updateIndex = updates.findIndex(u => u.id === character.id);
                              const respawnUpdate = { id: character.id, x: character.positionX, y: character.positionY, health: character.currentHealth, state: 'idle' };
                              if(updateIndex > -1) { Object.assign(updates[updateIndex], respawnUpdate); } else { updates.push(respawnUpdate); }
                              continue; // Skip movement/further updates if respawned
                         }

                        // Handle target death (enemy removal)
                        if (tickResult.targetDied && character.attackTargetId === null /* Safety check */) {
                            // Find the ID of the enemy that died
                            const deadEnemyId = tickResult.enemyHealthUpdates.find(upd => upd.health <= 0)?.id;
                            if(deadEnemyId) {
                                // This log is now redundant as it's in CharacterStateService
                                // this.logger.log(`Enemy ${deadEnemyId} died from attack by Character ${character.id}`);
                                deaths.push({ entityId: deadEnemyId, type: 'enemy' });
                                this.zoneService.removeEnemy(zoneId, deadEnemyId); // Remove dead enemy from zone
                                // Refresh enemy list for subsequent character checks in this tick? Maybe not needed.
                            } else {
                                this.logger.warn(`Character ${character.id} reported targetDied, but couldn't find dead enemy ID in health updates.`);
                            }
                        }

                        // --- Movement Simulation (Refactored) ---
                         let needsPositionUpdate = false;
                         const currentPosition: Point = { x: character.positionX, y: character.positionY };
                         const targetPosition: Point | null = (character.targetX !== null && character.targetY !== null) 
                                                              ? { x: character.targetX, y: character.targetY } 
                                                              : null;

                         if (targetPosition) {
                            // Get character speed from entity data (assuming it exists, else use default)
                            // TODO: Add baseSpeed to Character entity later if needed
                             const characterSpeed = 150; // Placeholder: Use character.baseSpeed eventually

                             const moveResult: MovementResult = this.movementService.simulateMovement(
                                 currentPosition,
                                 targetPosition,
                                 characterSpeed,
                                 deltaTime
                             );

                             // Check if position actually changed
                             if (moveResult.newPosition.x !== character.positionX || moveResult.newPosition.y !== character.positionY) {
                                needsPositionUpdate = true;
                                character.positionX = moveResult.newPosition.x;
                                character.positionY = moveResult.newPosition.y;
                                // Persist the updated position in ZoneService's runtime data
                                this.zoneService.updateCharacterCurrentPosition(player.user.id, character.id, character.positionX, character.positionY);
                             }

                             // If target was reached, clear the target fields in the character data
                             if (moveResult.reachedTarget) {
                                 character.targetX = null;
                                 character.targetY = null;
                                 // State transition (e.g., moving -> idle) should be handled by CharacterStateService based on reaching the target
                             }
                         }

                        // --- Batch Update Preparation (Simplified) ---
                         // Check if health, state, or position changed compared to start of tick OR if explicit flags were set
                         const healthChanged = character.currentHealth !== initialHealth;
                         const stateChanged = character.state !== initialState;

                         if (needsPositionUpdate || healthChanged || stateChanged) {
                             const updateIndex = updates.findIndex(u => u.id === character.id);
                             const updateData: any = { id: character.id };
                             if (needsPositionUpdate) {
                                 updateData.x = character.positionX;
                                 updateData.y = character.positionY;
                             }
                             if (healthChanged) {
                                 updateData.health = character.currentHealth;
                             }
                              // Always include the latest state if sending update for this char
                              updateData.state = character.state;

                             if (updateIndex > -1) {
                                 // Merge new data into existing update
                                 Object.assign(updates[updateIndex], updateData);
                             } else {
                                 updates.push(updateData);
                             }
                         }

                    } // End character loop
                } // End player loop

                // --- Enemy AI, State & Movement Processing (Refactored) ---
                 // Fetch fresh list in case some died from player attacks earlier in the tick
                 const currentEnemies = this.zoneService.getZoneEnemies(zoneId);
                for (const enemy of currentEnemies) {
                    if (enemy.currentHealth <= 0) continue; // Skip dead enemies

                     // --- Enemy State Processing ---
                     const enemyTickResult: EnemyTickResult = await this.enemyStateService.processEnemyTick(
                         enemy, // Pass mutable enemy object
                         zoneId,
                         now,
                         deltaTime
                     );

                     // Process results from EnemyStateService
                     combatActions.push(...enemyTickResult.combatActions);

                     // Merge character health updates into the main updates array
                     enemyTickResult.characterHealthUpdates.forEach(charUpdate => {
                        const existingUpdateIndex = updates.findIndex(u => u.id === charUpdate.id);
                        if (existingUpdateIndex > -1) {
                            // Avoid overwriting position if already updated
                            updates[existingUpdateIndex].health = charUpdate.health;
                        } else {
                            // Need character position if creating a new update entry
                            const charState = this.zoneService.getCharacterStateById(zoneId, charUpdate.id);
                            updates.push({ id: charUpdate.id, x: charState?.positionX, y: charState?.positionY, health: charUpdate.health });
                        }
                     });

                     // Handle character death initiated by enemy
                     if (enemyTickResult.targetDied) {
                        // Find the ID of the character that died
                        const deadCharId = enemyTickResult.characterHealthUpdates.find(upd => upd.health <= 0)?.id;
                        if (deadCharId) {
                             // This log is redundant as it's in EnemyStateService
                             // this.logger.log(`Character ${deadCharId} died from attack by Enemy ${enemy.id}`);
                             // Add to deaths array if not already added by character processing
                            if (!deaths.some(d => d.entityId === deadCharId && d.type === 'character')) {
                                deaths.push({ entityId: deadCharId, type: 'character' });
                            }
                             // Mark character as dead in updates array (ensure it's there)
                             const deadCharUpdateIndex = updates.findIndex(u => u.id === deadCharId);
                             // Need position for the update
                             const charState = this.zoneService.getCharacterStateById(zoneId, deadCharId);
                             const deadUpdate = { id: deadCharId, x: charState?.positionX, y: charState?.positionY, health: 0, state: 'dead' };
                             if (deadCharUpdateIndex > -1) { Object.assign(updates[deadCharUpdateIndex], deadUpdate); }
                             else { updates.push(deadUpdate); }
                        } else {
                            this.logger.warn(`Enemy ${enemy.id} reported targetDied, but couldn't find dead character ID in health updates.`);
                        }
                     }

                    // --- Enemy Movement Simulation ---
                    let enemyNeedsPositionUpdate = false;
                    const enemyCurrentPos: Point = { x: enemy.position.x, y: enemy.position.y };
                    // Ensure target is Point | null, treating undefined as null
                    const enemyTargetPos: Point | null = enemy.target ?? null; 

                     if (enemyTargetPos) {
                        // Get enemy speed from entity data (assuming it exists)
                         const enemySpeed = enemy.baseSpeed || 75; // Use default if not set

                         const enemyMoveResult: MovementResult = this.movementService.simulateMovement(
                             enemyCurrentPos,
                             enemyTargetPos,
                             enemySpeed,
                             deltaTime
                         );

                         if (enemyMoveResult.newPosition.x !== enemy.position.x || enemyMoveResult.newPosition.y !== enemy.position.y) {
                            enemyNeedsPositionUpdate = true;
                            enemy.position.x = enemyMoveResult.newPosition.x;
                            enemy.position.y = enemyMoveResult.newPosition.y;
                            // Persist updated position
                            this.zoneService.updateEnemyPosition(zoneId, enemy.id, enemy.position);
                         }

                         if (enemyMoveResult.reachedTarget) {
                             const previousTarget = enemy.target; // Store before clearing
                             enemy.target = null; // Clear target locally first
                             this.zoneService.setEnemyTarget(zoneId, enemy.id, null); // Persist cleared target

                              // State transitions (e.g., WANDERING -> IDLE) are handled here based on reaching target
                              // (Could potentially move into EnemyStateService after movement simulation)
                              if (enemy.aiState === 'WANDERING' || enemy.aiState === 'LEASHED') {
                                  this.zoneService.setEnemyAiState(zoneId, enemy.id, 'IDLE'); // Reached wander/leash point
                              } else if (enemy.aiState === 'CHASING') {
                                  // Reaching the exact spot might transition to ATTACKING or back to CHASING next AI tick
                              }
                         }
                     }

                    // --- Add enemy to updates array if needed ---
                     // Only add if position actually changed
                     if (enemyNeedsPositionUpdate) {
                         const updateIndex = updates.findIndex(u => u.id === enemy.id);
                         if (updateIndex > -1) {
                             updates[updateIndex].x = enemy.position.x;
                             updates[updateIndex].y = enemy.position.y;
                             // Health should have been updated via combatResult handling if it changed
                         } else {
                             // If no existing update, push new one (position only unless health changed earlier)
                             updates.push({ id: enemy.id, x: enemy.position.x, y: enemy.position.y });
                         }
                     }
                } // End enemy loop

                // --- Nest Spawning Check (Refactored) ---
                const newlySpawnedEnemies = await this.spawningService.processNestSpawns(zoneId, now);
                if (newlySpawnedEnemies.length > 0) {
                    spawnedEnemies.push(...newlySpawnedEnemies);
                     // Add new enemies to the updates array immediately so clients see them
                     newlySpawnedEnemies.forEach(newEnemy => {
                         updates.push({ id: newEnemy.id, x: newEnemy.position.x, y: newEnemy.position.y, health: newEnemy.currentHealth, state: newEnemy.aiState });
                     });
                }

                // --- Broadcast Updates ---
                if (updates.length > 0) { this.server?.to(zoneId).emit('entityUpdate', { updates }); }
                if (spawnedEnemies.length > 0) {
                    // Broadcast individual spawn events
                    spawnedEnemies.forEach(enemy => { this.server?.to(zoneId).emit('enemySpawned', enemy); });
                }
                if (combatActions.length > 0) { this.server?.to(zoneId).emit('combatAction', { actions: combatActions }); }
                if (deaths.length > 0) {
                     deaths.forEach(death => { this.server?.to(zoneId).emit('entityDied', death); });
                }

            } // End zone loop
        } catch (error) {
            this.logger.error(`Error in game loop: ${error.message}`, error.stack);
            // Consider stopping the loop or implementing error recovery
             this.isLoopRunning = false; // Stop loop on error for safety?
             if (this.gameLoopTimeout) clearTimeout(this.gameLoopTimeout);
             this.gameLoopTimeout = null;
        }

        const endTime = Date.now();
        const duration = endTime - startTime;
        if (duration > this.TICK_RATE) {
            this.logger.warn(`Game loop for tick took ${duration}ms, exceeding tick rate of ${this.TICK_RATE}ms.`);
        }
    }

    // --- Helper Functions ---
}
