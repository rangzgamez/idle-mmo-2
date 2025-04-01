export interface EnemyInstance {
    id: string; // Unique ID for *this specific enemy* instance.  Use UUID.
    templateId: string; // ID of the EnemyTemplate this instance is based on.
    zoneId: string; // The zone this enemy currently resides in.
    currentHealth: number;
    position: { x: number; y: number };
    target?: { x: number; y: number } | null; // Optional: target position if moving.
    aiState: string; // e.g., "IDLE", "CHASING", "ATTACKING", "COOLDOWN"
    lastAttackTime?: number; // Needed for cooldowns

    // Add stats needed for combat
    baseAttack: number;
    baseDefense: number;
    // Add name? speed? range? from template if needed elsewhere
    // name: string;
  }