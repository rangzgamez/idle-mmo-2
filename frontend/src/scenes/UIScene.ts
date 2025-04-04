// frontend/src/scenes/UIScene.ts
import Phaser from 'phaser';
import { NetworkManager } from '../network/NetworkManager';
import { EventBus } from '../EventBus';
import { InventoryItem } from '../../../backend/src/inventory/inventory.entity'; // Adjust path if needed
import { EquipmentSlot } from '../../../backend/src/item/item.types'; // Import EquipmentSlot

// Interface for the inventory update event payload
interface InventoryUpdatePayload {
    inventory: InventoryItem[];
}

// Add interface for the equipment update event payload
interface EquipmentUpdatePayload {
    characterId: string; // ID of the character whose equipment was updated
    equipment: Partial<Record<EquipmentSlot, InventoryItem>>; // Map from slot to item
}

export default class UIScene extends Phaser.Scene {
    networkManager!: NetworkManager;
    chatLogElement!: HTMLElement | null; // The div where messages appear
    chatInputElement!: HTMLInputElement | null; // The input field
    inventoryWindowElement!: HTMLElement | null; // Reference to inventory window
    inventoryItemsElement!: HTMLElement | null; // Reference to item list container
    // Add pagination state
    private fullInventory: InventoryItem[] = [];
    private currentPage = 1;
    private itemsPerPage = 36; // 6x6 grid
    private totalPages = 1;
    // References for pagination controls (add these)
    private invPrevButton: HTMLButtonElement | null = null;
    private invNextButton: HTMLButtonElement | null = null;
    private invPageInfo: HTMLSpanElement | null = null;
    // Add reference for the tooltip element
    private itemTooltipElement: Phaser.GameObjects.DOMElement | null = null;
    // Add references for Equipment UI
    private equipWindowGameObject: Phaser.GameObjects.DOMElement | null = null;
    private equipmentSlots: Map<EquipmentSlot, HTMLElement> = new Map(); // Map to hold slot elements
    // Add state for pagination
    private currentParty: any[] = []; // Store the selected party info
    private currentEquipCharacterIndex: number = 0;
    private allCharacterEquipment: Map<string, Partial<Record<EquipmentSlot, InventoryItem>>> = new Map();
    // Remove pagination button refs, add tab container ref
    // private equipPrevButton: HTMLButtonElement | null = null;
    // private equipNextButton: HTMLButtonElement | null = null;
    // private equipCharInfo: HTMLSpanElement | null = null;
    private equipmentTabsContainer: HTMLElement | null = null; 
    private receivedPartyData: any[] = []; // Store data received on init

    constructor() {
        // Make sure the scene key is unique and matches the one in main.ts config
        super({ key: 'UIScene', active: false }); // Start inactive initially
    }

    // *** Add init method ***
    init(data: { selectedParty?: any[] }) {
        console.log("UIScene init received data:", data);
        this.receivedPartyData = data.selectedParty || []; // Store the passed data
    }

    create() {
        console.log('UIScene create');
        this.networkManager = NetworkManager.getInstance();

        // --- Create Top Menu Bar DOM Element ---
        const menuBarHtml = `
            <div id="menu-bar" style="position: absolute; top: 10px; left: 10px; display: flex; gap: 5px; background-color: rgba(0,0,0,0.6); padding: 5px; border-radius: 3px;">
                <button id="inventory-button" style="padding: 3px 6px; font-size: 12px; background-color: #555; color: white; border: 1px solid #777;">Inventory</button>
                <button id="equipment-button" style="padding: 3px 6px; font-size: 12px; background-color: #555; color: white; border: 1px solid #777;">Equipment</button> <!-- Enable this -->
                <button style="padding: 3px 6px; font-size: 12px; background-color: #555; color: #aaa; border: 1px solid #777; cursor: not-allowed;">Settings</button> 
                <button style="padding: 3px 6px; font-size: 12px; background-color: #555; color: #aaa; border: 1px solid #777; cursor: not-allowed;">Logout</button> 
            </div>
        `;
        const menuBar = this.add.dom(0, 0).createFromHTML(menuBarHtml).setOrigin(0, 0);
        console.log("UIScene: Menu Bar HTML content:", menuBar.node.innerHTML); 

        // --- Create Inventory Window DOM Element (Initially Hidden) ---
        const invWindowHtml = `
            <div id="inventory-window" style="width: 320px; /* Adjusted width for grid */ max-height: 450px; /* Adjusted height */ flex-direction: column; background-color: rgba(40, 40, 40, 0.9); border: 2px solid #888; border-radius: 5px; font-family: sans-serif; z-index: 100;"> 
                <div id="inventory-title-bar" style="background-color: #333; color: white; padding: 5px; font-size: 14px; font-weight: bold; cursor: grab; display: flex; justify-content: space-between; align-items: center;">
                    <span>Inventory</span>
                    <button id="inventory-close-button" style="background: none; border: none; color: white; font-size: 16px; cursor: pointer; line-height: 1;">&times;</button>
                </div>
                
                <!-- Grid Container -->
                <div id="inventory-grid" style="display: grid; grid-template-columns: repeat(6, 45px); grid-template-rows: repeat(6, 45px); gap: 5px; padding: 10px; justify-content: center; align-content: center;">
                    <!-- 36 slots will be generated here by JS -->
                </div>
                
                <!-- Pagination Controls -->
                <div id="inventory-pagination" style="display: flex; justify-content: center; align-items: center; padding: 5px; border-top: 1px solid #555;">
                    <button id="inv-prev-button" style="padding: 2px 5px; font-size: 12px; margin-right: 10px;">&lt; Prev</button>
                    <span id="inv-page-info" style="color: white; font-size: 12px;">Page 1 / 1</span>
                    <button id="inv-next-button" style="padding: 2px 5px; font-size: 12px; margin-left: 10px;">Next &gt;</button>
                </div>
            </div>
        `;
        // Create the Phaser DOM Element
        const invWindowGameObject = this.add.dom(0, 0).createFromHTML(invWindowHtml).setOrigin(0, 0);
        // Position the Phaser DOM Element (wrapper) - Under menu bar
        const initialInvX = 10;
        const initialInvY = 50; // Approx below menu bar (10px top + ~30px height + 10px gap)
        invWindowGameObject.setPosition(initialInvX, initialInvY); 
        invWindowGameObject.setVisible(false); // Start hidden using Phaser's visibility

        // Get references to HTML elements INSIDE the container
        const inventoryWindowElement = invWindowGameObject.getChildByID('inventory-window') as HTMLElement;
        this.inventoryItemsElement = invWindowGameObject.getChildByID('inventory-grid') as HTMLElement;
        const inventoryButton = menuBar.getChildByID('inventory-button') as HTMLElement;
        const inventoryCloseButton = invWindowGameObject.getChildByID('inventory-close-button') as HTMLElement;
        const inventoryTitleBar = invWindowGameObject.getChildByID('inventory-title-bar') as HTMLElement;
        // ** Store references to pagination controls **
        this.invPrevButton = invWindowGameObject.getChildByID('inv-prev-button') as HTMLButtonElement;
        this.invNextButton = invWindowGameObject.getChildByID('inv-next-button') as HTMLButtonElement;
        this.invPageInfo = invWindowGameObject.getChildByID('inv-page-info') as HTMLSpanElement;

        // ** Update: Check for new pagination elements **
        if (!inventoryWindowElement || !this.inventoryItemsElement || !inventoryButton || !inventoryCloseButton || !inventoryTitleBar || !this.invPrevButton || !this.invNextButton || !this.invPageInfo) {
            console.error("Failed to get all inventory UI elements (incl. pagination)!");
            return; // Exit early if elements aren't found
        }

        // Store reference if needed elsewhere (maybe not necessary now)
        // this.inventoryWindowElement = inventoryWindowElement;

        // --- Inventory Button Listener ---
        inventoryButton.addEventListener('click', () => {
            // Toggle visibility using Phaser DOM element
            invWindowGameObject.setVisible(!invWindowGameObject.visible);
        });

        // --- Inventory Close Button Listener ---
        inventoryCloseButton.addEventListener('click', () => {
             invWindowGameObject.setVisible(false);
        });

        // --- Inventory Drag Logic ---
        if (invWindowGameObject && inventoryTitleBar) {
             console.log("[UIScene] Attaching drag handler to Inventory Window");
             this.makeDraggable(invWindowGameObject, inventoryTitleBar);
        } else {
             console.error("[UIScene] Failed to attach drag handler to Inventory: Missing elements.");
        }

        // --- Create Equipment Window DOM Element (Initially Hidden) ---
        const equipmentSlotsHtml = Object.values(EquipmentSlot).map(slot => 
            `<div class="equip-slot" id="equip-slot-${slot}" title="${slot}" 
                  style="width: 50px; height: 50px; background-color: rgba(0,0,0,0.4); border: 1px dashed #888; 
                         display: flex; align-items: center; justify-content: center; color: #666; font-size: 10px; overflow: hidden;" 
            >${slot.substring(0,3)}</div>` // Placeholder text
        ).join('');

        const equipWindowHtml = `
            <div id="equipment-window" style="width: 220px; /* Slightly wider */ flex-direction: column; background-color: rgba(40, 40, 40, 0.9); border: 2px solid #888; border-radius: 5px; font-family: sans-serif; z-index: 99;">
                <div id="equipment-title-bar" style="background-color: #333; color: white; padding: 5px; font-size: 14px; font-weight: bold; cursor: grab; display: flex; justify-content: space-between; align-items: center;">
                    <span>Equipment</span>
                    <button id="equipment-close-button" style="background: none; border: none; color: white; font-size: 16px; cursor: pointer; line-height: 1;">&times;</button>
                </div>
                <!-- Equipment Character Tabs -->
                 <div id="equipment-tabs" style="display: flex; border-bottom: 1px solid #555; background-color: rgba(0,0,0,0.1);">
                    <!-- Tabs will be generated here -->
                 </div>
                <!-- Equipment Slot Grid (Updated Layout) -->
                <div style="padding: 10px; display: grid; grid-template-areas: 
                    '. helm necklace' 
                    'mainhand armor offhand' 
                    'gloves boots .' 
                    '. ring1 ring2'; 
                    grid-template-columns: 1fr 1fr 1fr; gap: 8px; justify-items: center;" >
                    ${equipmentSlotsHtml} 
                </div> 
            </div>
        `;
        this.equipWindowGameObject = this.add.dom(0, 0).createFromHTML(equipWindowHtml).setOrigin(0, 0);
        this.equipWindowGameObject.setPosition(Number(this.sys.game.config.width) - 240, 50); // Adjusted for wider window
        this.equipWindowGameObject.setVisible(false);

        // Get references to equipment elements
        const equipmentButton = menuBar.getChildByID('equipment-button') as HTMLElement;
        console.log("UIScene: Found equipmentButton element via getChildByID:", !!equipmentButton); 

        const equipmentCloseButton = this.equipWindowGameObject.getChildByID('equipment-close-button') as HTMLElement;
        const equipmentTitleBar = this.equipWindowGameObject.getChildByID('equipment-title-bar') as HTMLElement;
         // Get references to tab container
        // Removed pagination refs
        this.equipmentTabsContainer = this.equipWindowGameObject.getChildByID('equipment-tabs') as HTMLElement;

        // Store references to slot divs in the map
        Object.values(EquipmentSlot).forEach(slot => {
            const slotElement = this.equipWindowGameObject?.getChildByID(`equip-slot-${slot}`) as HTMLElement;
            if (slotElement) {
                // Assign grid area based on slot name
                slotElement.style.gridArea = slot.toLowerCase();
                this.equipmentSlots.set(slot, slotElement);
            }
        });

        // Updated check for elements
        if (!equipmentButton || !equipmentCloseButton || !equipmentTitleBar || !this.equipmentTabsContainer || this.equipmentSlots.size !== Object.keys(EquipmentSlot).length) {
            console.error("Failed to get all equipment UI elements (including tabs container)!");
            if (!equipmentButton) {
                console.error("UIScene: Specifically, #equipment-button was NOT found via getChildByID!");
            }
             if (!this.equipmentTabsContainer) {
                console.error("UIScene: Specifically, #equipment-tabs container was NOT found!");
            }
            // Don't return here, other UI might still work
        }

        // --- Equipment Button Listener ---
        if (equipmentButton) {
            console.log("UIScene: Attaching click listener to equipmentButton"); 
            equipmentButton.addEventListener('click', () => {
                console.log("UIScene: Equipment button clicked!"); 
                console.log("UIScene: equipWindowGameObject available:", !!this.equipWindowGameObject); 

                if (this.equipWindowGameObject) {
                    const currentVisibility = this.equipWindowGameObject.visible;
                    this.equipWindowGameObject.setVisible(!currentVisibility); 
                    const newVisibility = this.equipWindowGameObject.visible;

                    if (newVisibility) {
                        console.log("UIScene: Equipment window opened."); 

                        // *** Use receivedPartyData ***
                        this.currentParty = this.receivedPartyData; // Use data passed via init
                        console.log("UIScene: Using party data received via init:", this.currentParty); 
                        
                        this.currentEquipCharacterIndex = 0;
                        this.renderCurrentCharacterEquipment(); // Render initial character

                        if (this.currentParty.length > 0) {
                            const firstCharId = this.currentParty[0].id;
                            console.log(`UIScene: Requesting initial equipment for characterId: ${firstCharId}`); 
                            this.networkManager.sendMessage('requestEquipment', { characterId: firstCharId });
                        } else {
                            console.warn("UIScene: Cannot request equipment, no party data received via init.");
                        }
                    } else {
                         console.log("UIScene: Equipment window closed."); 
                    }
                } else {
                     console.error("UIScene: equipWindowGameObject is null or undefined when button clicked!"); 
                }
            });
        } else {
            console.error("UIScene: Could not find #equipment-button to attach listener."); 
        }
        
        // --- Equipment Close Button Listener ---
        // Need this listener explicitly now
        if(equipmentCloseButton) {
            equipmentCloseButton.addEventListener('click', () => {
                this.equipWindowGameObject?.setVisible(false);
            });
        }

        // --- Equipment Pagination Button Listeners ---
        // REMOVED
        // if (this.equipPrevButton) { ... }
        // if (this.equipNextButton) { ... }

        // --- Equipment Drag Logic ---
        if (this.equipWindowGameObject && equipmentTitleBar) {
             console.log("[UIScene] Attaching drag handler to Equipment Window");
            this.makeDraggable(this.equipWindowGameObject, equipmentTitleBar);
        } else {
             console.error("[UIScene] Failed to attach drag handler to Equipment: Missing elements.");
        }

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
            // Update focus check for nested elements
            if (document.activeElement === this.chatInputElement || invWindowGameObject.node.contains(document.activeElement)) {
                event.stopPropagation(); // Stop Phaser if chat or inventory window elements have focus
                if (event.key === 'Enter' && document.activeElement === this.chatInputElement) {
                    this.handleSendMessage();
                }
                 // Add ESC key to close inventory if it's open
                 if (event.key === 'Escape' && invWindowGameObject.visible) { // Check Phaser visibility
                    invWindowGameObject.setVisible(false);
                }
            }
        });

        // --- EventBus Listeners ---
        EventBus.on('chat-message-received', this.handleChatMessage, this);
        EventBus.on('focus-chat-input', this.focusChatInput, this);
        EventBus.on('inventory-update', this.handleInventoryUpdate, this); 
        EventBus.on('equipment-update', this.handleEquipmentUpdate, this); // <-- Add equipment listener

        console.log('UI Elements Created (Chat, Menu, Inventory Window).');
        if (!this.chatLogElement || !this.chatInputElement) {
             console.error("Failed to get chat log or input elements!");
        }

        // --- Pagination Button Listeners ---
        this.invPrevButton.addEventListener('click', () => {
            if (this.currentPage > 1) {
                this.currentPage--;
                this.renderCurrentInventoryPage(); // Re-render grid
            }
        });

        this.invNextButton.addEventListener('click', () => {
            if (this.currentPage < this.totalPages) {
                this.currentPage++;
                this.renderCurrentInventoryPage(); // Re-render grid
            }
        });
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
        EventBus.off('focus-chat-input', this.focusChatInput, this);
        EventBus.off('inventory-update', this.handleInventoryUpdate, this); 
        EventBus.off('equipment-update', this.handleEquipmentUpdate, this); // <-- Remove equipment listener
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

    // Method to make DOM elements draggable
    // Takes the Phaser DOM Element and the HTML Handle element
    private makeDraggable(domGameObject: Phaser.GameObjects.DOMElement, handle: HTMLElement) {
        let isDragging = false;
        let offsetX = 0;
        let offsetY = 0;

        handle.style.cursor = 'grab';

        const onMouseDown = (e: MouseEvent) => {
            // Prevent starting drag on buttons within the handle (like close buttons)
            if ((e.target as HTMLElement)?.tagName === 'BUTTON') {
                return;
            }
            isDragging = true;
            offsetX = e.clientX - domGameObject.x;
            offsetY = e.clientY - domGameObject.y;
            handle.style.cursor = 'grabbing';
            // Add listeners to document for move/up
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
            // Prevent text selection during drag
            e.preventDefault();
        };

        const onMouseMove = (e: MouseEvent) => {
            if (!isDragging) return;

            let newX = e.clientX - offsetX;
            let newY = e.clientY - offsetY;

            // --- Boundary check using the dragged element's dimensions ---
            const gameWidth = this.scale.width;
            const gameHeight = this.scale.height;
            // Get the main content div within the Phaser DOM wrapper
            const contentElement = domGameObject.node.firstElementChild as HTMLElement;
            const elementWidth = contentElement?.clientWidth ?? domGameObject.width; // Fallback to DOM object width
            const elementHeight = contentElement?.clientHeight ?? domGameObject.height; // Fallback to DOM object height

            newX = Math.max(0, Math.min(newX, gameWidth - elementWidth));
            newY = Math.max(0, Math.min(newY, gameHeight - elementHeight));
            // -------------------------------------------------------------

            domGameObject.setPosition(newX, newY);
        };

        const onMouseUp = () => {
            if (isDragging) {
                isDragging = false;
                handle.style.cursor = 'grab';
                // Remove listeners from document
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', onMouseUp);
            }
        };
        
        // Attach the initial mousedown listener to the handle
        handle.addEventListener('mousedown', onMouseDown);

        // Store cleanup function to remove listener when scene shuts down
        // (Requires modifying shutdown method later if not already handled)
        this.events.once('shutdown', () => {
           handle.removeEventListener('mousedown', onMouseDown);
           document.removeEventListener('mousemove', onMouseMove); // Ensure cleanup
           document.removeEventListener('mouseup', onMouseUp);      // Ensure cleanup
        });
    }

    // --- Inventory Display Update ---
    private handleInventoryUpdate(data: InventoryUpdatePayload) { 
        console.log('[UIScene] Handling inventory update:', data);
        this.fullInventory = data.inventory || [];
        this.totalPages = 6; // Always 6 pages
        // Reset to page 1 or stay on current page if still valid?
        this.currentPage = Math.max(1, Math.min(this.currentPage, this.totalPages)); 
        this.renderCurrentInventoryPage();
    }

    // --- Renders the items for the current page --- 
    private renderCurrentInventoryPage() {
        console.log(`[UIScene] Rendering inventory page ${this.currentPage}/${this.totalPages}`);
        if (!this.inventoryItemsElement || !this.invPrevButton || !this.invNextButton || !this.invPageInfo) {
            console.error("Cannot render inventory page, elements missing.");
            return;
        }

        // Clear previous items
        this.inventoryItemsElement.innerHTML = '';

        // Calculate items for the current page
        const startIndex = (this.currentPage - 1) * this.itemsPerPage;
        const endIndex = startIndex + this.itemsPerPage;
        const pageItems = this.fullInventory.slice(startIndex, endIndex);

        // Update pagination controls visibility/state
        this.invPageInfo.textContent = `Page ${this.currentPage} / ${this.totalPages}`;
        this.invPrevButton.disabled = this.currentPage <= 1;
        this.invNextButton.disabled = this.currentPage >= this.totalPages;
        this.invPrevButton.style.cursor = this.currentPage <= 1 ? 'not-allowed' : 'pointer';
        this.invNextButton.style.cursor = this.currentPage >= this.totalPages ? 'not-allowed' : 'pointer';

        // Populate grid - Create 36 slots, fill with items, leave others empty
        for (let i = 0; i < this.itemsPerPage; i++) {
            const slotElement = document.createElement('div');
            slotElement.style.width = '45px';
            slotElement.style.height = '45px';
            slotElement.style.backgroundColor = 'rgba(0, 0, 0, 0.3)';
            slotElement.style.border = '1px solid #666';
            slotElement.style.position = 'relative'; // For quantity display
            slotElement.style.display = 'flex'; // Center content (optional)
            slotElement.style.alignItems = 'center'; // Center content (optional)
            slotElement.style.justifyContent = 'center'; // Center content (optional)

            const item = pageItems[i];
            // Clear previous listeners first
            slotElement.onmouseenter = null;
            slotElement.onmouseleave = null;
            slotElement.oncontextmenu = null; 
            slotElement.style.cursor = 'default';

            if (item) {
                // Add logging here
                console.log(`[UIScene Inventory Render] Item: ${item.id}, Template Exists: ${!!item.itemTemplate}, EquipSlot Value: ${item.itemTemplate?.equipSlot}`);

                // Standard Tooltip listeners
                slotElement.onmouseenter = () => this.showItemTooltip(item, slotElement);
                slotElement.onmouseleave = () => this.hideItemTooltip();
                slotElement.style.cursor = 'pointer';

                // ** Use SVG for basic shapes based on itemType **
                let itemVisualHtml = '';
                const itemType = item.itemTemplate?.itemType;
                const fillColor = '#aaa'; // Default color

                switch (itemType) {
                    case 'MATERIAL': // Circle
                        itemVisualHtml = `<svg width="30" height="30" viewBox="0 0 100 100"><circle cx="50" cy="50" r="45" fill="${fillColor}" /></svg>`;
                        break;
                    case 'WEAPON': // Triangle (simple)
                         itemVisualHtml = `<svg width="30" height="30" viewBox="0 0 100 100"><polygon points="50,5 95,95 5,95" fill="${fillColor}" /></svg>`;
                        break;
                    case 'ARMOR': // Square
                    case 'HELM':
                    case 'GLOVES':
                    case 'BOOTS':
                    case 'OFFHAND': // Treat offhand as armor for shape
                         itemVisualHtml = `<svg width="30" height="30" viewBox="0 0 100 100"><rect x="10" y="10" width="80" height="80" fill="${fillColor}" /></svg>`;
                        break;
                    case 'CONSUMABLE': // Cylinder (basic rectangle for now)
                        itemVisualHtml = `<svg width="20" height="30" viewBox="0 0 66 100"><rect x="10" y="10" width="46" height="80" rx="15" ry="15" fill="${fillColor}" /></svg>`; // Rounded rectangle approximation
                        break;
                    case 'RING': // Smaller Circle
                    case 'NECKLACE':
                         itemVisualHtml = `<svg width="25" height="25" viewBox="0 0 100 100"><circle cx="50" cy="50" r="35" fill="${fillColor}" stroke="#666" stroke-width="10" /></svg>`; // Circle with hole
                         break;
                    default: // Default placeholder
                         itemVisualHtml = `<span style="font-size: 10px;">?</span>`;
                         break;
                }
                slotElement.innerHTML = itemVisualHtml; // Set SVG as content
                // slotElement.textContent = itemName.substring(0, 3); // Remove text placeholder
                // slotElement.style.fontSize = '10px';
                // slotElement.style.overflow = 'hidden';
                // slotElement.style.textAlign = 'center';
                
                const itemName = item.itemTemplate?.name ?? 'Unknown Item';
                slotElement.title = itemName; // Tooltip for full name

                // Display quantity if > 1
                if (item.quantity > 1) {
                    const quantityElement = document.createElement('span');
                    quantityElement.textContent = `${item.quantity}`;
                    quantityElement.style.position = 'absolute';
                    quantityElement.style.bottom = '2px';
                    quantityElement.style.right = '2px';
                    quantityElement.style.fontSize = '10px';
                    quantityElement.style.color = 'white';
                    quantityElement.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
                    quantityElement.style.padding = '0 2px';
                    quantityElement.style.borderRadius = '2px';
                    slotElement.appendChild(quantityElement);
                }

                // --- Add Right-Click Listener for Equipping --- 
                const isEquippable = item.itemTemplate && item.itemTemplate.equipSlot;
                 // Log if the equip listener is being added
                 console.log(`[UIScene Inventory Render] Item: ${item.id}, Is Equippable (adding listener?): ${isEquippable}`);

                if (isEquippable) {
                    slotElement.oncontextmenu = (event) => {
                        event.preventDefault(); // Prevent default browser menu
                        
                        // Determine target character (currently selected in equip window)
                        const partySize = this.currentParty.length;
                        if (!this.equipWindowGameObject?.visible || partySize === 0) {
                             console.warn("Cannot equip item: Equipment window closed or no party selected.");
                            this.showFeedbackMessage("Open Equipment window and select a character first."); // Provide user feedback
                            return;
                        }
                        const targetCharacter = this.currentParty[this.currentEquipCharacterIndex];
                        if (!targetCharacter) {
                            console.error("Cannot equip item: Could not find target character data.");
                            return;
                        }
                        const targetCharacterId = targetCharacter.id;
                        const inventoryItemId = item.id; // The ID of the item being clicked

                        console.log(`[UIScene] Right-clicked inventory item ${inventoryItemId} to equip on character ${targetCharacterId}`);
                        
                        // Send equip command to server
                        this.networkManager.sendMessage('equipItemCommand', { 
                            inventoryItemId: inventoryItemId, 
                            characterId: targetCharacterId
                        });
                        // Optional: Add brief visual feedback here (e.g., highlight slot)
                    };
                } else {
                     // If not equippable, ensure cursor is default and no context menu
                     slotElement.style.cursor = 'default';
                     slotElement.oncontextmenu = (e) => e.preventDefault(); // Still prevent default menu maybe?
                }
                // ------------------------------------------------

            } else {
                 // Empty slot, ensure no listeners and default cursor
                 slotElement.onmouseenter = null;
                 slotElement.onmouseleave = null;
                 slotElement.oncontextmenu = null; 
                 slotElement.style.cursor = 'default';
            }
            
            this.inventoryItemsElement.appendChild(slotElement);
        }
    }

    // --- Tooltip Methods --- 
    private showItemTooltip(item: InventoryItem, slotElement: HTMLElement) {
        this.hideItemTooltip(); // Hide any existing tooltip

        const template = item.itemTemplate;
        if (!template) return;

        // Basic stats string
        let statsHtml = '';
        if (template.attackBonus && template.attackBonus > 0) {
            statsHtml += `<div style="color: #ddd;">Attack: +${template.attackBonus}</div>`;
        }
        if (template.defenseBonus && template.defenseBonus > 0) {
            statsHtml += `<div style="color: #ddd;">Defense: +${template.defenseBonus}</div>`;
        }
        // Add other stats (health, etc.) here if implemented

        const tooltipHtml = `
            <div id="item-tooltip" style="position: absolute; left: 0; top: 0; width: 200px; background-color: rgba(0,0,0,0.85); border: 1px solid #aaa; border-radius: 4px; color: white; padding: 8px; font-size: 12px; z-index: 110; pointer-events: none;">
                <div style="font-weight: bold; color: #eee; margin-bottom: 5px;">${template.name}</div>
                <div style="margin-bottom: 8px; display: flex; align-items: center;">
                     <div style="width: 40px; height: 40px; background-color: #333; border: 1px solid #555; margin-right: 8px; display: flex; align-items: center; justify-content: center;">
                         ${this.getItemSvgShape(template.itemType, '#ccc', 30)}
                     </div>
                     <div style="flex-grow: 1; font-style: italic; color: #bbb;">${template.description || ''}</div>
                </div>
                ${statsHtml}
            </div>
        `;

        // Create the tooltip DOM element temporarily at 0,0 to measure it
        this.itemTooltipElement = this.add.dom(0, 0).createFromHTML(tooltipHtml).setOrigin(0, 0);
        const tooltipNode = this.itemTooltipElement.node as HTMLElement;
        const tooltipRect = tooltipNode.getBoundingClientRect(); // Measure its size
        
        // Calculate desired position relative to the slot
        const slotRect = slotElement.getBoundingClientRect();
        const gameCanvas = this.sys.game.canvas;
        const margin = 10; // Space between slot and tooltip

        let desiredX = slotRect.right + margin;
        let desiredY = slotRect.top;

        // --- Comprehensive Boundary Checks ---
        // Check Right Edge
        if (desiredX + tooltipRect.width > gameCanvas.clientWidth) {
            desiredX = slotRect.left - tooltipRect.width - margin; // Flip to left
        }
        // Check Left Edge (after potentially flipping)
        if (desiredX < 0) {
            desiredX = margin; // Clamp to left edge
        }

        // Check Bottom Edge
        if (desiredY + tooltipRect.height > gameCanvas.clientHeight) {
             // Try placing above ONLY if it fits there, otherwise clamp to bottom
             if (slotRect.top - tooltipRect.height - margin >= 0) {
                 desiredY = slotRect.top - tooltipRect.height - margin; // Place above
             } else {
                 desiredY = gameCanvas.clientHeight - tooltipRect.height - margin; // Clamp to bottom edge
             }
        }
         // Check Top Edge (after potentially moving)
         if (desiredY < 0) {
            desiredY = margin; // Clamp to top edge
         }
        // ------------------------------------

        // Set the final calculated position
        this.itemTooltipElement.setPosition(desiredX, desiredY);
    }

    private hideItemTooltip() {
        this.itemTooltipElement?.destroy();
        this.itemTooltipElement = null;
    }

    // Helper to get SVG shape string (avoids duplicating logic)
    private getItemSvgShape(itemType: string | undefined, fillColor: string, size: number): string {
         switch (itemType) {
            case 'MATERIAL': 
                return `<svg width="${size}" height="${size}" viewBox="0 0 100 100"><circle cx="50" cy="50" r="45" fill="${fillColor}" /></svg>`;
            case 'WEAPON': 
                 return `<svg width="${size}" height="${size}" viewBox="0 0 100 100"><polygon points="50,5 95,95 5,95" fill="${fillColor}" /></svg>`;
            case 'ARMOR': case 'HELM': case 'GLOVES': case 'BOOTS': case 'OFFHAND':
                 return `<svg width="${size}" height="${size}" viewBox="0 0 100 100"><rect x="10" y="10" width="80" height="80" fill="${fillColor}" /></svg>`;
            case 'CONSUMABLE': 
                return `<svg width="${Math.floor(size * 0.66)}" height="${size}" viewBox="0 0 66 100"><rect x="10" y="10" width="46" height="80" rx="15" ry="15" fill="${fillColor}" /></svg>`;
            case 'RING': case 'NECKLACE':
                 return `<svg width="${Math.floor(size * 0.8)}" height="${Math.floor(size * 0.8)}" viewBox="0 0 100 100"><circle cx="50" cy="50" r="35" fill="${fillColor}" stroke="#666" stroke-width="10" /></svg>`;
            default: 
                 return `<span style="font-size: ${size * 0.4}px;">?</span>`;
        }
    }

    // --- Method to show temporary feedback messages ---
    private showFeedbackMessage(message: string, duration: number = 2000) {
        // Reuse error display logic, maybe change color?
        const x = this.cameras.main.centerX;
        const y = 50; // Position near the top-center

        const text = this.add.text(x, y, message, {
            fontSize: '16px',
            fontFamily: 'Arial, sans-serif',
            color: '#eeeeee', // White/light gray for general feedback
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

    // --- Equipment Display Update ---
    private handleEquipmentUpdate(data: EquipmentUpdatePayload) {
        console.log('[UIScene] Handling equipment update for char:', data.characterId, data.equipment);
        // Store the updated equipment data for the specific character
        this.allCharacterEquipment.set(data.characterId, data.equipment);

        // If the update is for the currently viewed character, re-render
        const currentCharacter = this.currentParty[this.currentEquipCharacterIndex];
        if (currentCharacter && currentCharacter.id === data.characterId) {
            console.log('[UIScene] Equipment update is for current view, re-rendering.');
            this.renderCurrentCharacterEquipment();
        }
    }

    // --- Render Equipment for Current Character --- 
    private renderCurrentCharacterEquipment() {
        // Check for tab container instead of pagination buttons
        if (!this.equipWindowGameObject || !this.equipmentTabsContainer) {
            console.error("Equipment window elements not ready for rendering (missing tabs container?).");
            return;
        }

        const partySize = this.currentParty.length;
        
        // --- Generate Tabs --- 
        this.equipmentTabsContainer.innerHTML = ''; // Clear existing tabs
        if (partySize === 0) {
            this.equipmentTabsContainer.textContent = 'No Party Selected'; // Display message in tab area
            this.equipmentTabsContainer.style.padding = '5px';
            this.equipmentTabsContainer.style.color = '#888';
            this.equipmentTabsContainer.style.textAlign = 'center';
        } else {
            this.equipmentTabsContainer.style.padding = '0'; // Reset padding
            this.currentParty.forEach((character, index) => {
                // *** Add null check for safety although covered by function entry check ***
                if (!this.equipmentTabsContainer) return; 

                const tabButton = document.createElement('button');
                tabButton.textContent = character.name.substring(0, 8) + (character.name.length > 8 ? '...': ''); // Shorten name
                tabButton.dataset.index = String(index); // Store index on the button
                tabButton.title = character.name; // Full name on hover

                // Basic tab styling (adjust as needed)
                tabButton.style.flexGrow = '1';
                tabButton.style.padding = '6px 4px';
                tabButton.style.border = 'none';
                tabButton.style.borderRight = '1px solid #555';
                tabButton.style.fontSize = '11px';
                tabButton.style.textAlign = 'center';
                tabButton.style.cursor = 'pointer';
                tabButton.style.whiteSpace = 'nowrap';
                tabButton.style.overflow = 'hidden';
                tabButton.style.textOverflow = 'ellipsis';

                if (index === this.currentEquipCharacterIndex) {
                    // Active tab style
                    tabButton.style.backgroundColor = 'rgba(80, 80, 80, 0.7)';
                    tabButton.style.color = 'white';
                    tabButton.style.fontWeight = 'bold';
                } else {
                    // Inactive tab style
                    tabButton.style.backgroundColor = 'rgba(40, 40, 40, 0.5)';
                    tabButton.style.color = '#bbb';
                }

                // Add click listener for tab switching
                tabButton.addEventListener('click', () => {
                    const clickedIndex = parseInt(tabButton.dataset.index || '0', 10);
                    if (clickedIndex !== this.currentEquipCharacterIndex) {
                        this.currentEquipCharacterIndex = clickedIndex;
                        console.log(`[UIScene] Switched equipment tab to index: ${this.currentEquipCharacterIndex}`);
                        this.renderCurrentCharacterEquipment(); // Re-render to update slots and highlight

                        // Optional: Request equipment if not loaded
                        const charId = this.currentParty[this.currentEquipCharacterIndex]?.id;
                        if (charId && !this.allCharacterEquipment.has(charId)) {
                            console.log(`[UIScene] Requesting equipment for newly viewed character via tab: ${charId}`);
                            this.networkManager.sendMessage('requestEquipment', { characterId: charId });
                        }
                    }
                });

                this.equipmentTabsContainer.appendChild(tabButton);
            });
             // Remove border from last tab
            const lastTab = this.equipmentTabsContainer.lastChild as HTMLElement;
            if (lastTab) lastTab.style.borderRight = 'none';
        }
        // --- End Tab Generation ---

        // If no party, clear slots and exit
        if (partySize === 0) {
            this.equipmentSlots.forEach((slotElement, slot) => {
                slotElement.innerHTML = '';
                slotElement.textContent = slot.substring(0, 3);
                slotElement.style.borderColor = '#888';
                slotElement.title = slot;
            });
            return;
        }

        // Ensure index is valid (still useful)
        this.currentEquipCharacterIndex = Math.max(0, Math.min(this.currentEquipCharacterIndex, partySize - 1));

        const character = this.currentParty[this.currentEquipCharacterIndex];
        const characterId = character?.id;
        const characterName = character?.name ?? 'Unknown';
        const equipmentData = this.allCharacterEquipment.get(characterId) || {};

        // Update character info display (REMOVED - now handled by active tab highlight)
        // this.equipCharInfo.textContent = `${characterName} (${this.currentEquipCharacterIndex + 1}/${partySize})`;

        console.log(`[UIScene] Rendering equipment for ${characterName} (Index: ${this.currentEquipCharacterIndex})`, equipmentData);

        // Update slots 
        this.equipmentSlots.forEach((slotElement, slot) => {
            const item = equipmentData[slot]; 
            // Clear previous content and listeners
            slotElement.innerHTML = ''; 
            slotElement.title = slot; 
            slotElement.style.cursor = 'default'; 
            slotElement.oncontextmenu = null; 
            slotElement.onmouseenter = null; // Clear hover listener
            slotElement.onmouseleave = null; // Clear hover listener
            
            if (item && item.itemTemplate) {
                const template = item.itemTemplate;
                slotElement.innerHTML = this.getItemSvgShape(template.itemType, '#ddd', 35); 
                slotElement.title = `${template.name}\n(${slot})`; 
                slotElement.style.borderColor = '#ccc'; 
                slotElement.style.cursor = 'pointer'; 

                // Add Right-Click Listener for Unequipping (already exists)
                slotElement.oncontextmenu = (event) => {
                    event.preventDefault(); // Prevent default browser menu
                    const charId = this.currentParty[this.currentEquipCharacterIndex]?.id;
                    if (!charId) {
                        console.error("Cannot unequip: Current character ID not found.");
                        return;
                    }
                    console.log(`[UIScene] Right-clicked to unequip item from slot ${slot} for character ${charId}`);
                    // Send unequip command to server
                    this.networkManager.sendMessage('unequipItem', { 
                        characterId: charId, 
                        slot: slot // The slot key from the loop
                    });
                    // Optional: Add brief visual feedback here (e.g., highlight)
                };

                // --- Add Hover Listeners for Tooltip --- 
                slotElement.onmouseenter = () => this.showItemTooltip(item, slotElement);
                slotElement.onmouseleave = () => this.hideItemTooltip();
                // ------------------------------------------

            } else {
                // Empty slot: Show placeholder text
                slotElement.textContent = slot.substring(0, 3);
                slotElement.style.borderColor = '#888'; 
                // Ensure listeners and cursor are reset for empty slots
                slotElement.oncontextmenu = null; 
                slotElement.onmouseenter = null;
                slotElement.onmouseleave = null;
                slotElement.style.cursor = 'default';
            }
        });

        // Update pagination button states (REMOVED)
        // this.equipPrevButton.disabled = ...
        // this.equipNextButton.disabled = ...
    }

    // --- Change Character View --- 
    // REMOVED - No longer needed
    // private changeEquipmentCharacter(delta: number) { ... }

}