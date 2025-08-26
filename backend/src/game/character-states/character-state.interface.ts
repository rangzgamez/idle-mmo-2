import { RuntimeCharacterData, ZoneService } from '../zone.service';
import { CombatService } from '../combat.service';
import { InventoryService } from '../../inventory/inventory.service';
import { CharacterService } from '../../character/character.service';
import { EnemyService } from '../../enemy/enemy.service';
import { EnemyInstance } from '../interfaces/enemy-instance.interface';
import { DroppedItem } from '../interfaces/dropped-item.interface';

// Structure for dependencies needed by state logic
export interface CharacterStateDependencies {
    zoneService: ZoneService;
    combatService: CombatService;
    inventoryService: InventoryService;
    characterService: CharacterService;
    enemyService: EnemyService;
    // Add constants if needed, or access via service/config
    ITEM_PICKUP_RANGE_SQ: number;
}

// Structure for the results returned by a state's processing
export interface StateProcessResult {
    combatActions: any[];
    enemyHealthUpdates: Array<{ id: string; health: number }>;
    targetDied: boolean;
    pickedUpItemId: string | null;
    // nextState?: string; // Decided against this, states will mutate directly
}

export interface ICharacterState {
    /**
     * Processes the logic for this specific state for one game tick.
     * This method SHOULD mutate the characterData object directly for state transitions (character.state = '...')
     * and other properties like targetX/Y, attackTargetId, etc.
     * It returns events/results caused during this tick within this state.
     *
     * @param character The character's runtime data (will be mutated).
     * @param dependencies Services and constants needed for state logic.
     * @param zoneId Current zone ID.
     * @param enemiesInZone All enemies in the zone.
     * @param siblingCharacters Other characters from the same owner in the zone.
     * @param now Current timestamp.
     * @param deltaTime Time since last tick.
     * @returns StateProcessResult containing events that occurred during this tick.
     */
    processTick(
        character: RuntimeCharacterData,
        dependencies: CharacterStateDependencies,
        zoneId: string,
        enemiesInZone: EnemyInstance[],
        siblingCharacters: RuntimeCharacterData[],
        now: number,
        deltaTime: number,
    ): Promise<StateProcessResult>;
} 