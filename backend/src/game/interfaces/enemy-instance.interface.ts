export interface EnemyInstance {
    instanceId: string; // Unique ID for *this specific enemy* instance.  Use UUID.
    templateId: string; // ID of the EnemyTemplate this instance is based on.
    zoneId: string; // The zone this enemy currently resides in.
    currentHealth: number;
    position: { x: number; y: number };
    target?: { x: number; y: number } | null; // Optional: target position if moving.
    aiState: string; // e.g., "IDLE", "CHASING", "ATTACKING"
    lastAttackTime?: number; // Timestamp of the last attack.
  }