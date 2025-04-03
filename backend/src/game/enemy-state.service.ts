import { Injectable, Logger } from '@nestjs/common';
import { ZoneService } from './zone.service';
import { CombatService } from './combat.service';
import { AIService } from './ai.service';
import { EnemyInstance } from './interfaces/enemy-instance.interface';
import { RuntimeCharacterData } from './zone.service'; // Import RuntimeCharacterData for attack targets
import { CombatResult } from './interfaces/combat.interface';

// Define structure for results returned by processing an enemy tick
export interface EnemyTickResult {
    enemyData: EnemyInstance; // The potentially modified enemy data (though AI service modifies directly)
    combatActions: any[]; // Combat actions initiated by this enemy
    characterHealthUpdates: Array<{ id: string, health: number }>; // Character health changes caused by this enemy
    targetDied: boolean; // Did the enemy's target (character) die this tick?
    aiActionType: string; // The type of action the AI decided on ('ATTACK', 'MOVE_TO', 'IDLE', etc.)
}

@Injectable()
export class EnemyStateService {
    private readonly logger = new Logger(EnemyStateService.name);

    constructor(
        private zoneService: ZoneService,
        private combatService: CombatService,
        private aiService: AIService,
    ) {}

    /**
     * Processes the state updates for a single enemy for one game tick.
     * Gets AI action, handles resulting attack or target setting.
     *
     * @param enemy The enemy's current runtime data.
     * @param zoneId The ID of the zone the enemy is in.
     * @param now Current timestamp (Date.now()).
     * @param deltaTime Time elapsed since the last tick in seconds.
     * @returns EnemyTickResult containing updates and events from this tick.
     */
    async processEnemyTick(
        enemy: EnemyInstance,
        zoneId: string,
        now: number, // Keep 'now' in case cooldowns move here later
        deltaTime: number, // Keep 'deltaTime' for consistency
    ): Promise<EnemyTickResult> {

        const results: EnemyTickResult = {
            enemyData: enemy, // Start with input data
            combatActions: [],
            characterHealthUpdates: [],
            targetDied: false,
            aiActionType: 'NONE', // Default action type
        };

        // --- 1. Get AI Action ---
        // Note: aiService.updateEnemyAI might directly modify enemy.aiState and enemy.lastAttackTime
        const action = this.aiService.updateEnemyAI(enemy, zoneId);
        results.aiActionType = action.type; // Record the action type

        // --- 2. Process AI Action ---
        switch (action.type) {
            case 'ATTACK':
                const targetCharacterState: RuntimeCharacterData | undefined = this.zoneService.getCharacterStateById(zoneId, action.targetEntityId);

                // Ensure target exists, is alive, and not already in a 'dead' state
                if (targetCharacterState && targetCharacterState.currentHealth > 0 && targetCharacterState.state !== 'dead') {
                    // Execute attack via CombatService
                    const combatResult: CombatResult = await this.combatService.handleAttack(enemy, targetCharacterState, zoneId);

                    // Add combat action for visual feedback
                    results.combatActions.push({ attackerId: enemy.id, targetId: action.targetEntityId, damage: combatResult.damageDealt, type: 'attack' });

                    // Record character health update
                    results.characterHealthUpdates.push({ id: action.targetEntityId, health: combatResult.targetCurrentHealth });

                    if (combatResult.targetDied) {
                        this.logger.log(`Character ${action.targetEntityId} died from attack by Enemy ${enemy.id}`);
                        results.targetDied = true; // Signal target death
                        // The GameLoopService will handle marking the character as dead and adding to the 'deaths' array based on this flag.
                        // AI service should ideally clear the enemy's target or choose a new one next tick.
                    }
                } else {
                     // AI chose to attack an invalid target (non-existent, dead, or already dying)
                     this.logger.warn(`Enemy ${enemy.id} AI tried to attack invalid/dead target ${action.targetEntityId}. Current AI state: ${enemy.aiState}. Target state: ${targetCharacterState?.state}, health: ${targetCharacterState?.currentHealth}`);
                     // Force AI back to IDLE? Clear target? AIService should ideally handle this better.
                     this.zoneService.setEnemyAiState(zoneId, enemy.id, 'IDLE');
                     enemy.target = null; // Clear invalid target reference
                     this.zoneService.setEnemyTarget(zoneId, enemy.id, null); // Persist cleared target
                }
                break;

            case 'MOVE_TO':
                // Update target in ZoneService only if it changed
                 if (!enemy.target || enemy.target.x !== action.target.x || enemy.target.y !== action.target.y) {
                     this.zoneService.setEnemyTarget(zoneId, enemy.id, action.target);
                     enemy.target = action.target; // Update local copy (passed by reference, so maybe redundant)
                 }
                // Movement simulation itself is handled separately in GameLoopService (for now)
                break;

            case 'IDLE':
                // Clear target in ZoneService if it wasn't already null
                if (enemy.target) {
                    this.zoneService.setEnemyTarget(zoneId, enemy.id, null);
                    enemy.target = null; // Update local copy
                }
                // No specific action needed here, movement simulation handles staying put if no target
                break;

            // Handle other potential AI action types here if added later
        }

        // Return the results
        results.enemyData = enemy; // Reflect any direct modifications by AI service
        return results;
    }
}