// frontend/src/types/enemy.types.ts

// Corresponds to the runtime data for an enemy instance in a zone
export interface EnemyInstance {
    id: string; // Unique instance ID
    templateId: string; // ID of the enemy template
    name: string;
    zoneId: string;
    currentHealth: number;
    baseHealth: number; // Max health
    position: { x: number; y: number };
    spriteKey: string; // Key for the visual sprite
    // Optional fields that might be sent
    state?: string; // e.g., "IDLE", "CHASING", "ATTACKING"
    targetX?: number | null;
    targetY?: number | null;
    // Add any other relevant fields sent by the backend
} 