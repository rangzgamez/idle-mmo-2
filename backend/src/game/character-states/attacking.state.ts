import { Logger } from '@nestjs/common';
import { RuntimeCharacterData } from '../zone.service';
import { EnemyInstance } from '../interfaces/enemy-instance.interface';
import { CombatResult } from '../interfaces/combat.interface';
import {
    CharacterStateDependencies,
    ICharacterState,
    StateProcessResult,
} from './character-state.interface';

export class AttackingState implements ICharacterState {
    private readonly logger = new Logger(AttackingState.name);

    async processTick(
        character: RuntimeCharacterData,
        dependencies: CharacterStateDependencies,
        zoneId: string,
        enemiesInZone: EnemyInstance[],
        siblingCharacters: RuntimeCharacterData[],
        now: number,
        deltaTime: number,
    ): Promise<StateProcessResult> {
        const { zoneService, combatService, enemyService, characterService } = dependencies;
        const results: StateProcessResult = {
            combatActions: [],
            enemyHealthUpdates: [],
            targetDied: false,
            pickedUpItemId: null,
        };

        if (!character.attackTargetId) {
            this.logger.warn(`Character ${character.id} in attacking state but has no attackTargetId. Transitioning to idle.`);
            zoneService.setCharacterState(zoneId, character.id, 'idle');
            character.targetX = null;
            character.targetY = null;
            return results;
        }

        const targetEnemy = zoneService.getEnemyInstanceById(zoneId, character.attackTargetId);

        if (!targetEnemy || targetEnemy.currentHealth <= 0) {
            this.logger.debug(`Character ${character.id}'s target ${character.attackTargetId} is dead or gone. Transitioning to idle.`);
            character.attackTargetId = null;
            zoneService.setCharacterState(zoneId, character.id, 'idle');
            character.targetX = null;
            character.targetY = null;
            return results;
        }

        const distToTargetSq = (character.positionX! - targetEnemy.position.x)**2 + (character.positionY! - targetEnemy.position.y)**2;
        const attackRangeSq = character.attackRange * character.attackRange;

        if (distToTargetSq <= attackRangeSq) {
            // In range - Stop moving if we were approaching
            if (character.targetX !== null || character.targetY !== null) {
                this.logger.verbose(`Character ${character.id} reached attack range for ${targetEnemy.id}. Clearing movement target.`);
                character.targetX = null;
                character.targetY = null;
            }

            // Check attack cooldown
            if (now >= character.lastAttackTime + character.attackSpeed) {
                this.logger.verbose(`Character ${character.id} attacking ${targetEnemy.id}.`);
                const combatResult: CombatResult = await combatService.handleAttack(character, targetEnemy, zoneId);
                character.lastAttackTime = now;

                results.combatActions.push({
                    attackerId: character.id,
                    targetId: targetEnemy.id,
                    damage: combatResult.damageDealt,
                    type: 'attack',
                });
                results.enemyHealthUpdates.push({
                    id: targetEnemy.id,
                    health: combatResult.targetCurrentHealth,
                });

                if (combatResult.targetDied) {
                    this.logger.log(`Enemy ${targetEnemy.id} (Template: ${targetEnemy.templateId}) died from attack by Character ${character.id} (${character.name}). Granting XP and transitioning to idle.`);
                    results.targetDied = true; // Signal target death for external handling if needed

                    // --- Grant XP ---
                    await this._grantXpToParty(character, targetEnemy, dependencies, zoneId);
                    // --- End Grant XP ---

                    character.attackTargetId = null;
                    zoneService.setCharacterState(zoneId, character.id, 'idle');
                }
                // else: Target still alive, continue attacking next tick if ready
            } else {
                 this.logger.verbose(`Character ${character.id} waiting for attack cooldown against ${targetEnemy.id}.`);
            }

        } else {
            // Out of range - Need to move towards target
            this.logger.debug(`Character ${character.id} is out of attack range for ${targetEnemy.id}. Setting target and transitioning to moving.`);
            // --- USE CENTRALIZED METHOD --- 
            // Use setMovementTarget which handles state change and broadcast
            // Ensure targetEnemy position is valid before setting
            if (typeof targetEnemy.position.x === 'number' && typeof targetEnemy.position.y === 'number') {
                 zoneService.setMovementTarget(zoneId, character.id, targetEnemy.position.x, targetEnemy.position.y);
                 // Update character.attackTargetId here as setMovementTarget clears it
                 // We want to keep attacking this target once we reach it
                 // Since setMovementTarget modified the same character object, just re-assign.
                 character.attackTargetId = targetEnemy.id;
                 /* --- REMOVED RE-FETCH LOGIC --- 
                 const movingChar = zoneService.getCharacterById(zoneId, character.id); // Re-fetch needed after setMovementTarget
                 if (movingChar) {
                     movingChar.attackTargetId = targetEnemy.id;
                 } else {
                     this.logger.error(`[AttackingState] Failed to re-fetch character ${character.id} after setting move target!`);
                 }
                 */
             } else {
                 this.logger.error(`[AttackingState] Target enemy ${targetEnemy.id} has invalid position data. Cannot set movement target.`);
                 // Transition to idle if we can't move to the target
                 zoneService.setCharacterState(zoneId, character.id, 'idle');
                 character.attackTargetId = null;
             }
            // character.targetX = targetEnemy.position.x; <-- Handled by setMovementTarget
            // character.targetY = targetEnemy.position.y; <-- Handled by setMovementTarget
            // character.state = 'moving'; <-- Handled by setMovementTarget
            // ----------------------------
        }

        return results;
    }

    // Helper for XP Granting (extracted from original logic)
    private async _grantXpToParty(
        killerCharacter: RuntimeCharacterData,
        targetEnemy: EnemyInstance,
        dependencies: CharacterStateDependencies,
        zoneId: string,
    ): Promise<void> {
        const { zoneService, enemyService, characterService } = dependencies;
        try {
            const enemyTemplate = await enemyService.findOne(targetEnemy.templateId);
            if (enemyTemplate && enemyTemplate.xpReward > 0) {
                // Get all characters for the player who owns the attacking character IN THIS ZONE
                const partyMembers = zoneService.getPlayerCharactersInZone(
                    zoneId,
                    killerCharacter.ownerId,
                );
                if (partyMembers.length > 0) {
                    this.logger.log(
                        `Granting ${enemyTemplate.xpReward} XP to ${partyMembers.length} party member(s) (Owner: ${killerCharacter.ownerId}) for killing Enemy ${targetEnemy.id}`,
                    );
                    for (const member of partyMembers) {
                        // Grant XP only if the party member is in the same zone and alive
                        if (member.state !== 'dead') {
                            await characterService.addXp(member.id, enemyTemplate.xpReward);
                        } else if (member.state === 'dead') {
                            this.logger.debug(
                                `Skipping XP grant for dead party member ${member.id}`,
                            );
                        }
                    }
                } else {
                    this.logger.warn(`Could not find party members for player ${killerCharacter.ownerId} in zone ${zoneId} to grant XP.`);
                }
            } else if (enemyTemplate) {
                this.logger.debug(`Enemy template ${targetEnemy.templateId} has no XP reward.`);
            } else {
                this.logger.warn(`Could not find enemy template ${targetEnemy.templateId} to grant XP.`);
            }
        } catch (error) {
            this.logger.error(`Failed to grant XP to character ${killerCharacter.id} party after killing enemy ${targetEnemy.id}: ${error.message}`, error.stack);
        }
    }
} 