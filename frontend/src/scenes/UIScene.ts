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
    private equipPrevButton: HTMLButtonElement | null = null;
    private equipNextButton: HTMLButtonElement | null = null;
    private equipCharInfo: HTMLSpanElement | null = null;
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

        // --- Inventory Drag Logic (pass Phaser DOM Object and HTML Handle) ---
        this.makeDraggable(invWindowGameObject, inventoryTitleBar);

        // --- Create Equipment Window DOM Element (Initially Hidden) ---
        const equipmentSlotsHtml = Object.values(EquipmentSlot).map(slot => 
            `<div class="equip-slot" id="equip-slot-${slot}" title="${slot}" 
                  style="width: 50px; height: 50px; background-color: rgba(0,0,0,0.4); border: 1px dashed #888; 
                         display: flex; align-items: center; justify-content: center; color: #666; font-size: 10px; overflow: hidden;" 
            >${slot.substring(0,3)}</div>` // Placeholder text
        ).join('');

        const equipWindowHtml = `
            <div id="equipment-window" style="width: 220px; /* Slightly wider for pagination */ flex-direction: column; background-color: rgba(40, 40, 40, 0.9); border: 2px solid #888; border-radius: 5px; font-family: sans-serif; z-index: 99;">
                <div id="equipment-title-bar" style="background-color: #333; color: white; padding: 5px; font-size: 14px; font-weight: bold; cursor: grab; display: flex; justify-content: space-between; align-items: center;">
                    <span>Equipment</span>
                    <button id="equipment-close-button" style="background: none; border: none; color: white; font-size: 16px; cursor: pointer; line-height: 1;">&times;</button>
                </div>
                <!-- Character Info and Pagination -->
                 <div id="equipment-pagination" style="display: flex; justify-content: space-between; align-items: center; padding: 5px 10px; border-bottom: 1px solid #555; background-color: rgba(0,0,0,0.2);">
                    <button id="equip-prev-button" style="padding: 2px 5px; font-size: 12px;">&lt;</button>
                    <span id="equip-char-info" style="color: white; font-size: 12px; text-align: center; flex-grow: 1;">Character (1/1)</span>
                    <button id="equip-next-button" style="padding: 2px 5px; font-size: 12px;">&gt;</button>
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
         // Get references to pagination controls
        this.equipPrevButton = this.equipWindowGameObject.getChildByID('equip-prev-button') as HTMLButtonElement;
        this.equipNextButton = this.equipWindowGameObject.getChildByID('equip-next-button') as HTMLButtonElement;
        this.equipCharInfo = this.equipWindowGameObject.getChildByID('equip-char-info') as HTMLSpanElement;

        // Store references to slot divs in the map
        Object.values(EquipmentSlot).forEach(slot => {
            const slotElement = this.equipWindowGameObject?.getChildByID(`equip-slot-${slot}`) as HTMLElement;
            if (slotElement) {
                // Assign grid area based on slot name
                slotElement.style.gridArea = slot.toLowerCase();
                this.equipmentSlots.set(slot, slotElement);
            }
        });

        if (!equipmentButton || !equipmentCloseButton || !equipmentTitleBar || !this.equipPrevButton || !this.equipNextButton || !this.equipCharInfo || this.equipmentSlots.size !== Object.keys(EquipmentSlot).length) {
            console.error("Failed to get all equipment UI elements (including pagination)!");
            if (!equipmentButton) {
                console.error("UIScene: Specifically, #equipment-button was NOT found via getChildByID!");
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
        if (this.equipPrevButton) {
            this.equipPrevButton.addEventListener('click', () => {
                this.changeEquipmentCharacter(-1);
            });
        }
        if (this.equipNextButton) {
            this.equipNextButton.addEventListener('click', () => {
                this.changeEquipmentCharacter(1);
            });
        }

        // --- Equipment Drag Logic ---
        if (this.equipWindowGameObject && equipmentTitleBar) {
            this.makeDraggable(this.equipWindowGameObject, equipmentTitleBar);
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

    // Method to make the inventory window draggable
    // Takes the Phaser DOM Element and the HTML Handle element
    private makeDraggable(domGameObject: Phaser.GameObjects.DOMElement, handle: HTMLElement) {
        let isDragging = false;
        let offsetX = 0;
        let offsetY = 0;

        handle.style.cursor = 'grab';

        handle.onmousedown = (e) => {
            // No need for extensive logging now, hopefully this works
            isDragging = true;
            // Calculate offset based on mouse click relative to the DOM Element's top-left (x, y)
            offsetX = e.clientX - domGameObject.x;
            offsetY = e.clientY - domGameObject.y;
            
            handle.style.cursor = 'grabbing';
            e.preventDefault(); 
        };

        document.onmousemove = (e) => {
            if (!isDragging) return;

            // Calculate new *absolute* position for the DOM Element
            let newX = e.clientX - offsetX;
            let newY = e.clientY - offsetY;

            // Boundary check using scale manager and element *visual* dimensions
            const gameWidth = this.scale.width;
            const gameHeight = this.scale.height;
            // Use offsetWidth/Height of the actual #inventory-window div for size
            const elementWidth = (domGameObject.node as HTMLElement)?.querySelector('#inventory-window')?.clientWidth ?? 300; // Fallback width
            const elementHeight = (domGameObject.node as HTMLElement)?.querySelector('#inventory-window')?.clientHeight ?? 400; // Fallback height
            
            newX = Math.max(0, Math.min(newX, gameWidth - elementWidth));
            newY = Math.max(0, Math.min(newY, gameHeight - elementHeight));

            // Apply the new position using Phaser's method
            domGameObject.setPosition(newX, newY);
        };

        document.onmouseup = () => {
            if (isDragging) {
                isDragging = false;
                handle.style.cursor = 'grab';
            }
        };

        document.onmouseleave = () => {
            if (isDragging) {
                isDragging = false;
                handle.style.cursor = 'grab';
            }
        };
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
            if (item) {
                // Add hover listeners for tooltip
                slotElement.onmouseenter = () => this.showItemTooltip(item, slotElement);
                slotElement.onmouseleave = () => this.hideItemTooltip();
                slotElement.style.cursor = 'pointer'; // Indicate interactivity

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
                // TODO: Add click/drag handlers for items later
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
            <div id="item-tooltip" style="position: absolute; left: 0; top: 0; /* Positioned by JS */ width: 200px; background-color: rgba(0,0,0,0.85); border: 1px solid #aaa; border-radius: 4px; color: white; padding: 8px; font-size: 12px; z-index: 110; pointer-events: none;">
                <div style="font-weight: bold; color: #eee; margin-bottom: 5px;">${template.name}</div>
                <div style="margin-bottom: 8px; display: flex; align-items: center;">
                     <!-- Placeholder for larger image/shape -->
                     <div style="width: 40px; height: 40px; background-color: #333; border: 1px solid #555; margin-right: 8px; display: flex; align-items: center; justify-content: center;">
                         ${this.getItemSvgShape(template.itemType, '#ccc', 30)} <!-- Use helper for shape -->
                     </div>
                     <div style="flex-grow: 1; font-style: italic; color: #bbb;">${template.description || ''}</div>
                </div>
                ${statsHtml}
            </div>
        `;

        // Calculate position near the slot element
        const slotRect = slotElement.getBoundingClientRect();
        const gameCanvas = this.sys.game.canvas;
        const tooltipX = slotRect.right + 5; // Position to the right of the slot
        const tooltipY = slotRect.top;

        this.itemTooltipElement = this.add.dom(tooltipX, tooltipY).createFromHTML(tooltipHtml).setOrigin(0, 0);

        // Adjust position if tooltip goes off-screen (basic check)
        const tooltipRect = this.itemTooltipElement.node.getBoundingClientRect();
        if (tooltipRect.right > gameCanvas.clientWidth) {
            this.itemTooltipElement.x = slotRect.left - tooltipRect.width - 5;
        }
        if (tooltipRect.bottom > gameCanvas.clientHeight) {
            this.itemTooltipElement.y = slotRect.bottom - tooltipRect.height;
        }
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
        if (!this.equipWindowGameObject || !this.equipCharInfo || !this.equipPrevButton || !this.equipNextButton) {
            console.error("Equipment window elements not ready for rendering.");
            return;
        }

        const partySize = this.currentParty.length;
        if (partySize === 0) {
            this.equipCharInfo.textContent = 'No Party Selected';
            this.equipmentSlots.forEach((slotElement, slot) => {
                slotElement.innerHTML = '';
                slotElement.textContent = slot.substring(0, 3);
                slotElement.style.borderColor = '#888';
                slotElement.title = slot;
            });
            this.equipPrevButton.disabled = true;
            this.equipNextButton.disabled = true;
            return;
        }

        // Ensure index is valid
        this.currentEquipCharacterIndex = Math.max(0, Math.min(this.currentEquipCharacterIndex, partySize - 1));

        const character = this.currentParty[this.currentEquipCharacterIndex];
        const characterId = character?.id;
        const characterName = character?.name ?? 'Unknown';
        const equipmentData = this.allCharacterEquipment.get(characterId) || {};

        // Update character info display
        this.equipCharInfo.textContent = `${characterName} (${this.currentEquipCharacterIndex + 1}/${partySize})`;

        console.log(`[UIScene] Rendering equipment for ${characterName} (Index: ${this.currentEquipCharacterIndex})`, equipmentData);

        // Update slots
        this.equipmentSlots.forEach((slotElement, slot) => {
            const item = equipmentData[slot]; // Get item for this slot, if any
            slotElement.innerHTML = ''; // Clear previous content
            slotElement.title = slot; // Set default title to slot name
            
            if (item && item.itemTemplate) {
                const template = item.itemTemplate;
                slotElement.innerHTML = this.getItemSvgShape(template.itemType, '#ddd', 35); // Use SVG helper
                slotElement.title = `${template.name}\n(${slot})`; // Set tooltip
                // TODO: Add click/drag handlers later for unequipping
                slotElement.style.borderColor = '#ccc'; // Indicate filled slot
            } else {
                // Show placeholder text if empty
                slotElement.textContent = slot.substring(0, 3);
                slotElement.style.borderColor = '#888'; // Default border color
            }
        });

        // Update pagination button states
        this.equipPrevButton.disabled = this.currentEquipCharacterIndex <= 0;
        this.equipNextButton.disabled = this.currentEquipCharacterIndex >= partySize - 1;
        this.equipPrevButton.style.cursor = this.equipPrevButton.disabled ? 'not-allowed' : 'pointer';
        this.equipNextButton.style.cursor = this.equipNextButton.disabled ? 'not-allowed' : 'pointer';
    }

    // --- Change Character View --- 
    private changeEquipmentCharacter(delta: number) {
        if (!this.currentParty || this.currentParty.length <= 1) return; // No change if no party or only 1 char

        const newIndex = this.currentEquipCharacterIndex + delta;
        const partySize = this.currentParty.length;

        // Clamp the index
        this.currentEquipCharacterIndex = Math.max(0, Math.min(newIndex, partySize - 1));

        console.log(`[UIScene] Changing equipment view to index: ${this.currentEquipCharacterIndex}`);
        this.renderCurrentCharacterEquipment();

        // Optional: Request equipment for the newly viewed character if we don't have it yet
        const characterId = this.currentParty[this.currentEquipCharacterIndex]?.id;
        if (characterId && !this.allCharacterEquipment.has(characterId)) {
            console.log(`[UIScene] Requesting equipment for newly viewed character: ${characterId}`);
            this.networkManager.sendMessage('requestEquipment', { characterId: characterId });
        }
    }
}