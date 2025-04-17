// frontend/src/graphics/PhaserSpriteAnimator.ts
import Phaser from 'phaser';

/**
 * Defines the mapping between logical animation states (like 'idle', 'walk')
 * and the keys of the preloaded spritesheet textures in Phaser's cache.
 */
export interface StateTextureKeys {
    idle: string;
    attack?: string;
    walk?: string;
    // Add other potential states as needed (e.g., hurt, death)
    [key: string]: string | undefined;
}

/**
 * Manages Phaser animations for a specific sprite based on state.
 * Assumes spritesheets for each state are preloaded into Phaser's texture cache.
 */
export class PhaserSpriteAnimator {
    private scene: Phaser.Scene;
    private sprite: Phaser.GameObjects.Sprite;
    private textureKeys: StateTextureKeys;
    private frameWidth: number;
    private frameHeight: number;
    // Store the actual Animation objects managed by Phaser
    private animConfigs: { [state: string]: Phaser.Animations.Animation } = {};
    private baseFrameRate: number;
    private statePrefix: string; // Unique prefix for animation keys

    constructor(
        scene: Phaser.Scene,
        sprite: Phaser.GameObjects.Sprite,
        textureKeys: StateTextureKeys,
        frameWidth: number,
        frameHeight: number,
        animIntervalMs: number = 200,
        statePrefix?: string // Optional prefix if sprite name/id isn't unique enough
    ) {
        this.scene = scene;
        this.sprite = sprite;
        this.textureKeys = textureKeys;
        this.frameWidth = frameWidth;
        this.frameHeight = frameHeight;
        this.baseFrameRate = animIntervalMs > 0 ? 1000 / animIntervalMs : 10;

        // Use sprite name or a provided prefix for unique animation keys
        this.statePrefix = statePrefix || sprite.name || `sprite_${sprite.texture?.key}_${Date.now()}`;
        if (!this.statePrefix) {
            console.warn("PhaserSpriteAnimator: Sprite missing name/texture key, generating less specific prefix.");
            this.statePrefix = `sprite_${Math.random().toString(36).substring(7)}`;
        }

        if (!textureKeys.idle) {
            throw new Error("PhaserSpriteAnimator requires at least an 'idle' state texture key.");
        }

        // Set initial texture immediately if possible, before defining animations
        if (this.scene.textures.exists(textureKeys.idle)) {
            this.sprite.setTexture(textureKeys.idle);
        } else {
             console.warn(`[PhaserSpriteAnimator ${this.statePrefix}] Initial idle texture key "${textureKeys.idle}" not found! Sprite may appear as default texture.`);
             // Consider setting a known placeholder texture if idle isn't loaded yet
             // if (this.scene.textures.exists('placeholder')) this.sprite.setTexture('placeholder');
        }


        this.defineAnimations();
        this.setToIdle(); // Attempt to set idle animation state
    }

    /**
     * Creates Phaser animation configurations for each state defined in textureKeys.
     */
    private defineAnimations(): void {
        console.log(`[PhaserSpriteAnimator ${this.statePrefix}] Defining animations...`);
        Object.keys(this.textureKeys).forEach(state => {
            const textureKey = this.textureKeys[state];
            if (!textureKey || !this.scene.textures.exists(textureKey)) {
                console.warn(`[PhaserSpriteAnimator ${this.statePrefix}] Texture key "${textureKey}" for state "${state}" not found or not loaded. Skipping animation definition.`);
                return;
            }

            const texture = this.scene.textures.get(textureKey);
            // Use texture dimensions. Handle cases where source[0] might not exist.
             const sourceWidth = texture.source[0]?.width;
             const sourceHeight = texture.source[0]?.height;

             if (!sourceWidth || !sourceHeight || sourceWidth === 0 || sourceHeight === 0) {
                  console.warn(`[PhaserSpriteAnimator ${this.statePrefix}] Texture "${textureKey}" has invalid dimensions or source. Skipping.`);
                  return;
             }

            const totalColumns = Math.max(1, Math.floor(sourceWidth / this.frameWidth));
            const totalRows = Math.max(1, Math.floor(sourceHeight / this.frameHeight));
            const frameCount = totalColumns * totalRows;

            if (frameCount <= 0) {
                 console.warn(`[PhaserSpriteAnimator ${this.statePrefix}] Calculated 0 frames for state "${state}" with texture "${textureKey}". Skipping.`);
                 return;
            }

            const animKey = this.getAnimationKey(state);

            // Determine loop based on state convention
            const repeat = (state === 'attack' || state === 'cast' || state === 'hurt' || state === 'death') ? 0 : -1;

            // Only create animation if it doesn't exist globally yet
            if (!this.scene.anims.exists(animKey)) {
                const config: Phaser.Types.Animations.Animation = {
                    key: animKey,
                    frames: this.scene.anims.generateFrameNumbers(textureKey, { start: 0, end: frameCount - 1 }),
                    frameRate: this.baseFrameRate,
                    repeat: repeat
                };
                 try {
                    this.scene.anims.create(config);
                    // Retrieve the actual animation object after creation
                    const createdAnim = this.scene.anims.get(animKey);
                    if (createdAnim) {
                       this.animConfigs[state] = createdAnim; // Store the retrieved animation object
                       console.log(`[PhaserSpriteAnimator ${this.statePrefix}] Defined animation: key='${animKey}', frames=${frameCount}, repeat=${repeat}`);
                    } else {
                       // This case should be unlikely if create didn't throw
                       console.error(`[PhaserSpriteAnimator ${this.statePrefix}] Failed to retrieve animation '${animKey}' after creation.`);
                    }
                 } catch (error) {
                      console.error(`[PhaserSpriteAnimator ${this.statePrefix}] Error creating animation '${animKey}':`, error);
                 }
            } else {
                 console.log(`[PhaserSpriteAnimator ${this.statePrefix}] Animation '${animKey}' already exists.`);
                 // Store the existing animation object
                 const existingAnim = this.scene.anims.get(animKey);
                 if (existingAnim) {
                     this.animConfigs[state] = existingAnim;
                 } else {
                      // Should be impossible if scene.anims.exists(animKey) was true
                     console.error(`[PhaserSpriteAnimator ${this.statePrefix}] Inconsistency: Animation '${animKey}' exists but could not be retrieved.`);
                 }
            }
        });
    }

    /** Generates a unique animation key for a given state */
    private getAnimationKey(state: string): string {
        return `${this.statePrefix}_${state}`;
    }

    /**
     * Plays the animation for the specified state.
     * @param state The state to play (e.g., 'walk', 'attack').
     * @param forceRestart If true, restarts the animation even if it's already playing.
     * @param ignoreIfPlaying If true and the requested animation is already playing, do nothing. (Default: true)
     * @param frameRate Optional frame rate to override the animation's default.
     */
    playAnimation(
        state: string, 
        forceRestart: boolean = false, 
        ignoreIfPlaying: boolean = true, 
        frameRate?: number
    ): void {
        const animKey = this.getAnimationKey(state);

        if (!this.animConfigs[state] && !this.scene.anims.exists(animKey)) {
            console.warn(`[PhaserSpriteAnimator ${this.statePrefix}] Animation key "${animKey}" for state "${state}" not defined or loaded. Cannot play.`);
            if (state !== 'idle') {
                this.setToIdle(); // Attempt fallback to idle
            }
            return;
        }

        // Prevent flickering or unnecessary restarts if the same animation is already playing
        const currentAnimKey = this.sprite.anims.currentAnim?.key;
        if (!forceRestart && ignoreIfPlaying && currentAnimKey === animKey) {
            if (frameRate !== undefined && this.sprite.anims.currentAnim && this.sprite.anims.currentAnim.frameRate !== frameRate) {
                console.warn(`[PhaserSpriteAnimator ${this.statePrefix}] Frame rate needs update for ${animKey}. Re-playing.`);
            } else {
                 return; // Already playing the requested animation with correct rate (or no rate override)
            }
        }

        try {
            if (frameRate !== undefined) {
                 this.sprite.play({ key: animKey, frameRate: frameRate }, ignoreIfPlaying);
             } else {
                 this.sprite.play(animKey, ignoreIfPlaying);
             }
        } catch (error) {
            console.error(`[PhaserSpriteAnimator ${this.statePrefix}] Error playing animation '${animKey}':`, error);
        }
    }

    /**
     * Stops the current animation and sets the sprite to the first frame of the 'idle' state animation.
     */
    setToIdle(): void {
        const idleAnimKey = this.getAnimationKey('idle');
        if (this.animConfigs.idle || this.scene.anims.exists(idleAnimKey)) {
             try {
                  this.sprite.play(idleAnimKey, true); // Play idle (usually loops), ignore if already playing
             } catch (error) {
                 console.error(`[PhaserSpriteAnimator ${this.statePrefix}] Error playing idle animation '${idleAnimKey}':`, error);
                 this.fallbackToIdleTexture(); // Attempt texture fallback on error
             }
        } else {
            console.warn(`[PhaserSpriteAnimator ${this.statePrefix}] Idle animation key "${idleAnimKey}" not defined. Attempting texture fallback.`);
            this.fallbackToIdleTexture();
        }
    }

    /** Attempts to set the sprite's texture to the idle texture and stop animation */
    private fallbackToIdleTexture(): void {
         if (this.textureKeys.idle && this.scene.textures.exists(this.textureKeys.idle)) {
            this.sprite.anims.stop(); // Stop any current animation first
            this.sprite.setTexture(this.textureKeys.idle);
            // Optionally set frame 0 if the texture is a spritesheet
            // this.sprite.setFrame(0);
        } else {
            console.error(`[PhaserSpriteAnimator ${this.statePrefix}] Fallback failed: Idle texture key "${this.textureKeys.idle}" not found.`);
            this.sprite.anims.stop(); // Stop animation at least
        }
    }


    /**
     * Stops the current animation and optionally sets the sprite to a specific frame.
     */
    stopAnimation(frameIndex?: number): void {
        this.sprite.anims.stop();
        if (frameIndex !== undefined) {
            // Be careful setting frame if the texture might not match the index
             try {
                 this.sprite.setFrame(frameIndex);
             } catch (error) {
                 console.warn(`[PhaserSpriteAnimator ${this.statePrefix}] Error setting frame ${frameIndex}:`, error);
             }
        }
    }

    /**
     * Cleans up resources (stops animation). Call when the sprite is destroyed.
     */
    destroy(): void {
        console.log(`[PhaserSpriteAnimator ${this.statePrefix}] Destroying...`);
        this.stopAnimation();
        // Animations are global to the scene, usually no need to remove them here
    }

    /** Gets the key of the currently playing animation, if any */
    getCurrentAnimationKey(): string | null {
        return this.sprite.anims.currentAnim?.key ?? null;
    }
}