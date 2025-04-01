// backend/src/game/combat.service.ts
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ZoneService } from './zone.service'; // Inject ZoneService
import { EnemyService } from '../enemy/enemy.service'; // Inject EnemyService
import { CombatResult } from './interfaces/combat.interface'; // Import the interface

@Injectable()
export class CombatService {
    private readonly logger = new Logger(CombatService.name);

    constructor(
        private readonly zoneService: ZoneService,
        private readonly enemyService: EnemyService,
        // Inject CharacterService if needed for base stats later
    ) {}

    /**
     * Calculates the base damage dealt from attacker to defender.
     */
    calculateDamage(attackerAttack: number, defenderDefense: number): number {
        let damage = attackerAttack - defenderDefense;
        // Basic formula: Attack minus Defense
        // Add critical hits, randomness, resistances etc. later
        return Math.max(0, damage); // Damage cannot be negative
    }

    /**
     * Handles a complete attack interaction between two entities.
     * Fetches stats, calculates damage, applies it, checks for death.
     * @returns Promise<CombatResult> - The outcome of the attack.
     */
    async handleAttack(
        attackerId: string,
        attackerType: 'enemy' | 'character',
        defenderId: string,
        defenderType: 'enemy' | 'character',
        zoneId: string,
    ): Promise<CombatResult> {
        try {
            // --- 1. Get Attacker Stats ---
            let attackerAttack = 0;
            if (attackerType === 'enemy') {
                const enemyInstance = this.zoneService.getEnemy(zoneId, attackerId);
                if (!enemyInstance) throw new NotFoundException(`Attacker enemy ${attackerId} not found in zone ${zoneId}`);
                const enemyTemplate = await this.enemyService.findOne(enemyInstance.templateId);
                if (!enemyTemplate) throw new NotFoundException(`Enemy template ${enemyInstance.templateId} not found`);
                attackerAttack = enemyTemplate.baseAttack;
            } else { // Attacker is character
                // TODO: Fetch character stats - requires ownerId
                // For now, use a placeholder
                attackerAttack = 15; // Placeholder character attack
            }

            // --- 2. Get Defender Stats & State ---
            let defenderDefense = 0;
            let defenderCurrentHealth = 0;
            let defenderOwnerId: string | null = null; // Needed if defender is a character

            if (defenderType === 'enemy') {
                const enemyInstance = this.zoneService.getEnemy(zoneId, defenderId);
                if (!enemyInstance) throw new NotFoundException(`Defender enemy ${defenderId} not found in zone ${zoneId}`);
                const enemyTemplate = await this.enemyService.findOne(enemyInstance.templateId);
                if (!enemyTemplate) throw new NotFoundException(`Enemy template ${enemyInstance.templateId} not found`);
                defenderDefense = enemyTemplate.baseDefense;
                defenderCurrentHealth = enemyInstance.currentHealth;
            } else { // Defender is character
                // Find the character across all players in the zone
                const characterData = this.zoneService.findCharacterInZoneById(zoneId, defenderId);
                if (!characterData) throw new NotFoundException(`Defender character ${defenderId} not found in zone ${zoneId}`);

                defenderDefense = characterData.baseDefense ?? 5; // Placeholder character defense
                defenderCurrentHealth = characterData.currentHealth ?? 100; // Get current health
                defenderOwnerId = characterData.ownerId!; // Get owner ID
            }

            // --- 3. Calculate Damage ---
            const damageDealt = this.calculateDamage(attackerAttack, defenderDefense);

            // --- 4. Apply Damage ---
            let targetDied = false;
            let targetCurrentHealth = defenderCurrentHealth; // Start with current health before damage

            if (damageDealt > 0) {
                if (defenderType === 'enemy') {
                    const success = this.zoneService.updateEnemyHealth(zoneId, defenderId, -damageDealt);
                    if (success) {
                        const updatedEnemy = this.zoneService.getEnemy(zoneId, defenderId);
                        targetCurrentHealth = updatedEnemy?.currentHealth ?? 0; // Get health AFTER update
                        targetDied = targetCurrentHealth <= 0;
                    } else {
                         throw new Error(`Failed to update health for enemy ${defenderId}`);
                    }
                } else { // Defender is character
                     if (!defenderOwnerId) throw new Error(`Defender character ${defenderId} ownerId is missing`);
                    const success = this.zoneService.updateCharacterHealth(defenderOwnerId, defenderId, -damageDealt);
                     if (success) {
                         const updatedCharacter = this.zoneService.getPlayerCharacterById(defenderOwnerId, defenderId);
                         targetCurrentHealth = updatedCharacter?.currentHealth ?? 0; // Get health AFTER update
                         targetDied = targetCurrentHealth <= 0;
                     } else {
                          throw new Error(`Failed to update health for character ${defenderId}`);
                     }
                }
            } else {
                // No damage dealt, health remains the same
                 targetCurrentHealth = defenderCurrentHealth;
                 targetDied = defenderCurrentHealth <= 0; // Could already be dead
            }

            // --- 5. Return Result ---
            this.logger.log(`Attack resolved: ${attackerType} ${attackerId} -> ${defenderType} ${defenderId}. Damage: ${damageDealt}, Target Died: ${targetDied}, Target Health: ${targetCurrentHealth}`);
            return {
                damageDealt,
                targetDied,
                targetCurrentHealth,
            };

        } catch (error) {
            this.logger.error(`Error during handleAttack (${attackerId} -> ${defenderId}): ${error.message}`, error.stack);
            return {
                damageDealt: 0,
                targetDied: false,
                // Attempt to get current health even on error, might be useful
                targetCurrentHealth: this.getCurrentHealthOnError(zoneId, defenderId, defenderType),
                error: error.message || 'Unknown combat error',
            };
        }
    }

     // Helper to try and get health even if main logic failed
     private getCurrentHealthOnError(zoneId: string, entityId: string, entityType: 'enemy' | 'character'): number {
         try {
             if (entityType === 'enemy') {
                 return this.zoneService.getEnemy(zoneId, entityId)?.currentHealth ?? 0;
             } else {
                // Need a way to get character health without ownerId if possible, or just return 0
                // This might require enhancing findCharacterInZoneById or another getter
                 const char = this.zoneService.findCharacterInZoneById(zoneId, entityId);
                 return char?.currentHealth ?? 0;
             }
         } catch {
             return 0; // Default to 0 if lookup fails
         }
     }
}