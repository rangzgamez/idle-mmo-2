// backend/src/game/combat.service.ts
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ZoneService, RuntimeCharacterData } from './zone.service'; // Import ZoneService and RuntimeCharacterData
import { EnemyInstance } from './interfaces/enemy-instance.interface'; // Import EnemyInstance
import { CombatResult } from './interfaces/combat.interface';
// No longer need EnemyService here if stats are passed in
// import { EnemyService } from '../enemy/enemy.service'; 

// Define a common structure for combat participants
// We might need base stats here if not directly on EnemyInstance/RuntimeCharacterData
// For now, assume they have necessary stats like baseAttack, baseDefense, currentHealth
type Combatant = (EnemyInstance & { baseAttack: number, baseDefense: number }) 
               | (RuntimeCharacterData & { baseAttack: number, baseDefense: number });

@Injectable()
export class CombatService {
    private readonly logger = new Logger(CombatService.name);

    constructor(
        private readonly zoneService: ZoneService,
        // Remove EnemyService injection
        // private readonly enemyService: EnemyService,
    ) {}

    /**
     * Calculates the base damage dealt from attacker to defender.
     */
    calculateDamage(attackerAttack: number, defenderDefense: number): number {
        this.logger.debug(`Calculating damage: Attacker Attack = ${attackerAttack}, Defender Defense = ${defenderDefense}`);
        const rawDamage = attackerAttack - defenderDefense;
        this.logger.debug(`Raw damage (Attack - Defense) = ${rawDamage}`);
        const finalDamage = Math.max(0, rawDamage); // Damage cannot be negative
        this.logger.debug(`Final damage (Clamped to >= 0) = ${finalDamage}`);
        return finalDamage;
    }

    /**
     * Handles a complete attack interaction between two entities.
     * Assumes attacker and defender objects contain necessary stats.
     * Calculates damage, applies it via ZoneService, checks for death.
     * @returns Promise<CombatResult> - The outcome of the attack.
     */
    async handleAttack(
        attacker: Combatant,
        defender: Combatant,
        zoneId: string, // Still needed for ZoneService calls
    ): Promise<CombatResult> {
        try {
            // Log initial states
            this.logger.debug(`Handling attack: Attacker ID=${attacker.id}, Defender ID=${defender.id}`);
            this.logger.debug(`Attacker Stats: Attack=${attacker.baseAttack ?? 'N/A'}`);
            this.logger.debug(`Defender Stats: Defense=${defender.baseDefense ?? 'N/A'}, Current Health=${defender.currentHealth ?? 'N/A'}`);

            // --- 1. Get Stats (Directly from objects) ---
            const attackerAttack = attacker.baseAttack ?? 0;
            const defenderDefense = defender.baseDefense ?? 0;
            const defenderInitialHealth = defender.currentHealth ?? 0; // Health before damage

            // --- 2. Calculate Damage (Now logs internally) ---
            const damageDealt = this.calculateDamage(attackerAttack, defenderDefense);

            // --- 3. Apply Damage ---
            let targetDied = false;
            let targetCurrentHealth = defenderInitialHealth;

            if (damageDealt > 0) {
                this.logger.debug(`Applying ${damageDealt} damage to defender ${defender.id}`);
                 // Corrected Type Check: Check for ownerId first
                 if ('ownerId' in defender && defender.ownerId) { // Defender is RuntimeCharacterData
                     this.logger.debug(`Defender identified as Character (ID: ${defender.id}, Owner: ${defender.ownerId})`);
                     // Ensure ownerId is actually present (it should be based on type, but belt-and-suspenders)
                     const newHealth = await this.zoneService.updateCharacterHealth(defender.ownerId, defender.id, -damageDealt);
                     if (newHealth !== null) {
                         targetCurrentHealth = newHealth;
                         targetDied = targetCurrentHealth <= 0;
                     } else {
                         throw new Error(`Failed to update health for character ${defender.id}`);
                     }
                 } else if ('id' in defender) { // Assume defender is EnemyInstance (has id but no ownerId)
                     this.logger.debug(`Defender identified as Enemy (ID: ${defender.id})`);
                     const newHealth = await this.zoneService.updateEnemyHealth(zoneId, defender.id, -damageDealt);
                     if (newHealth !== null) {
                         targetCurrentHealth = newHealth;
                         targetDied = targetCurrentHealth <= 0;
                     } else {
                         throw new Error(`Failed to update health for enemy ${defender.id}`);
                     }
                 } else {
                      // Type is 'never' here, cannot safely access defender.id
                     this.logger.error(`Could not determine defender type. Properties: ${Object.keys(defender).join(', ')}`);
                     throw new Error('Defender type could not be determined');
                 }
            } else {
                this.logger.debug(`Damage dealt is ${damageDealt}, no health update needed for ${defender.id}`);
                targetCurrentHealth = defenderInitialHealth; // Ensure health is set correctly
                targetDied = defenderInitialHealth <= 0; // Check if already dead
            }

            // --- 4. Return Result ---
            this.logger.log(`Attack resolved: ${attacker.id} -> ${defender.id}. Damage: ${damageDealt}, Target Died: ${targetDied}, Target Health: ${targetCurrentHealth}`);
            return {
                damageDealt,
                targetDied,
                targetCurrentHealth,
            };

        } catch (error) {
            this.logger.error(`Error during handleAttack (${attacker.id} -> ${defender.id}): ${error.message}`, error.stack);
            // Simplified error handling return
            return {
                damageDealt: 0,
                targetDied: defender.currentHealth <= 0, // Best guess based on state before error
                targetCurrentHealth: defender.currentHealth ?? 0,
                error: error.message || 'Unknown combat error',
            };
        }
    }
}