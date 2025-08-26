import { Injectable, Logger } from '@nestjs/common';
import { ZoneService, RuntimeCharacterData } from './zone.service';
import { CombatService } from './combat.service';
import { EnemyInstance } from './interfaces/enemy-instance.interface';
import { InventoryService } from '../inventory/inventory.service';
import { BroadcastService } from './broadcast.service';
import { DroppedItem } from './interfaces/dropped-item.interface';
import { CombatResult } from './interfaces/combat.interface';
import { EnemyService } from '../enemy/enemy.service';
import { CharacterService } from '../character/character.service';
import { GameConfig } from '../common/config/game.config';

// Import State Pattern files
import {
    ICharacterState,
    CharacterStateDependencies,
    StateProcessResult,
} from './character-states/character-state.interface';
import { IdleState } from './character-states/idle.state';
import { MovingState } from './character-states/moving.state';
import { AttackingState } from './character-states/attacking.state';
// Dead state is handled directly before delegation
import { MovingToLootState } from './character-states/moving-to-loot.state';
import { LootingAreaState } from './character-states/looting-area.state';

// Define the structure for the results returned by processing a character tick
export interface CharacterTickResult {
    characterData: RuntimeCharacterData; // The potentially modified character data
    combatActions: any[]; // Combat actions initiated by this character (e.g., attack visuals)
    enemyHealthUpdates: Array<{ id: string, health: number }>; // Enemy health changes caused by this character
    diedThisTick: boolean; // Did the character die this tick?
    respawnedThisTick: boolean; // Did the character respawn this tick?
    targetDied: boolean; // Did the character's target die this tick? (Aggregated from state results)
    pickedUpItemId: string | null; // ID of item picked up this tick (Aggregated from state results)
}


@Injectable()
export class CharacterStateService {
    private readonly logger = new Logger(CharacterStateService.name);
     // Game configuration constants
     private readonly RESPAWN_TIME_MS = GameConfig.CHARACTER.RESPAWN_TIME_MS;
     private readonly CHARACTER_HEALTH_REGEN_PERCENT_PER_SEC = GameConfig.CHARACTER.HEALTH_REGEN_PERCENT_PER_SEC;
     private readonly ITEM_PICKUP_RANGE_SQ = GameConfig.INVENTORY.ITEM_PICKUP_RANGE * GameConfig.INVENTORY.ITEM_PICKUP_RANGE;

    // Map state names to state handler instances
    private stateHandlers: Map<string, ICharacterState>;
    private dependencies: CharacterStateDependencies; // Dependencies passed to states

    constructor(
        private zoneService: ZoneService,
        private combatService: CombatService,
        private inventoryService: InventoryService,
        private broadcastService: BroadcastService,
        private enemyService: EnemyService,
        private characterService: CharacterService,
    ) {
        // Store dependencies for passing to state handlers
        this.dependencies = {
            zoneService: this.zoneService,
            combatService: this.combatService,
            inventoryService: this.inventoryService,
            characterService: this.characterService,
            enemyService: this.enemyService,
            ITEM_PICKUP_RANGE_SQ: this.ITEM_PICKUP_RANGE_SQ,
            // Add other services/constants if needed by states
        };

        // Initialize state handlers (these are stateless, so singletons are fine)
        this.stateHandlers = new Map<string, ICharacterState>([
            ['idle', new IdleState()],
            ['moving', new MovingState()],
            ['attacking', new AttackingState()],
            ['moving_to_loot', new MovingToLootState()],
            ['looting_area', new LootingAreaState()],
            // Note: 'dead' state is handled before delegation
        ]);
    }

    /**
     * Processes the state updates for a single character for one game tick.
     * Handles high-level checks (death, respawn, regen, leashing) and then
     * delegates the core logic to the appropriate state handler based on character.state.
     *
     * @param character The character's current runtime data (will be mutated).
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

        // Removed verbose tick start logging

        // --- Initial Position Check ---
        // Moved to start to ensure position exists before any logic
        if (character.positionX === null || character.positionY === null) {
            this.logger.warn(`Character ${character.id} has null position. Setting to default spawn and anchor.`);
            character.positionX = GameConfig.CHARACTER.DEFAULT_SPAWN_X;
            character.positionY = GameConfig.CHARACTER.DEFAULT_SPAWN_Y;
            // Set anchor if null, otherwise character won't leash or return properly
            if (character.anchorX === null || character.anchorY === null) {
                character.anchorX = character.positionX;
                character.anchorY = character.positionY;
                this.logger.warn(`Character ${character.id} also had null anchor. Set anchor to spawn point.`);
            }
        }

        // --- Base Result Structure ---
        const tickResult: CharacterTickResult = {
             characterData: character, // Start with the input data, will be updated
             combatActions: [],
             enemyHealthUpdates: [],
             diedThisTick: false,
             respawnedThisTick: false,
             targetDied: false,
             pickedUpItemId: null,
        };

        // --- -1. Respawn Check ---
        if (character.state === 'dead') {
            if (character.timeOfDeath === null) {
                this.logger.error(`Character ${character.id} in dead state but timeOfDeath is null! Setting timeOfDeath now.`);
                character.timeOfDeath = now;
                // Return results as is, character remains dead, needs timeOfDeath set
                return tickResult;
            }
            if (now >= character.timeOfDeath + this.RESPAWN_TIME_MS) {
                // Character respawning
                character.currentHealth = character.baseHealth; // Full health
                this.dependencies.zoneService.setCharacterState(zoneId, character.id, 'idle');
                character.timeOfDeath = null;
                // Respawn at anchor or default (use nullish coalescing)
                character.positionX = character.anchorX ?? GameConfig.CHARACTER.DEFAULT_SPAWN_X;
                character.positionY = character.anchorY ?? GameConfig.CHARACTER.DEFAULT_SPAWN_Y;
                character.attackTargetId = null; // Clear targets
                character.targetX = null;
                character.targetY = null;
                character.targetItemId = null; // Clear loot target
                character.commandState = null; // Clear command state
                tickResult.respawnedThisTick = true;
            }
            // If still dead (timer not up) or just respawned, return early.
            // No further state logic or checks needed for dead/just-respawned characters.
            return tickResult;
        }

        // --- 0. Death Check (if not already dead) ---
        if (character.currentHealth <= 0) {
            // Character has died
            character.timeOfDeath = now;
            this.dependencies.zoneService.setCharacterState(zoneId, character.id, 'dead');
            character.attackTargetId = null; // Clear targets/state
            character.targetX = null;
            character.targetY = null;
            character.targetItemId = null;
            character.commandState = null;
            tickResult.diedThisTick = true;
            // Died this tick, stop processing further states for this tick.
            return tickResult;
        }

        // --- 0.5 Health Regeneration ---
        // Only regen if not full health and not attacking (consistent with original logic)
        if (character.currentHealth < character.baseHealth && character.state !== 'attacking') {
             const regenAmount = (character.baseHealth * (this.CHARACTER_HEALTH_REGEN_PERCENT_PER_SEC / 100)) * deltaTime;
             if (regenAmount > 0) {
                 // Prevent regen from exceeding base health
                 const newHealth = Math.min(character.baseHealth, character.currentHealth + regenAmount);
                 character.currentHealth = newHealth; // Update health directly
             }
        }

        // --- 1. Leashing Check ---
        let isLeashing = false;
        if (character.anchorX !== null && character.anchorY !== null && character.leashDistance > 0) {
            const distToAnchorSq = (character.positionX - character.anchorX)**2 + (character.positionY - character.anchorY)**2;
            if (distToAnchorSq > character.leashDistance * character.leashDistance) {
                isLeashing = true;
                // Check if we aren't *already* correctly moving back to the anchor
                if (character.state !== 'moving' || character.targetX !== character.anchorX || character.targetY !== character.anchorY) {
                    // Character beyond leash range, forcing return to anchor
                    this.dependencies.zoneService.setMovementTarget(zoneId, character.id, character.anchorX, character.anchorY);
                } else {
                    // Already moving back to anchor, let the MovingState handle it.
                    // Already moving back to anchor
                }
            }
        }
        // Note: If isLeashing is true, the character.state is now guaranteed to be 'moving'
        // and targetX/Y point to the anchor.
        if (isLeashing) {
            // State changed to 'moving' by leashing
        }
        // State after leashing check complete

        // --- 2. State Logic Delegation ---
        const currentStateHandler = this.stateHandlers.get(character.state);
        let stateResult: StateProcessResult | null = null;

        if (currentStateHandler) {
            // Delegating to state handler
            // Delegate the actual state logic processing to the handler
            stateResult = await currentStateHandler.processTick(
                character, // Pass the character data (handler can mutate it, but should ideally call zoneService.set... methods)
                this.dependencies,
                zoneId,
                enemiesInZone,
                siblingCharacters,
                now,
                deltaTime
            );
            // State handler execution complete

        } else {
            // Handle unknown state
            this.logger.error(`[Tick ${character.id}] Unknown state: '${character.state}'. Setting to idle.`);
            // Use the zone service method to ensure broadcast
            this.dependencies.zoneService.setCharacterState(zoneId, character.id, 'idle');
            // Reset targets etc. (This might be better handled by an 'enterIdle' method later)
            character.attackTargetId = null;
            character.targetX = null;
            character.targetY = null;
            character.targetItemId = null;
            character.commandState = null;
        }

        // --- 3. Aggregate Results --- (Remains the same)
        if (stateResult) {
            tickResult.combatActions.push(...stateResult.combatActions);
            tickResult.enemyHealthUpdates.push(...stateResult.enemyHealthUpdates);
            tickResult.targetDied = tickResult.targetDied || stateResult.targetDied;
            tickResult.pickedUpItemId = tickResult.pickedUpItemId || stateResult.pickedUpItemId;
        }

        // --- Final Result ---
        // Ensure the characterData in the result reflects all mutations
        tickResult.characterData = character;
        // Tick processing complete
        return tickResult;
    }

     // Optional: Helper for distance if needed, though MovementService might handle it
     // private calculateDistance(point1: {x:number, y:number}, point2: {x:number, y:number}): number { ... }
}
