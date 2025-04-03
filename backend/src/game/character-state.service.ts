import { Injectable, Logger } from '@nestjs/common';
import { ZoneService, RuntimeCharacterData } from './zone.service';
import { CombatService } from './combat.service';
import { EnemyInstance } from './interfaces/enemy-instance.interface';

// Define the structure for the results returned by processing a character tick
export interface CharacterTickResult {
    characterData: RuntimeCharacterData; // The potentially modified character data
    combatActions: any[]; // Combat actions initiated by this character (e.g., attack visuals)
    enemyHealthUpdates: Array<{ id: string, health: number }>; // Enemy health changes caused by this character
    diedThisTick: boolean; // Did the character die this tick?
    respawnedThisTick: boolean; // Did the character respawn this tick?
    targetDied: boolean; // Did the character's target die this tick?
}


@Injectable()
export class CharacterStateService {
    private readonly logger = new Logger(CharacterStateService.name);
     // Constants potentially needed (could be moved to a config service later)
     private readonly RESPAWN_TIME_MS = 5000;
     private readonly CHARACTER_HEALTH_REGEN_PERCENT_PER_SEC = 1.0;

    constructor(
        private zoneService: ZoneService,
        private combatService: CombatService,
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
     * @param now Current timestamp (Date.now()).
     * @param deltaTime Time elapsed since the last tick in seconds.
     * @returns CharacterTickResult containing updates and events from this tick.
     */
    async processCharacterTick(
        character: RuntimeCharacterData,
        playerId: string,
        zoneId: string,
        enemiesInZone: EnemyInstance[],
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
                results.respawnedThisTick = true;
                // No further processing this tick after respawning
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
            results.diedThisTick = true;
            // No further processing this tick after dying
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

        // --- 2. State Logic (Only if NOT leashing) ---
        if (!isLeashing) {
            switch (character.state) {
                case 'attacking':
                    const targetEnemy = character.attackTargetId ? this.zoneService.getEnemyInstanceById(zoneId, character.attackTargetId) : undefined;

                    if (!targetEnemy || targetEnemy.currentHealth <= 0) {
                        // Target is invalid or dead, switch back to idle
                        // this.logger.debug(`Character ${character.id} target ${character.attackTargetId} invalid/dead. Switching to idle.`);
                        character.attackTargetId = null;
                        character.state = 'idle';
                        character.targetX = null; // Stop moving
                        character.targetY = null;
                    } else {
                        // Valid target exists, check range
                        const distToTargetSq = (character.positionX - targetEnemy.position.x)**2 + (character.positionY - targetEnemy.position.y)**2;
                        const attackRangeSq = character.attackRange * character.attackRange;

                        if (distToTargetSq <= attackRangeSq) {
                            // In Range: Stop moving if approaching
                            if (character.targetX !== null || character.targetY !== null) {
                                character.targetX = null;
                                character.targetY = null;
                            }
                            // Check attack cooldown
                            if (now >= character.lastAttackTime + character.attackSpeed) {
                                // Attack!
                                // this.logger.debug(`Character ${character.id} attacking ${targetEnemy.id}`);
                                const combatResult = await this.combatService.handleAttack(character, targetEnemy, zoneId);
                                character.lastAttackTime = now; // Update last attack time

                                // Add combat action for visual feedback
                                results.combatActions.push({ attackerId: character.id, targetId: targetEnemy.id, damage: combatResult.damageDealt, type: 'attack' });

                                // Record enemy health update
                                results.enemyHealthUpdates.push({ id: targetEnemy.id, health: combatResult.targetCurrentHealth });

                                if (combatResult.targetDied) {
                                    this.logger.log(`Enemy ${targetEnemy.id} died from attack by Character ${character.id}`);
                                    results.targetDied = true; // Signal target death
                                    character.attackTargetId = null; // Stop targeting dead enemy
                                    character.state = 'idle'; // Go idle after kill

                                    // Enemy removal from ZoneService will be handled by the main loop based on targetDied flag
                                }
                            }
                        } else {
                            // Out of Range: Move Towards Target
                            if (character.targetX !== targetEnemy.position.x || character.targetY !== targetEnemy.position.y) {
                                // this.logger.debug(`Character ${character.id} moving towards ${targetEnemy.id} to attack.`);
                                character.targetX = targetEnemy.position.x;
                                character.targetY = targetEnemy.position.y;
                                // State remains 'attacking', movement simulation will handle moving
                            }
                        }
                    }
                    break;

                case 'moving':
                    // Movement simulation handles the actual position change.
                    // Here, we just check if the destination is reached to transition back to idle.
                     if (character.targetX !== null && character.targetY !== null) {
                         const dx = character.targetX - character.positionX;
                         const dy = character.targetY - character.positionY;
                         const distSq = dx*dx + dy*dy;
                         const closeEnoughThresholdSq = 1; // Use squared threshold
                         if (distSq <= closeEnoughThresholdSq) {
                             // this.logger.debug(`Character ${character.id} reached move destination.`);
                             character.state = 'idle';
                             character.positionX = character.targetX; // Snap to target
                             character.positionY = character.targetY;
                             character.targetX = null;
                             character.targetY = null;
                         }
                     } else {
                          // In moving state but no target? Should not happen if state transitions are correct.
                          this.logger.warn(`Character ${character.id} in 'moving' state but has no target. Setting idle.`);
                          character.state = 'idle';
                     }
                    break;

                case 'idle':
                    // Auto-Aggro Scan
                    if (character.aggroRange > 0) {
                        let closestEnemy: EnemyInstance | null = null;
                        let minDistSq = character.aggroRange * character.aggroRange; // Use squared range

                        for (const enemy of enemiesInZone) {
                             if (enemy.currentHealth <= 0) continue; // Skip dead enemies

                             // Basic position validation before distance check
                             if (character.positionX === null || character.positionY === null || typeof enemy.position.x !== 'number' || typeof enemy.position.y !== 'number') {
                                 this.logger.warn(`Skipping aggro check due to invalid position: Char(${character.positionX}, ${character.positionY}), Enemy(${enemy.position.x}, ${enemy.position.y})`);
                                 continue;
                             }

                             const distSq = (character.positionX - enemy.position.x)**2 + (character.positionY - enemy.position.y)**2;
                             if (distSq <= minDistSq) { // Check against squared range and find closest
                                 minDistSq = distSq;
                                 closestEnemy = enemy;
                             }
                        }

                        if (closestEnemy) {
                            this.logger.debug(`Character ${character.id} [${character.name}] auto-aggroed onto Enemy ${closestEnemy.id} (Dist: ${Math.sqrt(minDistSq).toFixed(1)}). Switching to attacking state.`);
                            character.state = 'attacking';
                            character.attackTargetId = closestEnemy.id;
                            // Don't set targetX/Y yet, let the 'attacking' state handle moving if needed next tick
                        }
                    } // End Aggro Scan

                    // Return to Anchor Check (only if still idle after aggro scan)
                    if (character.state === 'idle' && character.anchorX !== null && character.anchorY !== null) {
                         const distToAnchorSq = (character.positionX - character.anchorX)**2 + (character.positionY - character.anchorY)**2;
                         if (distToAnchorSq > 1) { // Use a small threshold
                            // this.logger.debug(`Character ${character.id} returning to anchor.`);
                             character.state = 'moving';
                             character.targetX = character.anchorX;
                             character.targetY = character.anchorY;
                         }
                     }
                    break;
            } // End switch(character.state)
        } // End if(!isLeashing)


        // Return the modified character data and any generated events/updates
        results.characterData = character;
        return results;
    }

     // Optional: Helper for distance if needed, though MovementService might handle it
     // private calculateDistance(point1: {x:number, y:number}, point2: {x:number, y:number}): number { ... }
}
