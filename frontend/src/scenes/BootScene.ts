// frontend/src/scenes/BootScene.ts
import Phaser from 'phaser';

export default class BootScene extends Phaser.Scene {
    constructor() {
        super('BootScene');
    }

    preload() {
        // Load assets needed for the PreloadScene (e.g., loading bar graphics)
        // For now, we can keep it empty or load a simple image if desired
        console.log('BootScene preload');
    }

    create() {
        console.log('BootScene create');
        // Start the PreloadScene
        this.scene.start('PreloadScene');
    }
}