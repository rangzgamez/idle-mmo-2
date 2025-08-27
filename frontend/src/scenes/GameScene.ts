// frontend/src/scenes/GameScene.ts
import Phaser from 'phaser';
import { NetworkManager } from '../network/NetworkManager';
import { CharacterSprite } from '../gameobjects/CharacterSprite'; // Import the sprite class
import { EventBus } from '../EventBus';
import UIScene from './UIScene';
import { EnemySprite } from '../gameobjects/EnemySprite';
import { DroppedItemSprite, DroppedItemData } from '../gameobjects/DroppedItemSprite';
import { ZoneCharacterState } from '../types/zone.types';

// Add the interface definitions if not shared
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

// --- Payload Interfaces (Copied/Shared from UIScene or common types file) ---
interface LevelUpPayload {
    characterId: string;
    newLevel: number;
    newBaseStats: { health: number; attack: number; defense: number };
    xp: number; // Total XP
    xpToNextLevel: number; // Total XP needed for next level
}

interface XpUpdatePayload {
    characterId: string;
    level: number;
    xp: number; // Total XP
    xpToNextLevel: number; // Total XP needed for next level
}
// ---

// Define interface if not already present
interface CharacterStateUpdatePayload {
    updates: Array<{ entityId: string; state: string }>;
}

export default class GameScene extends Phaser.Scene {
    networkManager!: NetworkManager;
    playerCharacters: Map<string, CharacterSprite> = new Map(); // Key: characterId
    otherCharacters: Map<string, CharacterSprite> = new Map(); // Key: characterId
    selectedPartyData: any[] = []; // Data passed from CharacterSelectScene
    private playerClassMap: Map<string, string> = new Map(); // <<<--- NEW: Store player class names
    private lastMarkerTarget: Phaser.Math.Vector2 | null = null; // Store the target associated with the marker
    private clickMarker: Phaser.GameObjects.Sprite | null = null; // Add property for the marker
    private markerFadeTween: Phaser.Tweens.Tween | null = null; // Store the active fade tween
    private uiSceneRef: UIScene | null = null;
    private currentPlayerUsername: string | null = null; // <-- Add property to store username
    private enemySprites: Map<string, EnemySprite> = new Map(); //NEW
    private droppedItemSprites: Map<string, DroppedItemSprite> = new Map(); // <-- Add map for dropped items
    private recentPlayerAttacks: Map<string, number> = new Map(); // Track recent attacks by player characters (targetId -> timestamp)
    private screenShakeTween: Phaser.Tweens.Tween | null = null; // Track active screen shake
    constructor() {
        super('GameScene');
    }

    // Receive data from the previous scene (CharacterSelectScene)
    init(data: { selectedParty?: any[] }) {
        this.selectedPartyData = data?.selectedParty || []; // Safely access selectedParty
        this.networkManager = NetworkManager.getInstance();

        // <<<--- Populate Player Class Map ---
        this.playerClassMap.clear(); // Clear previous map if scene restarts
        this.selectedPartyData.forEach(char => {
            if (char.id && char.class) { // Use 'className' based on previous context
                this.playerClassMap.set(char.id, char.class.toLowerCase());
            } else {
                console.warn('[GameScene.init] Selected character data missing id or className:', char);
            }
        });
        // <<<-------------------------------

        // --- Store current player's username ---
        this.currentPlayerUsername = null; // Reset on init
        if (this.selectedPartyData.length > 0 && this.selectedPartyData[0].ownerName) {
            // Get username from the ownerName field provided by the backend's selectParty response
            this.currentPlayerUsername = this.selectedPartyData[0].ownerName;
        } else {
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

        // <<<--- LOAD CHARACTER SPRITESHEETS ---
        // IMPORTANT: Replace 'warrior', 'mage' etc. with your actual class names
        // IMPORTANT: Ensure frameWidth/frameHeight match CharacterSprite/PhaserSpriteAnimator setup (e.g., 100x100)
        const classesToLoad = ['fighter', 'wizard', 'archer', 'priest']; // !!! UPDATE THIS ARRAY with your actual class names !!!
        const frameConfig = { frameWidth: 100, frameHeight: 100 }; // !!! UPDATE frame dimensions if different !!!

        classesToLoad.forEach(className => {
            const basePath = `assets/sprites/characters/${className}/`;

            // Define states and their corresponding file names
            const states = {
                idle: 'idle.png',
                walk: 'walk.png',
                attack: 'attack.png'
                // Add other states like 'hurt', 'death' here if they exist
            };

            for (const state in states) {
                const fileName = states[state as keyof typeof states];
                const path = basePath + fileName;
                const key = `${className}_${state}`; // e.g., "warrior_idle", "mage_walk"

                // You might want to add error checking here in a real project
                // to confirm the file actually exists before trying to load it.
                this.load.spritesheet(key, path, frameConfig);
            }
        });
         // Example error handling during loading
        // <<<-------------------------------------

        // this.load.tilemapTiledJSON('zone1Map', 'assets/tilemaps/zone1.json');
    }

    create() {

        // Check network connection
        if (!this.networkManager.isConnected()) {
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
        EventBus.on('item-despawned', this.handleItemDespawned, this); // <-- ADD LISTENER for item despawn
        this.events.on('droppedItemClicked', this.handleDroppedItemClicked, this); // <-- CORRECTED: Use this.events
        // --- ADD Listeners for XP/Level Events ---
        EventBus.on('levelUpNotification', this.handleLevelUpNotification, this);
        EventBus.on('xpUpdate', this.handleXpUpdate, this);
        // ---> ADD Listener for local state updates
        EventBus.on('character-state-update', this.handleCharacterStateUpdates, this);
        // <--- END ADD
        // -----------------------------------------

        // --- Launch UI Scene ---
        // Use scene.launch to run it in parallel with this scene
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
                EventBus.emit('focus-chat-input');
                event.stopPropagation(); // Prevent other Enter handlers
            }
        });
        // --- Send 'enterZone' request ---
        const zoneId = 'startZone'; // Or determine dynamically
        this.networkManager.sendMessage('enterZone', { zoneId }, (response: { success: boolean; zoneState?: ZoneCharacterState[]; enemyState?: EnemySpawnData[]; message?: string }) => {
            if (response && response.success) {

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
                 this.networkManager.sendMessage('requestInventory');
                 // --------------------------------

            } else {
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
                        clickedOnActionable = true;
                    } else {
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
            targetSprite.showChatBubble(data.message);
        } else {
             // This might happen if the character left the zone just before the message arrived
        }
    }
    update(time: number, delta: number) {
        // Update character interpolation
        this.playerCharacters.forEach(char => char.update(time, delta));
        this.otherCharacters.forEach(char => char.update(time, delta));
        this.enemySprites.forEach(sprite => sprite.update(time, delta));

        // --- Cleanup old tracked attacks (prevent memory leaks) ---
        const now = Date.now();
        const attackTimeoutMs = 3000; // 3 seconds
        const sizeBefore = this.recentPlayerAttacks.size;
        for (const [targetId, timestamp] of this.recentPlayerAttacks.entries()) {
            if (now - timestamp > attackTimeoutMs) {
                this.recentPlayerAttacks.delete(targetId);
            }
        }
        const sizeAfter = this.recentPlayerAttacks.size;
        if (sizeBefore !== sizeAfter) {
        }
        // ----------------------------------------------------------

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
                this.markerFadeTween.stop(); // Stop the tween
                this.markerFadeTween = null;    // Clear reference
                this.lastMarkerTarget = null; // Clear target
                this.clickMarker?.setActive(false).setVisible(false); // Hide marker immediately
            }
        }
        // --------------------------------------------
    }


    // --- Event Handlers ---

    handlePlayerJoined(data: ZoneCharacterState) {
        if (!data.className) {
            return;
        }
        this.createOrUpdateCharacterSprite(data, false);
    }

    handlePlayerLeft(data: { ownerId: string }) {
        this.otherCharacters.forEach((sprite, charId) => {
            if (sprite.ownerId === data.ownerId) {
                sprite.destroy();
                this.otherCharacters.delete(charId);
            }
        });
    }

    handleEntityUpdate(data: EntityUpdateData) {
        // <<<--- REMOVE LOG AT THE VERY START
        // console.log(`[GameScene.handleEntityUpdate] Handler triggered for ID: ${data?.id}`);

        // <<<--- REMOVE RAW DATA LOG (OR KEEP COMMENTED OUT) ---
        // console.log(`[GameScene.handleEntityUpdate] Received update for ${data.id}:`, JSON.stringify(data));

        const sprite = this.findSpriteById(data.id);

        if (sprite) {
            // Update Position (Interpolation Target)
            if (data.x !== undefined && data.y !== undefined && data.x !== null && data.y !== null) {
                // Check if the method exists before calling
                if (typeof sprite.updateTargetPosition === 'function') {
                    // <<<--- REMOVE LOG BEFORE UPDATE
                    // console.log(`[GameScene.handleEntityUpdate] Updating target position for ${data.id} to (${data.x}, ${data.y})`);
                   sprite.updateTargetPosition(data.x, data.y);
                } else {
                    // <<<--- REMOVE WARNING (Optional, could keep if useful)
                    // console.warn(`[GameScene.handleEntityUpdate] Sprite ${data.id} missing updateTargetPosition method.`);
                }
            } else {
                 // <<<--- REMOVE LOG IF POSITION DATA IS MISSING/NULL
                 // if ('x' in data || 'y' in data) { 
                 //    console.log(`[GameScene.handleEntityUpdate] Received update for ${data.id} WITHOUT valid position data.`);
                 // }
            }

            // Update Health
            if (data.health !== undefined && data.health !== null) {
                if (typeof sprite.setHealth === 'function') {
                   sprite.setHealth(data.health);
                   // --- Emit Party HP Update only for player characters ---
                   if (sprite instanceof CharacterSprite && this.playerCharacters.has(data.id)) {
                       EventBus.emit('update-party-hp', {
                           characterId: data.id,
                           currentHp: data.health,
                           maxHp: sprite.getMaxHealth() // Safe now, it's a CharacterSprite
                       });
                   }
                   // -------------------------------------------------------
                }
            }

            // <<<--- Update Animation State ---
            if (sprite instanceof CharacterSprite && data.state) {
                 // Map server state to animation state
                 let animState: 'idle' | 'walk' | 'attack' = 'idle'; // Default to idle
                 switch (data.state) {
                     case 'idle':
                         animState = 'idle';
                         break;
                     case 'moving':
                     case 'moving_to_loot': // Treat moving to loot as walking
                         animState = 'walk';
                         break;
                     case 'attacking':
                     case 'looting_area': // Maybe use 'attack' animation for looting?
                         animState = 'attack';
                         break;
                     case 'dead':
                         // Optionally handle dead state animation here (e.g., sprite.setFrame(deadFrame))
                         // Currently handled by alpha in createOrUpdate?
                         break;
                     default:
                         animState = 'idle';
                 }

                // Set animation unless dead (handle dead state separately if needed)
                 if (data.state !== 'dead') {
                     const forceRestart = (animState === 'attack'); // Only force restart attack
                     sprite.setAnimation(animState, forceRestart);
                 }
            } else if (sprite instanceof EnemySprite && data.state) {
                 // TODO: Add animation handling for EnemySprite if needed
                 // e.g., sprite.setAnimation(data.state);
            }
            // <<<-------------------------------
        } else {
             // console.warn('[GameScene] Received entity update for unknown ID:', data.id);
        }
    }

    handleEntityDied(data: EntityDeathData) {
        
        const sprite = this.findSpriteById(data.entityId);
        if (sprite) {
            if (sprite instanceof EnemySprite) {
                // --- Check for screen shake on player enemy kills ---
                const recentAttackTime = this.recentPlayerAttacks.get(data.entityId);
                
                if (recentAttackTime) {
                    const timeSinceAttack = Date.now() - recentAttackTime;
                    
                    // Trigger screen shake if the attack was within the last 2 seconds
                    if (timeSinceAttack <= 2000) {
                        this.triggerScreenShake(8, 300); // Nice subtle shake
                    }
                    // Clean up the tracked attack
                    this.recentPlayerAttacks.delete(data.entityId);
                }
                // --------------------------------------------------------

                // Start death animation instead of immediate destruction
                sprite.startDeathAnimation();
                
                // Set timer to destroy sprite after 10 seconds (with fade out)
                this.time.delayedCall(10000, () => {
                    if (sprite && sprite.active) {
                        // Fade out before destroying
                        this.tweens.add({
                            targets: sprite,
                            alpha: 0,
                            duration: 500,
                            ease: 'Power2.easeOut',
                            onComplete: () => {
                                if (this.enemySprites.has(data.entityId)) {
                                    this.enemySprites.delete(data.entityId);
                                    sprite.destroy();
                                }
                            }
                        });
                    }
                });
                
            } else if (sprite instanceof CharacterSprite) {
                // Handle character death visually (e.g., fade out, play death animation)
                sprite.setAlpha(0.4); // Example: Fade slightly
                // Optionally stop animations using the public method if needed
                 if (typeof sprite.setAnimation === 'function') {
                    // If you have a specific 'dead' animation:
                    // sprite.setAnimation('dead', true);
                    // Otherwise, maybe revert to idle (though visually faded)
                    // sprite.setAnimation('idle');
                    // Or simply stop: (Requires adding a public stop method to CharacterSprite or modifying setAnimation)
                    // sprite.stopAnimation(); // Assuming a public stop method exists
                 }
                 // The character respawn logic is handled server-side based on documentation
            }
        }
    }

    // +++ ADDED: Handler for enemy spawns +++
    handleEnemySpawned(enemyData: EnemySpawnData) {
        this.createEnemySprite(enemyData);
    }
    // ++++++++++++++++++++++++++++++++++++++++

    handleDisconnectError(reason: string | any) {
        // Generic handler for disconnects or critical errors
        const message = typeof reason === 'string' ? reason : 'Connection error.';

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

    private createOrUpdateCharacterSprite(charData: ZoneCharacterState, isPlayer: boolean, initialX?: number, initialY?: number) {
        let determinedClassName: string | undefined = charData.className; // Start with potentially undefined value

        // Attempt to get className for the player from the map if missing from charData
        if (isPlayer && !determinedClassName) {
             determinedClassName = this.playerClassMap.get(charData.id);
        } 
        // Assign placeholder if still missing (covers other players missing data, or player lookup failure)
        if (!determinedClassName) {
             if (!isPlayer) {
                }
             determinedClassName = 'fighter'; // Assign placeholder
        }

        // At this point, determinedClassName should ALWAYS be a string.
        const className: string = determinedClassName;

        const existingSprite = isPlayer
            ? this.playerCharacters.get(charData.id)
            : this.otherCharacters.get(charData.id);

        const posX = initialX ?? charData.x ?? this.cameras.main.width / 2;
        const posY = initialY ?? charData.y ?? this.cameras.main.height / 2;
        const textureKey = `${className}_idle`;

        if (existingSprite) {
            // Update existing sprite
            existingSprite.updateTargetPosition(posX, posY);
            // Optionally snap position for existing sprites on zone join/major update?
            // existingSprite.setPosition(posX, posY);
            existingSprite.updateNameLabel(charData.name, charData.level);
            existingSprite.setHealth(charData.currentHealth ?? charData.baseHealth ?? 100, charData.baseHealth);
            existingSprite.setAlpha(1); // Reset alpha in case they were dead

            // Check if class changed (unlikely but possible)
            if (existingSprite.className !== charData.className) {
                 // Easiest way to handle animator change is full recreation
                 existingSprite.destroy();
                 this.createOrUpdateCharacterSprite(charData, isPlayer, posX, posY); // Re-call to create new
                 return;
            }

            // Ensure animation is reset correctly (e.g., if respawning)
            if (typeof existingSprite.setAnimation === 'function') {
                existingSprite.setAnimation('idle');
            }

        } else {
            // Create new sprite

            // Check if the initial texture is loaded
            if (!this.textures.exists(textureKey)) {
                // Fallback to placeholder if idle texture isn't loaded
                const placeholderTexture = 'playerPlaceholder';
                const sprite = new CharacterSprite(this, posX, posY, placeholderTexture, charData, isPlayer);
                 if (isPlayer) { this.playerCharacters.set(charData.id, sprite); }
                 else { this.otherCharacters.set(charData.id, sprite); }
                 // Note: Animator setup will fail inside CharacterSprite, but sprite exists
                 return;
            }

            // Create with the correct initial texture
            // Ensure the ZoneCharacterState being passed includes the determined className
            const finalCharData: ZoneCharacterState = { ...charData, className: className };
            const sprite = new CharacterSprite(this, posX, posY, textureKey, finalCharData, isPlayer);
            if (isPlayer) {
                this.playerCharacters.set(charData.id, sprite);
            } else {
                this.otherCharacters.set(charData.id, sprite);
            }
            // Animator is set up inside CharacterSprite constructor
        }
    }

    shutdownScene() {
        // Remove EventBus listeners
        EventBus.off('network-disconnect', this.handleDisconnectError, this);
        EventBus.off('player-joined', this.handlePlayerJoined, this);
        EventBus.off('player-left', this.handlePlayerLeft, this);
        EventBus.off('entity-update', this.handleEntityUpdate, this);
        EventBus.off('chat-message-received', this.handleChatMessageForBubble, this);
        EventBus.off('entity-died', this.handleEntityDied, this);
        EventBus.off('enemy-spawned', this.handleEnemySpawned, this);
        EventBus.off('combat-action', this.handleCombatAction, this);
        EventBus.off('items-dropped', this.handleItemsDropped, this);
        EventBus.off('item-picked-up', this.handleItemPickedUp, this);
        EventBus.off('item-despawned', this.handleItemDespawned, this);
        this.events.off('droppedItemClicked', this.handleDroppedItemClicked, this);
        // --- Remove XP/Level Listeners ---
        EventBus.off('levelUpNotification', this.handleLevelUpNotification, this);
        EventBus.off('xpUpdate', this.handleXpUpdate, this);
        // ---> REMOVE Listener on shutdown
        EventBus.off('character-state-update', this.handleCharacterStateUpdates, this);
        // <--- END REMOVE
        // -------------------------------
        // Clear character maps
        this.playerCharacters.forEach(sprite => sprite.destroy());
        this.otherCharacters.forEach(sprite => sprite.destroy());
        this.playerCharacters.clear();
        this.otherCharacters.clear();
        // Destroy dropped item sprites
        this.droppedItemSprites.forEach(sprite => sprite.destroy());
        this.droppedItemSprites.clear();
        // Clean up screen shake tracking
        this.recentPlayerAttacks.clear();
        if (this.screenShakeTween) {
            this.screenShakeTween.stop();
            this.screenShakeTween = null;
        }
        // --- Stop the UI Scene when GameScene stops ---
        this.input.keyboard?.off('keydown-ENTER'); // Clean up listener
        this.uiSceneRef = null; // Clear reference
        this.scene.stop('UIScene');
    }

    // Called automatically when the scene is shut down
    shutdown() {
        // Remove EventBus listeners
        EventBus.off('network-disconnect', this.handleDisconnectError, this);
        EventBus.off('player-joined', this.handlePlayerJoined, this);
        EventBus.off('player-left', this.handlePlayerLeft, this);
        EventBus.off('entity-update', this.handleEntityUpdate, this);
        EventBus.off('chat-message-received', this.handleChatMessageForBubble, this);
        EventBus.off('entity-died', this.handleEntityDied, this);
        EventBus.off('enemy-spawned', this.handleEnemySpawned, this);
        EventBus.off('combat-action', this.handleCombatAction, this);
        EventBus.off('items-dropped', this.handleItemsDropped, this);
        EventBus.off('item-picked-up', this.handleItemPickedUp, this);
        EventBus.off('item-despawned', this.handleItemDespawned, this);
        this.events.off('droppedItemClicked', this.handleDroppedItemClicked, this);
        // --- Remove XP/Level Listeners ---
        EventBus.off('levelUpNotification', this.handleLevelUpNotification, this);
        EventBus.off('xpUpdate', this.handleXpUpdate, this);
        // ---> REMOVE Listener on shutdown
        EventBus.off('character-state-update', this.handleCharacterStateUpdates, this);
        // <--- END REMOVE
        // -------------------------------
        // Clear character maps
        this.playerCharacters.forEach(sprite => sprite.destroy());
        this.otherCharacters.forEach(sprite => sprite.destroy());
        this.playerCharacters.clear();
        this.otherCharacters.clear();
        // Destroy dropped item sprites
        this.droppedItemSprites.forEach(sprite => sprite.destroy());
        this.droppedItemSprites.clear();
        // Clean up screen shake tracking
        this.recentPlayerAttacks.clear();
        if (this.screenShakeTween) {
            this.screenShakeTween.stop();
            this.screenShakeTween = null;
        }
        // --- Stop the UI Scene when GameScene stops ---
        this.input.keyboard?.off('keydown-ENTER'); // Clean up listener
        this.uiSceneRef = null; // Clear reference
        this.scene.stop('UIScene');
    }

    // +++ ADDED: Reusable enemy sprite creation logic +++
    private createEnemySprite(enemyData: EnemySpawnData) {
        if (this.enemySprites.has(enemyData.id)) {
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
        }
        // --------------------------------------------------


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
        // <<<--- DEBUG LOG ENTRY ---
        // -------------------------

        // Find the attacker sprite (could be player or other character)
        const attackerSprite = this.playerCharacters.get(data.attackerId) || this.otherCharacters.get(data.attackerId);
        // Find the target sprite (could be enemy or character)
        const targetSprite = this.findSpriteById(data.targetId); // Use helper

        // --- Track player attacks on enemies for screen shake ---
        const isPlayerAttacker = this.playerCharacters.has(data.attackerId);
        const isEnemyTarget = this.enemySprites.has(data.targetId);
        
        
        if (isPlayerAttacker && isEnemyTarget) {
            // Track this attack with current timestamp (for 2 second window)
            const timestamp = Date.now();
            this.recentPlayerAttacks.set(data.targetId, timestamp);
        }
        // --------------------------------------------------------

        // --- ADDED: Play attacker's animation --- 
        if (attackerSprite instanceof CharacterSprite) { // Ensure it's a character
            attackerSprite.playAttackAnimationOnce();
        }
        // ----------------------------------------

        // Visual feedback for the target (e.g., brief tint)
        if (targetSprite) {
            // ... (existing tint logic) ...
        }

        // Show floating combat text
        if (targetSprite && data.damage) { // Checks if targetSprite exists AND data.damage is truthy (>0)
             // <<<--- DEBUG LOG ---
             // ------------------
             this.showFloatingText(targetSprite.x, targetSprite.y - targetSprite.displayHeight * 0.6, `-${data.damage}`, '#ff0000'); // Uses RED color
        } else {
             // <<<--- DEBUG LOG ---
             if (!targetSprite) {
             }
             if (!data.damage) {
             }
             // ------------------
        }
    }

    // --- New Event Handlers for Items ---
    private handleItemsDropped(data: ItemsDroppedPayload) {
        if (!data || !Array.isArray(data.items)) {
            return;
        }

        data.items.forEach(itemData => {
            if (this.droppedItemSprites.has(itemData.id)) {
                return;
            }
            try {
                 // Add click listener when creating the sprite
                 const itemSprite = new DroppedItemSprite(this, itemData);
                 itemSprite.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
                     if (pointer.button === 0) { // Only react to left click
                        this.networkManager.sendMessage('pickupItemCommand', { itemId: itemData.id }, (response) => {
                            if (response && response.success) {
                                // Sprite removal will be handled by 'itemPickedUp' event
                            } else {
                                // Optionally show feedback to the player in UIScene
                                this.uiSceneRef?.showTemporaryMessage(`Cannot pick up: ${response?.message || 'Error'}`);
                            }
                        });
                    }
                 });
                this.droppedItemSprites.set(itemData.id, itemSprite);
            } catch (error) {
            }
        });
    }

    private handleItemPickedUp(data: { itemId: string }) {
        if (!data || !data.itemId) {
            return;
        }
        const sprite = this.droppedItemSprites.get(data.itemId);
        if (sprite) {
            sprite.destroy();
            this.droppedItemSprites.delete(data.itemId);
        } else {
        }
    }

    // --- ADD Handler for clicking dropped items ---
    private handleDroppedItemClicked(itemId: string) {
        if (!itemId) {
            return;
        }
        this.networkManager.sendMessage('pickup_item', { itemId });
    }
    // -------------------------------------------

    // --- NEW: Frontend XP Calculation Helpers (Copied from UIScene) ---
    private _frontendCalculateXpForLevel(level: number): number {
        const baseXP = 100;
        const exponent = 1.5;
        if (level <= 1) return 0;
        return Math.floor(baseXP * Math.pow(level - 1, exponent));
    }
    private _getXpForCurrentLevel(totalXp: number, level: number): number {
        if (level <= 1) return totalXp;
        const xpNeededForCurrentLevelStart = this._frontendCalculateXpForLevel(level);
        return totalXp - xpNeededForCurrentLevelStart;
    }
    private _getXpNeededForLevelSpan(level: number): number {
        if (level < 1) return 0;
        const xpForNext = this._frontendCalculateXpForLevel(level + 1);
        const xpForCurrent = this._frontendCalculateXpForLevel(level);
        return xpForNext - xpForCurrent;
    }
    // --- END NEW HELPERS ---

    // --- NEW: Handle Level Up Notification ---
    private handleLevelUpNotification(payload: LevelUpPayload) {
        const charSprite = this.playerCharacters.get(payload.characterId);
        if (charSprite) {
            // Update Sprite (Check if methods exist)
            if (typeof charSprite.setLevel === 'function') {
                charSprite.setLevel(payload.newLevel);
            } else {
            }
            charSprite.setHealth(payload.newBaseStats.health, payload.newBaseStats.health); // Update max and current HP
            
            // Calculate relative XP values for UI
            const xpInCurrentLevel = this._getXpForCurrentLevel(payload.xp, payload.newLevel);
            const xpNeededBetweenLevels = this._getXpNeededForLevelSpan(payload.newLevel);

            // Emit event for UIScene
            EventBus.emit('party-member-level-up', { 
                characterId: payload.characterId,
                newLevel: payload.newLevel,
                currentHp: payload.newBaseStats.health, // Full HP
                maxHp: payload.newBaseStats.health,
                currentXp: xpInCurrentLevel,
                xpToNextLevel: xpNeededBetweenLevels
            });
        }
    }
    // --- END NEW ---

    // --- NEW: Handle XP Update ---
    private handleXpUpdate(payload: XpUpdatePayload) {
        // 1. Check if this log appears

        // We only need to forward this to the UI if it's for one of our characters
        if (this.playerCharacters.has(payload.characterId)) {
             // 2. Check if this log appears

             // Calculate relative XP values for UI
            const xpInCurrentLevel = this._getXpForCurrentLevel(payload.xp, payload.level);
            const xpNeededBetweenLevels = this._getXpNeededForLevelSpan(payload.level);

            // 3. Check if this log appears

            EventBus.emit('update-party-xp', {
                characterId: payload.characterId,
                level: payload.level,
                currentXp: xpInCurrentLevel,
                xpToNextLevel: xpNeededBetweenLevels
            });
        } else {
             // 4. OR Check if this log appears
        }
    }
     // --- END NEW ---

    private handleItemDespawned(data: { itemId: string }) {
        const itemSprite = this.droppedItemSprites.get(data.itemId);
        if (itemSprite) {
            itemSprite.destroy(); // This will remove the sprite and any associated elements (tooltip, etc.)
            this.droppedItemSprites.delete(data.itemId);
        } else {
        }
    }

    private findSpriteById(id: string): CharacterSprite | EnemySprite | undefined {
        return this.playerCharacters.get(id) || this.otherCharacters.get(id) || this.enemySprites.get(id);
    }

    // Simple helper for floating text (can be expanded)
    private showFloatingText(x: number, y: number, message: string, color: string = '#ffffff', duration: number = 1000) {
        const text = this.add.text(x, y, message, {
            fontFamily: 'Arial', fontSize: '14px', color: color, stroke: '#000000', strokeThickness: 3
        });
        text.setOrigin(0.5, 1); // Anchor bottom-center
        text.setDepth(100); // Ensure on top

        this.tweens.add({
            targets: text,
            y: y - 30, // Float up
            alpha: { from: 1, to: 0 },
            duration: duration,
            ease: 'Quad.easeOut',
            onComplete: () => { text.destroy(); }
        });
    }

    // Screen shake functionality for game juice
    private triggerScreenShake(intensity: number = 10, duration: number = 300) {
        
        // Stop any existing screen shake
        if (this.screenShakeTween) {
            this.screenShakeTween.stop();
            this.screenShakeTween = null;
        }

        const camera = this.cameras.main;
        
        // IMPORTANT: Temporarily disable camera follow during shake
        const wasFollowing = camera.followTarget;
        if (wasFollowing) {
            camera.stopFollow();
        }
        
        const originalX = camera.scrollX;
        const originalY = camera.scrollY;
        
        
        let updateCount = 0;
        
        // Create shake effect - we need to animate a dummy object and manually update camera
        const shakeTarget = { x: 0, y: 0 };
        
        
        this.screenShakeTween = this.tweens.add({
            targets: shakeTarget,
            x: 1, // Dummy animation - we'll ignore this value
            duration: duration,
            ease: 'Power2',
            yoyo: false,
            repeat: 0,
            onStart: () => {
            },
            onUpdate: (tween: Phaser.Tweens.Tween) => {
                updateCount++;
                // Calculate diminishing shake intensity over time
                const progress = tween.progress;
                const currentIntensity = intensity * (1 - progress);
                
                // Random offset within intensity range
                const offsetX = (Math.random() - 0.5) * currentIntensity;
                const offsetY = (Math.random() - 0.5) * currentIntensity;
                
                const newX = originalX + offsetX;
                const newY = originalY + offsetY;
                
                camera.setScroll(newX, newY);
                
            },
            onComplete: () => {
                // Restore camera follow if it was active
                if (wasFollowing) {
                    camera.startFollow(wasFollowing, true, 0.1, 0.1);
                } else {
                    // Only restore position if not following
                    camera.setScroll(originalX, originalY);
                }
                
                this.screenShakeTween = null;
            }
        });
    }

    // ---> ADD Handler function
    private handleCharacterStateUpdates(payload: CharacterStateUpdatePayload) {
        // console.log('GameScene handling character state update batch', payload);
        payload.updates.forEach(update => {
            const { entityId, state } = update;
            // Find the sprite in either player or other characters map
            const characterSprite = this.playerCharacters.get(entityId) || this.otherCharacters.get(entityId);

            if (characterSprite) {
                // Call the method on CharacterSprite to handle the state change
                // Ensure CharacterSprite has this method!
                characterSprite.setCharacterState(state);
                // console.log(`Updated state for character ${entityId} to ${state}`);
            } else {
                // Ignore if sprite not found (might happen if entity left zone just before update)
                // console.warn(`GameScene: Received state update for unknown character ID: ${entityId}`);
            }
        });
    }
    // <--- END ADD
}