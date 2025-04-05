// backend/src/game/combat.service.ts
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ZoneService, RuntimeCharacterData } from './zone.service'; // Import ZoneService and RuntimeCharacterData
import { EnemyInstance } from './interfaces/enemy-instance.interface'; // Import EnemyInstance
import { CombatResult } from './interfaces/combat.interface';
// No longer need InventoryService here
// import { InventoryService } from '../inventory/inventory.service';

// Define combat participants with appropriate stats
type Combatant =
    | (EnemyInstance & { baseAttack: number, baseDefense: number }) // Enemies use base stats
    | (RuntimeCharacterData & { effectiveAttack: number, effectiveDefense: number }); // Characters use effective stats

@Injectable()
export class CombatService {
    private readonly logger = new Logger(CombatService.name);

    constructor(
        private readonly zoneService: ZoneService,
        // Remove InventoryService injection
        // private readonly inventoryService: InventoryService,
    ) {}

    /**
     * Calculates damage based on effective/base stats.
     */
    calculateDamage(attackerEffectiveAttack: number, defenderEffectiveDefense: number): number {
        this.logger.debug(`Calculating damage: Attacker Effective Attack = ${attackerEffectiveAttack}, Defender Effective Defense = ${defenderEffectiveDefense}`);
        const rawDamage = attackerEffectiveAttack - defenderEffectiveDefense;
        this.logger.debug(`Raw damage (Effective Attack - Effective Defense) = ${rawDamage}`);
        const finalDamage = Math.max(0, rawDamage); // Damage cannot be negative
        this.logger.debug(`Final damage (Clamped to >= 0) = ${finalDamage}`);
        return finalDamage;
    }

    /**
     * Handles a complete attack interaction between two entities.
     * Uses pre-calculated effective stats for characters, base stats for enemies.
     * Calculates damage, applies it via ZoneService, checks for death.
     * @returns Promise<CombatResult> - The outcome of the attack.
     */
    async handleAttack(
        attacker: Combatant,
        defender: Combatant,
        zoneId: string,
    ): Promise<CombatResult> {
        try {
            this.logger.debug(`Handling attack: Attacker ID=${attacker.id}, Defender ID=${defender.id}`);

            // --- 1. Get Effective/Base Stats ---
            // Check if attacker is Character (has ownerId/effectiveAttack) or Enemy
            const attackerStat = 'effectiveAttack' in attacker ? attacker.effectiveAttack : attacker.baseAttack ?? 0;
            // Check if defender is Character (has ownerId/effectiveDefense) or Enemy
            const defenderStat = 'effectiveDefense' in defender ? defender.effectiveDefense : defender.baseDefense ?? 0;

            const defenderInitialHealth = defender.currentHealth ?? 0;

            this.logger.debug(`Attacker Stat Used: ${ 'effectiveAttack' in attacker ? 'Effective' : 'Base' } Attack = ${attackerStat}`);
            this.logger.debug(`Defender Stat Used: ${ 'effectiveDefense' in defender ? 'Effective' : 'Base' } Defense = ${defenderStat}, Current Health=${defenderInitialHealth}`);

            // --- 2. Calculate Damage (using appropriate stats) ---
            const damageDealt = this.calculateDamage(attackerStat, defenderStat);

            // --- 3. Apply Damage (Existing logic remains the same) ---
            let targetDied = false;
            let targetCurrentHealth = defenderInitialHealth;

            if (damageDealt > 0) {
                this.logger.debug(`Applying ${damageDealt} damage to defender ${defender.id}`);
                if ('ownerId' in defender && defender.ownerId) { // Defender is Character
                    this.logger.debug(`Defender identified as Character (ID: ${defender.id}, Owner: ${defender.ownerId})`);
                    const newHealth = await this.zoneService.updateCharacterHealth(defender.ownerId, defender.id, -damageDealt);
                    if (newHealth !== null) {
                        targetCurrentHealth = newHealth;
                        targetDied = targetCurrentHealth <= 0;
                    } else {
                        throw new Error(`Failed to update health for character ${defender.id}`);
                    }
                } else if ('id' in defender) { // Assume defender is Enemy
                    this.logger.debug(`Defender identified as Enemy (ID: ${defender.id})`);
                    const newHealth = await this.zoneService.updateEnemyHealth(zoneId, defender.id, -damageDealt);
                    if (newHealth !== null) {
                        targetCurrentHealth = newHealth;
                        targetDied = targetCurrentHealth <= 0;
                    } else {
                        throw new Error(`Failed to update health for enemy ${defender.id}`);
                    }
                } else {
                    this.logger.error(`Could not determine defender type. Properties: ${Object.keys(defender).join(', ')}`);
                    throw new Error('Defender type could not be determined');
                }
            } else {
                this.logger.debug(`Damage dealt is ${damageDealt}, no health update needed for ${defender.id}`);
                targetCurrentHealth = defenderInitialHealth;
                targetDied = defenderInitialHealth <= 0;
            }

            // --- 4. Return Result (Existing logic) ---
            this.logger.log(`Attack resolved: ${attacker.id} -> ${defender.id}. Damage: ${damageDealt}, Target Died: ${targetDied}, Target Health: ${targetCurrentHealth}`);
            return {
                damageDealt,
                targetDied,
                targetCurrentHealth,
            };

        } catch (error) {
            this.logger.error(`Error during handleAttack (${attacker.id} -> ${defender.id}): ${error.message}`, error.stack);
            return {
                damageDealt: 0,
                targetDied: defender.currentHealth <= 0,
                targetCurrentHealth: defender.currentHealth ?? 0,
                error: error.message || 'Unknown combat error',
            };
        }
    }
}