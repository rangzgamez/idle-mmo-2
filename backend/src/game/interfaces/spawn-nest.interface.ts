import { Enemy } from "../../enemy/enemy.entity";

/**
 * Defines a specific location and parameters for spawning enemies.
 */
export interface SpawnNest {
    id: string; // Unique identifier for the nest (e.g., 'goblin-camp-1')
    zoneId: string; // The zone this nest belongs to
    templateId: string; // The ID of the Enemy template to spawn
    center: { x: number; y: number }; // Center coordinates of the nest
    radius: number; // Radius around the center where enemies can spawn/wander
    maxCapacity: number; // Maximum number of enemies this nest can hold
    currentEnemyIds: Set<string>; // Set of IDs of enemies currently alive from this nest
    respawnDelayMs: number; // Time in ms before trying to respawn after a slot opens
    lastSpawnCheckTime: number; // Timestamp of the last time a spawn was attempted/occurred
} 