// frontend/src/gameobjects/EnemySprite.ts
import * as Phaser from 'phaser';
import { HealthBar } from './HealthBar'; // Import HealthBar
export class EnemySprite extends Phaser.GameObjects.Sprite {
    private targetX: number;
    private targetY: number;
    private nameLabel: Phaser.GameObjects.Text; // Example Label
    private spriteKey: string;
    private healthBar: HealthBar; // Add health bar property
    private isDying: boolean = false; // Track death animation state
    constructor(scene: Phaser.Scene, x: number, y: number, spriteKey:string, name: string, enemyData?:any) {
        super(scene, x, y, spriteKey); // Ensure spriteKey is passed correctly
        this.spriteKey = spriteKey
        this.scene.add.existing(this);
        scene.physics.add.existing(this);
        (this.body as Phaser.Physics.Arcade.Body).setCollideWorldBounds(true); // CORRECT LINE
        this.targetX = x;
        this.targetY = y;

        // Example Name Label
        this.nameLabel = scene.add.text(0, 0, name, {
            fontSize: '12px',
            color: '#ffffff',
            stroke: '#000000',
            strokeThickness: 3,
        });
        this.nameLabel.setOrigin(0.5); // Center the label
        this.updateNameLabelPosition(); //Initial position
        // TODO: Get max health from enemyData when backend provides it
        const maxHealth = enemyData?.baseHealth ?? 50; // Placeholder max health
        this.healthBar = new HealthBar(scene, this.x, this.y - 30, 40, 5, maxHealth);
        this.updateHealthBarPosition();
        this.setHealth(maxHealth); // Initialize health
        //Set enemy type metadata, so we know if it's enemy on attack click
        this.setData('type', 'enemy');

        this.setData("enemyData", enemyData);
    }

    update(time: number, delta: number): void {
        // Interpolate position
        this.x = Phaser.Math.Linear(this.x, this.targetX, 0.1);
        this.y = Phaser.Math.Linear(this.y, this.targetY, 0.1);
        
        // Only update UI elements if they still exist (not destroyed due to death)
        if (this.healthBar) {
            this.updateHealthBarPosition(); // Keep health bar position updated
        }
        if (this.nameLabel) {
            this.updateNameLabelPosition();
        }
    }
    setHealth(currentHealth: number, maxHealth?: number): void {
        if (this.healthBar) {
            this.healthBar.setHealth(currentHealth, maxHealth);
        }
    }

    private updateHealthBarPosition(): void {
        this.healthBar.setPosition(this.x, this.y - 25); // Position below name label
    }
    updateTargetPosition(x: number, y: number): void {
        this.targetX = x;
        this.targetY = y;
    }

    private updateNameLabelPosition(): void {
        // Position the label above the sprite (adjust offset as needed)
        this.nameLabel.x = this.x;
        this.nameLabel.y = this.y - 20;
    }

    // Death animation - visual effects only (backend handles movement)
    public startDeathAnimation(): void {
        if (this.isDying) return; // Prevent multiple calls
        
        this.isDying = true;
        
        // Make non-interactive immediately
        this.disableInteractive();
        this.removeAllListeners(); // Remove click/pointer events
        
        // Instant visual death effects (no tweening)
        this.scaleY = -1; // Flip upside down instantly
        this.setTint(0x333333); // Dim to ~20% brightness instantly
        
        // Immediately destroy health bar and name label
        if (this.healthBar) {
            this.healthBar.destroy();
            this.healthBar = null as any;
        }
        if (this.nameLabel) {
            this.nameLabel.destroy();
            this.nameLabel = null as any;
        }
    }
    
    // Check if enemy is in dying state
    public getIsDying(): boolean {
        return this.isDying;
    }

     destroy(fromScene?: boolean): void {
        if (this.healthBar) {
            this.healthBar.destroy(); // Destroy health bar
        }
        if (this.nameLabel) {
            this.nameLabel.destroy(); // Destroy attached components
        }
        return super.destroy(fromScene);
    }
}