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


export class NetworkManager {
    private socket: Socket | null = null;
    private static instance: NetworkManager;

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
        this.socket.on('entityUpdate', (data: { updates: EntityUpdateData[] }) => {
            // console.log('NetworkManager: Received "entityUpdate"', data); // Can be very noisy!
            EventBus.emit('entity-update', data);
        });

        // --- ADDED: Listen for entity deaths ---
        this.socket.on('entityDied', (data: { entityId: string, type: 'character' | 'enemy' }) => {
            console.log('>>> NetworkManager: Received "entityDied"', data);
            EventBus.emit('entity-died', data); // Emit using the correct event name ('entity-died')
        });
        // -------------------------------------

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
}