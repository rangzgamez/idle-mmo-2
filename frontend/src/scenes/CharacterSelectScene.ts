// frontend/src/scenes/CharacterSelectScene.ts
import Phaser from 'phaser';
import { NetworkManager, CharacterClassTemplateData } from '../network/NetworkManager';
import { EventBus } from '../EventBus';

// Define an interface for the character data we expect from the backend
interface CharacterData {
    id: string;
    name: string;
    level: number;
    class: string;
    // Add other relevant fields later (e.g., class, appearance)
}

export default class CharacterSelectScene extends Phaser.Scene {
    private characters: CharacterData[] = [];
    private selectedCharacterIds: Set<string> = new Set();
    private readonly MAX_SELECTED_CHARACTERS = 3;
    private availableClasses: CharacterClassTemplateData[] = [];
    private selectedClassId: string | null = null;
    // --- Store active animation interval --- 
    private activeWalkAnimationIntervalId: NodeJS.Timeout | null = null;
    private activeWalkAnimationClassId: string | null = null;
    // -------------------------------------

    // UI Elements
    private characterListText: Phaser.GameObjects.Text[] = [];
    private enterGameButton!: Phaser.GameObjects.DOMElement;
    private statusText!: Phaser.GameObjects.Text;
    private showCreateModalButton!: Phaser.GameObjects.DOMElement;
    private createModalContainer!: Phaser.GameObjects.DOMElement;

    // --- Animation Constants (Adjust as needed) ---
    private readonly FRAME_WIDTH = 100;
    private readonly ATTACK_FRAME_COUNT = 4; // Example: 4 frames in attack sheet
    private readonly WALK_FRAME_COUNT = 4; // Example: 4 frames in walk sheet
    private readonly ANIM_INTERVAL_MS = 150; // Milliseconds per frame
    // -------------------------------------------

    constructor() {
        super('CharacterSelectScene');
    }

    create() {
        console.log('CharacterSelectScene create');
        this.cameras.main.setBackgroundColor('#3d3d3d');

        const { width, height }: { width: any, height: any } = this.sys.game.config;
        const centerW = Number(width) / 2;
        const bottomAreaY = height - 60; // Y position for bottom buttons

        this.add.text(centerW, 50, 'Select Your Party (Up to 3)', { fontSize: '28px', color: '#fff' }).setOrigin(0.5);

        // Status Text (moved slightly up)
        this.statusText = this.add.text(centerW, height - 30, '', { fontSize: '16px', color: '#ff0000', align: 'center' })
            .setOrigin(0.5);

        // --- Add "Create New Character" Button --- 
        this.showCreateModalButton = this.add.dom(centerW - 100, bottomAreaY).createFromHTML(`
            <button name="showCreate" style="width: 180px; padding: 10px; font-size: 14px;">Create New Character</button>
        `);
        this.showCreateModalButton.addListener('click');
        this.showCreateModalButton.on('click', () => {
            this.showCreateCharacterModal();
        });

        // --- Enter Game Button (moved slightly right) ---
        this.enterGameButton = this.add.dom(centerW + 100, bottomAreaY).createFromHTML(`
            <button name="enter" style="width: 180px; padding: 10px; font-size: 14px; background-color: #4CAF50; color: white;">Enter Game</button>
        `);
        this.enterGameButton.addListener('click');
        this.enterGameButton.on('click', () => {
            this.handleEnterGame();
        });
        this.toggleEnterGameButton(false);

        // --- Add Modal Container (Initially Hidden) ---
        this.createModalContainer = this.add.dom(centerW, height / 2).createFromHTML(`
            <div id="create-modal" style="
                display: none; /* Hidden by default */
                position: absolute;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                width: 500px;
                padding: 20px;
                background-color: #555;
                border: 2px solid #ccc;
                border-radius: 8px;
                z-index: 100; 
                color: white;
                box-shadow: 0 5px 15px rgba(0,0,0,0.3);
            ">
                <h3 style="text-align: center; margin-top: 0;">Create New Character</h3>
                
                <div style="margin-bottom: 15px;">
                    <label>Select Class:</label>
                    <div id="modal-class-select-container" style="display: flex; justify-content: space-around; align-items: stretch; margin-top: 10px; flex-wrap: wrap; gap: 10px;">
                        <!-- Class options will be loaded here -->
                    </div>
                </div>
                
                <div style="margin-bottom: 20px;">
                    <label for="modalCharName">Name:</label>
                    <input type="text" id="modalCharName" name="modalCharName" placeholder="Character Name" style="width: calc(100% - 22px); padding: 10px; font-size: 14px; margin-top: 5px;">
                </div>
                
                <div style="display: flex; justify-content: space-between;">
                    <button id="modal-cancel-button" style="padding: 10px 20px; font-size: 14px;">Cancel</button>
                    <button id="modal-create-button" style="padding: 10px 20px; font-size: 14px; background-color: #888; color: #ccc; cursor: not-allowed;" disabled>Create Character</button>
                </div>
            </div>
        `);

        // Add listeners for modal buttons later when modal is shown

        // --- Fetch Initial Data ---
        this.fetchCharacters();
        this.fetchAndDisplayClasses(); // Fetches classes, will populate modal later
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
            const response = await fetch('http://localhost:3000/characters', //'http://141.155.171.22:3000/auth/login', 
            {
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
        const centerW = Number(this.sys.game.config.width) / 2;

        if (this.characters.length === 0) {
             this.add.text(centerW, startY + 50, 'No characters found. Create one below!', { fontSize: '18px', color: '#ccc' }).setOrigin(0.5);
             return;
        }

        // Create a map for class ID to Name for easy lookup
        const classNameMap = new Map(this.availableClasses.map(c => [c.classId, c.name]));

        this.characters.forEach((char, index) => {
            // +++ Get class name, default to ID if not found +++
            const className = classNameMap.get(char.class) || char.class || 'Unknown'; 
            const charText = this.add.text(
                centerW,
                startY + index * spacing,
                // +++ Update display text +++
                `Lv ${char.level} ${className} - ${char.name}`,
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
        // This is now triggered by the MODAL's create button
        const modalElement = this.createModalContainer.node.querySelector('#create-modal') as HTMLElement;
        if (!modalElement) return; // Should not happen if button is clickable

        const inputElement = modalElement.querySelector('#modalCharName') as HTMLInputElement | null;
        
        // Class selection check remains
        if (!this.selectedClassId) {
            this.setStatus('Please select a class for the new character.', true);
            return;
        }

        // Input element check
        if (!inputElement) {
            console.error('Cannot find character name input element in modal.');
            this.setStatus('Internal error creating character.', true);
            return;
        }

        const name = inputElement.value.trim();
        // Name validation checks remain
        if (!name) {
            this.setStatus('Please enter a name for the new character.', true);
            return;
        }
        if (name.length < 3 || name.length > 50) {
             this.setStatus('Character name must be between 3 and 50 characters.', true);
             return;
         }

        this.setStatus('Creating character...', false);
        
        // Disable modal's create button during request
        const createBtnElement = modalElement.querySelector('#modal-create-button') as HTMLButtonElement;
        if(createBtnElement) createBtnElement.disabled = true;

        const token = localStorage.getItem('jwtToken');
        if (!token) {
            this.setStatus('Authentication error. Please log in again.', true);
             if(createBtnElement) createBtnElement.disabled = false; // Re-enable button
            this.time.delayedCall(2000, () => this.scene.start('LoginScene'));
            return;
        }

        try {
            const response = await fetch(`${NetworkManager.getInstance()['apiBaseUrl']}/characters`, // Use NM's base URL
            {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ name, classId: this.selectedClassId }), // Send selected classId
            });

            const data = await response.json();
            if (!response.ok) {
                throw new Error(data.message || `Failed to create character (${response.status})`);
            }

            // Creation successful
            this.setStatus(`Character '${name}' created!`, false);
            this.hideCreateCharacterModal(); // Close the modal
            // No need to reset modal state here, resetModalState called on show
            await this.fetchCharacters(); // Re-fetch character list

        } catch (error: any) {
            console.error('Create Character Error:', error);
            this.setStatus(error.message || 'Failed to create character.', true);
        } finally {
             if(createBtnElement) createBtnElement.disabled = false; // Re-enable modal button if needed (though modal closes)
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

    async fetchAndDisplayClasses() {
        this.setStatus('Loading classes...', false);
        try {
            this.availableClasses = await NetworkManager.getInstance().getAvailableClasses();
            this.setStatus(''); // Clear status if characters also loaded
        } catch (error: any) {
            console.error('Fetch Classes Error:', error);
            this.setStatus(error.message || 'Failed to load classes.', true);
            // Handle error appropriately, maybe disable creation
        }
    }

    // +++ Add Modal Show/Hide Functions +++
    showCreateCharacterModal() {
        const modalElement = this.createModalContainer.node.querySelector('#create-modal') as HTMLElement;
        if (modalElement) {
            modalElement.style.display = 'block';
            this.resetModalState(); // Clear previous state
            this.displayClassSelectionUI(); // Re-populate classes in the modal
            this.updateModalCreateButtonState(); // Set initial button state

            // Add listeners for modal buttons now that it's visible
            const cancelButton = modalElement.querySelector('#modal-cancel-button') as HTMLButtonElement;
            const createButton = modalElement.querySelector('#modal-create-button') as HTMLButtonElement;
            const nameInput = modalElement.querySelector('#modalCharName') as HTMLInputElement;

            cancelButton?.removeEventListener('click', this.hideCreateCharacterModal);
            cancelButton?.addEventListener('click', this.hideCreateCharacterModal.bind(this)); // Use bind or arrow func

            createButton?.removeEventListener('click', this.handleCreateCharacter);
            createButton?.addEventListener('click', this.handleCreateCharacter.bind(this));
            
            nameInput?.removeEventListener('input', this.updateModalCreateButtonState);
            nameInput?.addEventListener('input', this.updateModalCreateButtonState.bind(this));
        }
    }

    hideCreateCharacterModal() {
        const modalElement = this.createModalContainer.node.querySelector('#create-modal') as HTMLElement;
        if (modalElement) {
            modalElement.style.display = 'none';
        }
    }

    resetModalState() {
        this.selectedClassId = null;
        const modalElement = this.createModalContainer.node.querySelector('#create-modal') as HTMLElement;
        if (modalElement) {
            const nameInput = modalElement.querySelector('#modalCharName') as HTMLInputElement;
            if(nameInput) nameInput.value = '';
            const classContainer = modalElement.querySelector('#modal-class-select-container') as HTMLElement;
            if (classContainer) {
                classContainer.querySelectorAll('div.class-card').forEach(el => {
                    (el as HTMLElement).style.borderColor = '#ccc';
                    (el as HTMLElement).style.backgroundColor = '#666'; 
                });
            }
        }
    }

    // +++ Add Function to Update Modal Create Button State +++
    updateModalCreateButtonState() {
        const modalElement = this.createModalContainer.node.querySelector('#create-modal') as HTMLElement;
        if (!modalElement) return;

        const nameInput = modalElement.querySelector('#modalCharName') as HTMLInputElement;
        const createButton = modalElement.querySelector('#modal-create-button') as HTMLButtonElement;
        
        const nameIsValid = nameInput && nameInput.value.trim().length >= 3 && nameInput.value.trim().length <= 50;
        const classIsSelected = !!this.selectedClassId;
        const shouldBeEnabled = nameIsValid && classIsSelected;

        if (createButton) {
            createButton.disabled = !shouldBeEnabled;
            createButton.style.backgroundColor = shouldBeEnabled ? '#4CAF50' : '#888';
            createButton.style.color = shouldBeEnabled ? 'white' : '#ccc';
            createButton.style.cursor = shouldBeEnabled ? 'pointer' : 'not-allowed';
        }
    }

    // Class UI display logic (now populates the MODAL)
    displayClassSelectionUI() { 
        const container = this.createModalContainer.node.querySelector('#modal-class-select-container') as HTMLElement;
        if (!container) {
            console.error('Modal class selection container not found!');
            return;
        }
        container.innerHTML = ''; // Clear previous options
        // --- Stop any existing animation when repopulating ---
        this.stopAndResetAllAnimations(container);
        // -------------------------------------------------
        console.log(`Displaying ${this.availableClasses.length} classes in modal.`);

        this.availableClasses.forEach(charClass => {
            const card = document.createElement('div');
            card.className = 'class-card';
            card.style.width = '110px'; // Adjusted width slightly for padding/border
            card.style.padding = '10px';
            card.style.border = '2px solid #ccc';
            card.style.borderRadius = '8px';
            card.style.cursor = 'pointer';
            card.style.textAlign = 'center';
            card.style.backgroundColor = '#666'; 
            card.style.color = '#fff';
            card.style.display = 'flex';
            card.style.flexDirection = 'column';
            card.style.alignItems = 'center';
            card.style.justifyContent = 'space-between'; 
            card.dataset.classId = charClass.classId;

            // --- Store sprite paths in dataset --- 
            const idleSpritePath = `assets/sprites/characters/${charClass.spriteKeyBase}/idle.png`;
            const attackSpritePath = `assets/sprites/characters/${charClass.spriteKeyBase}/attack.png`;
            const walkSpritePath = `assets/sprites/characters/${charClass.spriteKeyBase}/walk.png`;
            card.dataset.idleSprite = idleSpritePath;
            card.dataset.attackSprite = attackSpritePath;
            card.dataset.walkSprite = walkSpritePath;
            // -------------------------------------

            const imgPreview = document.createElement('div');
            imgPreview.id = `img-preview-${charClass.classId}`;
            imgPreview.style.width = `${this.FRAME_WIDTH}px`;
            imgPreview.style.height = `${this.FRAME_WIDTH}px`;
            imgPreview.style.backgroundImage = `url('${idleSpritePath}')`; // Start with idle
            imgPreview.style.backgroundPosition = '0px 0px';
            imgPreview.style.backgroundRepeat = 'no-repeat';
            imgPreview.style.marginBottom = '5px';
            imgPreview.style.transformOrigin = 'center'; 
            imgPreview.style.transform = 'scale(2.0)';
            imgPreview.style.imageRendering = 'pixelated';

            const name = document.createElement('div');
            name.textContent = charClass.name;
            name.style.fontWeight = 'bold';
            name.style.fontSize = '14px';
            name.style.marginBottom = '5px';

            const desc = document.createElement('div');
            desc.textContent = charClass.description;
            desc.style.fontSize = '11px';
            desc.style.flexGrow = '1';

            card.appendChild(imgPreview);
            card.appendChild(name);
            card.appendChild(desc);

            card.onclick = () => {
                const previouslySelectedClassId = this.selectedClassId;
                const newlySelectedClassId = charClass.classId;
                
                // Don't re-trigger animation if clicking the already selected card
                if (previouslySelectedClassId === newlySelectedClassId) {
                    return; 
                }

                this.selectedClassId = newlySelectedClassId;
                console.log(`Selected class: ${this.selectedClassId}`);

                // --- Stop animations and update styles --- 
                this.stopAndResetAllAnimations(container); // Stop all animations first
                container.querySelectorAll('div.class-card').forEach(el => {
                    const htmlEl = el as HTMLElement;
                    const currentCardClassId = htmlEl.dataset.classId;
                    const isSelected = currentCardClassId === this.selectedClassId;
                    
                    htmlEl.style.borderColor = isSelected ? '#0f0' : '#ccc';
                    htmlEl.style.backgroundColor = isSelected ? '#383' : '#666';

                    // Reset non-selected card previews to idle (already done by stopAndResetAllAnimations)
                });
                // -----------------------------------------

                // --- Start animation for the newly selected card --- 
                this.playAttackThenWalkAnimation(newlySelectedClassId);
                // -------------------------------------------------

                this.updateModalCreateButtonState();
            };

            container.appendChild(card);
        });
    }

    // --- Helper to stop all animations and reset previews ---
    stopAndResetAllAnimations(container: HTMLElement) {
        if (this.activeWalkAnimationIntervalId !== null) {
            clearInterval(this.activeWalkAnimationIntervalId);
            this.activeWalkAnimationIntervalId = null;
            this.activeWalkAnimationClassId = null;
        }
        // Ensure all previews are reset to idle frame even if interval wasn't active
        container.querySelectorAll('div.class-card').forEach(el => {
            const card = el as HTMLElement;
            const classId = card.dataset.classId;
            const idleSprite = card.dataset.idleSprite;
            if (classId && idleSprite) {
                const imgPreview = container.querySelector(`#img-preview-${classId}`) as HTMLElement;
                if (imgPreview) {
                    imgPreview.style.backgroundImage = `url('${idleSprite}')`;
                    imgPreview.style.backgroundPosition = '0px 0px';
                }
            }
        });
        console.log("Stopped and reset all animations.");
    }
    // ----------------------------------------------------

    // --- Helper to play Attack -> Walk sequence ---
    playAttackThenWalkAnimation(classId: string) {
        const card = this.createModalContainer.node.querySelector(`.class-card[data-class-id="${classId}"]`) as HTMLElement;
        const imgPreview = this.createModalContainer.node.querySelector(`#img-preview-${classId}`) as HTMLElement;
        
        if (!card || !imgPreview) {
            console.error(`Cannot find card or imgPreview for animation: ${classId}`);
            return;
        }
        
        const attackSprite = card.dataset.attackSprite;
        const walkSprite = card.dataset.walkSprite;
        const idleSprite = card.dataset.idleSprite;

        if (!attackSprite || !walkSprite || !idleSprite) {
            console.error(`Missing sprite paths for animation: ${classId}`);
            return; // Cannot animate without paths
        }

        let attackFrame = 0;
        imgPreview.style.backgroundImage = `url('${attackSprite}')`;
        imgPreview.style.backgroundPosition = '0px 0px';
        console.log(`Starting attack animation for ${classId}`);

        const attackIntervalId = setInterval(() => {
            attackFrame++;
            if (attackFrame < this.ATTACK_FRAME_COUNT) {
                const newX = -attackFrame * this.FRAME_WIDTH;
                imgPreview.style.backgroundPosition = `${newX}px 0px`;
            } else {
                // Attack finished
                clearInterval(attackIntervalId);
                console.log(`Attack finished for ${classId}, starting walk.`);
                
                // Start walking animation
                let walkFrame = 0;
                imgPreview.style.backgroundImage = `url('${walkSprite}')`;
                imgPreview.style.backgroundPosition = '0px 0px';

                // Clear any lingering walk interval just in case
                if (this.activeWalkAnimationIntervalId !== null) {
                    clearInterval(this.activeWalkAnimationIntervalId);
                }

                this.activeWalkAnimationClassId = classId;
                this.activeWalkAnimationIntervalId = setInterval(() => {
                    walkFrame = (walkFrame + 1) % this.WALK_FRAME_COUNT;
                    const newX = -walkFrame * this.FRAME_WIDTH;
                    imgPreview.style.backgroundPosition = `${newX}px 0px`;
                }, this.ANIM_INTERVAL_MS);
            }
        }, this.ANIM_INTERVAL_MS);
    }
    // -------------------------------------------
}