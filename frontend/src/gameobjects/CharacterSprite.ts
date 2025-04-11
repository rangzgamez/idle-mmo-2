// frontend/src/gameobjects/CharacterSprite.ts
import Phaser from 'phaser';
import { HealthBar } from './HealthBar'; // Import HealthBar
import { PhaserSpriteAnimator, StateTextureKeys } from '../graphics/PhaserSpriteAnimator'; // <<< Import Phaser Animator
import { ZoneCharacterState } from '../types/zone.types';
import FloatingCombatText from './FloatingCombatText';

export class CharacterSprite extends Phaser.GameObjects.Sprite {
    characterId: string;
    ownerId: string; // ID of the controlling player
    isPlayerCharacter: boolean; // Is this one of the client's own characters?
    className: string; // <<<--- ADD CLASS NAME PROPERTY
    // --- Interpolation properties ---
    targetX: number;
    targetY: number;
    lerpSpeed: number = 0.2; // Adjust for smoother/snappier movement (0 to 1)
    // ------------------------------
    // --- Chat Bubble Properties ---
    private activeBubbles: Phaser.GameObjects.Text[] = [];
    private healthBar: HealthBar; // Add health bar property
    private animator?: PhaserSpriteAnimator; // <<<--- ADD ANIMATOR (optional for safety)
    private isFacingRight: boolean = true; // <<<--- ADD FACING DIRECTION
    private isDead = false;
    private currentState: string = 'idle';

    private readonly BUBBLE_MAX_WIDTH = 150; // Max width before wrapping
    private readonly BUBBLE_OFFSET_Y = 20;  // Initial offset above sprite center/top
    private readonly BUBBLE_SPACING_Y = 18; // Vertical space between stacked bubbles (adjust based on font size)
    private readonly BUBBLE_FADE_DURATION = 4000; // 5 seconds
    private readonly BUBBLE_FONT_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
        fontFamily: 'Arial',
        fontSize: '10px',
        color: '#ffffff',
        backgroundColor: '#000000',
        padding: { x: 5, y: 3 },
        align: 'center',
        wordWrap: { width: this.BUBBLE_MAX_WIDTH }
    };
    private nameLabel: Phaser.GameObjects.Text;
    private chatBubble: Phaser.GameObjects.Container | null = null;
    private chatBubbleTimer: Phaser.Time.TimerEvent | null = null;

    constructor(scene: Phaser.Scene, x: number, y: number, texture: string, data: ZoneCharacterState, isPlayer: boolean) {
        // Use placeholder texture initially if idle texture isn't guaranteed yet
        // Or pass the expected idle key directly if preloaded reliably
        const initialTextureKey = `${data.className}_idle`;
        super(scene, x, y, scene.textures.exists(initialTextureKey) ? initialTextureKey : texture); // Use idle if exists, else placeholder
        scene.add.existing(this);
        scene.physics.add.existing(this); // Add basic physics body

        this.characterId = data.id;
        this.ownerId = data.ownerId;
        this.isPlayerCharacter = isPlayer;
        this.className = data.className; // <<<--- STORE CLASS NAME
        this.setName(this.characterId); // <<<--- SET UNIQUE NAME FOR ANIMATOR PREFIX
        this.targetX = x;
        this.targetY = y;

        // Name Label
        this.nameLabel = scene.add.text(x, y - this.height / 2 - 5, `${data.name} (Lvl ${data.level})`, {
            fontSize: '10px',
            color: isPlayer ? '#00ff00' : '#ffffff',
            align: 'center',
        }).setOrigin(0.5);
        this.updateNameLabelPosition(); // Use helper

        if (!isPlayer) {
            this.setAlpha(0.8);
        }

        // --- Health Bar --- 
        const maxHealth = data.baseHealth ?? 100; 
        const currentHealth = data.currentHealth ?? maxHealth; 
        this.healthBar = new HealthBar(scene, this.x, this.y - 30, 40, 5, maxHealth);
        this.updateHealthBarPosition();
        this.setHealth(currentHealth, maxHealth); // Initialize health visually
        // -----------------

        // <<<--- SETUP ANIMATOR ---
        this.setupAnimator(scene);
        // <<<---------------------

        this.currentState = data.state || 'idle';
        this.updateAnimation();
    }

    // <<<--- NEW METHOD TO SETUP ANIMATOR ---
    private setupAnimator(scene: Phaser.Scene): void {
        // Use the same frame dimensions as preloaded
        const frameWidth = 100; // Or get from config/data
        const frameHeight = 100; // Or get from config/data
        const animIntervalMs = 150; // Animation speed

        // Texture keys based on className (MUST match preload keys)
        const textureKeys: StateTextureKeys = {
            idle: `${this.className}_idle`,
            walk: `${this.className}_walk`,
            attack: `${this.className}_attack`,
            // Add other states here if needed (ensure they are preloaded)
        };

        // Check if essential idle texture was loaded
        if (!scene.textures.exists(textureKeys.idle)) {
            console.error(`[CharacterSprite ${this.characterId}] Idle texture '${textureKeys.idle}' not found! Cannot create animator.`);
            return; // Don't create animator if basic texture is missing
        }

        try {
            // Create the animator instance
            this.animator = new PhaserSpriteAnimator(
                scene,
                this, // Pass the sprite itself
                textureKeys,
                frameWidth,
                frameHeight,
                animIntervalMs,
                this.characterId // Pass characterId as unique prefix
            );
             console.log(`[CharacterSprite ${this.characterId}] Animator created successfully.`);
             // Animator should set the initial idle animation via its constructor
        } catch (error) {
             console.error(`[CharacterSprite ${this.characterId}] Failed to create PhaserSpriteAnimator:`, error);
        }
    }
    // <<<------------------------------------

    // ... (Keep showChatBubble, calculateBubbleY) ...
    showChatBubble(message: string) {
        if (!this.scene) return; // Guard against calls after destruction

        // 2. Create the new bubble text
        const newBubble = this.scene.add.text(
            this.x, // Start at character's current X
            this.calculateBubbleY(this.activeBubbles.length),
            message,
            this.BUBBLE_FONT_STYLE
        )
        .setOrigin(0.5, 1) // Origin bottom-center for easier stacking above head
        .setDepth(10); // Ensure bubbles are on top

        // 3. Add to active list
        this.activeBubbles.push(newBubble);

        // 4. Create fade-out tween
        const fadeTween = this.scene.tweens.add({
            targets: newBubble,
            alpha: { from: 1, to: 0 },
            delay: this.BUBBLE_FADE_DURATION, // Start fading after duration
            duration: 1000, // Fade over 1 second
            onComplete: () => {
                // Remove from array and destroy when fade completes
                this.activeBubbles = this.activeBubbles.filter(b => b !== newBubble);
                newBubble.destroy();
            }
        });

        // Store tween reference on the bubble itself for potential early cancellation if needed
        newBubble.setData('fadeTween', fadeTween);
    }
    private calculateBubbleY(index: number): number {
        // Calculate Y position based on index to stack bubbles
        const baseBubbleY = this.y - (this.displayHeight * this.originY) - this.BUBBLE_OFFSET_Y; // Anchor above sprite based on origin
        const effectiveIndex = this.activeBubbles.length - 1 - index;
        return baseBubbleY - (effectiveIndex * this.BUBBLE_SPACING_Y);
    }

    // Method to update target position based on server updates
    updateTargetPosition(x: number, y: number) {
        this.targetX = x;
        this.targetY = y;
        // Optional: Flip immediately when target is set? 
        // Or let the update loop handle it smoothly.
        // Let's let the update loop handle it for now.
    }

    // <<<--- NEW METHOD TO SET FACING DIRECTION ---
    facePosition(targetX: number): void {
        const xDifference = targetX - this.x;
        // Only flip if the horizontal difference is significant (e.g., > 1 pixel)
        if (Math.abs(xDifference) > 1) { 
            const shouldFaceRight = xDifference > 0;
            if (this.isFacingRight !== shouldFaceRight) {
                this.isFacingRight = shouldFaceRight;
                this.setFlipX(!this.isFacingRight); // Flip if facing left
                // console.log(`[CharacterSprite ${this.characterId}] Flipping ${this.isFacingRight ? 'Right' : 'Left'}`);
            }
        }
    }
    // <<<-----------------------------------------

    update(time: number, delta: number) {
        const currentX = this.x;
        const currentY = this.y;
        
        // Interpolate position
        this.x = Phaser.Math.Linear(currentX, this.targetX, this.lerpSpeed);
        this.y = Phaser.Math.Linear(currentY, this.targetY, this.lerpSpeed);

        // <<<--- FLIP SPRITE BASED ON MOVEMENT DIRECTION ---
        // Check if actively moving horizontally
        if (this.targetX !== null && Math.abs(this.targetX - currentX) > 1) {
             // Only flip if moving, not if already at target
             if (Math.abs(this.x - this.targetX) > 1) { // Check current interpolated position vs target
                this.facePosition(this.targetX);
             }
        }
        // <<<---------------------------------------------

        // Update name label & health bar positions
        this.updateNameLabelPosition();
        this.updateHealthBarPosition();

        // Update chat bubble positions
        this.activeBubbles.forEach((bubble, index) => {
            bubble.x = this.x;
            bubble.y = this.calculateBubbleY(index);
        });

        this.updateChatBubblePosition();
        this.updateAnimation();
    }

    setHealth(currentHealth: number, maxHealth?: number): void {
        this.healthBar.setHealth(currentHealth, maxHealth);
    }

    getMaxHealth(): number {
        return this.healthBar.getMaxHealth();
    }

    private updateHealthBarPosition(): void {
        // Position below name label, using displayHeight for robustness
        const yOffset = (this.displayHeight * (1 - this.originY)) + 20; // Below origin + offset
        this.healthBar.setPosition(this.x, this.y + yOffset);
    }

    private updateNameLabelPosition(): void {
         // Position above sprite, using displayHeight and origin
         const yOffset = (this.displayHeight * this.originY) + 5; // Above origin + offset
         this.nameLabel.setPosition(this.x, this.y - yOffset);
    }

    // Add method to update name/level label if needed later
    updateNameLabel(name: string, level: number) {
        this.nameLabel.setText(`${name} (Lvl ${level})`);
        this.updateNameLabelPosition(); // Recalculate position
    }

    // --- NEW: Method to set level (updates label) ---
    setLevel(level: number) {
        const currentText = this.nameLabel.text;
        const nameMatch = currentText.match(/^(.*?)\s+\(Lvl \d+\)$/);
        const name = nameMatch ? nameMatch[1] : currentText;
        this.updateNameLabel(name, level);
    }
    // -----------------------------------------------

    // <<<--- NEW METHOD TO CONTROL ANIMATION ---
    setAnimation(state: 'idle' | 'walk' | 'attack', forceRestart: boolean = false): void {
        if (!this.animator) {
            // console.warn(`[CharacterSprite ${this.characterId}] Animator not available, cannot set animation state: ${state}`);
            return; // Animator not initialized
        }

        // Determine if the animation should ignore if already playing (default: true)
        let ignoreIfPlaying = true;
        if (state === 'attack') { // Always restart attack animations
            forceRestart = true;
            ignoreIfPlaying = false;
        }

        // Handle movement interruption/state change logic if needed
        // Example: Stop interpolation when attacking
        // if (state === 'attack') {
        //    this.targetX = this.x;
        //    this.targetY = this.y;
        // }

        try {
             this.animator.playAnimation(state, forceRestart, ignoreIfPlaying);
        } catch (error) {
            console.error(`[CharacterSprite ${this.characterId}] Error setting animation to '${state}':`, error);
        }
    }
    // <<<---------------------------------------

    // Override destroy to clean up animator too
    destroy(fromScene?: boolean) {
        this.nameLabel.destroy();
        this.activeBubbles.forEach(bubble => {
            const tween = bubble.getData('fadeTween') as Phaser.Tweens.Tween;
            tween?.stop();
            bubble.destroy();
        });
        this.activeBubbles = [];
        this.healthBar.destroy();
        this.animator?.destroy(); // <<<--- DESTROY ANIMATOR
        this.clearChatBubble(true);
        super.destroy(fromScene);
    }

    public setCharacterState(newState: string): void {
        console.log(`[CharacterSprite ${this.characterId}] Setting character state to: ${newState}`);
        if (this.currentState !== newState && !this.isDead) {
            this.currentState = newState;
            this.updateAnimation();
        } else if (newState === 'dead' && !this.isDead) {
            this.handleDeath();
        }
    }

    private updateAnimation(): void {
        if (this.isDead) {
            this.stop();
            return;
        }

        const dx = this.targetX - this.x;
        const dy = this.targetY - this.y;
        const isMoving = Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5;

        let animKey: string | null = null;

        switch (this.currentState) {
            case 'attacking':
                animKey = `${this.className}_attack`;
                break;
            case 'moving_to_loot':
            case 'moving':
                animKey = isMoving ? `${this.className}_walk` : `${this.className}_idle`;
                break;
            case 'looting_area':
            case 'idle':
            default:
                animKey = `${this.className}_idle`;
                break;
        }

        if (animKey) {
            if (this.scene.anims.exists(animKey)) {
                if (this.anims.currentAnim?.key !== animKey) {
                    this.play(animKey);
                }
            } else {
                const idleKey = `${this.className}_idle`;
                if (animKey !== idleKey && this.scene.anims.exists(idleKey)) {
                    if (this.anims.currentAnim?.key !== idleKey) {
                        this.play(idleKey);
                    }
                } else {
                    this.stop();
                }
            }
        }

        if (Math.abs(dx) > 0.5) {
            this.setFlipX(dx < 0);
        }
    }

    public handleDeath(): void {
        if (this.isDead) return;
        console.log(`[CharacterSprite ${this.characterId}] Handling death visuals.`);
        this.isDead = true;
        this.currentState = 'dead';
        this.setAlpha(0.5);
        this.stop();
        this.clearChatBubble(true);
    }


    private updateChatBubblePosition(): void {
        if (this.chatBubble) {
            this.chatBubble.setPosition(this.x, this.y + this.BUBBLE_OFFSET_Y);
        }
    }

    public clearChatBubble(force: boolean = false): void {
        if (this.chatBubbleTimer && !force) {
            this.chatBubbleTimer.remove();
            this.chatBubbleTimer = null;
        }
        if (this.chatBubble) {
            this.chatBubble.destroy();
            this.chatBubble = null;
        }
    }
}