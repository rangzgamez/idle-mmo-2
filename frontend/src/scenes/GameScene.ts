// frontend/src/scenes/GameScene.ts (Conceptual)
import Phaser from 'phaser';
import { NetworkManager, EventBus } from '../network/NetworkManager';

export default class GameScene extends Phaser.Scene {
    networkManager: NetworkManager;

    constructor() {
        super('GameScene');
        this.networkManager = NetworkManager.getInstance();
    }

    create() {
        // Check if already connected
        if (!this.networkManager.isConnected()) {
            console.warn('Network not connected upon entering GameScene.');
            // Option 1: Try to reconnect if token exists
            const token = localStorage.getItem('jwtToken');
            if (token) {
                this.networkManager.connect(token);
            } else {
                // Option 2: Redirect to Login
                console.error('No token found, redirecting to Login.');
                this.scene.start('LoginScene');
                return; // Stop scene creation
            }
            // Listen for connection event if attempting reconnect
            EventBus.on('network-connect', this.onNetworkConnect);
        } else {
            // Already connected, proceed with setup
            this.initializeGame();
        }

         // Listen for network events
         EventBus.on('network-disconnect', this.onNetworkDisconnect);
         EventBus.on('network-auth-error', this.onNetworkAuthError);
         EventBus.on('chat-message-received', this.handleChatMessage); // Example listener

         // --- Input Handling ---
         this.input.on('pointerdown', (pointer: { worldX: number; worldY: number; }) => {
             // Example: Send a move command
             this.networkManager.sendMessage('moveCommand', { target: { x: pointer.worldX, y: pointer.worldY } });
         });
    }

    onNetworkConnect() {
        console.log('GameScene detected network connection.');
        this.initializeGame();
    }

    onNetworkDisconnect(reason: string) {
        console.error('GameScene detected network disconnect:', reason);
        // Show message, attempt reconnect, or go to login scene
        alert(`Disconnected: ${reason}. Redirecting to login.`);
        this.scene.start('LoginScene');
    }

    onNetworkAuthError(message: string) {
        console.error('GameScene detected auth error:', message);
        // Token might be expired or invalid
        localStorage.removeItem('jwtToken'); // Clear bad token
        alert(`Authentication Error: ${message}. Please log in again.`);
        this.scene.start('LoginScene');
    }

    initializeGame() {
        console.log('Initializing Game...');
        // Load tilemap, set up player sprite based on selected characters etc.
        // Send initial messages like 'enterZone' if needed
        // this.networkManager.sendMessage('enterZone', { zoneId: 'startZone' });

        // Test sending a message
        this.networkManager.sendMessage('messageToServer', 'Hello from Phaser GameScene!');
    }

    handleChatMessage(data: { senderName: string, message: string }) {
        console.log(`Chat received in GameScene: ${data.senderName}: ${data.message}`);
        // Update chat UI (likely handled in UIScene)
    }

    // Make sure to remove listeners when the scene shuts down
    shutdown() {
        EventBus.off('network-connect', this.onNetworkConnect);
        EventBus.off('network-disconnect', this.onNetworkDisconnect);
        EventBus.off('network-auth-error', this.onNetworkAuthError);
        EventBus.off('chat-message-received', this.handleChatMessage);
    }

    destroy() {
        // Clean up Phaser objects
        //super.destroy();
    }
}