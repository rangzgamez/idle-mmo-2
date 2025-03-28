// frontend/src/scenes/UIScene.ts
import Phaser from 'phaser';
import { NetworkManager } from '../network/NetworkManager';
import { EventBus } from '../EventBus'; 

export default class UIScene extends Phaser.Scene {
    networkManager!: NetworkManager;
    chatLogElement!: HTMLElement | null; // The div where messages appear
    chatInputElement!: HTMLInputElement | null; // The input field

    constructor() {
        // Make sure the scene key is unique and matches the one in main.ts config
        super({ key: 'UIScene', active: false }); // Start inactive initially
    }

    create() {
        console.log('UIScene create');
        this.networkManager = NetworkManager.getInstance();

        // --- Create Chat DOM Elements ---
        // Use Phaser's DOM Element feature. Position it at the bottom-left corner.
        const chatContainer = this.add.dom(10, Number(this.sys.game.config.height) - 10).createFromHTML(`
            <div id="chat-container" style="width: 350px; height: 200px; background-color: rgba(0, 0, 0, 0.5); display: flex; flex-direction: column; font-family: sans-serif;">
                <div id="chat-log" style="flex-grow: 1; overflow-y: auto; padding: 5px; color: white; font-size: 12px; margin-bottom: 5px;">
                    <!-- Messages will appear here -->
                </div>
                <input type="text" id="chat-input" placeholder="Type message and press Enter..." style="border: 1px solid #555; background-color: #333; color: white; padding: 5px; font-size: 12px;">
            </div>
        `).setOrigin(0, 1); // Origin bottom-left

        // Get references to the specific HTML elements for easier access
        this.chatLogElement = chatContainer.getChildByID('chat-log') as HTMLElement;
        this.chatInputElement = chatContainer.getChildByID('chat-input') as HTMLInputElement;

        // --- Input Handling ---
        // Prevent Phaser from capturing keyboard input when the chat input is focused
        chatContainer.addListener('click'); // Dummy listener to allow focus
        this.input.keyboard?.on('keydown', (event: KeyboardEvent) => {
            if (document.activeElement === this.chatInputElement) {
                 event.stopPropagation(); // Stop Phaser from processing keys like space, arrows etc.
                if (event.key === 'Enter') {
                    this.handleSendMessage();
                }
            }
        });

        // --- EventBus Listener for Incoming Messages ---
        EventBus.on('chat-message-received', this.handleChatMessage, this);
        EventBus.on('focus-chat-input', this.focusChatInput, this);
        // Log successful creation
        console.log('Chat UI Elements Created.');
        if (!this.chatLogElement || !this.chatInputElement) {
             console.error("Failed to get chat log or input elements!");
        }
    }
    /**
     * Public getter to allow other scenes (like GameScene)
     * to access the chat input element reference.
     */
    public getChatInputElement(): HTMLInputElement | null {
        return this.chatInputElement;
    }
    // ------------------------
    focusChatInput() {
        if (this.chatInputElement) {
            this.chatInputElement.focus();
        }
    }
    // --- Send Message Logic ---
    handleSendMessage() {
        if (!this.chatInputElement || !this.networkManager.isConnected()) {
            console.warn("Chat input not ready or network disconnected.");
            return;
        }

        const message = this.chatInputElement.value.trim();

        if (message.length > 0) {
            // Send the message via WebSocket
            this.networkManager.sendMessage('sendMessage', { message: message });

            // Clear the input field
            this.chatInputElement.value = '';
        }
    }

    // --- Receive Message Logic ---
    handleChatMessage(data: { senderName: string, message: string, timestamp?: number }) {
        if (!this.chatLogElement) return;

        console.log('UIScene received chat message:', data); // Debug log

        // Create a new paragraph element for the message
        const messageElement = document.createElement('p');
        messageElement.style.margin = '2px 0'; // Add slight spacing

        // Basic formatting (add timestamp later if desired)
        // Consider different colors for sender name vs message if you like
        messageElement.textContent = `[${data.senderName}]: ${data.message}`;

        // Append the message to the chat log
        this.chatLogElement.appendChild(messageElement);

        // Auto-scroll to the bottom
        this.chatLogElement.scrollTop = this.chatLogElement.scrollHeight;
    }

    // --- Scene Cleanup ---
    shutdown() {
        console.log('UIScene shutting down, removing listeners.');
        EventBus.off('chat-message-received', this.handleChatMessage, this);
        EventBus.off('focus-chat-input', this.focusChatInput, this); // <-- Remove focus listener
        // DOM elements added via this.add.dom are usually cleaned up automatically by Phaser
    }
}