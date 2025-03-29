// backend/src/game/combat.service.ts
import { Injectable } from '@nestjs/common';

@Injectable()
export class CombatService {
  /**
   * Calculates the damage dealt from attacker to defender.
   * This is a very basic implementation and can be expanded with more sophisticated
   * formulas (critical hits, resistances, etc.).
   * @param attackerAttack - The attacker's attack stat.
   * @param defenderDefense - The defender's defense stat.
   * @returns The amount of damage dealt. Can be zero (blocked).
   */
  calculateDamage(attackerAttack: number, defenderDefense: number): number {
    let damage = attackerAttack - defenderDefense;
    if (damage < 0) {
      damage = 0; // Defender blocked the attack entirely.
    }
    return damage;
  }
}