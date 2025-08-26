import { Logger } from '@nestjs/common';
import { RuntimeCharacterData } from '../zone.service';
import { EnemyInstance } from '../interfaces/enemy-instance.interface';
import {
    CharacterStateDependencies,
    ICharacterState,
    StateProcessResult,
} from './character-state.interface';

export class MovingToLootState implements ICharacterState {
    private readonly logger = new Logger(MovingToLootState.name);

    async processTick(
        character: RuntimeCharacterData,
        dependencies: CharacterStateDependencies,
        zoneId: string,
        enemiesInZone: EnemyInstance[],
        siblingCharacters: RuntimeCharacterData[],
        now: number,
        deltaTime: number,
    ): Promise<StateProcessResult> {
        const { zoneService, inventoryService, ITEM_PICKUP_RANGE_SQ } = dependencies;
        const results: StateProcessResult = {
            combatActions: [],
            enemyHealthUpdates: [],
            targetDied: false,
            pickedUpItemId: null,
        };

        if (character.targetItemId === null || character.targetX === null || character.targetY === null) {
            this.logger.warn(`Character ${character.id} in moving_to_loot state but missing target info. Transitioning to idle.`);
            zoneService.setCharacterState(zoneId, character.id, 'idle');
            character.targetItemId = null;
            character.targetX = null;
            character.targetY = null;
            character.commandState = null; // Clear potentially broken command
            return results;
        }

        const dxLoot = character.targetX - character.positionX!;
        const dyLoot = character.targetY - character.positionY!;
        const distToLootSq = dxLoot*dxLoot + dyLoot*dyLoot;

        if (distToLootSq <= ITEM_PICKUP_RANGE_SQ) {
            this.logger.debug(`Character ${character.id} reached location for item ${character.targetItemId}. Attempting pickup.`);
            const targetItemId = character.targetItemId; // Store before clearing
            const wasLootAreaCommand = character.commandState === 'loot_area';

            // --- Attempt Pickup ---
            const itemToPickup = zoneService.getDroppedItemById(zoneId, targetItemId);
            let pickupSuccess = false;
            if (itemToPickup) {
                try {
                    // Add to inventory FIRST
                    const addedInventoryItem = await inventoryService.addItemToUser(
                        character.ownerId,
                        itemToPickup.itemTemplateId,
                        itemToPickup.quantity
                    );
                    if (addedInventoryItem) {
                         // If added successfully, THEN remove from ground
                        const removed = zoneService.removeDroppedItem(zoneId, targetItemId);
                        if (removed) {
                            this.logger.log(`Character ${character.id} picked up item ${itemToPickup.itemName} (${targetItemId})`);
                            results.pickedUpItemId = targetItemId; // Report pickup
                            pickupSuccess = true;
                        } else {
                            // This case is problematic: added to inventory but failed to remove from ground. Needs reconciliation?
                            // For now, log an error. Maybe try removing again? Or flag item?
                            this.logger.error(`CRITICAL: Added item ${targetItemId} to inventory for char ${character.id} but FAILED to remove it from ZoneService!`);
                            // Rollback inventory add? Difficult. Let's assume removeDroppedItem is robust.
                        }
                    } else {
                        // Failed to add (e.g., inventory full, DB error)
                         this.logger.warn(`Character ${character.id} failed to add item ${targetItemId} to inventory (InventoryService returned falsy). Item remains.`);
                        // Potentially notify player? For now, just log.
                    }
                } catch (error) {
                    this.logger.error(`Failed to add item ${targetItemId} to inventory for user ${character.ownerId}: ${error.message}`, error.stack);
                    // Item remains on ground, character stops trying this specific item for now.
                }
            } else {
                this.logger.log(`Item ${targetItemId} no longer exists on ground when char ${character.id} reached it (picked up by other?).`);
                // Item is gone, nothing to pick up.
            }
            // --- End Attempt Pickup ---


            // --- Determine Next State ---
            // Reset targets regardless of pickup success/failure for this *specific* item attempt
            character.targetItemId = null;
            character.targetX = null;
            character.targetY = null;

            if (wasLootAreaCommand) {
                this.logger.debug(`Character ${character.id} finished move_to_loot attempt (success=${pickupSuccess}) during loot_area command. Transitioning back to looting_area.`);
                zoneService.setCharacterState(zoneId, character.id, 'looting_area');
            } else {
                this.logger.debug(`Character ${character.id} finished move_to_loot attempt (success=${pickupSuccess}) for single item. Transitioning to idle.`);
                zoneService.setCharacterState(zoneId, character.id, 'idle');
                character.commandState = null; // Clear command state after single pickup attempt
            }

        } else {
            // Still moving towards the item. Position update handled by MovementService.
            // Character still moving towards target item
            // State remains 'moving_to_loot', commandState persists.
        }

        return results;
    }
} 