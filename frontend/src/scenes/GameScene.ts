// frontend/src/scenes/GameScene.ts
import Phaser from 'phaser';
import { NetworkManager } from '../network/NetworkManager';
import { CharacterSprite } from '../gameobjects/CharacterSprite'; // Import the sprite class
import { EventBus } from '../EventBus';
import UIScene from './UIScene';
import { EnemySprite } from '../gameobjects/EnemySprite';
// Add the interface definitions if not shared
interface ZoneCharacterState { id: string; ownerId: string; ownerName: string; name: string; level: number; x: number | null; y: number | null; currentHealth?: number; baseHealth?: number; }
interface EntityUpdateData { id: string; x?: number | null; y?: number | null; health?: number | null; }
// --- Add Entity Death Interface ---
interface EntityDeathData { entityId: string; type: 'character' | 'enemy'; }

interface ChatMessageData {
    senderName: string;
    senderCharacterId: string;
    message: string;
    timestamp?: number;
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
        // --- Launch UI Scene ---
        // Use scene.launch to run it in parallel with this scene
        console.log('Launching UIScene...');
        this.scene.launch('UIScene');
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
        this.networkManager.sendMessage('enterZone', { zoneId }, (response: { success: boolean; zoneState?: ZoneCharacterState[]; enemyState?:any[]; message?: string }) => {
            if (response && response.success) {
                console.log(`Entered zone ${zoneId} successfully. Initial state:`, response.zoneState);

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

                 // Make camera follow the first player character
                 const firstPlayerChar = Array.from(this.playerCharacters.values())[0];
                 if(firstPlayerChar) {
                     this.cameras.main.startFollow(firstPlayerChar, true, 0.1, 0.1); // Smooth follow
                     this.cameras.main.setZoom(1.7); // Zoom in a bit
                 }
                 if (response.enemyState) {
                    response.enemyState.forEach(enemyData => {
                        // Create EnemySprite for each existing enemy
                         const newEnemy = new EnemySprite(this, enemyData.position.x, enemyData.position.y, 'goblin', `Enemy ${enemyData.instanceId}`, enemyData);
                        this.enemySprites.set(enemyData.instanceId, newEnemy);
                    });
                }

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
            let clickedOnEnemy = false;
            if (gameObjects.length > 0) {
                const topObject = gameObjects[0]; // Check the topmost object clicked
                if (topObject instanceof EnemySprite && topObject.getData('type') === 'enemy') {
                    // Clicked on an enemy!
                    const enemySprite = topObject as EnemySprite;
                    const enemyId = enemySprite.getData('enemyData')?.instanceId; // Get ID from stored data
                     if (enemyId) {
                        this.networkManager.sendMessage('attackCommand', { targetId: enemyId });
                        console.log(`Sent attack command for enemy: ${enemyId}`);
                        clickedOnEnemy = true;
                        // Optionally show a target indicator or visual feedback here
                    } else {
                        console.warn('Clicked enemy sprite missing instanceId in data.');
                    }
                }
            }
            // --- Send Move Command ---
            const firstPlayerCharId = Array.from(this.playerCharacters.keys())[0];
            if (firstPlayerCharId) {
                this.networkManager.sendMessage('moveCommand', {
                    target: { x: worldPoint.x, y: worldPoint.y }
                });
            } else {
                 console.warn("No player character found to send move command for.");
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
        console.log('Handling playerJoined:', data);
        data.characters.forEach(charData => {
            // Don't re-create if somehow we already have this character
            if (!this.otherCharacters.has(charData.id) && !this.playerCharacters.has(charData.id)) {
                 this.createOrUpdateCharacterSprite(charData, false);
            }
        });
    }

    handlePlayerLeft(data: { playerId: string }) {
        console.log('Handling playerLeft:', data.playerId);
        // Find and destroy all character sprites belonging to the player who left
        const charsToRemove: string[] = [];
        this.otherCharacters.forEach((charSprite) => {
            if (charSprite.ownerId === data.playerId) {
                charsToRemove.push(charSprite.characterId);
                charSprite.destroy();
            }
        });
        charsToRemove.forEach(id => this.otherCharacters.delete(id));
        console.log(`Removed ${charsToRemove.length} characters for player ${data.playerId}`);
    }

    handleEntityUpdate(data: { updates: EntityUpdateData[] }) {
        // console.log('Handling entityUpdate:', data); // Noisy
        data.updates.forEach(update => {
            const { id, x, y } = update;

            // Find the character sprite (could be player or other)
            const characterSprite = this.playerCharacters.get(id) || this.otherCharacters.get(id);
            if (characterSprite) {
                if (update.health) {
                    characterSprite.setHealth(update.health);
                }
            }
            if (characterSprite && x !== undefined && y !== undefined && x !== null && y !== null) {
                // Update the target position for interpolation
                characterSprite.updateTargetPosition(x, y);
                
            }
             // Handle other updates later (health, state changes, etc.)
             else if (this.enemySprites.has(update.id)) {
                const sprite = this.enemySprites.get(update.id);
                if (!sprite) {
                    console.warn(`Enemy sprite not found for ID: ${update.id}`);
                    return;
                }
                if (update.x && update.y) {
                    sprite.updateTargetPosition(update.x, update.y);
                }
                if (update.health) {
                    sprite.setHealth(update.health);
                }
            }
             // 4. NEW - Create Enemy Sprite if doesn't exist
            else {
                if (this.playerCharacters.has(update.id) || this.otherCharacters.has(update.id)) {
                    return; // Do nothing if it's a known character
                }
                // TODO: Improve this logic - we need definitive info from backend if it's an enemy
                // For now, assume it's an enemy if not a known character
                // GET ENEMY TEMPLATE INFO FROM BACKEND EVENTUALLY
                const enemyData = { instanceId: update.id }; // Store the ID
                const newEnemy = new EnemySprite(this, update.x!, update.y!, 'goblin', `Enemy`, enemyData); // Use 'goblin' for now
                newEnemy.setInteractive(); // *** MAKE ENEMY CLICKABLE ***
                this.enemySprites.set(update.id, newEnemy);
             }
        });
    }

    // --- ADD DEATH HANDLER ---
    handleEntityDied(data: EntityDeathData) {
        console.log('Entity Died:', data);
        if (data.type === 'enemy') {
            const deadEnemySprite = this.enemySprites.get(data.entityId);
            if (deadEnemySprite) {
                console.log(`Destroying enemy sprite: ${data.entityId}`);
                deadEnemySprite.destroy(); // Remove from scene
                this.enemySprites.delete(data.entityId); // Remove from map
            } else {
                console.warn(`Received entityDied for unknown enemy ID: ${data.entityId}`);
            }
        } else if (data.type === 'character') {
            // Handle character death visuals (e.g., make sprite grey, disable interactions)
             const deadCharSprite = this.playerCharacters.get(data.entityId) || this.otherCharacters.get(data.entityId);
             if (deadCharSprite) {
                console.log(`Handling character death visuals for: ${data.entityId}`);
                // TODO: Implement visual change for dead character
                 deadCharSprite.setAlpha(0.5); // Example: make semi-transparent
                 deadCharSprite.disableInteractive(); // Prevent clicking
                 // We might need a way to revert this on respawn later
             }
        }
    }
    // -------------------------

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
        const existingSprite = isPlayer ? this.playerCharacters.get(charData.id) : this.otherCharacters.get(charData.id);

        const posX = charData.x ?? defaultX ?? 100; // Use server pos, then default, then fallback
        const posY = charData.y ?? defaultY ?? 100;

        if (existingSprite) {
            // Optional: Update existing sprite data if needed (level, name change?)
            // For now, just update target position
            existingSprite.updateTargetPosition(posX, posY);
        } else {
            // Create new sprite
            // --- Prepare data for CharacterSprite constructor, ensuring health values --- 
            const spriteData = {
                ...charData,
                // Provide default values if health info is missing
                currentHealth: charData.currentHealth ?? 100, 
                baseHealth: charData.baseHealth ?? 100, 
            };
            // -----------------------------------------------------------------------
            const newSprite = new CharacterSprite(
                this,
                posX,
                posY,
                'playerPlaceholder', // Use actual texture later
                spriteData, // Pass the prepared data with guaranteed health values
                isPlayer
            );

            if (isPlayer) {
                this.playerCharacters.set(charData.id, newSprite);
            } else {
                this.otherCharacters.set(charData.id, newSprite);
            }
            console.log(`Created ${isPlayer ? 'player' : 'other'} character sprite: ${charData.name} (${charData.id}) at ${posX}, ${posY}`);
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
        // --- Stop the UI Scene when GameScene stops ---
        console.log('Stopping UIScene...');
        this.input.keyboard?.off('keydown-ENTER'); // Clean up listener
        this.uiSceneRef = null; // Clear reference
        this.scene.stop('UIScene');
    }

    // Called automatically when the scene is shut down
    shutdown() {
        this.shutdownScene();
    }
}