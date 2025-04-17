import { Logger } from '@nestjs/common';
import { RuntimeCharacterData } from '../zone.service';
import { EnemyInstance } from '../interfaces/enemy-instance.interface';
import { DroppedItem } from '../interfaces/dropped-item.interface';
import {
    CharacterStateDependencies,
    ICharacterState,
    StateProcessResult,
} from './character-state.interface';

export class LootingAreaState implements ICharacterState {
    private readonly logger = new Logger(LootingAreaState.name);

    async processTick(
        character: RuntimeCharacterData,
        dependencies: CharacterStateDependencies,
        zoneId: string,
        enemiesInZone: EnemyInstance[],
        siblingCharacters: RuntimeCharacterData[],
        now: number,
        deltaTime: number,
    ): Promise<StateProcessResult> {
        const { zoneService, ITEM_PICKUP_RANGE_SQ } = dependencies; // Use constant from deps
        const results: StateProcessResult = {
            combatActions: [],
            enemyHealthUpdates: [],
            targetDied: false,
            pickedUpItemId: null,
        };

        // --- Find Closest Available Item ---
        let closestAvailableItem: DroppedItem | null = null;
        // Use character's aggroRange as the looting scan radius? Or define a separate lootRadius? Let's use aggroRange for now.
        let minItemDistSq = character.aggroRange * character.aggroRange;

        // Build a set of items already targeted by siblings *in a looting state*
        const targetedItemIds = new Set<string>();
        for (const sibling of siblingCharacters) {
            // Only consider siblings actively moving to or scanning for loot
            if ((sibling.state === 'moving_to_loot' || sibling.state === 'looting_area') && sibling.targetItemId) {
                targetedItemIds.add(sibling.targetItemId);
            }
        }
        // Also exclude item currently targeted by self if somehow stuck in this state
        if (character.targetItemId) {
             targetedItemIds.add(character.targetItemId);
        }


        const allDroppedItems = zoneService.getDroppedItems(zoneId);
        this.logger.verbose(`Character ${character.id} scanning ${allDroppedItems.length} items. Siblings target: [${Array.from(targetedItemIds).join(', ')}]`);

        for (const item of allDroppedItems) {
            // Skip if targeted by another looting sibling (or self)
            if (targetedItemIds.has(item.id)) {
                this.logger.verbose(`Skipping item ${item.id} as it's already targeted.`);
                continue;
            }

            const itemDistSq = (character.positionX! - item.position.x)**2 + (character.positionY! - item.position.y)**2;

            if (itemDistSq <= minItemDistSq) {
                // Found a closer, untargeted item
                minItemDistSq = itemDistSq;
                closestAvailableItem = item;
            }
        }
        // --- End Find Item ---

        if (closestAvailableItem) {
            this.logger.debug(`Character ${character.id} found nearby item ${closestAvailableItem.id} to loot. Transitioning to moving_to_loot.`);
             // --- USE CENTRALIZED METHOD --- 
             // Need to set state, targetItemId, targetX, targetY
             // Can't use setMovementTarget as it clears targetItemId
             zoneService.setCharacterState(zoneId, character.id, 'moving_to_loot');
             character.targetItemId = closestAvailableItem.id;
             character.targetX = closestAvailableItem.position.x;
             character.targetY = closestAvailableItem.position.y;
             // character.state = 'moving_to_loot'; <-- Handled by setCharacterState
            // ----------------------------
            
            // Ensure commandState is set correctly (redundant check, maybe remove later)
            if (character.commandState !== 'loot_area') {
                 this.logger.warn(`Character ${character.id} entered looting_area state without 'loot_area' commandState? Setting it now.`);
                 character.commandState = 'loot_area';
            }
        } else {
            // No available items found within range
            this.logger.debug(`Character ${character.id} found no nearby items. Command finished. Transitioning to moving (to return to anchor).`);
             // --- USE CENTRALIZED METHOD --- 
             // Use setMovementTarget which handles state change and broadcast
             // Check anchor exists before calling
             if (character.anchorX !== null && character.anchorY !== null) {
                 zoneService.setMovementTarget(zoneId, character.id, character.anchorX, character.anchorY);
             } else {
                 // No anchor, just go idle
                 this.logger.warn(`Character ${character.id} finished looting area but has no anchor. Going idle.`);
                 zoneService.setCharacterState(zoneId, character.id, 'idle');
             }
             // character.state = 'moving'; <-- Handled by setMovementTarget/setCharacterState
             // character.targetX = character.anchorX; <-- Handled by setMovementTarget
             // character.targetY = character.anchorY; <-- Handled by setMovementTarget
             character.targetItemId = null; // Clear item target
             character.commandState = null; // Loot command is complete/aborted
             // ----------------------------
        }

        return results;
    }
} 