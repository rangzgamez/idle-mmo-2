// frontend/src/gameobjects/CharacterSprite.ts
import Phaser from 'phaser';
import { HealthBar } from './HealthBar'; // Import HealthBar

// Add the interface definition if you don't have it shared elsewhere
interface ZoneCharacterState {
    id: string;
    ownerId: string;
    ownerName: string;
    name: string;
    level: number;
    x: number | null;
    y: number | null;
    baseHealth: number;
}

export class CharacterSprite extends Phaser.GameObjects.Sprite {
    characterId: string;
    ownerId: string; // ID of the controlling player
    isPlayerCharacter: boolean; // Is this one of the client's own characters?
    // --- Interpolation properties ---
    targetX: number;
    targetY: number;
    lerpSpeed: number = 0.2; // Adjust for smoother/snappier movement (0 to 1)
    // ------------------------------
    // --- Chat Bubble Properties ---
    private activeBubbles: Phaser.GameObjects.Text[] = [];
    private healthBar: HealthBar; // Add health bar property

    private readonly BUBBLE_MAX_WIDTH = 150; // Max width before wrapping
    private readonly BUBBLE_OFFSET_Y = 20;  // Initial offset above sprite center/top
    private readonly BUBBLE_SPACING_Y = 18; // Vertical space between stacked bubbles (adjust based on font size)
    private readonly BUBBLE_FADE_DURATION = 4000; // 5 seconds
    private readonly BUBBLE_FONT_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
        fontFamily: 'Arial',
        fontSize: '10px',
        color: '#ffffff', // Black text
        backgroundColor: '#000000', // White background
        padding: { x: 5, y: 3 },
        align: 'center',
        wordWrap: { width: this.BUBBLE_MAX_WIDTH }
    };
    private nameLabel: Phaser.GameObjects.Text;

    constructor(scene: Phaser.Scene, x: number, y: number, texture: string, data: ZoneCharacterState, isPlayer: boolean) {
        super(scene, x, y, texture);
        scene.add.existing(this); // Add sprite to the scene
        scene.physics.add.existing(this); // Add basic physics body

        this.characterId = data.id;
        this.ownerId = data.ownerId;
        this.isPlayerCharacter = isPlayer;
        this.targetX = x; // Initialize target position
        this.targetY = y;

        // Basic Name Label
        this.nameLabel = scene.add.text(x, y - this.height / 2 - 5, `${data.name} (${data.ownerName})`, {
            fontSize: '10px',
            color: isPlayer ? '#00ff00' : '#ffffff', // Green for own chars, white for others
            align: 'center',
        }).setOrigin(0.5);
        this.nameLabel.y = y - this.height / 2 - 15;
        // Could set tint, scale, etc. based on data
        if (!isPlayer) {
            this.setAlpha(0.8); // Make other players slightly transparent maybe
        }
        const maxHealth = data.baseHealth; // Get from data or default
        this.healthBar = new HealthBar(scene, this.x, this.y - 30, 40, 5, maxHealth); // Adjust position/size
        this.updateHealthBarPosition(); // Initial position
        this.setHealth(maxHealth); // Initialize health visually
        // -----------------
    }
    // --- New Method to Show a Bubble ---
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
        const baseBubbleY = this.y - this.height / 2 - this.BUBBLE_OFFSET_Y;
        // If creating a new bubble, numBubbles hasn't been incremented yet,
        // so the new bubble's index *will be* numBubbles.
        // Let's adjust the formula based on the provided index directly.
        // Example: 3 bubbles (indices 0, 1, 2). New index = 3.
        // Total bubbles after adding will be 4.
        // We want the bubble at index 'i' to be positioned correctly relative to others.

        // Let's use the formula derived in the thought process:
        // The bubble at index `i` has `(numBubbles - 1 - i)` bubbles below it (newer).
        // If index === numBubbles (the one being added), this becomes (numBubbles - 1 - numBubbles) = -1 ?? Problem.

        // Let's rethink. We add to the end. Index 0 is oldest/highest. Index N-1 is newest/lowest.
        // Newest bubble (index N-1) should be at baseBubbleY.
        // Bubble at index 'i' is (N - 1 - i) steps *above* the newest bubble.
        return baseBubbleY - ((this.activeBubbles.length - 1 - index) * this.BUBBLE_SPACING_Y);
    }
    // Method to update target position based on server updates
    updateTargetPosition(x: number, y: number) {
        this.targetX = x;
        this.targetY = y;
    }

    update(time: number, delta: number) {
        // Interpolate position (existing code)
        this.x = Phaser.Math.Linear(this.x, this.targetX, this.lerpSpeed);
        this.y = Phaser.Math.Linear(this.y, this.targetY, this.lerpSpeed);

        // Update name label position (adjust Y offset)
        this.nameLabel.x = this.x;
        this.nameLabel.y = this.y - this.height / 2 - 15; // Adjusted Y

        // --- Update positions of active chat bubbles ---
        this.activeBubbles.forEach((bubble, index) => {
            // Keep bubble horizontally centered on sprite
            bubble.x = this.x;
            bubble.y = this.calculateBubbleY(index); // Update Y using the helper            // Relative Y position is handled by initial placement and upward push
        });
        // ---------------------------------------------
        this.updateHealthBarPosition(); // Keep health bar position updated
    }
    setHealth(currentHealth: number, maxHealth?: number): void {
        this.healthBar.setHealth(currentHealth, maxHealth);
    }
    private updateHealthBarPosition(): void {
        this.healthBar.setPosition(this.x, this.y - 25); // Position below name label
    }

    // Override destroy to clean up label too
    destroy(fromScene?: boolean) {
        this.nameLabel.destroy();
        // Destroy health bar later
        // --- Destroy active bubbles and stop tweens ---
        this.activeBubbles.forEach(bubble => {
            const tween = bubble.getData('fadeTween') as Phaser.Tweens.Tween;
            tween?.stop(); // Stop tween if it exists
            bubble.destroy();
        });
        this.activeBubbles = []; // Clear array
        this.healthBar.destroy(); // Destroy health bar
        super.destroy(fromScene);
    }
}