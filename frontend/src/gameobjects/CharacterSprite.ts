// frontend/src/gameobjects/CharacterSprite.ts
import Phaser from 'phaser';

// Add the interface definition if you don't have it shared elsewhere
interface ZoneCharacterState {
    id: string;
    ownerId: string;
    ownerName: string;
    name: string;
    level: number;
    x: number | null;
    y: number | null;
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

    private nameLabel: Phaser.GameObjects.Text;
    private healthBar?: Phaser.GameObjects.Graphics; // Add later

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

        // Could set tint, scale, etc. based on data
        if (!isPlayer) {
            this.setAlpha(0.8); // Make other players slightly transparent maybe
        }
    }

    // Method to update target position based on server updates
    updateTargetPosition(x: number, y: number) {
        this.targetX = x;
        this.targetY = y;
    }

    // Called by the scene's update loop for interpolation
    update(time: number, delta: number) {
        // Interpolate position
        this.x = Phaser.Math.Linear(this.x, this.targetX, this.lerpSpeed);
        this.y = Phaser.Math.Linear(this.y, this.targetY, this.lerpSpeed);

        // Update label position
        this.nameLabel.x = this.x;
        this.nameLabel.y = this.y - this.height / 2 - 5;

        // Update health bar position later
    }

    // Override destroy to clean up label too
    destroy(fromScene?: boolean) {
        this.nameLabel.destroy();
        // Destroy health bar later
        super.destroy(fromScene);
    }
}