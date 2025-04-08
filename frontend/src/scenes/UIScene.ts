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

// Define Level Up Notification Payload
interface LevelUpPayload {
    characterId: string;
    newLevel: number;
    newBaseStats: { health: number; attack: number; defense: number };
    xp: number;
    xpToNextLevel: number;
}

// Define XP Update Payload
interface XpUpdatePayload {
    characterId: string;
    level: number;
    xp: number;
    xpToNextLevel: number;
}

// Payload Interfaces for UI Update Events from GameScene
interface UpdatePartyHpPayload {
    characterId: string;
    currentHp: number;
    maxHp: number;
}
interface UpdatePartyXpPayload {
    characterId: string;
    level: number;
    currentXp: number;      // Relative XP within level
    xpToNextLevel: number; // Span/Needed for this level
}
interface PartyMemberLevelUpPayload {
    characterId: string;
    newLevel: number;
    currentHp: number;      // Full HP
    maxHp: number;
    currentXp: number;      // Relative XP within new level
    xpToNextLevel: number; // Span/Needed for new level
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
    // Remove old sort buttons, add dropdown refs
    private invSortButton: HTMLButtonElement | null = null;
    private invSortDropdown: HTMLElement | null = null;
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
    // --- Drag state ---
    private draggedItemData: { item: InventoryItem, originalSlot: number } | null = null; // Store original slot
    private draggedElementGhost: HTMLElement | null = null; // Visual ghost element
    // --- Inventory Data ---
    private inventorySlotsData: (InventoryItem | null)[] = []; // Store sparse array from backend
    // --- Party UI ---
    private partyUiGameObject: Phaser.GameObjects.DOMElement | null = null;
    // Modify map structure to store bar fill elements and values
    private partyMemberPanels: Map<string, {
        nameElement: HTMLElement | null,
        hpFillElement: HTMLElement | null, // Reference to HP bar fill
        xpFillElement: HTMLElement | null, // Reference to XP bar fill
        hpTextElement: HTMLElement | null, // Reference to text overlay for HP
        xpTextElement: HTMLElement | null, // Reference to text overlay for XP
        currentHp: number,
        maxHp: number,
        currentXp: number, // Store current XP (relative to level start)
        xpToNextLevel: number // Store XP needed for next level (relative to level start)
    }> = new Map();
    // ---------------

    constructor() {
        // Make sure the scene key is unique and matches the one in main.ts config
        super({ key: 'UIScene', active: false }); // Start inactive initially
    }

    // *** Add init method ***
    init(data: { selectedParty?: any[] }) {
        this.receivedPartyData = data.selectedParty || []; // Store the passed data
    }

    create() {
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

        // --- Create Inventory Window DOM Element (Initially Hidden) ---
        const invWindowHtml = `
            <div id="inventory-window" style="position: relative; /* Needed for absolute dropdown */ width: 320px; max-height: 450px; flex-direction: column; background-color: rgba(40, 40, 40, 0.9); border: 2px solid #888; border-radius: 5px; font-family: sans-serif; z-index: 100;">
                <div id="inventory-title-bar" style="background-color: #333; color: white; padding: 5px; font-size: 14px; font-weight: bold; cursor: grab; display: flex; justify-content: space-between; align-items: center;">
                    <span>Inventory</span>
                    <div> <!-- Container for buttons -->
                        <button id="inv-sort-button" style="padding: 1px 5px; font-size: 11px; background-color: #555; color: white; border: 1px solid #777; margin-right: 5px;">Sort</button>
                        <button id="inventory-close-button" style="background: none; border: none; color: white; font-size: 16px; cursor: pointer; line-height: 1;">&times;</button>
                    </div>
                </div>

                <!-- Sort Dropdown Menu (Hidden Initially) -->
                <div id="inv-sort-dropdown" style="position: absolute; top: 30px; /* Position below title bar */ right: 30px; /* Align near sort button */ background-color: #444; border: 1px solid #777; border-radius: 3px; padding: 5px; z-index: 101; display: none; /* Hidden by default */ flex-direction: column; gap: 3px;">
                    <button class="sort-option" data-sort-type="name" style="padding: 2px 5px; font-size: 11px; background-color: #666; color: white; border: none; text-align: left; cursor: pointer;">By Name</button>
                    <button class="sort-option" data-sort-type="type" style="padding: 2px 5px; font-size: 11px; background-color: #666; color: white; border: none; text-align: left; cursor: pointer;">By Type</button>
                    <button class="sort-option" data-sort-type="newest" style="padding: 2px 5px; font-size: 11px; background-color: #666; color: white; border: none; text-align: left; cursor: pointer;">By Newest</button>
                </div>

                <!-- Grid Container -->
                <div id="inventory-grid" style="display: grid; grid-template-columns: repeat(6, 45px); grid-template-rows: repeat(6, 45px); gap: 5px; padding: 10px; justify-content: center; align-content: center;">
                    <!-- 36 slots will be generated here by JS -->
                </div>

                <!-- Pagination Controls (Sort buttons removed) -->
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
        // ** Store references to sort button and dropdown **
        this.invSortButton = invWindowGameObject.getChildByID('inv-sort-button') as HTMLButtonElement;
        this.invSortDropdown = invWindowGameObject.getChildByID('inv-sort-dropdown') as HTMLElement;


        // ** Update: Check for new elements **
        if (!inventoryWindowElement || !this.inventoryItemsElement || !inventoryButton || !inventoryCloseButton || !inventoryTitleBar || !this.invPrevButton || !this.invNextButton || !this.invPageInfo || !this.invSortButton || !this.invSortDropdown) {
            console.error("Failed to get all inventory UI elements (incl. pagination, sort button, and dropdown)!");
            return; // Exit early if elements aren't found
        }

        // Store reference if needed elsewhere (maybe not necessary now)
        // this.inventoryWindowElement = inventoryWindowElement;

        // --- Inventory Button Listener ---
        inventoryButton.addEventListener('click', () => {
            // Toggle visibility using Phaser DOM element
            const willBeVisible = !invWindowGameObject.visible;
            invWindowGameObject.setVisible(willBeVisible);
            if (!willBeVisible) { // If closing, also hide dropdown
                this.invSortDropdown!.style.display = 'none';
            }
        });

        // --- Inventory Close Button Listener ---
        inventoryCloseButton.addEventListener('click', () => {
             invWindowGameObject.setVisible(false);
             this.invSortDropdown!.style.display = 'none'; // Hide dropdown on close
        });

        // --- Inventory Drag Logic ---
        if (invWindowGameObject && inventoryTitleBar) {
             this.makeDraggable(invWindowGameObject, inventoryTitleBar);
        } else {
             console.error("[UIScene] Failed to attach drag handler to Inventory: Missing elements.");
        }

        // --- Inventory Drag Listeners (Attach to the grid container) ---
        if (this.inventoryItemsElement) {
            this.inventoryItemsElement.addEventListener('dragstart', this.handleDragStart.bind(this));
            this.inventoryItemsElement.addEventListener('dragover', this.handleDragOver.bind(this));
            this.inventoryItemsElement.addEventListener('dragleave', this.handleDragLeave.bind(this));
            this.inventoryItemsElement.addEventListener('drop', this.handleDrop.bind(this));
            this.inventoryItemsElement.addEventListener('dragend', this.handleDragEnd.bind(this));
            // Need to prevent default for dragover for drop to work
            this.inventoryItemsElement.addEventListener('dragover', (event) => {
                event.preventDefault();
            });
        } else {
            console.error("Inventory grid element not found, cannot attach drag listeners.");
        }

        // --- Inventory Sort Button Listener (Toggle Dropdown) ---
        this.invSortButton.addEventListener('click', (event) => {
            event.stopPropagation(); // Prevent click from closing dropdown immediately if we add a global listener later
            const currentDisplay = this.invSortDropdown!.style.display;
            this.invSortDropdown!.style.display = currentDisplay === 'none' ? 'flex' : 'none';
        });

        // --- Inventory Sort Option Listeners (Event Delegation) ---
        this.invSortDropdown.addEventListener('click', (event) => {
            const target = event.target as HTMLElement;
            if (target.classList.contains('sort-option') && target.dataset.sortType) {
                const sortType = target.dataset.sortType as 'name' | 'type' | 'newest';
                // Add validation or specific handling for 'newest' if needed on frontend
                this.networkManager.sendMessage('sortInventoryCommand', { sortType: sortType });
                this.invSortDropdown!.style.display = 'none'; // Hide dropdown after selection
            }
        });

        // Optional: Add listener to close dropdown if clicking outside
        document.addEventListener('click', (event) => {
            // If inventory is visible AND the click was outside the dropdown AND outside the sort button
            if (invWindowGameObject.visible &&
                this.invSortDropdown && this.invSortDropdown.style.display !== 'none' &&
                !this.invSortDropdown.contains(event.target as Node) &&
                event.target !== this.invSortButton) {
                    this.invSortDropdown.style.display = 'none';
            }
        });


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
            equipmentButton.addEventListener('click', () => {

                if (this.equipWindowGameObject) {
                    const currentVisibility = this.equipWindowGameObject.visible;
                    this.equipWindowGameObject.setVisible(!currentVisibility);
                    const newVisibility = this.equipWindowGameObject.visible;

                    if (newVisibility) {

                        // *** Use receivedPartyData ***
                        this.currentParty = this.receivedPartyData; // Use data passed via init

                        this.currentEquipCharacterIndex = 0;
                        this.renderCurrentCharacterEquipment(); // Render initial character

                        if (this.currentParty.length > 0) {
                            const firstCharId = this.currentParty[0].id;
                            this.networkManager.sendMessage('requestEquipment', { characterId: firstCharId });
                        } else {
                            console.warn("UIScene: Cannot request equipment, no party data received via init.");
                        }
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
            this.makeDraggable(this.equipWindowGameObject, equipmentTitleBar);
        } else {
             console.error("[UIScene] Failed to attach drag handler to Equipment: Missing elements.");
        }

        // --- Create Loot All Button (Above Chat) ---
        const lootAllButtonHtml = `<button id="loot-all-button" title="Loot All Items" style="padding: 5px 8px; font-size: 12px; background-color: #4a4; color: white; border: 1px solid #6c6; cursor: pointer; width: 60px;">Loot All</button>`;
        const lootAllButtonContainer = this.add.dom(0, 0).createFromHTML(lootAllButtonHtml).setOrigin(0, 0);
        const lootAllButtonElement = lootAllButtonContainer.getChildByID('loot-all-button') as HTMLButtonElement;

        // --- Create Chat DOM Elements ---
        const chatContainerHtml = `
            <div id="chat-container"
                 style="/*position: absolute; bottom: 10px; left: 10px;*/ width: 450px; height: 160px;
                        display: flex; flex-direction: column; background-color: rgba(0, 0, 0, 0.5);
                        border: 1px solid #555; border-radius: 3px; font-family: sans-serif;">
                <div id="chat-log"
                     style="flex-grow: 1; padding: 5px; overflow-y: auto; margin-bottom: 5px; font-size: 12px; color: white;">
                    Welcome to the game!
                </div>
                <div style="display: flex; padding: 0 5px 5px 5px;">
                    <input type="text" id="chat-input" placeholder="Type message..."
                           style="flex-grow: 1; padding: 5px; border: 1px solid #777; background-color: #333; color: white; font-size: 12px;">
                    <!-- Loot button removed from here -->
                 </div>
            </div>
        `;
        const chatContainer = this.add.dom(0, 0).createFromHTML(chatContainerHtml).setOrigin(0, 0);

        // --- Positioning ---
        const gameHeight = Number(this.sys.game.config.height);
        const chatHeight = 160; // The height defined in the style
        const bottomMargin = 10;
        const chatY = gameHeight - chatHeight - bottomMargin;
        chatContainer.setPosition(10, chatY); // Position chat near bottom-left

        // Position Loot All button above chat
        const buttonHeight = 30; // Approximate height of button with padding/border
        const buttonMargin = 5;
        lootAllButtonContainer.setPosition(10, chatY - buttonHeight - buttonMargin);

        // Get references to elements inside the chat container
        this.chatLogElement = chatContainer.getChildByID('chat-log') as HTMLElement;
        this.chatInputElement = chatContainer.getChildByID('chat-input') as HTMLInputElement;
        // const lootAllButton = chatContainer.getChildByID('loot-all-button') as HTMLButtonElement; // No longer in chat container

        // Check if elements exist
        if (!this.chatLogElement || !this.chatInputElement || !lootAllButtonElement) { // Check new button element
            console.error("Failed to get chat UI or Loot All button elements!");
            return; // Exit early if elements aren't found
        }

        // --- Chat Input Listener (using keydown for Enter) ---
        chatContainer.addListener('click'); // Dummy listener to allow focus
        this.input.keyboard?.on('keydown', (event: KeyboardEvent) => {
            // Update focus check for nested elements
            // Make sure dropdown clicks don't trigger game input suppression incorrectly
            const activeEl = document.activeElement;
            const isChatInputFocused = activeEl === this.chatInputElement;
            const isInvWindowFocused = invWindowGameObject.node.contains(activeEl); // Includes dropdown

            if (isChatInputFocused || isInvWindowFocused) {
                event.stopPropagation(); // Stop Phaser if chat or inventory window elements have focus

                if (event.key === 'Enter' && isChatInputFocused) {
                    this.handleSendMessage();
                }
                 // Add ESC key to close inventory if it's open (also close dropdown)
                 if (event.key === 'Escape') {
                     if (this.invSortDropdown && this.invSortDropdown.style.display !== 'none') {
                         this.invSortDropdown.style.display = 'none';
                     } else if (invWindowGameObject.visible) { // Check Phaser visibility
                        invWindowGameObject.setVisible(false);
                     }
                 }
            }
        });

        // --- Loot All Button Listener (using the separate element) ---
        lootAllButtonElement.addEventListener('click', () => {
            this.networkManager.sendMessage('loot_all_command', {}); // Send empty payload for now
        });
        // -----------------------------------

        // --- EventBus Listeners ---
        EventBus.on('chat-message-received', this.handleChatMessage, this);
        EventBus.on('focus-chat-input', this.focusChatInput, this);
        EventBus.on('inventory-update', this.handleInventoryUpdate, this);
        EventBus.on('equipment-update', this.handleEquipmentUpdate, this);
        // --- ADD listeners for events from GameScene ---
        EventBus.on('update-party-hp', this.handleUpdatePartyHp, this);
        EventBus.on('update-party-xp', this.handleUpdatePartyXp, this);
        EventBus.on('party-member-level-up', this.handlePartyMemberLevelUp, this);

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

        // --- Inventory Sort Button Listeners (Removed) ---
        /*
        if (this.invSortByNameButton) { ... }
        if (this.invSortByTypeButton) { ... }
        */

        // --- Create Party UI Container (Bottom Right -> Bottom Left, Horizontal) ---
        const partyUiHtml = `
            <div id="party-ui" style="/* REMOVED: position related styles */ display: flex; flex-direction: row; /* <-- CHANGED */ gap: 10px; /* Added more gap */ width: auto; /* Allow dynamic width */">
                <!-- Party member panels will be added here -->
            </div>
        `;
        this.partyUiGameObject = this.add.dom(0, 0).createFromHTML(partyUiHtml)
            // Set Origin to Top-Left of the DOM element wrapper
            .setOrigin(0, 0) // <-- CHANGED
            // Position the Top-Left corner relative to the canvas size
            .setPosition(470, this.scale.height - 60); // <-- CHANGED Y position (Estimate panel height)

        const partyUiContainer = this.partyUiGameObject.getChildByID('party-ui') as HTMLElement;
        if (!partyUiContainer) {
            console.error("Failed to create Party UI container!");
        } else {
            // --- Populate Initial Party Panels ---
            this.receivedPartyData.forEach(charData => {
                if (!charData || !charData.id) {
                    console.warn("Skipping party panel creation for invalid charData:", charData);
                    return;
                }
                const panelHtml = this._createPartyMemberPanelHTML(charData);
                partyUiContainer.insertAdjacentHTML('beforeend', panelHtml);

                // Store references to the dynamic elements and initial max HP
                const panelElement = partyUiContainer.querySelector(`#party-panel-${charData.id}`);
                if (panelElement) {
                    const totalXp = charData.xp || 0;
                    const initialLevel = charData.level || 1;
                    const xpInCurrentLevel = this._getXpForCurrentLevel(totalXp, initialLevel);
                    const xpNeededBetweenLevels = this._getXpNeededForLevelSpan(initialLevel);
                    const initialMaxHp = charData.baseHealth || 0;
                    const initialHp = initialMaxHp; // Assume full health initially

                    this.partyMemberPanels.set(charData.id, {
                        nameElement: panelElement.querySelector('.party-char-name') as HTMLElement | null,
                        hpFillElement: panelElement.querySelector('.hp-bar-fill') as HTMLElement | null,
                        xpFillElement: panelElement.querySelector('.xp-bar-fill') as HTMLElement | null,
                        hpTextElement: panelElement.querySelector('.hp-bar-text') as HTMLElement | null,
                        xpTextElement: panelElement.querySelector('.xp-bar-text') as HTMLElement | null,
                        currentHp: initialHp,
                        maxHp: initialMaxHp,
                        currentXp: xpInCurrentLevel,
                        xpToNextLevel: xpNeededBetweenLevels
                    });
                } else {
                    console.error(`Failed to find panel element #party-panel-${charData.id} after adding it.`);
                }
            });
        }
        // -----------------------------------------

        this.hideItemTooltip();
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
        EventBus.off('chat-message-received', this.handleChatMessage, this);
        EventBus.off('focus-chat-input', this.focusChatInput, this);
        EventBus.off('inventory-update', this.handleInventoryUpdate, this);
        EventBus.off('equipment-update', this.handleEquipmentUpdate, this);
        // --- ADD removal for new listeners ---
        EventBus.off('update-party-hp', this.handleUpdatePartyHp, this);
        EventBus.off('update-party-xp', this.handleUpdatePartyXp, this);
        EventBus.off('party-member-level-up', this.handlePartyMemberLevelUp, this);
        // DOM elements added via this.add.dom are usually cleaned up automatically by Phaser

        // --- Clean up global listener ---
        // It's tricky to find the *exact* listener function reference here.
        // A better approach would be to store the listener reference when adding it.
        // For now, let's skip removing the document click listener, as it's less critical.
        // document.removeEventListener('click', ???);
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
            // Prevent starting drag on buttons within the handle (like close or sort buttons)
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
    private handleInventoryUpdate(data: { inventory: (InventoryItem | null)[] }) {
        this.inventorySlotsData = data.inventory || []; // Store the sparse array

        // --- BEGIN DEBUG LOG ---
        this.inventorySlotsData.forEach((item, index) => {
            if (item && !item.itemTemplate) {
                console.warn(`[UIScene] Item at index ${index} exists but has no itemTemplate:`, item);
            }
        });
        // --- END DEBUG LOG ---

        // We assume a fixed size for now based on rendering logic
        const expectedSize = 36 * 6; // 6 pages of 36 slots
        if (this.inventorySlotsData.length !== expectedSize) {
            // Pad with nulls if backend sent a shorter array (e.g., only up to highest occupied slot)
            // Or truncate if longer? For now, let's pad.
            if (this.inventorySlotsData.length < expectedSize) {
                this.inventorySlotsData.length = expectedSize; // Extends with empty slots if needed
                for(let i=data.inventory.length; i < expectedSize; i++) { // Fill potential new empty slots explicitly with null
                    if(this.inventorySlotsData[i] === undefined) this.inventorySlotsData[i] = null;
                }
            }
            console.warn(`Inventory data length (${data.inventory?.length}) mismatch expected (${expectedSize}). Padded/adjusted.`);
        }

        // Pagination logic might need adjustment if total pages isn't fixed
        this.totalPages = 6; // Keep fixed 6 pages assumption
        this.currentPage = Math.max(1, Math.min(this.currentPage, this.totalPages));

        this.renderCurrentInventoryPage(); // Render based on the new sparse data
    }

    // --- Renders the items for the current page ---
    private renderCurrentInventoryPage() {
        if (!this.inventoryItemsElement || !this.invPrevButton || !this.invNextButton || !this.invPageInfo) {
            console.error("Cannot render inventory page, elements missing.");
            return;
        }

        this.inventoryItemsElement.innerHTML = '';
        const startIndex = (this.currentPage - 1) * this.itemsPerPage;

        this.invPageInfo.textContent = `Page ${this.currentPage} / ${this.totalPages}`;
        this.invPrevButton.disabled = this.currentPage <= 1;
        this.invNextButton.disabled = this.currentPage >= this.totalPages;
        this.invPrevButton.style.cursor = this.currentPage <= 1 ? 'not-allowed' : 'pointer';
        this.invNextButton.style.cursor = this.currentPage >= this.totalPages ? 'not-allowed' : 'pointer';

        for (let i = 0; i < this.itemsPerPage; i++) {
            const slotElement = document.createElement('div');
            slotElement.style.width = '45px';
            slotElement.style.height = '45px';
            slotElement.style.backgroundColor = 'rgba(0, 0, 0, 0.3)';
            slotElement.style.border = '1px solid #666';
            slotElement.style.position = 'relative';
            slotElement.style.display = 'flex';
            slotElement.style.alignItems = 'center';
            slotElement.style.justifyContent = 'center';
            slotElement.classList.add('inventory-slot');
            slotElement.dataset.slotIndexOnPage = String(i); // Visual index 0-35

            const actualSlotIndex = startIndex + i; // Data index (e.g., 0-35 for page 1)
            slotElement.dataset.inventorySlot = String(actualSlotIndex); // Store the DATA index

            const item = this.inventorySlotsData[actualSlotIndex]; // Fetch from data using DATA index

            // Reset listeners/styles
            slotElement.onmouseenter = null;
            slotElement.onmouseleave = null;
            slotElement.oncontextmenu = null;
            slotElement.style.cursor = 'default';
            slotElement.draggable = false; // Default to not draggable

            if (item) {
                // Render item content (SVG, quantity, listeners)
                 // *** Log Item and its slot during render loop ***
                 slotElement.draggable = true;
                 slotElement.dataset.inventoryItemId = item.id;
                 // data-inventory-slot is already set above
                 // ------------------------

                 // Listeners
                 slotElement.onmouseenter = () => this.showItemTooltip(item, slotElement);
                 slotElement.onmouseleave = () => this.hideItemTooltip();
                 slotElement.style.cursor = 'grab';

                 // Render SVG
                 let itemVisualHtml = '';
                 const itemType = item.itemTemplate?.itemType;
                 const fillColor = '#aaa';
                 itemVisualHtml = this.getItemSvgShape(itemType, fillColor, 30); // Use helper
                 slotElement.innerHTML = itemVisualHtml;

                 const itemName = item.itemTemplate?.name ?? 'Unknown Item';
                 slotElement.title = itemName;

                 // Quantity
                 if (item.quantity > 1) {
                      const quantityElement = document.createElement('span');
                      quantityElement.textContent = `${item.quantity}`;
                      // ... quantity styling ...
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

                 // Right-Click Equip
                 const isEquippable = item.itemTemplate && item.itemTemplate.equipSlot;
                 if (isEquippable) {
                      slotElement.oncontextmenu = (event) => {
                         event.preventDefault(); // Prevent default browser menu

                         // --- Restore Equip Logic ---
                         // 1. Check if equipment window is open and party is selected
                         if (!this.equipWindowGameObject?.visible || this.currentParty.length === 0) {
                              console.warn("Cannot equip item: Equipment window closed or no party selected.");
                              this.showTemporaryMessage("Open Equipment window and select character first.");
                              return;
                         }
                         // 2. Get target character
                         const targetCharacter = this.currentParty[this.currentEquipCharacterIndex];
                         if (!targetCharacter || !targetCharacter.id) {
                              console.error("Cannot equip item: Could not determine target character ID.");
                              return;
                         }
                         const targetCharacterId = targetCharacter.id;
                         // 3. Get inventory item ID (from the item variable in the loop scope)
                         const inventoryItemId = item.id;
                         if (!inventoryItemId) {
                              console.error("Cannot equip item: Item ID is missing.");
                              return;
                         }
                         // 4. Send command to server
                         this.networkManager.sendMessage('equipItemCommand', {
                              inventoryItemId: inventoryItemId,
                              characterId: targetCharacterId
                         });
                         // --- End Restore Equip Logic ---
                      };
                 } else {
                      slotElement.oncontextmenu = (e) => e.preventDefault();
                 }
            } else {
                // Render empty slot content
                 // *** Log empty slot during render loop ***
                 slotElement.classList.add('empty-slot');
                 slotElement.innerHTML = ''; // Ensure it's visually empty
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
        // Store the updated equipment data for the specific character
        this.allCharacterEquipment.set(data.characterId, data.equipment);

        // If the update is for the currently viewed character, re-render
        const currentCharacter = this.currentParty[this.currentEquipCharacterIndex];
        if (currentCharacter && currentCharacter.id === data.characterId) {
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
                        this.renderCurrentCharacterEquipment(); // Re-render to update slots and highlight

                        // Optional: Request equipment if not loaded
                        const charId = this.currentParty[this.currentEquipCharacterIndex]?.id;
                        if (charId && !this.allCharacterEquipment.has(charId)) {
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

    // --- Drag and Drop Handlers ---
    private handleDragStart(event: DragEvent) {
        const target = event.target as HTMLElement;
        // Use data-inventory-slot now
        if (target.classList.contains('inventory-slot') && target.dataset.inventoryItemId && target.dataset.inventorySlot) {
            const itemId = target.dataset.inventoryItemId;
            const inventorySlot = parseInt(target.dataset.inventorySlot, 10);
            const item = this.inventorySlotsData[inventorySlot]; // Get from sparse array

            if (item && item.id === itemId) {
                this.draggedItemData = { item: item, originalSlot: inventorySlot }; // Store original slot
                event.dataTransfer?.setData('text/plain', itemId);
                event.dataTransfer!.effectAllowed = 'move';
                target.style.opacity = '0.5';
            } else {
                event.preventDefault();
            }
        } else {
            event.preventDefault();
        }
    }

    private handleDragOver(event: DragEvent) {
        event.preventDefault(); // Necessary to allow drop
        const target = event.target as HTMLElement;
        // Provide visual feedback by highlighting potential drop target
        if (target.classList.contains('inventory-slot')) {
            target.style.backgroundColor = 'rgba(255, 255, 255, 0.2)'; // Highlight effect
        }
    }

    private handleDragLeave(event: DragEvent) {
        const target = event.target as HTMLElement;
        // Remove highlight when dragging leaves a slot
        if (target.classList.contains('inventory-slot')) {
            // Reset background - Check if it was empty or had an item originally?
            // For simplicity, just reset to the default slot bg color
            target.style.backgroundColor = 'rgba(0, 0, 0, 0.3)';
        }
    }

    private handleDrop(event: DragEvent) {
        event.preventDefault();
        if (!this.draggedItemData) return;

        const target = event.target as HTMLElement;
        const targetSlotDiv = target.closest('.inventory-slot') as HTMLElement | null;

        // Case 1: Dropped onto an inventory slot
        // Use data-inventory-slot now
        if (targetSlotDiv && targetSlotDiv.dataset.inventorySlot) {
            const targetInventorySlot = parseInt(targetSlotDiv.dataset.inventorySlot, 10);
            targetSlotDiv.style.backgroundColor = 'rgba(0, 0, 0, 0.3)'; // Reset background

            if (this.draggedItemData.originalSlot !== targetInventorySlot) {
                this.networkManager.sendMessage('moveInventoryItem', {
                    fromIndex: this.draggedItemData.originalSlot,
                    toIndex: targetInventorySlot
                });
            }
        }
        // Case 2: Dropped OUTSIDE the inventory window (Drop Item)
        else {
              this.networkManager.sendMessage('dropInventoryItem', {
                  inventoryIndex: this.draggedItemData.originalSlot // Use original DB slot index
              });
        }
    }

    private handleDragEnd(event: DragEvent) {
        if (this.draggedItemData) {
             // Find original slot element using the correct data attribute
            const originalSlot = this.inventoryItemsElement?.querySelector(`[data-inventory-slot="${this.draggedItemData.originalSlot}"]`) as HTMLElement | null;
            if (originalSlot) {
                 originalSlot.style.opacity = '1';
                 originalSlot.style.backgroundColor = 'rgba(0, 0, 0, 0.3)';
            }
        }
        this.draggedItemData = null;
    }

    // --- NEW: Frontend XP Calculation Helper ---
    private _frontendCalculateXpForLevel(level: number): number {
        const baseXP = 100;
        const exponent = 1.5;
        if (level <= 1) return 0;
        return Math.floor(baseXP * Math.pow(level - 1, exponent));
    }
    // --- END NEW ---

    // --- Helper to calculate XP relative to the start of the current level ---
    private _getXpForCurrentLevel(totalXp: number, level: number): number {
        if (level <= 1) {
            return totalXp; // For level 1, total XP is the XP in the level
        }
        const xpNeededForCurrentLevelStart = this._frontendCalculateXpForLevel(level);
        return totalXp - xpNeededForCurrentLevelStart;
    }

    // --- Helper to calculate the XP needed *between* current and next level ---
    private _getXpNeededForLevelSpan(level: number): number {
        if (level < 1) return 0;
        const xpForNext = this._frontendCalculateXpForLevel(level + 1);
        const xpForCurrent = this._frontendCalculateXpForLevel(level);
        return xpForNext - xpForCurrent;
    }
    // --- END HELPERS ---

    // --- Helper to create party member panel HTML (Updated for Bars) ---
    private _createPartyMemberPanelHTML(characterData: any): string {
        const charId = characterData.id || 'unknown';
        const charName = characterData.name || 'Unknown';
        const initialLevel = characterData.level || 1;
        const initialHp = characterData.baseHealth || 100;
        const initialMaxHp = characterData.baseHealth || 100;
        const totalXp = characterData.xp || 0;

        // Calculate XP relative to the current level for display
        const xpInCurrentLevel = this._getXpForCurrentLevel(totalXp, initialLevel);
        const xpNeededBetweenLevels = this._getXpNeededForLevelSpan(initialLevel);

        const hpPercent = initialMaxHp > 0 ? (initialHp / initialMaxHp) * 100 : 0;
        const xpPercent = xpNeededBetweenLevels > 0 ? (xpInCurrentLevel / xpNeededBetweenLevels) * 100 : 0;

        const hpText = `${initialHp} / ${initialMaxHp}`;
        const xpText = `Lvl ${initialLevel} (${xpInCurrentLevel} / ${xpNeededBetweenLevels})`;

        return `
            <div id="party-panel-${charId}" class="party-panel" style="background-color: rgba(0, 0, 0, 0.7); border: 1px solid #555; border-radius: 3px; padding: 5px; font-size: 11px; color: white; font-family: sans-serif; width: 160px;">
                <div class="party-char-name" style="font-weight: bold; margin-bottom: 3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${charName}</div>
                <!-- HP Bar -->
                <div class="hp-bar-container" style="height: 14px; background-color: #500; border: 1px solid #833; border-radius: 2px; margin-bottom: 3px; position: relative;">
                    <div class="hp-bar-fill" style="width: ${hpPercent}%; height: 100%; background-color: #e00; transition: width 0.2s ease-out;"></div>
                    <div class="hp-bar-text" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; text-align: center; line-height: 14px; font-size: 10px; color: white; text-shadow: 1px 1px 1px black;">${hpText}</div>
                </div>
                <!-- XP Bar -->
                <div class="xp-bar-container" style="height: 10px; background-color: #550; border: 1px solid #883; border-radius: 2px; position: relative;">
                    <div class="xp-bar-fill" style="width: ${xpPercent}%; height: 100%; background-color: #ee0; transition: width 0.2s ease-out;"></div>
                    <div class="xp-bar-text" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; text-align: center; line-height: 10px; font-size: 9px; color: white; text-shadow: 1px 1px 1px black;">${xpText}</div>
                </div>
            </div>
        `;
    }
    // --- END NEW ---

    // --- Handle Level Up Notification (Renamed and Updated for Bars) ---
    private handlePartyMemberLevelUp(payload: PartyMemberLevelUpPayload) {
        const panelRefs = this.partyMemberPanels.get(payload.characterId);
        if (panelRefs) {
            // Update stored values
            panelRefs.maxHp = payload.maxHp;
            panelRefs.currentHp = payload.currentHp; // Already full HP from payload
            panelRefs.currentXp = payload.currentXp;
            panelRefs.xpToNextLevel = payload.xpToNextLevel;

            // Update HP Bar/Text
            if (panelRefs.hpFillElement) {
                panelRefs.hpFillElement.style.width = `100%`;
            }
            if (panelRefs.hpTextElement) {
                panelRefs.hpTextElement.textContent = `${panelRefs.currentHp} / ${panelRefs.maxHp}`;
            }
            // Update XP Bar/Text
            if (panelRefs.xpFillElement) {
                 const xpPercent = panelRefs.xpToNextLevel > 0 ? (panelRefs.currentXp / panelRefs.xpToNextLevel) * 100 : 0;
                 panelRefs.xpFillElement.style.width = `${Math.min(100, xpPercent)}%`;
            }
             if (panelRefs.xpTextElement) {
                 panelRefs.xpTextElement.textContent = `Lvl ${payload.newLevel} (${panelRefs.currentXp} / ${panelRefs.xpToNextLevel})`;
             }

            // Visual Flash
            const panelElement = this.partyUiGameObject?.getChildByID(`party-panel-${payload.characterId}`) as HTMLElement | null;
            if (panelElement) {
                panelElement.classList.add('level-up-flash');
                setTimeout(() => { panelElement.classList.remove('level-up-flash'); }, 500);
            }
        }
    }
    // --- END NEW ---

    // --- Handle Entity Update (Renamed for HP) ---
    private handleUpdatePartyHp(payload: UpdatePartyHpPayload) {
        const panelRefs = this.partyMemberPanels.get(payload.characterId);
        if (panelRefs) {
            panelRefs.currentHp = Math.round(payload.currentHp);
            panelRefs.maxHp = payload.maxHp; // Ensure maxHP is updated if it changed elsewhere
            // Update HP Bar
            if (panelRefs.hpFillElement && panelRefs.maxHp > 0) {
                 const hpPercent = (panelRefs.currentHp / panelRefs.maxHp) * 100;
                 panelRefs.hpFillElement.style.width = `${Math.min(100, Math.max(0, hpPercent))}%`;
            }
            // Update HP Text
            if (panelRefs.hpTextElement) {
                panelRefs.hpTextElement.textContent = `${panelRefs.currentHp} / ${panelRefs.maxHp}`;
            }
        }
    }
     // --- END NEW ---

     // --- Handle XP Update (Renamed for XP Bar) ---
     private handleUpdatePartyXp(payload: UpdatePartyXpPayload) {
         console.log("Received party xp update:", payload);
         const panelRefs = this.partyMemberPanels.get(payload.characterId);
         if (panelRefs) {
            // Update stored values
            panelRefs.currentXp = payload.currentXp;
            panelRefs.xpToNextLevel = payload.xpToNextLevel;

            // Update XP Bar
            if (panelRefs.xpFillElement) {
                const xpPercent = panelRefs.xpToNextLevel > 0 ? (panelRefs.currentXp / panelRefs.xpToNextLevel) * 100 : 0;
                panelRefs.xpFillElement.style.width = `${Math.min(100, xpPercent)}%`;
            }
            // Update XP Text
            if (panelRefs.xpTextElement) {
                panelRefs.xpTextElement.textContent = `Lvl ${payload.level} (${panelRefs.currentXp} / ${panelRefs.xpToNextLevel})`;
            }
         }
     }
     // --- END NEW ---
}