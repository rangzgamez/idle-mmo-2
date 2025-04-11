// frontend/src/network/NetworkManager.ts
import { io, Socket } from 'socket.io-client';
import { EventBus } from '../EventBus';

// Define interfaces for expected data structures (optional but good practice)
interface ZoneCharacterState {
    id: string;
    ownerId: string;
    ownerName: string;
    name: string;
    level: number;
    x: number | null;
    y: number | null;
}

interface EntityUpdateData {
    id: string;
    x?: number | null;
    y?: number | null;
    // Add other potential update fields later (health, state, etc.)
}

// Interface for data received when an enemy spawns
interface EnemySpawnData {
    id: string;
    templateId: string;
    zoneId: string;
    name: string;
    currentHealth: number;
    baseAttack?: number; // Optional, might not be needed by client
    baseDefense?: number; // Optional
    position: { x: number; y: number };
    aiState?: string; // Optional
    nestId?: string; // Optional
    anchorX?: number; // Optional
    anchorY?: number; // Optional
    wanderRadius?: number; // Optional
    // Add baseHealth if backend sends it, otherwise client might need to infer max HP
    baseHealth?: number; // Added baseHealth if available
}

// +++ ADD: CombatActionData interface (if not imported/shared) +++
interface CombatActionData {
    attackerId: string;
    targetId: string;
    damage: number;
    type: string;
}

// +++ Interface for Character Class Template data received from API +++
export interface CharacterClassTemplateData {
    classId: string; // Matches CharacterClass enum values (e.g., 'WIZARD')
    name: string;
    description: string;
    baseHealth: number;
    baseAttack: number;
    baseDefense: number;
    attackSpeed: number;
    attackRange: number;
    attackType: string; // Matches AttackType enum values
    spriteKeyBase: string;
}

// Define the payload interface if not already present
interface CharacterStateUpdatePayload {
    updates: Array<{ entityId: string; state: string }>;
}

export class NetworkManager {
    private socket: Socket | null = null;
    private static instance: NetworkManager;
    // +++ Add Backend API Base URL (Adjust if needed) +++
    private apiBaseUrl = 'http://localhost:3000'; // REMOVED /api prefix

    private constructor() {}

    public static getInstance(): NetworkManager {
        // ... (singleton logic)
        if (!NetworkManager.instance) {
          NetworkManager.instance = new NetworkManager();
        }
        return NetworkManager.instance;
    }

    public connect(token: string) {
        // ... (connection logic, including auth and basic event listeners: connect, disconnect, connect_error)
        if (this.socket?.connected) {
          console.warn('Socket already connected.');
          return;
        }

        console.log('Attempting to connect to WebSocket server...');
        this.socket = io('ws://localhost:3000', { auth: { token: token } });

        this.socket.on('connect', () => {
            console.log('>>> NetworkManager: Received "connect" event from socket.io. Emitting "network-connect" via EventBus.');
            EventBus.emit('network-connect');
        });

        this.socket.on('disconnect', (reason) => {
            console.log('NetworkManager: Received "disconnect" event.', reason);
            EventBus.emit('network-disconnect', reason);
            this.socket = null;
        });

        this.socket.on('connect_error', (error) => {
            console.error('>>> NetworkManager: Received "connect_error" event:', error.message, error);
             if (error.message.includes('Authentication') || error.message.includes('Unauthorized')) {
                EventBus.emit('network-auth-error', error.message);
            } else {
                EventBus.emit('network-error', `Connection failed: ${error.message}`);
            }
            this.socket = null;
        });

        // --- Register NEW listeners for game events ---

        // Player Joined (receives data about the joining player's characters)
        this.socket.on('playerJoined', (data: { characters: ZoneCharacterState[] }) => {
            console.log('NetworkManager: Received "playerJoined"', data);
            EventBus.emit('player-joined', data);
        });

        // Player Left (receives the User ID of the player who left)
        this.socket.on('playerLeft', (data: { playerId: string }) => {
            console.log('NetworkManager: Received "playerLeft"', data);
            EventBus.emit('player-left', data);
        });
        // --- Make sure chat listener is present ---
        this.socket.on('chatMessage', (data: { senderName: string, message: string, timestamp?: number }) => {
            console.log('NetworkManager: Received "chatMessage"', data);
            EventBus.emit('chat-message-received', data); // Emit local event
        });
        // Entity Updates (receives batched updates)
        this.socket.on('entityUpdate', (payload: { updates: EntityUpdateData[] }) => {
            // console.log('NetworkManager: Received raw "entityUpdate" payload:', payload);
            if (payload && Array.isArray(payload.updates)) {
                 // Loop through the array and emit one event per update
                 payload.updates.forEach(updateData => {
                     // console.log('[NetworkManager] Emitting single entity-update:', updateData);
                     EventBus.emit('entity-update', updateData); // Emit single update object
                 });
             } else {
                 console.warn('[NetworkManager] Received malformed entityUpdate payload:', payload);
             }
        });

        // --- ADDED: Listen for entity deaths ---
        this.socket.on('entityDied', (data: { entityId: string, type: 'character' | 'enemy' }) => {
            console.log('>>> NetworkManager: Received "entityDied"', data);
            EventBus.emit('entity-died', data); // Emit using the correct event name ('entity-died')
        });
        // -------------------------------------

        // +++ ADDED: Listen for enemy spawns +++
        this.socket.on('enemySpawned', (enemyData: EnemySpawnData) => {
            console.log('>>> NetworkManager: Received "enemySpawned"', enemyData);
            EventBus.emit('enemy-spawned', enemyData);
        });
        // +++++++++++++++++++++++++++++++++++++++

        // +++ ADDED: Listen for combat actions (Handles BATCHED actions) +++
        this.socket.on('combatAction', (data: { actions: CombatActionData[] }) => {
            // Check if data and data.actions exist and is an array
            if (data && Array.isArray(data.actions)) {
                // Loop through each action in the received array
                data.actions.forEach(action => {
                    // console.log('>>> NetworkManager: Received single combatAction from batch:', action); // Optional log
                    EventBus.emit('combat-action', action); // Emit each action individually
                });
            } else {
                console.warn('>>> NetworkManager: Received combatAction event with unexpected payload format:', data);
            }
        });
        // +++++++++++++++++++++++++++++++++++++++

        // +++ ADDED: Listen for items dropped (Handles BATCHED items) +++
        this.socket.on('itemsDropped', (data: { items: any[] }) => { // Assuming payload is { items: [...] }
            console.log('[NetworkManager] Received "itemsDropped" event:', data); // <-- Log reception
            if (data && data.items && Array.isArray(data.items)) {
                EventBus.emit('items-dropped', data); // <-- Emit to local EventBus (using kebab-case convention)
                console.log('[NetworkManager] Emitted "items-dropped" to EventBus.'); // <-- Log emission
            } else {
                console.warn('[NetworkManager] Received invalid "itemsDropped" data format:', data);
            }
        });
        // ++++++++++++++++++++++++++++++++++++++++

        // +++ ADDED: Listen for single item pickup confirmation +++
        this.socket.on('itemPickedUp', (data: { itemId: string }) => {
            console.log('[NetworkManager] Received "itemPickedUp" event:', data);
            if (data && data.itemId) {
                EventBus.emit('item-picked-up', data);
                console.log('[NetworkManager] Emitted "item-picked-up" to EventBus.');
            } else {
                console.warn('[NetworkManager] Received invalid "itemPickedUp" data format:', data);
            }
        });

        // +++ ADDED: Listen for item despawn events +++
        this.socket.on('itemDespawned', (data: { itemId: string }) => {
            console.log('[NetworkManager] Received "itemDespawned" event:', data);
            if (data && data.itemId) {
                EventBus.emit('item-despawned', data);
                console.log('[NetworkManager] Emitted "item-despawned" to EventBus.');
            } else {
                console.warn('[NetworkManager] Received invalid "itemDespawned" data format:', data);
            }
        });

        // +++ ADDED: Listen for inventory updates (direct to player) +++
        this.socket.on('inventoryUpdate', (data: { inventory: any[] }) => {
            console.log('[NetworkManager] Received "inventoryUpdate" event:', data);
            if (data && data.inventory && Array.isArray(data.inventory)) {
                EventBus.emit('inventory-update', data);
                console.log('[NetworkManager] Emitted "inventory-update" to EventBus.');
            } else {
                console.warn('[NetworkManager] Received invalid "inventoryUpdate" data format:', data);
            }
        });
        // ++++++++++++++++++++++++++++++++++++++++

        // +++ ADDED: Listen for equipment updates +++
        this.socket.on('equipmentUpdate', (data: { characterId: string, equipment: any }) => { // Use 'any' for now, refine later
            console.log('[NetworkManager] Received "equipmentUpdate" event:', data);
            if (data && data.characterId && data.equipment) {
                EventBus.emit('equipment-update', data);
                console.log('[NetworkManager] Emitted "equipment-update" to EventBus.');
            } else {
                console.warn('[NetworkManager] Received invalid "equipmentUpdate" data format:', data);
            }
        });
        // +++++++++++++++++++++++++++++++++++++++

        // +++ ADDED: Listen for XP updates (Direct to Player) +++
        this.socket.on('xpUpdate', (data: { characterId: string, level: number, xp: number, xpToNextLevel: number }) => {
            console.log('[NetworkManager] Received "xpUpdate" event:', data);
            if (data && data.characterId) { // Basic validation
                EventBus.emit('xpUpdate', data);
                console.log('[NetworkManager] Emitted "xpUpdate" to EventBus.');
            } else {
                console.warn('[NetworkManager] Received invalid "xpUpdate" data format:', data);
            }
        });
        // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++

        // ---> ADD Character State Updates Listener <---
        this.socket.on('characterStateUpdates', (payload: CharacterStateUpdatePayload) => {
            // This event bundles multiple state changes from the server
            // console.log(`Received character state updates for ${payload.updates.length} entities.`);

            // Validate payload structure before emitting
            if (payload && Array.isArray(payload.updates)) {
                // Use the imported EventBus singleton directly
                EventBus.emit('character-state-update', payload); // Emit locally
            } else {
                console.warn('Received invalid characterStateUpdates payload:', payload);
            }
        });
        // ---> END ADD <---

        // Existing listeners (keep if needed)
        // this.socket.on('chatMessage', (data) => { /* ... */ });
    }

    public disconnect() {
        // ...
        this.socket?.disconnect();
        this.socket = null;
    }

    public isConnected(): boolean {
        // ...
        return this.socket?.connected ?? false;
    }

    // Method to send messages to the server (no changes needed)
    public sendMessage<T>(eventName: string, data?: T, ack?: (...args: any[]) => void) {
        // ...
        if (!this.isConnected()) {
            console.error('Cannot send message: Socket not connected.');
            return;
        }
        if (ack) {
            this.socket?.emit(eventName, data, ack);
        } else {
            this.socket?.emit(eventName, data);
        }
        // console.log(`Sent message [${eventName}]:`, data); // Can be noisy
    }

    // +++ NEW Method to fetch available character classes via HTTP +++
    public async getAvailableClasses(): Promise<CharacterClassTemplateData[]> {
        const url = `${this.apiBaseUrl}/classes`;
        console.log(`[NetworkManager] Fetching available classes from ${url}...`);
        try {
            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    // Add Authorization header if this endpoint requires login
                    // 'Authorization': `Bearer ${your_token_variable}`
                },
            });

            if (!response.ok) {
                const errorText = await response.text();
                console.error(`[NetworkManager] Error fetching classes: ${response.status} ${response.statusText}`, errorText);
                throw new Error(`Failed to fetch classes: ${response.statusText}`);
            }

            const classes: CharacterClassTemplateData[] = await response.json();
            console.log(`[NetworkManager] Successfully fetched ${classes.length} classes.`);
            return classes;
        } catch (error) {
            console.error('[NetworkManager] Network or parsing error fetching classes:', error);
            // Re-throw or return empty array/handle as appropriate for the UI
            throw error;
        }
    }
    // +++ END NEW Method +++
}