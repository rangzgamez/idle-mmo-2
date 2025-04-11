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
     // Constants potentially needed (could be moved to a config service later)
     private readonly RESPAWN_TIME_MS = 5000;
     private readonly CHARACTER_HEALTH_REGEN_PERCENT_PER_SEC = 1.0;
     private readonly ITEM_PICKUP_RANGE_SQ = 5*5; // Squared distance threshold for picking up items (e.g., 5 pixels)

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

        // --- Initial Position Check ---
        // Moved to start to ensure position exists before any logic
        if (character.positionX === null || character.positionY === null) {
            this.logger.warn(`Character ${character.id} has null position. Setting to default spawn (100, 100) and anchor.`);
            character.positionX = 100; // TODO: Get default spawn from zone config?
            character.positionY = 100;
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
                this.logger.log(`Character ${character.id} [${character.name}] respawning.`);
                character.currentHealth = character.baseHealth; // Full health
                character.state = 'idle'; // Back to idle
                character.timeOfDeath = null;
                // Respawn at anchor or default (use nullish coalescing)
                character.positionX = character.anchorX ?? 100;
                character.positionY = character.anchorY ?? 100;
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
            this.logger.log(`Character ${character.id} [${character.name}] has died.`);
            character.timeOfDeath = now;
            character.state = 'dead';
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
        // Leashing overrides other states and forces a return to anchor.
        let isLeashing = false;
        if (character.anchorX !== null && character.anchorY !== null && character.leashDistance > 0) {
            const distToAnchorSq = (character.positionX - character.anchorX)**2 + (character.positionY - character.anchorY)**2;
            if (distToAnchorSq > character.leashDistance * character.leashDistance) {
                isLeashing = true;
                // Check if we aren't *already* correctly moving back to the anchor
                if (character.state !== 'moving' || character.targetX !== character.anchorX || character.targetY !== character.anchorY) {
                    this.logger.debug(`Character ${character.id} [${character.name}] is beyond leash range (${Math.sqrt(distToAnchorSq).toFixed(1)} > ${character.leashDistance}). Forcing move to anchor (${character.anchorX}, ${character.anchorY}).`);
                    character.state = 'moving'; // Force moving state
                    character.targetX = character.anchorX; // Set target to anchor
                    character.targetY = character.anchorY;
                    character.attackTargetId = null; // Stop attacking
                    character.targetItemId = null; // Stop looting
                    character.commandState = null; // Cancel commands
                } else {
                    // Already moving back to anchor, let the MovingState handle it.
                    this.logger.verbose(`Character ${character.id} is leashing but already moving correctly towards anchor.`);
                }
            }
        }
        // Note: If isLeashing is true, the character.state is now guaranteed to be 'moving'
        // and targetX/Y point to the anchor.

        // --- 2. State Logic Delegation ---
        // Find the handler for the *current* state (which might have been forced to 'moving' by leashing)
        const currentStateHandler = this.stateHandlers.get(character.state);
        const initialState = character.state; // Store state *before* delegation

        if (currentStateHandler) {
            // Log using initialState captured above
            this.logger.verbose(`Character ${character.id} processing state: ${initialState} (Leashing: ${isLeashing})`);
            // Delegate the actual state logic processing to the handler
            const stateResult: StateProcessResult = await currentStateHandler.processTick(
                character, // Pass the character data (handler can mutate it)
                this.dependencies, // Pass shared dependencies
                zoneId,
                enemiesInZone,
                siblingCharacters,
                now,
                deltaTime
            );

            const finalState = character.state; // Capture state *after* handler runs

            // --- 3. Aggregate Results from State Handler ---
            if (stateResult) {
                tickResult.combatActions.push(...stateResult.combatActions);
                tickResult.enemyHealthUpdates.push(...stateResult.enemyHealthUpdates);
                tickResult.targetDied = tickResult.targetDied || stateResult.targetDied;
                tickResult.pickedUpItemId = tickResult.pickedUpItemId || stateResult.pickedUpItemId;
            }

            // --->> Check for State Change and Queue Broadcast <<---
            if (initialState !== finalState) {
                this.logger.verbose(`Character ${character.id} state changed: ${initialState} -> ${finalState}`);
                if (character.ownerId) {
                    // --->> Queue the state change event <<---
                    this.broadcastService.queueCharacterStateChange(zoneId, {
                        entityId: character.id,
                        state: finalState,
                    });
                 } else {
                     this.logger.error(`Character ${character.id} changed state but ownerId is missing! Cannot broadcast state change.`);
                 }
            } else {
                 // Log using finalState here as initialState === finalState
                 this.logger.verbose(`Character ${character.id} finished processing state. State remained: ${finalState}`);
            }

        } else {
            // This should not happen if all states are mapped
            // Use initialState captured before the if/else block
            this.logger.error(
                `Character ${character.id} has unknown or unhandled state: '${initialState}'. Setting to idle to recover.`,
            );
            character.state = 'idle'; // Force state change
            character.targetX = null;
            character.targetY = null;
            character.attackTargetId = null;
            character.targetItemId = null;
            character.commandState = null;

            // --->> Queue Broadcast for Forced Idle State <<---
            // We know the state changed from initialState to 'idle'
            const finalState = character.state; // This is 'idle'
            this.logger.verbose(`Character ${character.id} state changed due to unknown state recovery: ${initialState} -> ${finalState}`);
            if (character.ownerId) {
                 // --->> Queue the state change event <<---
                 this.broadcastService.queueCharacterStateChange(zoneId, {
                     entityId: character.id,
                     state: finalState, // 'idle'
                 });
             } else {
                 this.logger.error(`Character ${character.id} changed state (unknown recovery) but ownerId is missing!`);
             }
        }

        // --- Final Result ---
        // Ensure the characterData in the result reflects all mutations
        tickResult.characterData = character;
        return tickResult;
    }

     // Optional: Helper for distance if needed, though MovementService might handle it
     // private calculateDistance(point1: {x:number, y:number}, point2: {x:number, y:number}): number { ... }
}
