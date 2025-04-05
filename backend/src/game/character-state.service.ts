import { Injectable, Logger } from '@nestjs/common';
import { ZoneService, RuntimeCharacterData } from './zone.service';
import { CombatService } from './combat.service';
import { EnemyInstance } from './interfaces/enemy-instance.interface';
import { InventoryService } from '../inventory/inventory.service';
import { BroadcastService } from './broadcast.service';
import { DroppedItem } from './interfaces/dropped-item.interface';
import { CombatResult } from './interfaces/combat.interface';

// Define the structure for the results returned by processing a character tick
export interface CharacterTickResult {
    characterData: RuntimeCharacterData; // The potentially modified character data
    combatActions: any[]; // Combat actions initiated by this character (e.g., attack visuals)
    enemyHealthUpdates: Array<{ id: string, health: number }>; // Enemy health changes caused by this character
    diedThisTick: boolean; // Did the character die this tick?
    respawnedThisTick: boolean; // Did the character respawn this tick?
    targetDied: boolean; // Did the character's target die this tick?
    pickedUpItemId: string | null; // ID of item picked up this tick
}


@Injectable()
export class CharacterStateService {
    private readonly logger = new Logger(CharacterStateService.name);
     // Constants potentially needed (could be moved to a config service later)
     private readonly RESPAWN_TIME_MS = 5000;
     private readonly CHARACTER_HEALTH_REGEN_PERCENT_PER_SEC = 1.0;
     private readonly ITEM_PICKUP_RANGE_SQ = 5*5; // Squared distance threshold for picking up items (e.g., 5 pixels)

    constructor(
        private zoneService: ZoneService,
        private combatService: CombatService,
        private inventoryService: InventoryService,
        private broadcastService: BroadcastService,
    ) {}

    /**
     * Processes the state updates for a single character for one game tick.
     * Handles death, respawn, health regen, leashing, state transitions (idle, moving, attacking),
     * auto-aggro, and initiating attacks via CombatService.
     *
     * @param character The character's current runtime data.
     * @param playerId The ID of the player owning the character.
     * @param zoneId The ID of the zone the character is in.
     * @param enemiesInZone Array of all enemy instances currently in the zone.
     * @param siblingCharacters Array of other characters owned by the same player in the zone.
     * @param now Current timestamp (Date.now()).
     * @param deltaTime Time elapsed since the last tick in seconds.
     * @returns CharacterTickResult containing updates and events from this tick.
     */
    async processCharacterTick(
        character: RuntimeCharacterData,
        playerId: string,
        zoneId: string,
        enemiesInZone: EnemyInstance[],
        siblingCharacters: RuntimeCharacterData[],
        now: number,
        deltaTime: number,
    ): Promise<CharacterTickResult> {

        if (character.positionX === null || character.positionY === null) {
            this.logger.warn(`Character ${character.id} has no position. Setting to default spawn.`);
            character.positionX = 100;
            character.positionY = 100;
        }

        const results: CharacterTickResult = {
             characterData: character, // Start with the input data
             combatActions: [],
             enemyHealthUpdates: [],
             diedThisTick: false,
             respawnedThisTick: false,
             targetDied: false,
             pickedUpItemId: null,
        };

        // --- -1. Respawn Check ---
        if (character.state === 'dead' && character.timeOfDeath !== null) {
            if (now >= character.timeOfDeath + this.RESPAWN_TIME_MS) {
                this.logger.log(`Character ${character.id} [${character.name}] respawning.`);
                character.currentHealth = character.baseHealth;
                character.state = 'idle';
                character.timeOfDeath = null;
                if (character.anchorX !== null && character.anchorY !== null) {
                    character.positionX = character.anchorX;
                    character.positionY = character.anchorY;
                } else {
                    character.positionX = 100; // Default spawn
                    character.positionY = 100;
                }
                character.attackTargetId = null;
                character.targetX = null;
                character.targetY = null;
                character.commandState = null; // Clear command state on respawn
                results.respawnedThisTick = true;
                 return results;
            }
            // Still dead, waiting for respawn timer
            return results; // No changes needed
        }

        // --- 0. Death Check (if not already dead) ---
        if (character.currentHealth <= 0 && character.state !== 'dead') {
            this.logger.log(`Character ${character.id} [${character.name}] has died.`);
            character.timeOfDeath = now;
            character.state = 'dead';
            character.attackTargetId = null;
            character.targetX = null;
            character.targetY = null;
            character.commandState = null; // Clear command state on death
            results.diedThisTick = true;
             return results;
        }

         // If somehow already dead but timeOfDeath is null, log error and set time
         if (character.state === 'dead' && character.timeOfDeath === null) {
             this.logger.error(`Character ${character.id} in dead state but timeOfDeath is null! Setting timeOfDeath now.`);
             character.timeOfDeath = now;
             return results; // Stop processing
         }
         // If dead and waiting for respawn, stop processing
         if (character.state === 'dead') {
             return results;
         }

        // --- 0.5 Health Regeneration (if alive and not attacking?) ---
        // Added check to ensure not regenerating during combat
        if (character.currentHealth < character.baseHealth && character.state !== 'attacking') {
            const regenAmount = (character.baseHealth * this.CHARACTER_HEALTH_REGEN_PERCENT_PER_SEC / 100) * deltaTime;
            if (regenAmount > 0) {
                // Update health directly via ZoneService to ensure consistency if needed elsewhere,
                // OR update locally and let the loop handle the update aggregation.
                // Let's update locally for now and return the change.
                const newHealth = Math.min(character.baseHealth, character.currentHealth + regenAmount);
                if (newHealth !== character.currentHealth) {
                    character.currentHealth = newHealth;
                    // We don't necessarily need to push this to updates here,
                    // the main loop will compare health before/after this service call.
                }
            }
        }

        // --- 1. Leashing Check ---
        let isLeashing = false;
        if (character.anchorX !== null && character.anchorY !== null && character.leashDistance > 0) {
            const distToAnchorSq = (character.positionX - character.anchorX)**2 + (character.positionY - character.anchorY)**2;
            if (distToAnchorSq > character.leashDistance * character.leashDistance) {
                isLeashing = true;
                if (character.state !== 'moving' || character.targetX !== character.anchorX || character.targetY !== character.anchorY) {
                    // this.logger.debug(`Character ${character.id} leashing.`); // Less verbose
                    character.state = 'moving';
                    character.targetX = character.anchorX;
                    character.targetY = character.anchorY;
                    character.attackTargetId = null; // Stop attacking when leashing
                }
            }
        }

        if (isLeashing) {
             character.commandState = null; // Leashing cancels loot command
        }

        // --- 2. State Logic (Only if NOT leashing) ---
        if (!isLeashing) {
            switch (character.state) {
                case 'attacking':
                    const targetEnemy = character.attackTargetId ? this.zoneService.getEnemyInstanceById(zoneId, character.attackTargetId) : undefined;
                    let combatResult: CombatResult | null = null;

                    if (!targetEnemy || targetEnemy.currentHealth <= 0) {
                        character.attackTargetId = null;
                        character.state = 'idle';
                        character.targetX = null;
                        character.targetY = null;
                    } else {
                        const distToTargetSq = (character.positionX - targetEnemy.position.x)**2 + (character.positionY - targetEnemy.position.y)**2;
                        const attackRangeSq = character.attackRange * character.attackRange;

                        if (distToTargetSq <= attackRangeSq) {
                            if (character.targetX !== null || character.targetY !== null) {
                                character.targetX = null;
                                character.targetY = null;
                            }
                            if (now >= character.lastAttackTime + character.attackSpeed) {
                                combatResult = await this.combatService.handleAttack(character, targetEnemy, zoneId);
                                character.lastAttackTime = now;

                                results.combatActions.push({ attackerId: character.id, targetId: targetEnemy.id, damage: combatResult.damageDealt, type: 'attack' });
                                results.enemyHealthUpdates.push({ id: targetEnemy.id, health: combatResult.targetCurrentHealth });

                                if (combatResult.targetDied) {
                                    this.logger.log(`Enemy ${targetEnemy.id} died from attack by Character ${character.id}`);
                                    results.targetDied = true;
                                    character.attackTargetId = null;
                                    character.state = 'idle';
                                }
                            }
                        } else {
                            if (character.targetX !== targetEnemy.position.x || character.targetY !== targetEnemy.position.y) {
                                character.targetX = targetEnemy.position.x;
                                character.targetY = targetEnemy.position.y;
                            }
                        }
                    }
                    break;

                case 'moving':
                    if (character.targetX !== null && character.targetY !== null) {
                        const dx = character.targetX - character.positionX;
                        const dy = character.targetY - character.positionY;
                        const distSq = dx*dx + dy*dy;
                        const closeEnoughThresholdSq = 1;
                        if (distSq <= closeEnoughThresholdSq) {
                            character.state = 'idle';
                            character.positionX = character.targetX; 
                            character.positionY = character.targetY;
                            character.targetX = null; 
                            character.targetY = null;
                        } // Else: still moving, commandState persists if set
                    } else {
                         this.logger.warn(`Character ${character.id} in 'moving' state but has no target. Setting idle.`);
                         character.state = 'idle';
                         character.targetX = null;
                         character.targetY = null;
                         character.commandState = null; // OK to clear if move was invalid/aborted
                    }
                    break;

                case 'idle':
                    let closestEnemy: EnemyInstance | null = null; 
                    
                    // --- Auto-Aggro Scan --- 
                    if (character.aggroRange > 0) {
                        let minDistSq = character.aggroRange * character.aggroRange;
                        for (const enemy of enemiesInZone) {
                             if (enemy.currentHealth <= 0) continue;
                             if (character.positionX === null || character.positionY === null || typeof enemy.position.x !== 'number' || typeof enemy.position.y !== 'number') {
                                 this.logger.warn(`Skipping aggro check due to invalid position...`);
                                 continue;
                             }
                             const distSq = (character.positionX - enemy.position.x)**2 + (character.positionY - enemy.position.y)**2;
                             if (distSq <= minDistSq) { 
                                 minDistSq = distSq;
                                 closestEnemy = enemy;
                             }
                        }
                    } // --- End Aggro Scan ---

                    // --- Action based on aggro/anchor --- 
                    if (closestEnemy) {
                       // Found enemy via aggro
                       this.logger.debug(`Character ${character.id} [${character.name}] auto-aggroed...`);
                       character.state = 'attacking';
                       character.attackTargetId = closestEnemy.id;
                       // commandState is NOT cleared by auto-aggro
                    } else {
                        // No enemy aggroed, check return to anchor
                        if (character.anchorX !== null && character.anchorY !== null) {
                             const distToAnchorSq = (character.positionX - character.anchorX)**2 + (character.positionY - character.anchorY)**2;
                             if (distToAnchorSq > 1) {
                                 // Need to return to anchor
                                 character.state = 'moving';
                                 character.targetX = character.anchorX;
                                 character.targetY = character.anchorY;
                                 // commandState persists if set, will clear when anchor reached or manually cleared
                             } else {
                                 // Idle AT anchor
                                 character.commandState = null; // Clear command state
                             }
                         } else {
                             // Truly idle, no anchor set
                             character.commandState = null; // Clear command state
                         }
                    }
                    break;

                case 'moving_to_loot':
                    if (character.targetItemId === null || character.targetX === null || character.targetY === null) {
                        this.logger.warn(`Character ${character.id} in moving_to_loot state but missing target info. Setting idle.`);
                        character.state = 'idle';
                        character.targetItemId = null;
                        character.targetX = null;
                        character.targetY = null;
                        character.commandState = null;
                        break;
                    }

                    const dxLoot = character.targetX - character.positionX;
                    const dyLoot = character.targetY - character.positionY;
                    const distToLootSq = dxLoot*dxLoot + dyLoot*dyLoot;

                    if (distToLootSq <= this.ITEM_PICKUP_RANGE_SQ) {
                        this.logger.debug(`Character ${character.id} reached location for item ${character.targetItemId}. Attempting pickup.`);
                        const targetItemId = character.targetItemId;
                        const wasLootAreaCommand = character.commandState === 'loot_area';

                        character.state = wasLootAreaCommand ? 'looting_area' : 'idle';
                        character.targetItemId = null;
                        character.targetX = null;
                        character.targetY = null;
                        if (!wasLootAreaCommand) {
                            character.commandState = null;
                        }

                        const itemToPickup = this.zoneService.getDroppedItemById(zoneId, targetItemId);
                        if (!itemToPickup) {
                            this.logger.log(`Item ${targetItemId} no longer exists (picked up by other?). Char ${character.id} goes ${character.state}.`);
                            if (character.state === 'looting_area') {
                            } else {
                                character.commandState = null;
                            }
                            break; 
                        }

                        try {
                            const addedInventoryItem = await this.inventoryService.addItemToUser(
                                character.ownerId,
                                itemToPickup.itemTemplateId,
                                itemToPickup.quantity
                            );
                            if (!addedInventoryItem) {
                                throw new Error('InventoryService returned null/undefined.');
                            }

                            const removed = this.zoneService.removeDroppedItem(zoneId, targetItemId);
                            if (removed) {
                                this.logger.log(`Character ${character.id} picked up item ${itemToPickup.itemName} (${targetItemId})`);
                                results.pickedUpItemId = targetItemId;
                            } else {
                                this.logger.error(`CRITICAL: ...`);
                            }

                        } catch (error) {
                            this.logger.error(`Failed to add item ...`, error.stack);
                            if (!wasLootAreaCommand) character.commandState = null;
                        }

                    } else {
                    }
                    break;

                case 'looting_area':
                    let closestAvailableItem: DroppedItem | null = null;
                    let minItemDistSq = character.aggroRange * character.aggroRange;
                    const targetedItemIds = new Set<string>();
                    for (const sibling of siblingCharacters) {
                        if ((sibling.state === 'moving_to_loot' || sibling.state === 'looting_area') && sibling.targetItemId) {
                            targetedItemIds.add(sibling.targetItemId);
                        }
                    }

                    for (const item of this.zoneService.getDroppedItems(zoneId)) {
                        if (targetedItemIds.has(item.id)) {
                            continue;
                        }

                        const itemDistSq = (character.positionX - item.position.x)**2 + (character.positionY - item.position.y)**2;
                        if (itemDistSq <= minItemDistSq) {
                            minItemDistSq = itemDistSq;
                            closestAvailableItem = item;
                        }
                    }

                    if (closestAvailableItem) {
                        this.logger.debug(`Character ${character.id} [${character.name}] found nearby available item ${closestAvailableItem.itemName} (${closestAvailableItem.id}) to loot. Switching to moving_to_loot.`);
                        character.state = 'moving_to_loot';
                        character.targetItemId = closestAvailableItem.id;
                        character.targetX = closestAvailableItem.position.x;
                        character.targetY = closestAvailableItem.position.y;
                        targetedItemIds.add(closestAvailableItem.id);
                        character.commandState = 'loot_area';
                    } else {
                        this.logger.debug(`Character ${character.id} [${character.name}] found no nearby available items to loot. Returning to anchor.`);
                        character.state = 'moving';
                        character.targetX = character.anchorX;
                        character.targetY = character.anchorY;
                        character.targetItemId = null;
                        character.commandState = null;
                    }
                    break;
            }
        } else {
             character.commandState = null;
        }

        results.characterData = character;
        return results;
    }

     // Optional: Helper for distance if needed, though MovementService might handle it
     // private calculateDistance(point1: {x:number, y:number}, point2: {x:number, y:number}): number { ... }
}
