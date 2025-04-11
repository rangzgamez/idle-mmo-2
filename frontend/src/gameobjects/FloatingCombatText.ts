import Phaser from 'phaser';

// Define common styles
const TEXT_STYLES = {
    damage: { fontFamily: 'Arial', fontSize: '14px', color: '#ff0000', stroke: '#000000', strokeThickness: 3 }, // Red for damage
    heal: { fontFamily: 'Arial', fontSize: '14px', color: '#00ff00', stroke: '#000000', strokeThickness: 3 },   // Green for healing
    level: { fontFamily: 'Arial', fontSize: '16px', color: '#ffff00', stroke: '#000000', strokeThickness: 4 },  // Yellow for level up
    default: { fontFamily: 'Arial', fontSize: '12px', color: '#ffffff', stroke: '#000000', strokeThickness: 3 } // White default
};

export default class FloatingCombatText extends Phaser.GameObjects.Text {
    constructor(
        scene: Phaser.Scene,
        x: number,
        y: number,
        text: string,
        type: 'damage' | 'heal' | 'level' | 'default' = 'default',
        duration: number = 1000,
        floatHeight: number = 30
    ) {
        // Determine style based on type
        const style = TEXT_STYLES[type] || TEXT_STYLES.default;
        super(scene, x, y, text, style);

        this.setOrigin(0.5, 1); // Anchor bottom-center
        this.setDepth(100); // Ensure it's on top
        scene.add.existing(this);

        // Create the tween animation
        scene.tweens.add({
            targets: this,
            y: y - floatHeight, // Float up
            alpha: { from: 1, to: 0 }, // Fade out
            duration: duration,
            ease: 'Quad.easeOut', // Smooth easing
            onComplete: () => {
                this.destroy(); // Remove the text object once the tween completes
            }
        });
    }
}

// Add this class to the Phaser GameObject Factory (optional but convenient)
Phaser.GameObjects.GameObjectFactory.register(
    'floatingCombatText',
    function (
        this: Phaser.GameObjects.GameObjectFactory,
        x: number,
        y: number,
        text: string,
        type?: 'damage' | 'heal' | 'level' | 'default',
        duration?: number,
        floatHeight?: number
    )
    {
        const combatText = new FloatingCombatText(this.scene, x, y, text, type, duration, floatHeight);
        this.displayList.add(combatText);
        // Note: We don't add to updateList as the tween handles its lifecycle
        return combatText;
    }
);

// Add type declaration for the new factory method (important for TypeScript)
declare global {
    namespace Phaser.GameObjects {
        interface GameObjectFactory {
            floatingCombatText(
                x: number,
                y: number,
                text: string,
                type?: 'damage' | 'heal' | 'level' | 'default',
                duration?: number,
                floatHeight?: number
            ): FloatingCombatText;
        }
    }
} 