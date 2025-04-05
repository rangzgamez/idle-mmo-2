// frontend/src/scenes/GameScene.ts
import Phaser from 'phaser';
import { NetworkManager } from '../network/NetworkManager';
import { CharacterSprite } from '../gameobjects/CharacterSprite'; // Import the sprite class
import { EventBus } from '../EventBus';
import UIScene from './UIScene';
import { EnemySprite } from '../gameobjects/EnemySprite';
import { DroppedItemSprite, DroppedItemData } from '../gameobjects/DroppedItemSprite'; // <-- Import DroppedItemSprite
// Add the interface definitions if not shared
interface ZoneCharacterState { id: string; ownerId: string; ownerName: string; name: string; level: number; x: number | null; y: number | null; currentHealth?: number; baseHealth?: number; }
interface EntityUpdateData { id: string; x?: number | null; y?: number | null; health?: number | null; state?: string; }
// --- Add Entity Death Interface ---
interface EntityDeathData { entityId: string; type: 'character' | 'enemy'; }

interface ChatMessageData {
    senderName: string;
    senderCharacterId: string;
    message: string;
    timestamp?: number;
}

// +++ Add Combat Action Interface +++
interface CombatActionData {
    attackerId: string;
    targetId: string;
    damage: number;
    type: string; // e.g., 'attack', 'heal' - currently only 'attack' expected
}

// Add interface for itemsDropped event payload
interface ItemsDroppedPayload {
    items: DroppedItemData[];
}

interface EnemySpawnData {
    id: string;
    templateId: string;
    zoneId: string;
    name: string;
    currentHealth: number;
    baseHealth?: number; // Add baseHealth if needed for health bar max
    position: { x: number; y: number };
    // other optional fields like aiState, nestId etc.
}

export default class GameScene extends Phaser.Scene {
    networkManager!: NetworkManager;
    playerCharacters: Map<string, CharacterSprite> = new Map(); // Key: characterId
    otherCharacters: Map<string, CharacterSprite> = new Map(); // Key: characterId
    selectedPartyData: any[] = []; // Data passed from CharacterSelectScene
    private lastMarkerTarget: Phaser.Math.Vector2 | null = null; // Store the target associated with the marker
    private clickMarker: Phaser.GameObjects.Sprite | null = null; // Add property for the marker
    private markerFadeTween: Phaser.Tweens.Tween | null = null; // Store the active fade tween
    private uiSceneRef: UIScene | null = null;
    private currentPlayerUsername: string | null = null; // <-- Add property to store username
    private enemySprites: Map<string, EnemySprite> = new Map(); //NEW
    private droppedItemSprites: Map<string, DroppedItemSprite> = new Map(); // <-- Add map for dropped items
    constructor() {
        super('GameScene');
    }

    // Receive data from the previous scene (CharacterSelectScene)
    init(data: { selectedParty?: any[] }) {
        console.log('GameScene init with data:', data);
        this.selectedPartyData = data.selectedParty || []; // Store the selected party data
        this.networkManager = NetworkManager.getInstance();
        // --- Store current player's username ---
        this.currentPlayerUsername = null; // Reset on init
        if (this.selectedPartyData.length > 0 && this.selectedPartyData[0].ownerName) {
            // Get username from the ownerName field provided by the backend's selectParty response
            this.currentPlayerUsername = this.selectedPartyData[0].ownerName;
            console.log(`Stored current player username: ${this.currentPlayerUsername}`);
        } else {
            console.warn("Could not determine current player username from selectedParty data.");
            // Fallback or error handling if needed, maybe try decoding JWT as a last resort?
            // For now, bubbles for own messages might not work if this fails.
        }
        // Clear any old character data if re-entering scene
        this.playerCharacters.clear();
        this.otherCharacters.clear();
    }

    preload() {
        // Load assets needed specifically for this scene if not preloaded
        this.load.image('playerPlaceholder', 'assets/sprites/player_sprite.png');
        this.load.image('clickMarker', 'assets/ui/click_marker.png'); // <-- Load the marker
        this.load.image('goblin', 'assets/sprites/goblin.png'); // Example sprite - add more
        this.load.image('spider', 'assets/sprites/spider.png');   // Load spider sprite
        // this.load.tilemapTiledJSON('zone1Map', 'assets/tilemaps/zone1.json');
        // this.load.image('tileset', 'assets/tilesets/your_tileset.png');
    }

    create() {
        console.log('GameScene create');

        // Check network connection
        if (!this.networkManager.isConnected()) {
            console.error('GameScene: Network not connected!');
            this.handleDisconnectError('Connection lost. Please log in again.');
            return;
        }

        // --- Setup Tilemap (Example) ---
        // const map = this.make.tilemap({ key: 'zone1Map' });
        // const tiles = map.addTilesetImage('your_tileset_name_in_tiled', 'tileset');
        // map.createLayer('GroundLayer', tiles, 0, 0);
        // const collisionLayer = map.createLayer('CollisionLayer', tiles, 0, 0);
        // collisionLayer?.setCollisionByProperty({ collides: true });
        // Add simple background color for now
        this.cameras.main.setBackgroundColor('#5a8f37'); // Greenish background

        // --- Register EventBus Listeners ---
        EventBus.on('network-disconnect', this.handleDisconnectError, this);
        EventBus.on('player-joined', this.handlePlayerJoined, this);
        EventBus.on('player-left', this.handlePlayerLeft, this);
        EventBus.on('entity-update', this.handleEntityUpdate, this);
        EventBus.on('chat-message-received', this.handleChatMessageForBubble, this); // Add listener for bubbles
        EventBus.on('entity-died', this.handleEntityDied, this); // <-- ADD LISTENER FOR DEATHS
        EventBus.on('enemy-spawned', this.handleEnemySpawned, this); // +++ ADD LISTENER +++
        EventBus.on('combat-action', this.handleCombatAction, this); // +++ ADD LISTENER for ATTACK VISUAL +++
        EventBus.on('items-dropped', this.handleItemsDropped, this); // <-- ADD LISTENER for dropped items
        EventBus.on('item-picked-up', this.handleItemPickedUp, this); // <-- ADD LISTENER for item pickup confirmation
        this.events.on('droppedItemClicked', this.handleDroppedItemClicked, this); // <-- CORRECTED: Use this.events
        // --- Launch UI Scene ---
        // Use scene.launch to run it in parallel with this scene
        console.log('Launching UIScene...');
        this.scene.launch('UIScene', { selectedParty: this.selectedPartyData });
        this.uiSceneRef = this.scene.get('UIScene') as UIScene; // Get reference

        // --- Global Enter Key Listener ---
        this.input.keyboard?.on('keydown-ENTER', (event: KeyboardEvent) => {
            // Check if chat input is already focused
            const chatInput = this.uiSceneRef?.getChatInputElement(); // Use getter
            if (document.activeElement === chatInput) {
                // Input is focused, let UIScene handle sending
                return;
            } else {
                // Input is NOT focused, emit event to focus it
                console.log("Enter pressed, focusing chat input.");
                EventBus.emit('focus-chat-input');
                event.stopPropagation(); // Prevent other Enter handlers
            }
        });
        // --- Send 'enterZone' request ---
        const zoneId = 'startZone'; // Or determine dynamically
        this.networkManager.sendMessage('enterZone', { zoneId }, (response: { success: boolean; zoneState?: ZoneCharacterState[]; enemyState?: EnemySpawnData[]; message?: string }) => {
            if (response && response.success) {
                console.log(`Entered zone ${zoneId} successfully. Initial state received.`);

                // Create sprites for OUR characters based on initial data
                // The server side 'selectParty' callback should have returned our validated characters
                this.selectedPartyData.forEach(charData => {
                     // Use actual position if provided by server, otherwise default
                     const startX = charData.positionX ?? 150;
                     const startY = charData.positionY ?? 150;
                     this.createOrUpdateCharacterSprite(charData, true, startX, startY);
                });

                // Create sprites for OTHER players already in the zone
                response.zoneState?.forEach(charData => {
                    this.createOrUpdateCharacterSprite(charData, false);
                });

                // Create sprites for existing ENEMIES in the zone
                response.enemyState?.forEach(enemyData => {
                    this.createEnemySprite(enemyData);
                });

                 // Make camera follow the first player character
                 const firstPlayerChar = Array.from(this.playerCharacters.values())[0];
                 if(firstPlayerChar) {
                     this.cameras.main.startFollow(firstPlayerChar, true, 0.1, 0.1); // Smooth follow
                     this.cameras.main.setZoom(1.7); // Zoom in a bit
                 }

                 // --- Request Initial Inventory --- 
                 console.log('[GameScene] Requesting initial inventory...');
                 this.networkManager.sendMessage('requestInventory');
                 // --------------------------------

            } else {
                console.error(`Failed to enter zone ${zoneId}:`, response?.message);
                // Handle error - maybe go back to character select?
                this.handleDisconnectError(`Failed to enter zone: ${response?.message}`);
            }
        });

        // --- Setup Input for Movement ---
        this.input.on(Phaser.Input.Events.POINTER_DOWN, (pointer: Phaser.Input.Pointer, gameObjects: Phaser.GameObjects.GameObject[]) => {
            if (!this || !this.networkManager || !this.playerCharacters) return;
            if (pointer.button !== 0) return;

            const worldPoint = pointer.positionToCamera(this.cameras.main) as Phaser.Math.Vector2;

            // Store the target location for the arrival check
            if (!this.lastMarkerTarget) {
                this.lastMarkerTarget = new Phaser.Math.Vector2();
            }
            this.lastMarkerTarget.set(worldPoint.x, worldPoint.y); // Update the target

            // Show the marker (this function will now also handle the tween storage)
            this.showClickMarker(worldPoint.x, worldPoint.y);
            // ------------------------------------
            let clickedOnActionable = false;
            if (gameObjects.length > 0) {
                const topObject = gameObjects[0]; // Check the topmost object clicked
                if (topObject instanceof EnemySprite && topObject.getData('enemyData')) { // Check for enemy data
                    const enemySprite = topObject as EnemySprite;
                    const enemyId = enemySprite.getData('enemyData')?.id; // Get ID from stored data
                     if (enemyId) {
                        this.networkManager.sendMessage('attackCommand', { targetId: enemyId });
                        console.log(`Sent attack command for enemy: ${enemyId}`);
                        clickedOnActionable = true;
                    } else {
                        console.warn('Clicked enemy sprite missing id in data.');
                    }
                }
            }
            // --- Send Move Command if nothing else was clicked ---
            if (!clickedOnActionable) {
                const firstPlayerCharId = Array.from(this.playerCharacters.keys())[0];
                if (firstPlayerCharId) {
                    this.networkManager.sendMessage('moveCommand', {
                        target: { x: worldPoint.x, y: worldPoint.y }
                    });
                } else {
                     console.warn("No player character found to send move command for.");
                }
            }
            // -------------------------
        });

        // Start UIScene in parallel if needed
        // this.scene.launch('UIScene');
    }
    showClickMarker(x: number, y: number) {
        // --- Stop and clear previous tween/target ---
        if (this.markerFadeTween) {
            this.markerFadeTween.stop(); // Stop existing tween immediately
            this.markerFadeTween = null; // Clear reference
            // Don't clear lastMarkerTarget here, it's set by the new click
        }
        // -------------------------------------------

        if (!this.clickMarker) {
            this.clickMarker = this.add.sprite(x, y, 'clickMarker')
                .setAlpha(0.8)
                .setDepth(5);
        } else {
            this.clickMarker.setPosition(x, y);
            this.clickMarker.setActive(true).setVisible(true);
            this.clickMarker.setAlpha(0.8);
            // No need to killTweensOf here, we handle it with markerFadeTween.stop() above
        }

        // --- Start the new fade-out tween AND store it ---
        this.markerFadeTween = this.tweens.add({ // Assign the tween result
            targets: this.clickMarker,
            alpha: { from: 0.8, to: 0 },
            ease: 'Cubic.easeOut',
            duration: 2000, // Increased duration (e.g., 2 seconds)
            onComplete: () => {
                // Tween completed normally (faded out fully)
                this.clickMarker?.setActive(false).setVisible(false);
                this.markerFadeTween = null; // Clear reference as it's done
                this.lastMarkerTarget = null; // Clear target as the marker action is complete
            }
        });
        // ------------------------------------------------
    }
    handleChatMessageForBubble(data: ChatMessageData) {
        console.log('GameScene received chat message for bubble:', data);

        let targetSprite: CharacterSprite | undefined;
        // --- Logic to find the target sprite USING senderCharacterId ---
        if (data.senderCharacterId) {
            // Check if it's one of the player's own characters
            targetSprite = this.playerCharacters.get(data.senderCharacterId);

            if (!targetSprite) {
                // If not found in player's characters, check other characters
                targetSprite = this.otherCharacters.get(data.senderCharacterId);
            }
        }
        if (targetSprite) {
            console.log(`Found target sprite ${targetSprite.characterId} for chat bubble from ${data.senderName}.`);
            targetSprite.showChatBubble(data.message);
        } else {
             // This might happen if the character left the zone just before the message arrived
             console.warn(`Could not find target sprite with ID ${data.senderCharacterId} for chat bubble from ${data.senderName}.`);
        }
    }
    update(time: number, delta: number) {
        // Update character interpolation
        this.playerCharacters.forEach(char => char.update(time, delta));
        this.otherCharacters.forEach(char => char.update(time, delta));
        this.enemySprites.forEach(sprite => sprite.update(time, delta));
        // --- Check for Arrival to Stop Marker Tween (Using Average Position) ---
        if (this.markerFadeTween && this.lastMarkerTarget && this.playerCharacters.size > 0) {

            // --- Calculate Average Position ---
            let sumX = 0;
            let sumY = 0;
            let count = 0;
            this.playerCharacters.forEach(char => {
                sumX += char.x;
                sumY += char.y;
                count++;
            });
            const avgX = sumX / count;
            const avgY = sumY / count;
            // ----------------------------------

            const distanceToTarget = Phaser.Math.Distance.Between(
                avgX,                    // Use average X
                avgY,                    // Use average Y
                this.lastMarkerTarget.x, // Anchor X (click point)
                this.lastMarkerTarget.y  // Anchor Y (click point)
            );

            const arrivalThreshold = 15; // Maybe slightly larger threshold for average

            if (distanceToTarget < arrivalThreshold) {
                console.log('Formation center arrived, stopping marker tween.'); // Debug log
                this.markerFadeTween.stop(); // Stop the tween
                this.markerFadeTween = null;    // Clear reference
                this.lastMarkerTarget = null; // Clear target
                this.clickMarker?.setActive(false).setVisible(false); // Hide marker immediately
            }
        }
        // --------------------------------------------
    }


    // --- Event Handlers ---

    handlePlayerJoined(data: { characters: ZoneCharacterState[] }) {
        console.log('Handling player joined:', data);
        data.characters.forEach(charData => {
            this.createOrUpdateCharacterSprite(charData, false);
        });
    }

    handlePlayerLeft(data: { playerId: string }) {
        console.log('Handling player left:', data);
        // Find and remove all characters associated with the leaving player ID
        this.otherCharacters.forEach((sprite, charId) => {
            if (sprite.ownerId === data.playerId) {
                sprite.destroy();
                this.otherCharacters.delete(charId);
                 console.log(`Removed character ${charId} for leaving player ${data.playerId}`);
            }
        });
    }

    handleEntityUpdate(data: { updates: EntityUpdateData[] }) {
        data.updates.forEach(update => {
            const { id, x, y, health, state } = update;

            // Check Characters (Player + Others)
            let charSprite = this.playerCharacters.get(id) || this.otherCharacters.get(id);
            if (charSprite) {
                if (x !== undefined && y !== undefined && x !== null && y !== null) {
                    charSprite.updateTargetPosition(x, y); // Use correct method
                }
                if (health !== undefined && health !== null) {
                    charSprite.setHealth(health); // Use correct method
                }
                // TODO: Handle character state visual changes (e.g., idle/moving/attacking/dead animations)
                // if (state) { charSprite.setStateVisual(state); }
                return; // Found and updated
            }

            // Check Enemies
            const enemySprite = this.enemySprites.get(id);
            if (enemySprite) {
                if (x !== undefined && y !== undefined && x !== null && y !== null) {
                    enemySprite.updateTargetPosition(x, y); // Use correct method
                }
                if (health !== undefined && health !== null) {
                    enemySprite.setHealth(health); // Use correct method
                }
                // TODO: Handle enemy state visual changes (e.g., idle/chasing/attacking/wandering)
                // if (state) { enemySprite.setStateVisual(state); }
                return; // Found and updated
            }
        });
    }

    handleEntityDied(data: EntityDeathData) {
        console.log('Handling entity died:', data);
        const { entityId, type } = data;

        if (type === 'character') {
            let sprite = this.playerCharacters.get(entityId) || this.otherCharacters.get(entityId);
            if (sprite) {
                console.log(`Character sprite ${entityId} died. Applying death visual.`);
                // Implement visual change directly here instead of calling non-existent method
                sprite.setAlpha(0.4); // Example: Make semi-transparent
                sprite.disableInteractive(); // Make non-clickable (if it was interactive)
                // We might need logic in update or a respawn event to revert this later
            } else {
                 console.warn(`Received death event for unknown character ID: ${entityId}`);
            }
        } else if (type === 'enemy') {
             const enemySprite = this.enemySprites.get(entityId);
             if (enemySprite) {
                 console.log(`Enemy sprite ${entityId} died. Destroying.`);
                 enemySprite.destroy();
                 this.enemySprites.delete(entityId);
             } else {
                  console.warn(`Received death event for unknown enemy ID: ${entityId}`);
             }
        }
    }

    // +++ ADDED: Handler for enemy spawns +++
    handleEnemySpawned(enemyData: EnemySpawnData) {
        console.log('Handling enemy spawned:', enemyData);
        this.createEnemySprite(enemyData);
    }
    // ++++++++++++++++++++++++++++++++++++++++

    handleDisconnectError(reason: string | any) {
        // Generic handler for disconnects or critical errors
        const message = typeof reason === 'string' ? reason : 'Connection error.';
        console.error('GameScene Disconnect/Error:', message);

        // Prevent multiple redirects
        if (this.scene.isActive()) { // Check if scene is still active
             // Clean up listeners
             this.shutdownScene();
             // Show message and go to login
             alert(`Disconnected: ${message}`); // Simple alert for now
             this.scene.start('LoginScene');
        }
    }

    // --- Helper Functions ---

    createOrUpdateCharacterSprite(charData: ZoneCharacterState, isPlayer: boolean, defaultX?: number, defaultY?: number) {
        const id = charData.id;
        const map = isPlayer ? this.playerCharacters : this.otherCharacters;
        let sprite = map.get(id);
        const x = charData.x ?? defaultX ?? 100;
        const y = charData.y ?? defaultY ?? 100;
        const baseHealth = charData.baseHealth ?? 100; // Get base health
        const currentHealth = charData.currentHealth ?? baseHealth; // Use current or default to base

        if (sprite) {
            // Update existing sprite
            console.log(`Updating existing ${isPlayer ? 'player' : 'other'} character sprite: ${id}`);
            sprite.updateTargetPosition(x, y); // Use correct method
            // Update name/level label
            sprite.updateNameLabel(charData.name, charData.level); // Use correct method
            // Update health
            sprite.setHealth(currentHealth, baseHealth); // Use correct method

        } else {
            // Create new sprite
            console.log(`Creating new ${isPlayer ? 'player' : 'other'} character sprite: ${id}`);
            // Pass baseHealth to constructor if it uses it, or set after
            // Ensure charData type matches constructor expectations (baseHealth handled in constructor now)
            const spriteData: any = { ...charData }; // Create a copy to avoid type issues if necessary
            if (spriteData.baseHealth === undefined) spriteData.baseHealth = 100; // Ensure default
            if (spriteData.currentHealth === undefined) spriteData.currentHealth = spriteData.baseHealth;

            sprite = new CharacterSprite(this, x, y, 'playerPlaceholder', spriteData as ZoneCharacterState, isPlayer);
            // Health is set within the constructor now based on data
            // sprite.setHealth(currentHealth, baseHealth);
            map.set(id, sprite);
        }
    }

    shutdownScene() {
        console.log('GameScene shutting down, removing listeners.');
        // Remove listeners to prevent memory leaks or errors on scene restart
        EventBus.off('network-disconnect', this.handleDisconnectError, this);
        EventBus.off('player-joined', this.handlePlayerJoined, this);
        EventBus.off('player-left', this.handlePlayerLeft, this);
        EventBus.off('entity-update', this.handleEntityUpdate, this);
        EventBus.off('chat-message-received', this.handleChatMessageForBubble, this); // Remove bubble listener
        EventBus.off('entity-died', this.handleEntityDied, this); // <-- REMOVE LISTENER FOR DEATHS
        EventBus.off('enemy-spawned', this.handleEnemySpawned, this); // ++ REMOVE LISTENER ++
        EventBus.off('combat-action', this.handleCombatAction, this); // +++ REMOVE LISTENER +++
        EventBus.off('items-dropped', this.handleItemsDropped, this); // <-- REMOVE LISTENER
        EventBus.off('item-picked-up', this.handleItemPickedUp, this); // <-- REMOVE LISTENER
        // --- Clean up click marker ---
        if (this.markerFadeTween) {
            this.markerFadeTween.stop(); // Stop active tween on shutdown
       }
       this.clickMarker?.destroy();
       this.clickMarker = null;
       this.markerFadeTween = null;
       this.lastMarkerTarget = null;
       this.currentPlayerUsername = null; // Clear username on shutdown
        // Destroy all character sprites
        this.playerCharacters.forEach(sprite => sprite.destroy());
        this.otherCharacters.forEach(sprite => sprite.destroy());
        this.playerCharacters.clear();
        this.otherCharacters.clear();
        // Destroy dropped item sprites
        this.droppedItemSprites.forEach(sprite => sprite.destroy());
        this.droppedItemSprites.clear();
        // --- Stop the UI Scene when GameScene stops ---
        console.log('Stopping UIScene...');
        this.input.keyboard?.off('keydown-ENTER'); // Clean up listener
        this.uiSceneRef = null; // Clear reference
        this.scene.stop('UIScene');
    }

    // Called automatically when the scene is shut down
    shutdown() {
        console.log("GameScene shutdown called");
        this.shutdownScene(); // Ensure cleanup runs even on scene.stop()
    }

    // +++ ADDED: Reusable enemy sprite creation logic +++
    private createEnemySprite(enemyData: EnemySpawnData) {
        if (this.enemySprites.has(enemyData.id)) {
            console.warn(`Enemy sprite with ID ${enemyData.id} already exists. Ignoring spawn event.`);
            return;
        }

        // --- Basic mapping from templateId to spriteKey --- 
        // !! IMPORTANT: Update this mapping with your actual Template IDs and Sprite Keys !!
        let spriteKey = 'goblin'; // Default key
        const knownTemplates: { [key: string]: string } = {
            // Example: Replace UUIDs with your actual template IDs
            'b9b83a12-6f9d-4c2e-a8b7-16c26f0f9a8d': 'goblin',
            '4e94c1a7-7a8a-4f8c-bd4f-933e1d5e2b7f': 'spider',
            // 'YOUR_WOLF_TEMPLATE_ID_HERE': 'wolf_sprite_key',
        };

        if (knownTemplates[enemyData.templateId]) {
            spriteKey = knownTemplates[enemyData.templateId];
        } else {
            console.warn(`No specific sprite key found for enemy template ID ${enemyData.templateId}. Using default '${spriteKey}'.`);
        }
        // --------------------------------------------------

        console.log(`Creating new enemy sprite: ${enemyData.name} (ID: ${enemyData.id}, Sprite: ${spriteKey}) at (${enemyData.position.x}, ${enemyData.position.y})`);

        const newEnemy = new EnemySprite(
            this,
            enemyData.position.x,
            enemyData.position.y,
            spriteKey,
            enemyData.name,
            enemyData // Pass full data; EnemySprite constructor uses baseHealth from it
        );

        // EnemySprite constructor calls setHealth, so no need to call it again here unless constructor changes
        // newEnemy.setHealth(enemyData.currentHealth, enemyData.baseHealth ?? enemyData.currentHealth);

        this.enemySprites.set(enemyData.id, newEnemy);
    }
    // +++++++++++++++++++++++++++++++++++++++++++++++++++++++

    // +++ ADDED: Handler for Combat Action Visuals +++
    private handleCombatAction(data: CombatActionData) {
        console.log('[GameScene] Handling combat action event:', data); // <-- UNCOMMENT/ADD THIS LOG

        // Find the target sprite
        let targetSprite: CharacterSprite | EnemySprite | undefined;
        targetSprite = this.playerCharacters.get(data.targetId) ||
                       this.otherCharacters.get(data.targetId) ||
                       this.enemySprites.get(data.targetId);

        if (targetSprite && targetSprite.scene) { // Check if sprite exists and is part of the scene
            console.log(`[GameScene] Found target sprite (${targetSprite.name}) for combat visual.`); // <-- ADD THIS LOG

            // --- Attack Circle Visual (Existing) ---
            const effect = this.add.graphics({ x: targetSprite.x, y: targetSprite.y });
            effect.fillStyle(0xff0000, 0.8); // Red color, slightly transparent
            effect.fillCircle(0, 0, 6); // Small circle at the graphic's origin (target's position)
            effect.setDepth(targetSprite.depth + 1); // Ensure it's drawn above the target

            this.tweens.add({
                targets: effect,
                alpha: { from: 0.8, to: 0 },
                scale: { from: 1, to: 1.6 }, // Make it expand slightly
                duration: 300, // Short duration (300ms)
                ease: 'Quad.easeOut',
                onComplete: () => {
                    if (effect?.scene) { // Check if effect still exists before destroying
                       effect.destroy(); // Clean up the graphics object
                    }
                }
            });

            // --- Floating Combat Text (NEW) ---
            if (data.damage > 0) { // Only show text if there's damage
                const damage = Math.round(data.damage); // Use rounded damage
                // Determine color: Red if target is one of OUR characters, white otherwise
                const isPlayerTarget = this.playerCharacters.has(data.targetId);
                const textColor = isPlayerTarget ? '#ff0000' : '#ffffff'; // Red for player damage taken, white otherwise
                const combatText = this.add.text(
                    targetSprite.x,
                    targetSprite.y - targetSprite.displayHeight / 2, // Start slightly above the sprite's center/top
                    `${damage}`,
                    {
                        fontFamily: 'Arial, sans-serif', // Choose a suitable font
                        fontSize: '14px',
                        fontStyle: 'bold',
                        color: textColor,
                        stroke: '#000000', // Black stroke for visibility
                        strokeThickness: 3
                    }
                );
                combatText.setOrigin(0.5, 0.5); // Center the text
                combatText.setDepth(targetSprite.depth + 2); // Ensure text is above the circle effect

                // Tween for floating up and fading out
                this.tweens.add({
                    targets: combatText,
                    y: combatText.y - 40, // Float upwards by 40 pixels
                    alpha: { from: 1, to: 0 }, // Fade out
                    duration: 1000, // 1 second duration
                    ease: 'Quad.easeOut',
                    onComplete: () => {
                        if (combatText?.scene) { // Check if text still exists
                            combatText.destroy(); // Clean up the text object
                        }
                    }
                });
            }
            // ------------------------------------

        } else {
            console.warn(`[GameScene] Combat action target sprite not found or already removed: ${data.targetId}`); // <-- ADD/MODIFY THIS LOG
        }
    }

    // --- New Event Handlers for Items ---
    private handleItemsDropped(data: ItemsDroppedPayload) {
        console.log('[GameScene] handleItemsDropped triggered with data:', data); // <-- ADD LOG HERE
        if (!data || !Array.isArray(data.items)) {
            console.warn('Received invalid itemsDropped data:', data);
            return;
        }
        console.log('Received items dropped:', data.items);

        data.items.forEach(itemData => {
            if (this.droppedItemSprites.has(itemData.id)) {
                console.warn(`Item sprite ${itemData.id} already exists, skipping.`);
                return;
            }
            try {
                 // Add click listener when creating the sprite
                 const itemSprite = new DroppedItemSprite(this, itemData);
                 itemSprite.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
                     if (pointer.button === 0) { // Only react to left click
                        console.log(`Attempting to pick up item: ${itemData.itemName} (${itemData.id})`);
                        this.networkManager.sendMessage('pickupItemCommand', { itemId: itemData.id }, (response) => {
                            if (response && response.success) {
                                console.log(`Pickup successful for item ${itemData.id}`);
                                // Sprite removal will be handled by 'itemPickedUp' event
                            } else {
                                console.warn(`Pickup failed for item ${itemData.id}:`, response?.message);
                                // Optionally show feedback to the player in UIScene
                                this.uiSceneRef?.showTemporaryMessage(`Cannot pick up: ${response?.message || 'Error'}`);
                            }
                        });
                    }
                 });
                this.droppedItemSprites.set(itemData.id, itemSprite);
                console.log(`Created sprite for dropped item: ${itemData.itemName} (${itemData.id})`);
            } catch (error) {
                console.error(`Failed to create sprite for item ${itemData.id} with key ${itemData.spriteKey}:`, error);
            }
        });
    }

    private handleItemPickedUp(data: { itemId: string }) {
        if (!data || !data.itemId) {
            console.warn('Received invalid itemPickedUp data:', data);
            return;
        }
        console.log(`Item picked up (removing sprite): ${data.itemId}`);
        const sprite = this.droppedItemSprites.get(data.itemId);
        if (sprite) {
            sprite.destroy();
            this.droppedItemSprites.delete(data.itemId);
        } else {
            console.warn(`Could not find sprite to remove for picked up item ID: ${data.itemId}`);
        }
    }

    // --- ADD Handler for clicking dropped items ---
    private handleDroppedItemClicked(itemId: string) {
        if (!itemId) {
            console.warn('Dropped item clicked event received invalid item ID.');
            return;
        }
        console.log(`[GameScene] Detected click on dropped item: ${itemId}. Sending pickup command...`);
        this.networkManager.sendMessage('pickup_item', { itemId });
    }
    // -------------------------------------------
}