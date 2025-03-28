// frontend/src/scenes/PreloadScene.ts
import Phaser from 'phaser';

export default class PreloadScene extends Phaser.Scene {
    constructor() {
        super('PreloadScene');
    }

    preload() {
        console.log('PreloadScene preload');

        // Display a simple loading text
        const { width, height } = this.sys.game.config;
        const centerW = Number(width) / 2;
        const centerH = Number(height) / 2;

        this.add.text(centerW, centerH - 20, 'Loading...', { fontSize: '32px', color: '#fff' }).setOrigin(0.5);

        // Example: Load a placeholder image for login button later
        // this.load.image('loginButton', 'assets/ui/login_button.png');

        // Add listeners for progress and completion
        const progressBar = this.add.graphics();
        const progressBox = this.add.graphics();
        progressBox.fillStyle(0x222222, 0.8);
        progressBox.fillRect(centerW - 160, centerH, 320, 50);

        this.load.on('progress', (value: number) => {
            progressBar.clear();
            progressBar.fillStyle(0xffffff, 1);
            progressBar.fillRect(centerW - 150, centerH + 10, 300 * value, 30);
        });

        this.load.on('complete', () => {
            console.log('PreloadScene complete');
            progressBar.destroy();
            progressBox.destroy();
            // Assets are loaded, start the LoginScene
            this.scene.start('LoginScene');
        });

        // --- Load your actual game assets here ---
        // this.load.image('player', 'assets/sprites/player.png');
        // this.load.spritesheet('explosion', 'assets/sprites/explosion.png', { frameWidth: 64, frameHeight: 64 });
        // this.load.tilemapTiledJSON('map1', 'assets/tilemaps/level1.json');
        // ... etc
    }

    // create() is usually not needed here as 'complete' event handles transition
}