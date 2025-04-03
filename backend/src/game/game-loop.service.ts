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
import { BroadcastService } from './broadcast.service';
import { LootService } from '../loot/loot.service';
import { v4 as uuidv4 } from 'uuid';
import { DroppedItem } from './interfaces/dropped-item.interface';

@Injectable()
export class GameLoopService implements OnApplicationShutdown {
    private logger: Logger = new Logger('GameLoopService');
    private gameLoopTimeout: NodeJS.Timeout | null = null;
    private isLoopRunning = false;
    private server: Server | null = null; // To hold the WebSocket server instance

    // --- Constants moved from Gateway ---
    private readonly TICK_RATE = 100; // ms (10 FPS)
    private readonly CHARACTER_HEALTH_REGEN_PERCENT_PER_SEC = 1.0; // Regenerate 1% of max health per second
    private readonly ITEM_DESPAWN_TIME_MS = 120000; // 2 minutes
    // ------------------------------------

    constructor(
        private zoneService: ZoneService,
        private combatService: CombatService,
        private aiService: AIService,
        private characterStateService: CharacterStateService,
        private movementService: MovementService,
        private enemyStateService: EnemyStateService,
        private spawningService: SpawningService,
        private broadcastService: BroadcastService,
        private lootService: LootService,
    ) {}

    // Method to start the loop, called by GameGateway
    startLoop(serverInstance: Server): void {
        if (!this.isLoopRunning) {
            this.server = serverInstance; // Store the server instance
            this.broadcastService.setServerInstance(serverInstance);
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
                        // Queue combat actions
                        tickResult.combatActions.forEach(action => {
                            this.broadcastService.queueCombatAction(zoneId, action);
                        });

                        // Queue enemy health updates
                        tickResult.enemyHealthUpdates.forEach(enemyUpdate => {
                            // Need enemy position if creating a new update entry
                            const enemy = this.zoneService.getEnemyInstanceById(zoneId, enemyUpdate.id);
                            const updatePayload = { 
                                id: enemyUpdate.id, 
                                x: enemy?.position.x, 
                                y: enemy?.position.y, 
                                health: enemyUpdate.health 
                            };
                            this.broadcastService.queueEntityUpdate(zoneId, updatePayload);
                        });

                        // Handle character death this tick
                        if (tickResult.diedThisTick) {
                            this.broadcastService.queueDeath(zoneId, { entityId: character.id, type: 'character' });
                             // Queue final death state update
                            const deathUpdate = { id: character.id, health: 0, state: 'dead' };
                             this.broadcastService.queueEntityUpdate(zoneId, deathUpdate);
                             continue; // Skip movement/further updates if died
                        }

                         // Handle character respawn this tick
                         if (tickResult.respawnedThisTick) {
                              // Queue respawn state update
                              const respawnUpdate = { id: character.id, x: character.positionX, y: character.positionY, health: character.currentHealth, state: 'idle' };
                              this.broadcastService.queueEntityUpdate(zoneId, respawnUpdate);
                              continue; // Skip movement/further updates if respawned
                         }

                        // Handle target death (enemy removal)
                        if (tickResult.targetDied && character.attackTargetId === null /* Safety check */) {
                            const deadEnemyId = tickResult.enemyHealthUpdates.find(upd => upd.health <= 0)?.id;
                            if(deadEnemyId) {
                                const deadEnemyInstance = this.zoneService.getEnemyInstanceById(zoneId, deadEnemyId);
                                
                                // --- Loot Drop Calculation ---
                                if (deadEnemyInstance && deadEnemyInstance.lootTableId) {
                                    this.logger.log(`Enemy ${deadEnemyInstance.name} (${deadEnemyId}) died, checking loot table ${deadEnemyInstance.lootTableId}...`);
                                    const droppedLoot = await this.lootService.calculateLootDrops(deadEnemyInstance.lootTableId);
                                    if (droppedLoot.length > 0) {
                                        this.logger.log(`Calculated drops for ${deadEnemyId}: ${JSON.stringify(droppedLoot.map(d => ({ item: d.itemTemplate.name, qty: d.quantity })))}`);
                                        // Create and add dropped items to the zone
                                        const dropTime = now;
                                        const despawnTime = dropTime + this.ITEM_DESPAWN_TIME_MS;
                                        for (const loot of droppedLoot) {
                                            const droppedItem: DroppedItem = {
                                                id: uuidv4(),
                                                itemTemplateId: loot.itemTemplate.id,
                                                itemName: loot.itemTemplate.name,
                                                itemType: loot.itemTemplate.itemType,
                                                position: { ...deadEnemyInstance.position }, // Copy position
                                                quantity: loot.quantity,
                                                timeDropped: dropTime,
                                                despawnTime: despawnTime,
                                            };
                                            const added = this.zoneService.addDroppedItem(zoneId, droppedItem);
                                            if (added) {
                                                this.logger.verbose(`Added dropped item ${droppedItem.itemName} (${droppedItem.id}) at ${droppedItem.position.x},${droppedItem.position.y}`);
                                                // Queue the broadcast event
                                                const itemPayload = {
                                                    id: droppedItem.id,
                                                    itemTemplateId: droppedItem.itemTemplateId,
                                                    itemName: droppedItem.itemName,
                                                    itemType: droppedItem.itemType,
                                                    spriteKey: loot.itemTemplate.spriteKey, // Get spriteKey from template
                                                    position: droppedItem.position,
                                                    quantity: droppedItem.quantity,
                                                };
                                                this.broadcastService.queueItemDropped(zoneId, itemPayload);
                                            } else {
                                                 this.logger.error(`Failed to add dropped item ${droppedItem.itemName} (${droppedItem.id}) to zone ${zoneId}`);
                                            }
                                        }
                                    } else {
                                        this.logger.log(`No loot dropped for ${deadEnemyId} from table ${deadEnemyInstance.lootTableId}.`);
                                    }
                                } else if (deadEnemyInstance) {
                                     this.logger.verbose(`Enemy ${deadEnemyInstance.name} (${deadEnemyId}) died but has no loot table.`);
                                } else {
                                    this.logger.warn(`Could not find dead enemy instance ${deadEnemyId} in zone ${zoneId} for loot calculation.`);
                                }
                                // -------------------------
                                
                                this.broadcastService.queueDeath(zoneId, { entityId: deadEnemyId, type: 'enemy' });
                                this.zoneService.removeEnemy(zoneId, deadEnemyId); // Remove dead enemy from zone state
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
                            // Queue character update
                             const updateData = {
                                 id: character.id,
                                 x: character.positionX,
                                 y: character.positionY,
                                 health: character.currentHealth,
                                 state: character.state
                             };
                              this.broadcastService.queueEntityUpdate(zoneId, updateData);
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
                     // Queue combat actions
                    enemyTickResult.combatActions.forEach(action => {
                        this.broadcastService.queueCombatAction(zoneId, action);
                    });

                     // Queue character health updates
                     enemyTickResult.characterHealthUpdates.forEach(charUpdate => {
                        const charState = this.zoneService.getCharacterStateById(zoneId, charUpdate.id);
                        const updatePayload = { 
                            id: charUpdate.id, 
                            x: charState?.positionX, 
                            y: charState?.positionY, 
                            health: charUpdate.health 
                        };
                         this.broadcastService.queueEntityUpdate(zoneId, updatePayload);
                     });

                     // Handle character death initiated by enemy
                     if (enemyTickResult.targetDied) {
                        const deadCharId = enemyTickResult.characterHealthUpdates.find(upd => upd.health <= 0)?.id;
                        if (deadCharId) {
                            this.broadcastService.queueDeath(zoneId, { entityId: deadCharId, type: 'character' });
                             // Queue final death state update
                             const charState = this.zoneService.getCharacterStateById(zoneId, deadCharId);
                             const deadUpdate = { id: deadCharId, x: charState?.positionX, y: charState?.positionY, health: 0, state: 'dead' };
                             this.broadcastService.queueEntityUpdate(zoneId, deadUpdate);
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
                        const updateData = {
                            id: enemy.id,
                            x: enemy.position.x,
                            y: enemy.position.y
                            // Health/state updates are handled via combat results or AI state changes
                        };
                        this.broadcastService.queueEntityUpdate(zoneId, updateData);
                    }
                } // End enemy loop

                // --- Nest Spawning Check (Refactored) ---
                const newlySpawnedEnemies = await this.spawningService.processNestSpawns(zoneId, now);
                 // Queue spawn events (BroadcastService also queues the initial entity update)
                newlySpawnedEnemies.forEach(newEnemy => {
                    this.broadcastService.queueSpawn(zoneId, newEnemy);
                });

                // --- Dropped Item Despawn Check ---
                const currentDroppedItems = this.zoneService.getDroppedItems(zoneId);
                for (const droppedItem of currentDroppedItems) {
                    if (now >= droppedItem.despawnTime) {
                        const removed = this.zoneService.removeDroppedItem(zoneId, droppedItem.id);
                        if (removed) {
                            this.logger.verbose(`Despawned item ${removed.itemName} (${removed.id})`);
                            // TODO: Broadcast itemDespawned event? (Optional)
                        }
                    }
                }

                // --- Flush All Queued Events for this Zone --- 
                this.broadcastService.flushZoneEvents(zoneId);

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
