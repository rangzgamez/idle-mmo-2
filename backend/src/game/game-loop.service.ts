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
import { InventoryService } from '../inventory/inventory.service';

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
        private inventoryService: InventoryService,
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
                            player.characters.filter(c => c.id !== character.id), // Pass siblings
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

                        // --- ADD: Handle item pickup this tick ---
                        if (tickResult.pickedUpItemId) {
                            // Handling item pickup
                            // 1. Queue broadcast for others to remove sprite
                            this.broadcastService.queueItemPickedUp(zoneId, tickResult.pickedUpItemId);

                            // 2. Send inventory update to the specific player
                            const playerSocket = zone.players.get(player.user.id)?.socket;
                            if (playerSocket) {
                                try {
                                    // Fetch the latest full inventory
                                    const updatedInventory = await this.inventoryService.getUserInventory(player.user.id);
                                    playerSocket.emit('inventoryUpdate', { inventory: updatedInventory });
                                    // Sent inventory update after pickup
                                } catch (error) {
                                    this.logger.error(`Failed to send inventoryUpdate to ${player.user.username} after pickup: ${error.message}`, error.stack);
                                }
                            } else {
                                this.logger.warn(`Could not find socket for user ${player.user.id} to send inventory update after pickup.`);
                            }
                        }
                        // --------------------------------------

                        // Handle target death (enemy knockback & dying state)
                        if (tickResult.targetDied) {
                            const deadEnemyId = tickResult.enemyHealthUpdates.find(upd => upd.health <= 0)?.id;
                            if(deadEnemyId) {
                                this.logger.debug(`[ENEMY DEATH] Enemy died: ${deadEnemyId}`);
                                const deadEnemyInstance = this.zoneService.getEnemyInstanceById(zoneId, deadEnemyId);
                                
                                if (deadEnemyInstance) {
                                    this.logger.debug(`[ENEMY DEATH] Dead enemy data: ${deadEnemyInstance.name}, position: (${deadEnemyInstance.position.x}, ${deadEnemyInstance.position.y})`);
                                    
                                    // --- Calculate Knockback Direction ---
                                    const killerPosition = { x: character.positionX, y: character.positionY };
                                    const enemyPosition = deadEnemyInstance.position;
                                    
                                    // Calculate direction vector (killer -> enemy)
                                    const directionX = enemyPosition.x - killerPosition.x;
                                    const directionY = enemyPosition.y - killerPosition.y;
                                    const magnitude = Math.sqrt(directionX * directionX + directionY * directionY);
                                    
                                    // Normalize direction (handle case where killer and enemy are at same position)
                                    const normalizedDirection = magnitude > 0 
                                        ? { x: directionX / magnitude, y: directionY / magnitude }
                                        : { x: Math.random() - 0.5, y: Math.random() - 0.5 }; // Random direction if overlapping
                                    
                                    // --- Mark Enemy as Dying with Knockback ---
                                    deadEnemyInstance.isDying = true;
                                    deadEnemyInstance.deathTimestamp = now;
                                    deadEnemyInstance.knockbackState = {
                                        startTime: now,
                                        direction: normalizedDirection,
                                        distance: 80, // Knockback distance in pixels
                                        duration: 300, // 300ms knockback animation
                                        originalPosition: { ...enemyPosition }
                                    };
                                    
                                    // Clear AI state to prevent further actions
                                    deadEnemyInstance.aiState = 'DEAD';
                                    deadEnemyInstance.currentTargetId = null;
                                    
                                    this.logger.debug(`[ENEMY DEATH] Initialized knockback for ${deadEnemyInstance.name}: direction=(${normalizedDirection.x.toFixed(2)}, ${normalizedDirection.y.toFixed(2)}), distance=80px`);
                                    
                                    // --- Handle Loot Drop ---
                                    if (deadEnemyInstance.lootTableId) {
                                        this.logger.debug(`[ITEM DROP] Calculating loot for enemy ${deadEnemyInstance.name} with table ${deadEnemyInstance.lootTableId}`);
                                        const droppedLoot = await this.lootService.calculateLootDrops(deadEnemyInstance.lootTableId);
                                        if (droppedLoot.length > 0) {
                                            this.logger.debug(`[ITEM DROP] Loot calculated: ${droppedLoot.length} items dropped`);
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
                                                    this.logger.debug(`[ITEM DROP] Added item ${droppedItem.itemName} (${droppedItem.id}) at (${droppedItem.position.x}, ${droppedItem.position.y})`);
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
                                                    this.logger.debug(`[ITEM DROP] Queueing broadcast for item ${itemPayload.itemName} (${itemPayload.id})`);
                                                    this.broadcastService.queueItemDropped(zoneId, itemPayload);
                                                    // Item drop event queued
                                                } else {
                                                     this.logger.error(`Failed to add dropped item ${droppedItem.itemName} (${droppedItem.id}) to zone ${zoneId}`);
                                                }
                                            }
                                        } else {
                                            this.logger.debug(`[ITEM DROP] No loot calculated for enemy ${deadEnemyInstance.name} from table ${deadEnemyInstance.lootTableId}`);
                                        }
                                    } else {
                                        this.logger.debug(`[ITEM DROP] Enemy ${deadEnemyInstance.name} died but has no loot table`);
                                    }
                                    
                                    // --- Queue Death Event (Visual Effects) ---
                                    this.broadcastService.queueDeath(zoneId, { entityId: deadEnemyId, type: 'enemy' });
                                    
                                    // NOTE: Enemy is NOT removed from zone - it stays as a "dying" enemy for 10 seconds
                                    this.logger.debug(`[ENEMY DEATH] Enemy ${deadEnemyInstance.name} marked as dying, will decay in 10 seconds`);
                                    
                                } else {
                                    this.logger.warn(`Could not find dead enemy instance ${deadEnemyId} in zone ${zoneId} for death handling.`);
                                }
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

                             if (moveResult.newPosition.x !== character.positionX || moveResult.newPosition.y !== character.positionY) {
                                needsPositionUpdate = true;
                                character.positionX = moveResult.newPosition.x;
                                character.positionY = moveResult.newPosition.y;
                                this.zoneService.updateCharacterCurrentPosition(player.user.id, character.id, character.positionX, character.positionY);
                             }

                         } // End if(targetPosition)

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
                                 state: character.state,
                                 className: character.class
                             };
                              this.broadcastService.queueEntityUpdate(zoneId, updateData);
                         }

                    } // End character loop
                } // End player loop

                // --- Enemy AI, State & Movement Processing (Refactored) ---
                 // Fetch fresh list in case some died from player attacks earlier in the tick
                 const currentEnemies = this.zoneService.getZoneEnemies(zoneId);
                for (const enemy of currentEnemies) {
                    // --- Process Dying Enemies (Knockback Physics) ---
                    if (enemy.isDying) {
                        let positionChanged = false;
                        
                        // Handle knockback animation if active
                        if (enemy.knockbackState) {
                            const knockback = enemy.knockbackState;
                            const elapsed = now - knockback.startTime;
                            
                            if (elapsed <= knockback.duration) {
                                // Calculate eased progress (ease-out effect: fast -> slow)
                                const progress = elapsed / knockback.duration;
                                const easedProgress = 1 - Math.pow(1 - progress, 3); // Cubic ease-out
                                
                                // Calculate new position
                                const offsetDistance = knockback.distance * easedProgress;
                                const newX = knockback.originalPosition.x + (knockback.direction.x * offsetDistance);
                                const newY = knockback.originalPosition.y + (knockback.direction.y * offsetDistance);
                                
                                // Update enemy position
                                if (Math.abs(enemy.position.x - newX) > 0.1 || Math.abs(enemy.position.y - newY) > 0.1) {
                                    enemy.position.x = newX;
                                    enemy.position.y = newY;
                                    positionChanged = true;
                                }
                            } else {
                                // Knockback animation completed, remove state
                                enemy.knockbackState = undefined;
                                this.logger.debug(`[ENEMY DEATH] Knockback completed for ${enemy.name} (${enemy.id})`);
                            }
                        }
                        
                        // Send position update if knockback moved the enemy
                        if (positionChanged) {
                            const updateData = { id: enemy.id, x: enemy.position.x, y: enemy.position.y };
                            this.broadcastService.queueEntityUpdate(zoneId, updateData);
                        }
                        
                        continue; // Skip AI processing for dying enemies
                    }

                    if (enemy.currentHealth <= 0) continue; // Skip dead enemies (legacy check)

                     // --- Enemy State Processing (Living Enemies Only) ---
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
                            health: charUpdate.health,
                            className: charState?.class
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

                         // Get all player positions for collision detection
                         const playerPositions: Point[] = [];
                         for (const [playerId, playerData] of this.connectedPlayers.entries()) {
                             const playerCharacters = playerData.characters;
                             for (const character of playerCharacters) {
                                 const charState = this.zoneService.getCharacterStateById(zoneId, character.id);
                                 if (charState && charState.positionX !== null && charState.positionY !== null) {
                                     playerPositions.push({ x: charState.positionX, y: charState.positionY });
                                 }
                             }
                         }

                         // Use collision-aware movement for enemies
                         const enemyMoveResult: MovementResult = this.movementService.simulateMovementWithCollision(
                             enemyCurrentPos,
                             enemyTargetPos,
                             enemySpeed,
                             deltaTime,
                             playerPositions, // Obstacles to avoid
                             GameConfig.COMBAT.ENEMY_COLLISION_RADIUS,
                             GameConfig.COMBAT.PLAYER_COLLISION_RADIUS
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
                            // Item despawned due to timeout
                            // Queue the despawn event for broadcast
                            this.broadcastService.queueItemDespawned(zoneId, removed.id);
                        }
                    }
                }

                // --- Dying Enemy Cleanup Check ---
                const dyingEnemies = this.zoneService.getZoneEnemies(zoneId).filter(e => e.isDying);
                for (const dyingEnemy of dyingEnemies) {
                    if (dyingEnemy.deathTimestamp && (now - dyingEnemy.deathTimestamp) >= 10000) { // 10 seconds
                        this.logger.debug(`[ENEMY DEATH] Cleaning up decayed enemy ${dyingEnemy.name} (${dyingEnemy.id}) after 10 seconds`);
                        this.zoneService.removeEnemy(zoneId, dyingEnemy.id);
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
