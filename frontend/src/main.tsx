// frontend/src/main.tsx
import Phaser from 'phaser';
import BootScene from './scenes/BootScene';
import PreloadScene from './scenes/PreloadScene';
import LoginScene from './scenes/LoginScene';
import CharacterSelectScene from './scenes/CharacterSelectScene';
import LoadScene from './scenes/LoadScene';
import GameScene from './scenes/GameScene';
import UIScene from './scenes/UIScene';

// Define the Phaser game configuration
const config: Phaser.Types.Core.GameConfig = {
    type: Phaser.AUTO, // Use WebGL if available, otherwise Canvas
    width: 1024,       // Set your desired game width
    height: 768,      // Set your desired game height
    parent: 'game-container', // ID of the DOM element to attach the canvas to
    pixelArt: true,    // Recommended for crisp pixel art
    physics: {
        default: 'arcade', // Using Arcade physics initially
        arcade: {
            // gravity: { y: 0 }, // No gravity for top-down
            debug: false, // Show physics debug bodies in development
        },
    },
    // Define all the scenes in your game
    scene: [
        BootScene,
        PreloadScene,
        LoginScene,
        CharacterSelectScene,
        LoadScene,
        GameScene,
        UIScene,
        // Add other scenes here as you create them
    ],
    // Scale settings can be adjusted later for responsiveness
    scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    dom: {
        createContainer: true // Allows Phaser to create a container for DOM elements if needed
    },
};

// Instantiate the Phaser game
const game = new Phaser.Game(config);

// Make the game instance globally accessible if needed (optional)
// (window as any).game = game;

export default game; // Export if needed, but instantiation is the key part