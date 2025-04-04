// frontend/src/scenes/UIScene.ts
import Phaser from 'phaser';
import { NetworkManager } from '../network/NetworkManager';
import { EventBus } from '../EventBus';
import { InventoryItem } from '../../../backend/src/inventory/inventory.entity'; // Adjust path if needed

// Interface for the inventory update event payload
interface InventoryUpdatePayload {
    inventory: InventoryItem[];
}

export default class UIScene extends Phaser.Scene {
    networkManager!: NetworkManager;
    chatLogElement!: HTMLElement | null; // The div where messages appear
    chatInputElement!: HTMLInputElement | null; // The input field
    inventoryWindowElement!: HTMLElement | null; // Reference to inventory window
    inventoryItemsElement!: HTMLElement | null; // Reference to item list container

    constructor() {
        // Make sure the scene key is unique and matches the one in main.ts config
        super({ key: 'UIScene', active: false }); // Start inactive initially
    }

    create() {
        console.log('UIScene create');
        this.networkManager = NetworkManager.getInstance();

        // --- Create Top Menu Bar DOM Element ---
        const menuBarHtml = `
            <div id="menu-bar" style="position: absolute; top: 10px; left: 10px; display: flex; gap: 5px; background-color: rgba(0,0,0,0.6); padding: 5px; border-radius: 3px;">
                <button id="inventory-button" style="padding: 3px 6px; font-size: 12px; background-color: #555; color: white; border: 1px solid #777;">Inventory</button>
                <button style="padding: 3px 6px; font-size: 12px; background-color: #555; color: #aaa; border: 1px solid #777; cursor: not-allowed;">Equipment</button> <!-- Placeholder -->
                <button style="padding: 3px 6px; font-size: 12px; background-color: #555; color: #aaa; border: 1px solid #777; cursor: not-allowed;">Settings</button> <!-- Placeholder -->
                <button style="padding: 3px 6px; font-size: 12px; background-color: #555; color: #aaa; border: 1px solid #777; cursor: not-allowed;">Logout</button> <!-- Placeholder -->
            </div>
        `;
        const menuBar = this.add.dom(0, 0).createFromHTML(menuBarHtml).setOrigin(0, 0);

        // --- Create Inventory Window DOM Element (Initially Hidden) ---
        const invWindowHtml = `
            <div id="inventory-window" style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 300px; max-height: 400px; display: none; flex-direction: column; background-color: rgba(40, 40, 40, 0.9); border: 2px solid #888; border-radius: 5px; font-family: sans-serif; z-index: 100;">
                <div id="inventory-title-bar" style="background-color: #333; color: white; padding: 5px; font-size: 14px; font-weight: bold; cursor: grab; display: flex; justify-content: space-between; align-items: center;">
                    <span>Inventory</span>
                    <button id="inventory-close-button" style="background: none; border: none; color: white; font-size: 16px; cursor: pointer; line-height: 1;">&times;</button>
                </div>
                <div id="inventory-items" style="padding: 10px; color: white; font-size: 12px; overflow-y: auto; flex-grow: 1;">
                    <!-- Items will be populated here -->
                    Inventory is empty.
                </div>
            </div>
        `;
        const invWindow = this.add.dom(0, 0).createFromHTML(invWindowHtml).setOrigin(0, 0);
        // Move inventory window to center initially (setOrigin(0,0) makes position relative to top-left)
        invWindow.setPosition(Number(this.sys.game.config.width)/2 - 150, Number(this.sys.game.config.height)/2 - 200); 

        // Get references to inventory elements
        this.inventoryWindowElement = invWindow.getChildByID('inventory-window') as HTMLElement;
        this.inventoryItemsElement = invWindow.getChildByID('inventory-items') as HTMLElement;
        const inventoryButton = menuBar.getChildByID('inventory-button') as HTMLElement;
        const inventoryCloseButton = invWindow.getChildByID('inventory-close-button') as HTMLElement;
        const inventoryTitleBar = invWindow.getChildByID('inventory-title-bar') as HTMLElement;

        if (!this.inventoryWindowElement || !this.inventoryItemsElement || !inventoryButton || !inventoryCloseButton || !inventoryTitleBar) {
            console.error("Failed to get all inventory UI elements!");
            return;
        }

        // --- Inventory Button Listener ---
        inventoryButton.addEventListener('click', () => {
            if (this.inventoryWindowElement) {
                const currentDisplay = this.inventoryWindowElement.style.display;
                this.inventoryWindowElement.style.display = (currentDisplay === 'none' || currentDisplay === '') ? 'flex' : 'none';
            }
        });

        // --- Inventory Close Button Listener ---
        inventoryCloseButton.addEventListener('click', () => {
            if (this.inventoryWindowElement) {
                this.inventoryWindowElement.style.display = 'none';
            }
        });

        // --- Inventory Drag Logic ---
        this.makeDraggable(this.inventoryWindowElement, inventoryTitleBar);

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
        chatContainer.addListener('click'); // Dummy listener to allow focus
        this.input.keyboard?.on('keydown', (event: KeyboardEvent) => {
            if (document.activeElement === this.chatInputElement || document.activeElement === this.inventoryWindowElement || this.inventoryWindowElement?.contains(document.activeElement)) {
                event.stopPropagation(); // Stop Phaser if chat or inventory window elements have focus
                if (event.key === 'Enter' && document.activeElement === this.chatInputElement) {
                    this.handleSendMessage();
                }
                 // Add ESC key to close inventory if it's open
                 if (event.key === 'Escape' && this.inventoryWindowElement && this.inventoryWindowElement.style.display !== 'none') {
                    this.inventoryWindowElement.style.display = 'none';
                }
            }
        });

        // --- EventBus Listeners ---
        EventBus.on('chat-message-received', this.handleChatMessage, this);
        EventBus.on('focus-chat-input', this.focusChatInput, this);
        EventBus.on('inventory-update', this.updateInventoryDisplay, this); // <-- Add inventory listener

        console.log('UI Elements Created (Chat, Menu, Inventory Window).');
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
        EventBus.off('inventory-update', this.updateInventoryDisplay, this); // <-- Remove inventory listener
        // DOM elements added via this.add.dom are usually cleaned up automatically by Phaser
    }

    // --- Temporary Message Display ---
    /**
     * Displays a message temporarily on the screen.
     * @param message The text message to display.
     * @param duration How long to display the message in milliseconds (default 3000).
     */
    public showTemporaryMessage(message: string, duration: number = 3000) {
        const x = Number(this.sys.game.config.width) / 2;
        const y = 50; // Position near the top-center

        const text = this.add.text(x, y, message, {
            fontSize: '16px',
            fontFamily: 'Arial, sans-serif',
            color: '#ffdddd', // Light red/pinkish color for errors/warnings
            backgroundColor: '#000000aa',
            padding: { x: 10, y: 5 },
            align: 'center'
        });
        text.setOrigin(0.5, 0.5);
        text.setDepth(1000); // Ensure it's on top of other UI

        // Fade out and destroy
        this.tweens.add({
            targets: text,
            alpha: { from: 1, to: 0 },
            delay: duration - 500, // Start fading 500ms before duration ends
            duration: 500,
            ease: 'Power1',
            onComplete: () => {
                text.destroy();
            }
        });
    }

    // Method to make the inventory window draggable
    private makeDraggable(element: HTMLElement, handle: HTMLElement) {
        let isDragging = false;
        let offsetX = 0;
        let offsetY = 0;

        handle.style.cursor = 'grab';

        handle.onmousedown = (e) => {
            isDragging = true;
            // Calculate offset from the element's top-left corner to the mouse click point
            offsetX = e.clientX - element.offsetLeft;
            offsetY = e.clientY - element.offsetTop;
            handle.style.cursor = 'grabbing';
            // Prevent text selection while dragging
            e.preventDefault(); 
        };

        document.onmousemove = (e) => {
            if (!isDragging) return;

            // Calculate new position based on mouse position and initial offset
            let newX = e.clientX - offsetX;
            let newY = e.clientY - offsetY;

            // Basic boundary check (optional, can be improved)
            const gameWidth = Number(this.sys.game.config.width);
            const gameHeight = Number(this.sys.game.config.height);
            newX = Math.max(0, Math.min(newX, gameWidth - element.offsetWidth));
            newY = Math.max(0, Math.min(newY, gameHeight - element.offsetHeight));

            element.style.left = `${newX}px`;
            element.style.top = `${newY}px`;
             // Important: Remove transform after initial positioning if dragging
             if (element.style.transform) {
                 element.style.transform = ''; 
             }
        };

        document.onmouseup = () => {
            if (isDragging) {
                isDragging = false;
                handle.style.cursor = 'grab';
            }
        };

        // Release drag if mouse leaves the window (important!)
        document.onmouseleave = () => {
            if (isDragging) {
                isDragging = false;
                handle.style.cursor = 'grab';
            }
        };
    }

    // --- Inventory Display Update ---
    private updateInventoryDisplay(data: InventoryUpdatePayload) {
        console.log('[UIScene] Updating inventory display:', data);
        if (!this.inventoryItemsElement) return;

        const inventory = data.inventory;
        // Clear previous items
        this.inventoryItemsElement.innerHTML = '';

        if (!inventory || inventory.length === 0) {
            this.inventoryItemsElement.innerHTML = '<p style="color: #aaa;">Inventory is empty.</p>';
            return;
        }

        // Populate with new items
        inventory.forEach(item => {
            const itemElement = document.createElement('div');
            itemElement.style.padding = '2px 0';
            itemElement.style.borderBottom = '1px solid #444';
            // Accessing nested itemTemplate data assumes it's eager loaded correctly by the backend service
            const itemName = item.itemTemplate?.name ?? 'Unknown Item';
            const quantity = item.quantity > 1 ? ` x${item.quantity}` : '';
            itemElement.textContent = `${itemName}${quantity}`;
            // TODO: Add icons later using item.itemTemplate?.spriteKey?
            this.inventoryItemsElement?.appendChild(itemElement);
        });
    }
}