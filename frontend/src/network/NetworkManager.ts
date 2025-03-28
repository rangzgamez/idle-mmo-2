// frontend/src/network/NetworkManager.ts
import { io, Socket } from 'socket.io-client';
//import { EventBus } from '../EventBus'; // We'll use a simple event emitter

export class NetworkManager {
  private socket: Socket | null = null;
  private static instance: NetworkManager;

  private constructor() {
    // Private constructor for singleton pattern
  }

  public static getInstance(): NetworkManager {
    if (!NetworkManager.instance) {
      NetworkManager.instance = new NetworkManager();
    }
    return NetworkManager.instance;
  }

  public connect(token: string) {
    if (this.socket?.connected) {
      console.warn('Socket already connected.');
      return;
    }

    console.log('Attempting to connect to WebSocket server...');

    // Connect to the NestJS WebSocket server (default port 3000)
    // Pass the JWT in the 'auth' object
    this.socket = io('ws://localhost:3000', { // Use ws:// or wss://
      auth: {
        token: token,
      },
      // Optional: If using namespaces on backend
      // path: '/socket.io' // Default path
      // You might specify a namespace if used: e.g., io('ws://localhost:3000/game', ...)
    });

    this.socket.on('connect', () => {
      console.log('Successfully connected to WebSocket server:', this.socket?.id);
      EventBus.emit('network-connect'); // Emit event for scenes to react
    });

    this.socket.on('disconnect', (reason) => {
      console.log('Disconnected from WebSocket server:', reason);
      EventBus.emit('network-disconnect', reason);
      this.socket = null; // Clear socket instance on disconnect
    });

    this.socket.on('connect_error', (error) => {
      console.error('WebSocket connection error:', error.message);
      // Handle specific auth errors if needed
      if (error.message.includes('Authentication failed') || error.message.includes('Unauthorized')) {
          EventBus.emit('network-auth-error', error.message);
          // Maybe redirect to login or show an error message
      } else {
          EventBus.emit('network-error', error.message);
      }
      this.socket = null; // Clear socket on connection error
    });

    // --- Register listeners for server events ---
    // Example: listen for chat messages
    this.socket.on('chatMessage', (data: { senderName: string, message: string }) => {
      console.log('Chat Message Received:', data);
      EventBus.emit('chat-message-received', data);
    });

    // Example: listen for entity updates
    this.socket.on('entityUpdate', (data: any) => {
        // console.log('Entity Update Received:', data); // Can be very noisy
        EventBus.emit('entity-update-received', data);
    });

    // Add more listeners for other game events (playerJoined, itemDropped, etc.)
    // this.socket.on('playerJoined', (data) => EventBus.emit('player-joined', data));
    // ...
  }

  public disconnect() {
    this.socket?.disconnect();
    this.socket = null;
  }

  public isConnected(): boolean {
    return this.socket?.connected ?? false;
  }

  // --- Method to send messages to the server ---
  public sendMessage<T>(eventName: string, data?: T, ack?: (...args: any[]) => void) {
    if (!this.isConnected()) {
      console.error('Cannot send message: Socket not connected.');
      return;
    }
    if (ack) {
        this.socket?.emit(eventName, data, ack);
    } else {
        this.socket?.emit(eventName, data);
    }
    console.log(`Sent message [${eventName}]:`, data); // Log outgoing messages
  }
}

// --- Simple Event Emitter ---
// You can use a library like 'mitt' or Phaser's built-in events if preferred
class SimpleEventBus {
    private listeners: { [key: string]: Function[] } = {};

    on(event: string, callback: Function) {
        if (!this.listeners[event]) {
            this.listeners[event] = [];
        }
        this.listeners[event].push(callback);
    }

    off(event: string, callback: Function) {
        if (!this.listeners[event]) return;
        this.listeners[event] = this.listeners[event].filter(listener => listener !== callback);
    }

    emit(event: string, ...args: any[]) {
        if (!this.listeners[event]) return;
        this.listeners[event].forEach(listener => listener(...args));
    }
}
export const EventBus = new SimpleEventBus();