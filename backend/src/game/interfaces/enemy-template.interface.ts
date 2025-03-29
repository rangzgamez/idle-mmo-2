// backend/src/game/interfaces/enemy-template.interface.ts
export interface EnemyInstance {
    id: string; // Unique identifier for the enemy type (e.g., "goblin", "orc")
    name: string; // Display name (e.g., "Goblin Warrior", "Orc Shaman")
    level: number; // Level of the enemy
    baseHealth: number; // Base health points
    baseAttack: number; // Base attack damage
    baseDefense: number; // Base defense (damage reduction)
    baseSpeed: number; // Movement speed
    attackRange: number; // Distance the enemy can attack from
    xpReward: number; // XP awarded to the player on defeat
    behaviorFlags: EnemyBehaviorFlags; // Flags controlling enemy behavior
    lootTableId?: string; // Optional reference to a loot table.
    spriteKey: string; // Key to use for the enemy's sprite in the frontend. (e.g. "goblin")
  }
  
  interface EnemyBehaviorFlags {
    isAggressive: boolean; // Does the enemy automatically attack nearby players?
    isStationary: boolean;  // Does the enemy stay in one place?
    canFlee: boolean;      // Does the enemy attempt to flee when low on health?
  }