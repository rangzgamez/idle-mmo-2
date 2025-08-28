// frontend/src/gameobjects/LoadingScreen.ts
import * as Phaser from 'phaser';

export class LoadingScreen {
    private scene: Phaser.Scene;
    private container: Phaser.GameObjects.Container | null = null;
    private backgroundOverlay: Phaser.GameObjects.Rectangle | null = null;
    private loadingText: Phaser.GameObjects.Text | null = null;
    private progressBar: Phaser.GameObjects.Graphics | null = null;
    private progressBarBg: Phaser.GameObjects.Graphics | null = null;
    private spinner: Phaser.GameObjects.Graphics | null = null;
    private spinnerTween: Phaser.Tweens.Tween | null = null;

    constructor(scene: Phaser.Scene) {
        this.scene = scene;
    }

    public show(message: string = 'Loading...'): void {
        if (this.container) {
            this.hide(); // Clean up existing loading screen
        }

        const camera = this.scene.cameras.main;
        const centerX = camera.width / 2;
        const centerY = camera.height / 2;

        // Create container for all loading elements
        this.container = this.scene.add.container(centerX, centerY);
        this.container.setDepth(1000); // Very high depth to be above everything
        this.container.setScrollFactor(0); // Don't scroll with camera

        // Solid black background overlay that covers entire screen
        this.backgroundOverlay = this.scene.add.rectangle(0, 0, camera.width * 2, camera.height * 2, 0x000000, 1.0);
        this.container.add(this.backgroundOverlay);

        // Loading text
        this.loadingText = this.scene.add.text(0, -50, message, {
            fontSize: '24px',
            color: '#ffffff',
            fontFamily: 'Arial',
            align: 'center'
        });
        this.loadingText.setOrigin(0.5);
        this.container.add(this.loadingText);

        // Progress bar background
        this.progressBarBg = this.scene.add.graphics();
        this.progressBarBg.fillStyle(0x333333);
        this.progressBarBg.fillRoundedRect(-150, 10, 300, 20, 10);
        this.container.add(this.progressBarBg);

        // Progress bar
        this.progressBar = this.scene.add.graphics();
        this.container.add(this.progressBar);

        // Spinning loading indicator
        this.spinner = this.scene.add.graphics();
        this.drawSpinner();
        this.container.add(this.spinner);

        // Animate spinner
        this.spinnerTween = this.scene.tweens.add({
            targets: this.spinner,
            rotation: Math.PI * 2,
            duration: 1000,
            repeat: -1,
            ease: 'Linear'
        });

        this.updateProgress(0);
    }

    public updateProgress(progress: number, message?: string): void {
        if (!this.container || !this.progressBar) return;

        // Update progress bar
        this.progressBar.clear();
        this.progressBar.fillStyle(0x00ff00);
        const barWidth = Math.floor(280 * Math.max(0, Math.min(1, progress)));
        this.progressBar.fillRoundedRect(-140, 15, barWidth, 10, 5);

        // Update text if provided
        if (message && this.loadingText) {
            this.loadingText.setText(message);
        }
    }

    public hide(): void {
        if (this.spinnerTween) {
            this.spinnerTween.stop();
            this.spinnerTween = null;
        }

        if (this.container) {
            this.container.destroy();
            this.container = null;
        }

        this.backgroundOverlay = null;
        this.loadingText = null;
        this.progressBar = null;
        this.progressBarBg = null;
        this.spinner = null;
    }

    private drawSpinner(): void {
        if (!this.spinner) return;

        this.spinner.clear();
        
        // Draw spinning dots
        const radius = 25;
        const dotCount = 8;
        
        for (let i = 0; i < dotCount; i++) {
            const angle = (i / dotCount) * Math.PI * 2;
            const x = Math.cos(angle) * radius;
            const y = Math.sin(angle) * radius;
            
            // Fade alpha based on position for spinning effect
            const alpha = 0.3 + (0.7 * (i / dotCount));
            
            this.spinner.fillStyle(0xffffff, alpha);
            this.spinner.fillCircle(x, y + 60, 4);
        }
    }

    public isVisible(): boolean {
        return this.container !== null;
    }
}