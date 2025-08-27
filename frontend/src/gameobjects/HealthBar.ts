// frontend/src/gameobjects/HealthBar.ts
import * as Phaser from 'phaser';

export class HealthBar {
    private bar: Phaser.GameObjects.Graphics;
    private x: number;
    private y: number;
    private value: number;
    private maxValue: number;
    private width: number;
    private height: number;
    private scene: Phaser.Scene;

    constructor(scene: Phaser.Scene, x: number, y: number, width: number = 40, height: number = 5, maxValue: number = 100) {
        this.scene = scene;
        this.bar = new Phaser.GameObjects.Graphics(scene);
        this.x = x;
        this.y = y;
        this.width = width;
        this.height = height;
        this.maxValue = maxValue;
        this.value = maxValue; // Start at full health

        scene.add.existing(this.bar);
        this.bar.setDepth(100); // Render above all sprites
        this.draw();
    }

    setPosition(x: number, y: number): void {
        this.x = x;
        this.y = y;
        this.draw(); // Redraw at new position
    }

    decrease(amount: number): void {
        this.value -= amount;
        if (this.value < 0) {
            this.value = 0;
        }
        this.draw();
    }

     // Sets the health to a specific value and max value
     setHealth(currentHealth: number, maxHealth?: number): void {
        this.value = Phaser.Math.Clamp(currentHealth, 0, this.maxValue);
        if (maxHealth !== undefined) {
            this.maxValue = maxHealth;
            // Ensure current value doesn't exceed new max
            this.value = Phaser.Math.Clamp(this.value, 0, this.maxValue);
        }
        this.draw();
    }

    // --- NEW: Getter for max health ---
    getMaxHealth(): number {
        return this.maxValue;
    }
    // ---------------------------------

    private draw(): void {
        this.bar.clear();

        // Background
        this.bar.fillStyle(0x000000); // Black background
        this.bar.fillRect(this.x - this.width / 2, this.y - this.height / 2, this.width, this.height);

        // Health fill
        const percent = this.value / this.maxValue;
        const innerWidth = Math.floor(this.width * percent);

        if (percent < 0.3) {
            this.bar.fillStyle(0xff0000); // Red when low
        } else if (percent < 0.6) {
            this.bar.fillStyle(0xffff00); // Yellow when medium
        } else {
            this.bar.fillStyle(0x00ff00); // Green when high
        }

        if (innerWidth > 0) {
             this.bar.fillRect(this.x - this.width / 2, this.y - this.height / 2, innerWidth, this.height);
        }
    }

    setVisible(visible: boolean): void {
        this.bar.setVisible(visible);
    }

    destroy(): void {
        this.bar.destroy();
    }
}