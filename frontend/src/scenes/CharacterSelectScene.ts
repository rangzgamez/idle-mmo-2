// frontend/src/scenes/CharacterSelectScene.ts
import Phaser from 'phaser';
import { NetworkManager } from '../network/NetworkManager';
import { EventBus } from '../EventBus';

// Define an interface for the character data we expect from the backend
interface CharacterData {
    id: string;
    name: string;
    level: number;
    // Add other relevant fields later (e.g., class, appearance)
}

export default class CharacterSelectScene extends Phaser.Scene {
    private characters: CharacterData[] = [];
    private selectedCharacterIds: Set<string> = new Set();
    private readonly MAX_SELECTED_CHARACTERS = 3;

    // UI Elements
    private characterListText: Phaser.GameObjects.Text[] = [];
    private newCharacterInput!: Phaser.GameObjects.DOMElement;
    private createButton!: Phaser.GameObjects.DOMElement;
    private enterGameButton!: Phaser.GameObjects.DOMElement;
    private statusText!: Phaser.GameObjects.Text;

    constructor() {
        super('CharacterSelectScene');
    }

    create() {
        console.log('CharacterSelectScene create');
        this.cameras.main.setBackgroundColor('#3d3d3d'); // Slightly lighter background

        const { width, height }: { width: any, height: any } = this.sys.game.config;
        const centerW = Number(width) / 2;
        // const centerH = Number(height) / 2;

        this.add.text(centerW, 50, 'Select Your Party (Up to 3)', { fontSize: '28px', color: '#fff' }).setOrigin(0.5);

        // Status Text
        this.statusText = this.add.text(centerW, height - 30, '', { fontSize: '16px', color: '#ff0000', align: 'center' })
            .setOrigin(0.5);

        // --- Character Creation UI ---
        this.newCharacterInput = this.add.dom(centerW - 150, height - 100).createFromHTML(`
            <input type="text" name="charName" placeholder="New Character Name" style="width: 200px; padding: 10px; font-size: 14px;">
        `);
        this.createButton = this.add.dom(centerW + 100, height - 100).createFromHTML(`
            <button name="create" style="width: 120px; padding: 10px; font-size: 14px;">Create</button>
        `);

        this.createButton.addListener('click');
        this.createButton.on('click', () => {
            this.handleCreateCharacter();
        });

        // --- Enter Game Button ---
        this.enterGameButton = this.add.dom(centerW, height - 60).createFromHTML(`
            <button name="enter" style="width: 332px; padding: 10px; font-size: 16px; background-color: #4CAF50; color: white;">Enter Game</button>
        `);
        this.enterGameButton.addListener('click');
        this.enterGameButton.on('click', () => {
            this.handleEnterGame();
        });
        // Initially disable Enter Game button until characters are selected
        this.toggleEnterGameButton(false);


        // --- Fetch and Display Characters ---
        this.fetchCharacters();
    }

    setStatus(message: string, isError: boolean = false) {
        this.statusText.setText(message);
        this.statusText.setColor(isError ? '#ff0000' : '#ffffff');
    }

    async fetchCharacters() {
        this.setStatus('Loading characters...', false);
        const token = localStorage.getItem('jwtToken');
        if (!token) {
            this.setStatus('Authentication error. Please log in again.', true);
            // Optionally redirect to login scene after a delay
            this.time.delayedCall(2000, () => this.scene.start('LoginScene'));
            return;
        }

        try {
            const response = await fetch('http://localhost:3000/characters', {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${token}`,
                },
            });

            if (!response.ok) {
                 const errorData = await response.json();
                throw new Error(errorData.message || `Failed to fetch characters (${response.status})`);
            }

            this.characters = await response.json() as CharacterData[];
            this.displayCharacters();
            this.setStatus(''); // Clear status on success

        } catch (error: any) {
            console.error('Fetch Characters Error:', error);
            this.setStatus(error.message || 'Failed to load characters.', true);
             if (error.message.includes('401') || error.message.includes('Unauthorized')) {
                 // Token might be invalid/expired
                 localStorage.removeItem('jwtToken');
                 this.time.delayedCall(2000, () => this.scene.start('LoginScene'));
             }
        }
    }

    displayCharacters() {
        // Clear previous list if any
        this.characterListText.forEach(text => text.destroy());
        this.characterListText = [];

        const startY = 100;
        const spacing = 40;

        if (this.characters.length === 0) {
             this.add.text(Number(this.sys.game.config.width) / 2, startY + 50, 'No characters found. Create one below!', { fontSize: '18px', color: '#ccc' }).setOrigin(0.5);
             return; // No need to proceed further
        }

        this.characters.forEach((char, index) => {
            const charText = this.add.text(
                Number(this.sys.game.config.width) / 2,
                startY + index * spacing,
                `Lv ${char.level} - ${char.name}`,
                { fontSize: '20px', color: '#fff' }
            ).setOrigin(0.5).setInteractive(); // Make text clickable

            charText.on('pointerdown', () => {
                this.toggleCharacterSelection(char.id, charText);
            });

            // Set initial appearance based on selection state
            this.updateCharacterTextApperance(char.id, charText);

            this.characterListText.push(charText);
        });
    }

    toggleCharacterSelection(id: string, textObject: Phaser.GameObjects.Text) {
        if (this.selectedCharacterIds.has(id)) {
            this.selectedCharacterIds.delete(id);
        } else {
            if (this.selectedCharacterIds.size < this.MAX_SELECTED_CHARACTERS) {
                this.selectedCharacterIds.add(id);
            } else {
                this.setStatus(`You can only select up to ${this.MAX_SELECTED_CHARACTERS} characters.`, true);
                // Optional: Flash the text or give other feedback
                this.time.delayedCall(1500, () => this.setStatus('')); // Clear message after delay
                return; // Do not add if limit reached
            }
        }

        // Update visual appearance of the clicked text
        this.updateCharacterTextApperance(id, textObject);

        // Update all text objects' appearance (in case selection changes indirectly)
        this.characterListText.forEach((txt, index) => {
            if (this.characters[index]) { // Ensure character exists for this text
                 this.updateCharacterTextApperance(this.characters[index].id, txt);
            }
        });

        // Enable/disable Enter Game button based on selection count
        this.toggleEnterGameButton(this.selectedCharacterIds.size > 0);
    }

    updateCharacterTextApperance(id: string, textObject: Phaser.GameObjects.Text) {
         if (this.selectedCharacterIds.has(id)) {
            textObject.setColor('#00ff00'); // Green for selected
            textObject.setFontStyle('bold');
        } else {
            textObject.setColor('#ffffff'); // White for not selected
            textObject.setFontStyle('normal');
        }
    }


    toggleEnterGameButton(enabled: boolean) {
        const buttonElement = (this.enterGameButton.node as HTMLElement).querySelector('button');
        if (buttonElement) {
            buttonElement.disabled = !enabled;
            buttonElement.style.backgroundColor = enabled ? '#4CAF50' : '#888'; // Green when enabled, grey when disabled
            buttonElement.style.cursor = enabled ? 'pointer' : 'not-allowed';
        }
    }

    async handleCreateCharacter() {
        const inputContainer = this.newCharacterInput.node as HTMLElement;
        const inputElement = inputContainer.querySelector('input[name="charName"]') as HTMLInputElement | null;

        if (!inputElement) {
            console.error('Cannot find character name input element.');
            this.setStatus('Internal error creating character.', true);
            return;
        }

        const name = inputElement.value.trim();
        if (!name) {
            this.setStatus('Please enter a name for the new character.', true);
            return;
        }
        if (name.length < 3 || name.length > 50) {
             this.setStatus('Character name must be between 3 and 50 characters.', true);
             return;
         }

        this.setStatus('Creating character...', false);
        // Disable create button during request
        const createBtnElement = (this.createButton.node as HTMLElement).querySelector('button');
        if(createBtnElement) createBtnElement.disabled = true;


        const token = localStorage.getItem('jwtToken');
        if (!token) {
            this.setStatus('Authentication error. Please log in again.', true);
             if(createBtnElement) createBtnElement.disabled = false; // Re-enable button
            this.time.delayedCall(2000, () => this.scene.start('LoginScene'));
            return;
        }

        try {
            const response = await fetch('http://localhost:3000/characters', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ name }),
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.message || `Failed to create character (${response.status})`);
            }

            // Creation successful
            this.setStatus(`Character '${name}' created!`, false);
            inputElement.value = ''; // Clear input field
            this.fetchCharacters(); // Refresh the character list

        } catch (error: any) {
            console.error('Create Character Error:', error);
            this.setStatus(error.message || 'Failed to create character.', true);
        } finally {
             // Re-enable create button
             if(createBtnElement) createBtnElement.disabled = false;
        }
    }

    handleEnterGame() {
        if (this.selectedCharacterIds.size === 0) {
            this.setStatus('Please select at least one character.', true);
            return;
        }

        const selectedIds = Array.from(this.selectedCharacterIds);
        console.log('Selected Character IDs:', selectedIds);
        this.setStatus('Selecting party...', false);

        // Send selection to server via WebSocket
        const networkManager = NetworkManager.getInstance();
        if (!networkManager.isConnected()) {
            this.setStatus('Not connected to server. Please try again or login.', true);
            // Optionally try to reconnect or go to login
            return;
        }

        networkManager.sendMessage('selectParty', { characterIds: selectedIds }, (response: {success: boolean, characters: any[]}) => {
            // This callback executes when the server acknowledges the message
            if (response && response.success) {
                console.log('Server confirmed party selection:', response.characters);
                 this.setStatus(''); // Clear status
                 // Transition to GameScene, passing selected character data (optional, GameScene can also rely on server state)
                 this.scene.start('GameScene', { selectedParty: response.characters });
            } else {
                 console.error('Server failed to select party:', response);
                 this.setStatus('Server error selecting party. Please try again.', true);
                 // Keep the user on this scene
            }
        });
    }
}