// frontend/src/scenes/LoadScene.ts
import Phaser from 'phaser';
import { NetworkManager } from '../network/NetworkManager';
import { BackgroundManager } from '../gameobjects/BackgroundManager';
import { LoadingScreen } from '../gameobjects/LoadingScreen';
import { EventBus } from '../EventBus';

interface EnemySpawnData {
    id: string;
    templateId: string;
    zoneId: string;
    name: string;
    currentHealth: number;
    baseHealth?: number;
    position: { x: number; y: number };
}

export default class LoadScene extends Phaser.Scene {
    private networkManager!: NetworkManager;
    private selectedPartyData: any[] = [];
    private loadingScreen: LoadingScreen | null = null;
    private backgroundManager: BackgroundManager | null = null;
    private worldWidth = 4000;
    private worldHeight = 4000;

    constructor() {
        super('LoadScene');
    }

    init(data: { selectedParty?: any[] }) {
        this.selectedPartyData = data?.selectedParty || [];
        this.networkManager = NetworkManager.getInstance();
    }

    create() {
        // Set black background
        this.cameras.main.setBackgroundColor('#000000');

        // Check network connection
        if (!this.networkManager.isConnected()) {
            this.handleDisconnectError('Connection lost. Please log in again.');
            return;
        }

        // Create loading screen
        this.loadingScreen = new LoadingScreen(this);
        this.loadingScreen.show('Connecting to world...');

        // Start the loading process
        this.startWorldGeneration();
    }

    private async startWorldGeneration(): Promise<void> {
        try {
            // Step 1: Generate background first (offline)
            this.loadingScreen?.updateProgress(0.1, 'Generating world background...');
            
            this.backgroundManager = new BackgroundManager(this, this.worldWidth, this.worldHeight);
            
            await this.backgroundManager.initialize((progress, message) => {
                // Map background progress to 0.1 - 0.7 range
                const loadProgress = 0.1 + (progress * 0.6);
                this.loadingScreen?.updateProgress(loadProgress, message);
            });

            // Step 2: Enter zone and get initial data (this starts the game)
            this.loadingScreen?.updateProgress(0.8, 'Connecting to game world...');
            
            const zoneData = await this.enterZone();
            
            // Step 3: Prepare to transition
            this.loadingScreen?.updateProgress(0.9, 'Finalizing world...');
            
            // Brief pause to show completion
            await new Promise(resolve => setTimeout(resolve, 300));
            
            this.loadingScreen?.updateProgress(1.0, 'World ready!');
            
            // Step 4: Transition to GameScene with all data
            await new Promise(resolve => setTimeout(resolve, 300));
            
            this.transitionToGameScene(zoneData);

        } catch (error) {
            console.error('Failed to load world:', error);
            this.loadingScreen?.updateProgress(1.0, 'Failed to load world');
            
            // Show error for 2 seconds then go back to character select
            this.time.delayedCall(2000, () => {
                this.scene.start('CharacterSelectScene');
            });
        }
    }

    private async enterZone(): Promise<any> {
        return new Promise((resolve, reject) => {
            const zoneId = 'startZone';
            
            this.networkManager.sendMessage('enterZone', { zoneId }, (response: { 
                success: boolean; 
                zoneState?: any[]; 
                enemyState?: EnemySpawnData[]; 
                message?: string 
            }) => {
                if (response && response.success) {
                    resolve({
                        zoneState: response.zoneState || [],
                        enemyState: response.enemyState || []
                    });
                } else {
                    reject(new Error(`Failed to enter zone: ${response?.message}`));
                }
            });
        });
    }

    private transitionToGameScene(zoneData: any): void {
        // Transfer the pre-generated background to GameScene
        const backgroundData = {
            backgroundManager: this.backgroundManager,
            worldWidth: this.worldWidth,
            worldHeight: this.worldHeight
        };

        // Start GameScene with all necessary data
        this.scene.start('GameScene', {
            selectedParty: this.selectedPartyData,
            zoneState: zoneData.zoneState,
            enemyState: zoneData.enemyState,
            backgroundData: backgroundData
        });
    }

    private handleDisconnectError(message: string): void {
        console.error('LoadScene Error:', message);
        EventBus.emit('show-error', message);
        this.scene.start('LoginScene');
    }

    shutdown() {
        if (this.loadingScreen) {
            this.loadingScreen.hide();
            this.loadingScreen = null;
        }
        
        // Don't destroy backgroundManager here - it will be transferred to GameScene
    }
}