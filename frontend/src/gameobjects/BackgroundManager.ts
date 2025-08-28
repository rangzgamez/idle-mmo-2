// frontend/src/gameobjects/BackgroundManager.ts
import * as Phaser from 'phaser';

interface StaticElement {
    x: number;
    y: number;
    type: 'tree' | 'rock' | 'water' | 'grass' | 'dirt';
    size: number;
    color: number;
}

export class BackgroundManager {
    private scene: Phaser.Scene;
    private staticElements: Phaser.GameObjects.Graphics[] = [];
    private worldWidth: number;
    private worldHeight: number;
    private isInitialized: boolean = false;

    constructor(scene: Phaser.Scene, worldWidth: number, worldHeight: number) {
        this.scene = scene;
        this.worldWidth = worldWidth;
        this.worldHeight = worldHeight;
    }

    public async initialize(progressCallback?: (progress: number, message: string) => void): Promise<void> {
        if (this.isInitialized) return;
        
        progressCallback?.(0.2, 'Creating reference points...');
        
        // Create simple static elements around spawn area (center of world)
        this.createStaticElements();
        
        progressCallback?.(1.0, 'Reference points ready!');
        this.isInitialized = true;
    }

    private createStaticElements(): void {
        const centerX = this.worldWidth / 2;
        const centerY = this.worldHeight / 2;
        const spawnRadius = 300; // Elements within 300px of spawn
        
        // Define static element positions and types
        const staticElements: StaticElement[] = [
            // Trees (green circles)
            { x: centerX + 120, y: centerY - 80, type: 'tree', size: 25, color: 0x228B22 },
            { x: centerX - 150, y: centerY + 60, type: 'tree', size: 30, color: 0x32CD32 },
            { x: centerX + 200, y: centerY + 150, type: 'tree', size: 20, color: 0x006400 },
            { x: centerX - 80, y: centerY - 180, type: 'tree', size: 28, color: 0x228B22 },
            
            // Rocks (gray shapes)  
            { x: centerX + 80, y: centerY + 100, type: 'rock', size: 15, color: 0x696969 },
            { x: centerX - 200, y: centerY - 50, type: 'rock', size: 20, color: 0x708090 },
            { x: centerX + 180, y: centerY - 120, type: 'rock', size: 18, color: 0x2F4F4F },
            
            // Water (blue rectangles)
            { x: centerX - 100, y: centerY + 200, type: 'water', size: 60, color: 0x4169E1 },
            { x: centerX + 250, y: centerY - 200, type: 'water', size: 50, color: 0x1E90FF },
            
            // Grass patches (light green)
            { x: centerX + 50, y: centerY - 200, type: 'grass', size: 35, color: 0x90EE90 },
            { x: centerX - 120, y: centerY + 120, type: 'grass', size: 40, color: 0x98FB98 },
            { x: centerX + 150, y: centerY + 50, type: 'grass', size: 30, color: 0x32CD32 },
            
            // Dirt paths (brown rectangles)
            { x: centerX - 60, y: centerY - 100, type: 'dirt', size: 45, color: 0xD2B48C },
            { x: centerX + 100, y: centerY + 180, type: 'dirt', size: 40, color: 0xCD853F },
            { x: centerX - 180, y: centerY + 20, type: 'dirt', size: 50, color: 0xA0522D }
        ];
        
        // Create graphics objects for each element
        staticElements.forEach((element, index) => {
            const graphics = this.scene.add.graphics();
            graphics.fillStyle(element.color);
            
            switch (element.type) {
                case 'tree':
                    // Draw as circle
                    graphics.fillCircle(element.x, element.y, element.size);
                    break;
                case 'rock':
                    // Draw as irregular triangle
                    graphics.fillTriangle(
                        element.x - element.size, element.y + element.size,
                        element.x + element.size, element.y + element.size,
                        element.x, element.y - element.size
                    );
                    break;
                case 'water':
                    // Draw as rounded rectangle
                    graphics.fillRoundedRect(
                        element.x - element.size/2, 
                        element.y - element.size*0.3, 
                        element.size, 
                        element.size*0.6, 
                        10
                    );
                    break;
                case 'grass':
                    // Draw as circle
                    graphics.fillCircle(element.x, element.y, element.size);
                    break;
                case 'dirt':
                    // Draw as rounded rectangle
                    graphics.fillRoundedRect(
                        element.x - element.size/2, 
                        element.y - element.size*0.4, 
                        element.size, 
                        element.size*0.8, 
                        8
                    );
                    break;
            }
            
            graphics.setDepth(-10); // Behind all game objects
            this.staticElements.push(graphics);
        });
        
        console.log(`Created ${staticElements.length} static reference elements`);
    }

    public update(cameraX: number, cameraY: number, cameraWidth: number, cameraHeight: number): void {
        // Static elements don't need updates - they stay in place
    }

    public destroy(): void {
        // Clean up static elements
        this.staticElements.forEach(graphics => graphics.destroy());
        this.staticElements = [];
        this.isInitialized = false;
    }

    public getElementCount(): number {
        return this.staticElements.length;
    }

    public isReady(): boolean {
        return this.isInitialized;
    }
}