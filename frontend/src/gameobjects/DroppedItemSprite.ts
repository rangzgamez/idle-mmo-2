import Phaser from 'phaser';
import { ItemType } from '../../../backend/src/item/item.types'; // Adjust path as needed

// Interface matching the payload from the backend 'itemsDropped' event
// We might receive this directly or reconstruct it client-side
export interface DroppedItemData {
    id: string; // Unique instance ID
    itemTemplateId: string;
    itemName: string;
    itemType: ItemType;
    spriteKey: string;
    position: { x: number; y: number };
    quantity: number;
}

export class DroppedItemSprite extends Phaser.GameObjects.Sprite {
    instanceId: string;
    itemData: DroppedItemData;
    itemLabel: Phaser.GameObjects.Text | null = null;
    tooltipBox: Phaser.GameObjects.Graphics | null = null;

    constructor(scene: Phaser.Scene, data: DroppedItemData) {
        super(scene, data.position.x, data.position.y, data.spriteKey);
        this.instanceId = data.id;
        this.itemData = data;

        scene.add.existing(this);
        this.setInteractive(); // Make it clickable
        // Optional: Scale down item sprites slightly?
        // this.setScale(0.8);

        // --- Tooltip on Hover --- 
        this.on('pointerover', () => {
            this.showTooltip();
        });
        this.on('pointerout', () => {
            this.hideTooltip();
        });

         // --- Click Handler (will be handled in GameScene) ---
        // this.on('pointerdown', () => {
        //     // Scene needs to handle sending the pickup command
        //     console.log(`Clicked item: ${this.itemData.itemName} (${this.instanceId})`);
        //     this.scene.events.emit('droppedItemClicked', this.instanceId);
        // });

    }

    showTooltip() {
        this.hideTooltip(); // Clear previous tooltip elements

        const text = `${this.itemData.itemName}${this.itemData.quantity > 1 ? ` (x${this.itemData.quantity})` : ''}`;
        this.itemLabel = this.scene.add.text(0, 0, text, {
            fontSize: '12px',
            color: '#ffffff',
            backgroundColor: '#000000aa',
            padding: { x: 5, y: 3 },
            fixedWidth: 0, // Auto width
        });
        this.itemLabel.setOrigin(0.5, 1); // Position above the sprite
        this.itemLabel.setPosition(this.x, this.y - this.displayHeight / 2 - 5);
        this.itemLabel.setDepth(100); // Ensure tooltip is on top
    }

    hideTooltip() {
        if (this.itemLabel) {
            this.itemLabel.destroy();
            this.itemLabel = null;
        }
    }

    // Override destroy to clean up tooltip
    destroy(fromScene?: boolean) {
        this.hideTooltip();
        super.destroy(fromScene);
    }

    // Pre-update logic if needed (e.g., animations)
    // preUpdate(time: number, delta: number) {
    //     super.preUpdate(time, delta);
    // }
} 