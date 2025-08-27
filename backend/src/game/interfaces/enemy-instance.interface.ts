import { Character } from "../../character/character.entity";

export interface EnemyInstance {
    id: string; // Unique ID for *this specific enemy* instance.  Use UUID.
    templateId: string; // ID of the EnemyTemplate this instance is based on.
    zoneId: string; // The zone this enemy currently resides in.
    currentHealth: number;
    position: { x: number; y: number };
    target?: { x: number; y: number } | null; // Optional: target position if moving.
    aiState: string; // e.g., "IDLE", "CHASING", "ATTACKING", "COOLDOWN", "DEAD", "WANDERING", "LEASHED"
    lastAttackTime?: number; // Needed for cooldowns

    // Add stats needed for combat
    baseAttack: number;
    baseDefense: number;
    name: string; // <-- ADDED: Name from the template for client display
    baseSpeed: number; // <-- ADDED: Speed from the template for movement
    lootTableId: string | null; // <-- ADDED: Loot table ID from template
    // Add speed? range? from template if needed elsewhere
    // name: string;

    // --- Nest Information ---
    nestId?: string; // ID of the spawn nest this enemy belongs to
    anchorX?: number; // Original spawn point X (nest center)
    anchorY?: number; // Original spawn point Y (nest center)
    wanderRadius?: number; // Radius the enemy can wander within its nest
    currentTargetId?: string | null; // ID of the character the enemy is currently focused on
    
    // --- Death & Knockback State ---
    isDying?: boolean; // Whether the enemy is in death animation phase
    deathTimestamp?: number; // When the enemy died (for decay timer)
    knockbackState?: {
        startTime: number; // When knockback animation started
        direction: { x: number; y: number }; // Unit vector direction for knockback
        distance: number; // Total knockback distance in pixels
        duration: number; // Duration of knockback animation in milliseconds
        originalPosition: { x: number; y: number }; // Starting position for knockback calculation
    };
}