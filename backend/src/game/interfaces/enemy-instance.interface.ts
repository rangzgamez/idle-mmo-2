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
    // Add speed? range? from template if needed elsewhere
    // name: string;

    // --- Nest Information ---
    nestId?: string; // ID of the spawn nest this enemy belongs to
    anchorX?: number; // Original spawn point X (nest center)
    anchorY?: number; // Original spawn point Y (nest center)
    wanderRadius?: number; // Radius the enemy can wander within its nest
    currentTargetId?: string | null; // ID of the character the enemy is currently focused on
}