// frontend/src/types/zone.types.ts

// Defines the data structure for a character's state within a zone,
// typically received from the server.
export interface ZoneCharacterState {
    id: string;
    ownerId: string; // ID of the user who owns the character
    ownerName: string; // Username of the owner
    name: string; // Character's name
    level: number;
    x: number | null;
    y: number | null;
    currentHealth: number;
    baseHealth: number; // Max health
    className: string; // e.g., 'fighter', 'wizard' (used for sprite lookup)
    state?: string; // Current state string (e.g., 'idle', 'moving', 'attacking') - Make optional as it might not always be sent initially
    // Add other fields if the server sends them and they are needed client-side
    // e.g., targetX?: number | null;
    // e.g., targetY?: number | null;
    // e.g., attackTargetId?: string | null;
} 
