import { Logger } from '@nestjs/common';
import { RuntimeCharacterData } from '../zone.service';
import { EnemyInstance } from '../interfaces/enemy-instance.interface';
import {
    CharacterStateDependencies,
    ICharacterState,
    StateProcessResult,
} from './character-state.interface';

export class IdleState implements ICharacterState {
    private readonly logger = new Logger(IdleState.name);

    async processTick(
        character: RuntimeCharacterData,
        dependencies: CharacterStateDependencies,
        zoneId: string,
        enemiesInZone: EnemyInstance[],
        siblingCharacters: RuntimeCharacterData[],
        now: number,
        deltaTime: number,
    ): Promise<StateProcessResult> {
        const results: StateProcessResult = {
            combatActions: [],
            enemyHealthUpdates: [],
            targetDied: false,
            pickedUpItemId: null,
        };

        let closestEnemy: EnemyInstance | null = null;

        // --- Auto-Aggro Scan ---
        if (character.aggroRange > 0) {
            let minDistSq = character.aggroRange * character.aggroRange;
            for (const enemy of enemiesInZone) {
                if (enemy.currentHealth <= 0) continue;
                // Basic position validation
                if (typeof character.positionX !== 'number' || typeof character.positionY !== 'number' ||
                    typeof enemy.position.x !== 'number' || typeof enemy.position.y !== 'number') {
                     this.logger.warn(`Skipping aggro check due to invalid position data for char ${character.id} or enemy ${enemy.id}`);
                     continue;
                }
                const distSq = (character.positionX - enemy.position.x)**2 + (character.positionY - enemy.position.y)**2;
                if (distSq <= minDistSq) {
                    minDistSq = distSq;
                    closestEnemy = enemy;
                }
            }
        }

        // --- Action based on aggro/anchor ---
        if (closestEnemy) {
            // Found enemy via aggro
            this.logger.debug(`Character ${character.id} [${character.name}] auto-aggroed enemy ${closestEnemy.id}. Transitioning to attacking.`);
            character.state = 'attacking';
            character.attackTargetId = closestEnemy.id;
            // commandState is NOT cleared by auto-aggro
        } else {
            // No enemy aggroed, check return to anchor
            if (character.anchorX !== null && character.anchorY !== null) {
                const distToAnchorSq = (character.positionX! - character.anchorX)**2 + (character.positionY! - character.anchorY)**2;
                const closeEnoughThresholdSq = 1; // Consider making this a constant
                if (distToAnchorSq > closeEnoughThresholdSq) {
                    // Need to return to anchor
                    this.logger.debug(`Character ${character.id} [${character.name}] is idle away from anchor. Transitioning to moving to return.`);
                    character.state = 'moving';
                    character.targetX = character.anchorX;
                    character.targetY = character.anchorY;
                    // commandState persists if set, will clear when anchor reached or manually cleared/overridden
                } else {
                    // Idle AT anchor - clear command state if character wasn't explicitly told to move somewhere else
                     if (character.commandState && character.targetX === null && character.targetY === null) {
                         this.logger.debug(`Character ${character.id} reached idle state at anchor, clearing command state: ${character.commandState}`);
                         character.commandState = null;
                     }
                }
            } else {
                // Truly idle, no anchor set - clear command state
                 if (character.commandState) {
                     this.logger.debug(`Character ${character.id} reached idle state with no anchor, clearing command state: ${character.commandState}`);
                     character.commandState = null;
                 }
            }
        }

        // If no transition occurred, the state remains 'idle'
        return results; // No direct actions performed in idle state itself
    }
} 