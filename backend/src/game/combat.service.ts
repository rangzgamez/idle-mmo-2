// backend/src/game/combat.service.ts
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ZoneService, RuntimeCharacterData } from './zone.service'; // Import ZoneService and RuntimeCharacterData
import { EnemyInstance } from './interfaces/enemy-instance.interface'; // Import EnemyInstance
import { CombatResult } from './interfaces/combat.interface';
import { BroadcastService } from './broadcast.service';
import { LootService } from '../loot/loot.service';
import { DroppedItem } from './interfaces/dropped-item.interface';
import { v4 as uuidv4 } from 'uuid';
// No longer need InventoryService here
// import { InventoryService } from '../inventory/inventory.service';

// Define combat participants with appropriate stats
type Combatant =
    | (EnemyInstance & { baseAttack: number, baseDefense: number }) // Enemies use base stats
    | (RuntimeCharacterData & { effectiveAttack: number, effectiveDefense: number }); // Characters use effective stats

@Injectable()
export class CombatService {
    private readonly logger = new Logger(CombatService.name);
    private readonly ITEM_DESPAWN_TIME_MS = 120000; // 2 minutes

    constructor(
        private readonly zoneService: ZoneService,
        private readonly broadcastService: BroadcastService,
        private readonly lootService: LootService,
        // Remove InventoryService injection
        // private readonly inventoryService: InventoryService,
    ) {}

    /**
     * Calculates damage based on effective/base stats.
     */
    calculateDamage(attackerEffectiveAttack: number, defenderEffectiveDefense: number): number {
        // Calculating damage from stats
        const rawDamage = attackerEffectiveAttack - defenderEffectiveDefense;
        // Raw damage calculated
        const finalDamage = Math.max(0, rawDamage); // Damage cannot be negative
        // Final damage calculated
        return finalDamage;
    }

    /**
     * Handles spell/AoE damage to multiple enemies in an area.
     * Uses the same damage system as normal attacks for consistency.
     * @param caster - The character casting the spell
     * @param targetX - X coordinate of spell target
     * @param targetY - Y coordinate of spell target
     * @param radius - AoE radius
     * @param spellDamage - Base spell damage
     * @param zoneId - Zone where spell is cast
     * @returns Array of combat results for each enemy hit
     */
    async handleSpellDamage(
        caster: RuntimeCharacterData,
        targetX: number,
        targetY: number,
        radius: number,
        spellDamage: number,
        zoneId: string,
    ): Promise<Array<CombatResult & { enemyId: string; distance: number }>> {
        const enemies = this.zoneService.getZoneEnemies(zoneId);
        const results: Array<CombatResult & { enemyId: string; distance: number }> = [];

        for (const enemy of enemies) {
            // Skip dead/dying enemies
            if (enemy.currentHealth <= 0 || enemy.isDying) {
                continue;
            }

            // Calculate distance from spell center
            const distance = Math.sqrt(
                Math.pow(enemy.position.x - targetX, 2) + 
                Math.pow(enemy.position.y - targetY, 2)
            );

            // Skip enemies outside spell radius
            if (distance > radius) {
                continue;
            }

            // Create a "fake attacker" for spell damage (no defense calculation)
            // For spells, use the target coordinates as the "attacker position" for knockback
            const spellAttacker = {
                ...caster,
                effectiveAttack: spellDamage, // Use raw spell damage
                positionX: targetX, // Spell center X
                positionY: targetY, // Spell center Y
            };

            // Apply spell damage using existing combat system
            const combatResult = await this.handleAttack(spellAttacker, enemy, zoneId);
            
            // Death effects are handled in handleAttack() - no separate logic needed
            
            results.push({
                ...combatResult,
                enemyId: enemy.id,
                distance,
            });

            this.logger.log(`Spell hit enemy ${enemy.id} for ${combatResult.damageDealt} damage (distance: ${distance.toFixed(1)})`);
        }

        this.logger.log(`Spell damage complete: ${results.length} enemies hit`);
        return results;
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
            // Processing combat between entities

            // --- 1. Get Effective/Base Stats ---
            // Check if attacker is Character (has ownerId/effectiveAttack) or Enemy
            const attackerStat = 'effectiveAttack' in attacker ? attacker.effectiveAttack : attacker.baseAttack ?? 0;
            // Check if defender is Character (has ownerId/effectiveDefense) or Enemy
            const defenderStat = 'effectiveDefense' in defender ? defender.effectiveDefense : defender.baseDefense ?? 0;

            const defenderInitialHealth = defender.currentHealth ?? 0;

            // Using attacker stats
            // Using defender stats

            // --- 2. Calculate Damage (using appropriate stats) ---
            const damageDealt = this.calculateDamage(attackerStat, defenderStat);

            // --- 3. Apply Damage (Existing logic remains the same) ---
            let targetDied = false;
            let targetCurrentHealth = defenderInitialHealth;

            if (damageDealt > 0) {
                // Applying damage to defender
                if ('ownerId' in defender && defender.ownerId) { // Defender is Character
                    // Defender is a character
                    const newHealth = await this.zoneService.updateCharacterHealth(defender.ownerId, defender.id, -damageDealt);
                    if (newHealth !== null) {
                        targetCurrentHealth = newHealth;
                        targetDied = targetCurrentHealth <= 0;
                    } else {
                        throw new Error(`Failed to update health for character ${defender.id}`);
                    }
                } else if ('id' in defender) { // Assume defender is Enemy
                    // Defender is an enemy
                    const newHealth = await this.zoneService.updateEnemyHealth(zoneId, defender.id, -damageDealt);
                    if (newHealth !== null) {
                        targetCurrentHealth = newHealth;
                        targetDied = targetCurrentHealth <= 0;
                        
                        // Apply death effects if enemy died (consolidated for ALL damage sources)
                        if (targetDied) {
                            await this.applyEnemyDeathEffects(defender as EnemyInstance, attacker, zoneId);
                        }
                    } else {
                        throw new Error(`Failed to update health for enemy ${defender.id}`);
                    }
                } else {
                    this.logger.error(`Could not determine defender type. Properties: ${Object.keys(defender).join(', ')}`);
                    throw new Error('Defender type could not be determined');
                }
            } else {
                // No damage dealt, no health update needed
                targetCurrentHealth = defenderInitialHealth;
                targetDied = defenderInitialHealth <= 0;
            }

            // --- 4. Return Result (Existing logic) ---
            // Attack resolved
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

    /**
     * Consolidated death effects for enemies - handles knockback, animations, and events
     * for ALL damage sources (attacks, spells, etc.)
     */
    private async applyEnemyDeathEffects(enemy: EnemyInstance, attacker: Combatant, zoneId: string): Promise<void> {
        this.logger.log(`Enemy ${enemy.id} killed - applying consolidated death effects`);
        
        // Calculate knockback direction based on attacker position
        let killerPosition: { x: number; y: number };
        
        if ('positionX' in attacker && 'positionY' in attacker && attacker.positionX !== null && attacker.positionY !== null) {
            // Attacker is a character (or spell with target coordinates)
            killerPosition = { x: attacker.positionX, y: attacker.positionY };
        } else if ('position' in attacker) {
            // Attacker is an enemy
            killerPosition = attacker.position;
        } else {
            // Fallback for spell damage or unknown attacker
            killerPosition = { x: 0, y: 0 };
        }
        
        const enemyPosition = enemy.position;
        
        // Calculate knockback direction
        const directionX = enemyPosition.x - killerPosition.x;
        const directionY = enemyPosition.y - killerPosition.y;
        const magnitude = Math.sqrt(directionX * directionX + directionY * directionY);
        
        const normalizedDirection = magnitude > 0 
            ? { x: directionX / magnitude, y: directionY / magnitude }
            : { x: Math.random() - 0.5, y: Math.random() - 0.5 };
        
        // Apply death state and knockback
        enemy.isDying = true;
        enemy.deathTimestamp = Date.now();
        enemy.knockbackState = {
            startTime: Date.now(),
            direction: normalizedDirection,
            distance: 80,
            duration: 300,
            originalPosition: { ...enemyPosition }
        };
        
        // Clear AI state
        enemy.aiState = 'DEAD';
        enemy.currentTargetId = null;
        
        // Handle loot drops
        await this.handleLootDrops(enemy, zoneId);

        // Queue death event for broadcast
        this.broadcastService.queueDeath(zoneId, { 
            entityId: enemy.id, 
            type: 'enemy' 
        });
        
        this.logger.log(`Death effects applied: Enemy ${enemy.id} marked as dying with knockback`);
    }

    /**
     * Handle loot drops when an enemy dies
     */
    private async handleLootDrops(enemy: EnemyInstance, zoneId: string): Promise<void> {
        if (!enemy.lootTableId) {
            this.logger.debug(`Enemy ${enemy.name} has no loot table`);
            return;
        }

        try {
            this.logger.debug(`Calculating loot for enemy ${enemy.name} with table ${enemy.lootTableId}`);
            const droppedLoot = await this.lootService.calculateLootDrops(enemy.lootTableId);
            
            if (droppedLoot.length > 0) {
                this.logger.debug(`Loot calculated: ${droppedLoot.length} items dropped`);
                const now = Date.now();
                const despawnTime = now + this.ITEM_DESPAWN_TIME_MS;
                
                for (const loot of droppedLoot) {
                    const droppedItem: DroppedItem = {
                        id: uuidv4(),
                        itemTemplateId: loot.itemTemplate.id,
                        itemName: loot.itemTemplate.name,
                        itemType: loot.itemTemplate.itemType,
                        position: { ...enemy.position },
                        quantity: loot.quantity,
                        timeDropped: now,
                        despawnTime: despawnTime,
                    };
                    
                    const added = this.zoneService.addDroppedItem(zoneId, droppedItem);
                    if (added) {
                        this.logger.debug(`Added item ${droppedItem.itemName} (${droppedItem.id}) at (${droppedItem.position.x}, ${droppedItem.position.y})`);
                        
                        // Queue the broadcast event
                        const itemPayload = {
                            id: droppedItem.id,
                            itemTemplateId: droppedItem.itemTemplateId,
                            itemName: droppedItem.itemName,
                            itemType: droppedItem.itemType,
                            spriteKey: loot.itemTemplate.spriteKey,
                            position: droppedItem.position,
                            quantity: droppedItem.quantity,
                        };
                        
                        this.broadcastService.queueItemDropped(zoneId, itemPayload);
                        this.logger.debug(`Queued broadcast for item ${itemPayload.itemName} (${itemPayload.id})`);
                    } else {
                        this.logger.error(`Failed to add dropped item ${droppedItem.itemName} (${droppedItem.id}) to zone ${zoneId}`);
                    }
                }
            } else {
                this.logger.debug(`No loot calculated for enemy ${enemy.name}`);
            }
        } catch (error) {
            this.logger.error(`Error handling loot drops for enemy ${enemy.id}: ${error.message}`);
        }
    }
}