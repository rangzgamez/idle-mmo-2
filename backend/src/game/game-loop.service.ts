import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { Server } from 'socket.io';
import { ZoneService, RuntimeCharacterData } from './zone.service';
import { CombatService } from './combat.service';
import { AIService } from './ai.service';
import { EnemyInstance } from './interfaces/enemy-instance.interface';
import { CharacterStateService, CharacterTickResult } from './character-state.service';

@Injectable()
export class GameLoopService implements OnApplicationShutdown {
    private logger: Logger = new Logger('GameLoopService');
    private gameLoopTimeout: NodeJS.Timeout | null = null;
    private isLoopRunning = false;
    private server: Server | null = null; // To hold the WebSocket server instance

    // --- Constants moved from Gateway ---
    private readonly TICK_RATE = 100; // ms (10 FPS)
    private readonly MOVEMENT_SPEED = 150; // Pixels per second
    private readonly ENEMY_MOVEMENT_SPEED = 75; // Pixels per second
    private readonly CHARACTER_HEALTH_REGEN_PERCENT_PER_SEC = 1.0; // Regenerate 1% of max health per second
    // ------------------------------------

    constructor(
        private zoneService: ZoneService,
        private combatService: CombatService,
        private aiService: AIService,
        private characterStateService: CharacterStateService,
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

                        // --- Movement Simulation (Still in GameLoopService for now) ---
                         let needsPositionUpdate = false;
                         if (character.targetX !== null && character.targetY !== null) {
                             const dx = character.targetX - character.positionX;
                             const dy = character.targetY - character.positionY;
                             const distance = this.calculateDistance({x: character.positionX, y: character.positionY}, {x: character.targetX, y: character.targetY});
                             const moveAmount = this.MOVEMENT_SPEED * deltaTime;

                             if (distance <= moveAmount) {
                                 // Reached Target or close enough
                                 character.positionX = character.targetX;
                                 character.positionY = character.targetY;
                                 const previousTargetX = character.targetX;
                                 const previousTargetY = character.targetY;
                                 character.targetX = null;
                                 character.targetY = null;

                                // State transition (moving -> idle) is handled by CharacterStateService upon reaching destination
                                // We just need to detect if position changed
                                 needsPositionUpdate = true;
                             } else {
                                 // Move towards Target
                                 character.positionX += (dx / distance) * moveAmount;
                                 character.positionY += (dy / distance) * moveAmount;
                                 needsPositionUpdate = true;
                             }
                             // Persist the updated position in ZoneService's runtime data
                             this.zoneService.updateCharacterCurrentPosition(player.user.id, character.id, character.positionX, character.positionY);
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

                // --- Enemy AI & Movement Processing ---
                const currentEnemies = this.zoneService.getZoneEnemies(zoneId); // Fetch fresh list in case some died
                for (const enemy of currentEnemies) {
                    if (enemy.currentHealth <= 0) continue; // Skip dead enemies processed above

                    const action = this.aiService.updateEnemyAI(enemy, zoneId);
                    let enemyNeedsPositionUpdate = false;
                    let enemyHealthChanged = false; // Track if health changed this tick (unlikely here, done via combat)

                    switch (action.type) {
                        case 'ATTACK':
                            const targetCharacterState = this.zoneService.getCharacterStateById(zoneId, action.targetEntityId);
                            // Ensure target exists and is NOT dead
                            if (targetCharacterState && targetCharacterState.currentHealth > 0 && targetCharacterState.state !== 'dead') {
                                const combatResult = await this.combatService.handleAttack(enemy, targetCharacterState, zoneId);
                                combatActions.push({ attackerId: enemy.id, targetId: action.targetEntityId, damage: combatResult.damageDealt, type: 'attack' });

                                // Update character health in the updates array
                                const charUpdateIndex = updates.findIndex(u => u.id === action.targetEntityId);
                                if (charUpdateIndex > -1) { updates[charUpdateIndex].health = combatResult.targetCurrentHealth; }
                                else { updates.push({ id: action.targetEntityId, x: targetCharacterState.positionX, y: targetCharacterState.positionY, health: combatResult.targetCurrentHealth }); }

                                if (combatResult.targetDied) {
                                    this.logger.log(`Character ${action.targetEntityId} died from attack by Enemy ${enemy.id}`);
                                    // Mark character as dead in updates array
                                    const deadCharUpdateIndex = updates.findIndex(u => u.id === action.targetEntityId);
                                    const deadUpdate = { id: action.targetEntityId, x: targetCharacterState.positionX, y: targetCharacterState.positionY, health: 0, state: 'dead' };
                                    if (deadCharUpdateIndex > -1) { Object.assign(updates[deadCharUpdateIndex], deadUpdate); }
                                    else { updates.push(deadUpdate); }
                                    // Add to deaths array for explicit death event
                                    deaths.push({ entityId: action.targetEntityId, type: 'character' });
                                    // The character's state will be handled in their own processing block next tick
                                }
                            } else {
                                 this.logger.warn(`Enemy ${enemy.id} AI tried to attack invalid/dead target ${action.targetEntityId}. AI state was ${enemy.aiState}`);
                                 // Optionally force AI back to IDLE or re-evaluate target
                                 this.zoneService.setEnemyAiState(zoneId, enemy.id, 'IDLE');
                                 enemy.target = null; // Clear target
                            }
                            break;
                        case 'MOVE_TO':
                             // Update target only if it changed
                             if (!enemy.target || enemy.target.x !== action.target.x || enemy.target.y !== action.target.y) {
                                 this.zoneService.setEnemyTarget(zoneId, enemy.id, action.target);
                                 enemy.target = action.target; // Update local copy
                             }
                            break;
                        case 'IDLE':
                            // Clear target if it wasn't already null
                            if (enemy.target) {
                                this.zoneService.setEnemyTarget(zoneId, enemy.id, null);
                                enemy.target = null; // Update local copy
                            }
                            break;
                    }

                    // Enemy Movement Simulation
                    if (enemy.target) {
                        const dx = enemy.target.x - enemy.position.x;
                        const dy = enemy.target.y - enemy.position.y;
                        const distance = Math.sqrt(dx * dx + dy * dy);
                        const moveAmount = this.ENEMY_MOVEMENT_SPEED * deltaTime;
                        if (distance <= moveAmount) {
                            // Reached Target
                            enemy.position.x = enemy.target.x;
                            enemy.position.y = enemy.target.y;
                            const previousTarget = enemy.target; // Store before clearing
                            enemy.target = null; // Clear target locally first
                            this.zoneService.setEnemyTarget(zoneId, enemy.id, null); // Persist cleared target
                            // If the AI state was move-related, transition back to IDLE
                            // Let AIService decide next state based on reaching the destination
                             if (enemy.aiState === 'WANDERING' || enemy.aiState === 'LEASHED') {
                                 this.zoneService.setEnemyAiState(zoneId, enemy.id, 'IDLE'); // Reached wander/leash point
                             } else if (enemy.aiState === 'CHASING') {
                                 // Reaching the exact spot of a character might transition to ATTACKING next AI tick
                                 // Or if character moved, might start CHASING again. Let AI decide.
                             }
                            enemyNeedsPositionUpdate = true;
                        } else {
                            // Move towards Target
                            enemy.position.x += (dx / distance) * moveAmount;
                            enemy.position.y += (dy / distance) * moveAmount;
                            enemyNeedsPositionUpdate = true;
                        }
                        // Persist updated position
                        this.zoneService.updateEnemyPosition(zoneId, enemy.id, enemy.position);
                    }

                    // Add enemy to updates array if needed
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

                // --- Nest Spawning Check ---
                const nests = this.zoneService.getZoneNests(zoneId);
                if (nests) { // Check if nests exist for this zone
                    for (const nest of nests) {
                        if (nest.currentEnemyIds.size < nest.maxCapacity) {
                            if (now >= nest.lastSpawnCheckTime + nest.respawnDelayMs) {
                                const newEnemy = await this.zoneService.addEnemyFromNest(nest);
                                if (newEnemy) {
                                   spawnedEnemies.push(newEnemy);
                                   // Add new enemy to the updates array immediately
                                   updates.push({ id: newEnemy.id, x: newEnemy.position.x, y: newEnemy.position.y, health: newEnemy.currentHealth, state: newEnemy.aiState });
                                }
                                // Update check time even if spawn failed (e.g., DB error)
                                nest.lastSpawnCheckTime = now;
                            }
                        } else {
                            // Reset check time if full, so it checks again immediately after one dies
                            nest.lastSpawnCheckTime = now;
                        }
                    } // End nest spawning check loop
                } // End if(nests)


                // --- Broadcast Updates ---
                if (updates.length > 0) { this.server.to(zoneId).emit('entityUpdate', { updates }); }
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
    private calculateDistance(point1: {x:number, y:number}, point2: {x:number, y:number}): number {
        if (typeof point1.x !== 'number' || typeof point1.y !== 'number' || typeof point2.x !== 'number' || typeof point2.y !== 'number') {
            this.logger.error(`Invalid input for calculateDistance: p1=(${point1.x},${point1.y}), p2=(${point2.x},${point2.y})`);
            return Infinity; // Return infinity to prevent invalid calculations downstream
        }
        const dx = point1.x - point2.x;
        const dy = point1.y - point2.y;
        return Math.sqrt(dx * dx + dy * dy);
    }
}
