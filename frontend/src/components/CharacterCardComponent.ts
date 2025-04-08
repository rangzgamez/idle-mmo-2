// frontend/src/components/CharacterCardComponent.ts

// Define data structure the component expects
export interface CharacterCardData {
    id: string; // Character ID or Class ID
    name: string;
    levelText?: string; // e.g., "Lv 5 Warrior" or just "Warrior" for class
    spritePaths: {
        idle: string;
        attack: string;
        walk: string;
    };
    initialIsSelected?: boolean;
}

// Define the structure for animation frame counts (can be fetched or passed in)
interface AnimationCounts {
    attack: number;
    walk: number;
}

export class CharacterCardComponent {
    private data: CharacterCardData;
    private parentContainer: HTMLElement;
    private onClickCallback: (id: string) => void;

    private cardElement!: HTMLElement;
    private imgPreviewElement!: HTMLElement;

    private isSelected: boolean = false;
    private frameCounts: AnimationCounts;
    private imagesLoaded: boolean = false;

    // Animation State
    private attackIntervalId: NodeJS.Timeout | number | null = null; // Use number for browser compatibility
    private walkIntervalId: NodeJS.Timeout | number | null = null;

    // Constants (could be passed in config later)
    private readonly FRAME_WIDTH = 100;
    private readonly ANIM_INTERVAL_MS = 150;
    private readonly DEFAULT_ATTACK_FRAMES = 4;
    private readonly DEFAULT_WALK_FRAMES = 4;
    private readonly SCALE_FACTOR = 1.5; // Or make configurable

    constructor(
        parentContainer: HTMLElement,
        data: CharacterCardData,
        onClickCallback: (id: string) => void
    ) {
        this.parentContainer = parentContainer;
        this.data = data;
        this.onClickCallback = onClickCallback;
        this.isSelected = data.initialIsSelected ?? false;
        this.frameCounts = {
            attack: this.DEFAULT_ATTACK_FRAMES,
            walk: this.DEFAULT_WALK_FRAMES
        };

        this.createCardElement();
        this.updateAppearance();
        
        this.loadImagesAndCalculateFrameCounts();

        if (this.isSelected) {
            this.playAttackThenWalkAnimation();
        }
    }

    private createCardElement(): void {
        this.cardElement = document.createElement('div');
        this.cardElement.className = 'character-card'; // Consistent class name
        this.cardElement.dataset.id = this.data.id; // Use generic 'id'
        this.cardElement.style.display = 'flex';
        this.cardElement.style.flexDirection = 'column';
        this.cardElement.style.alignItems = 'center';
        this.cardElement.style.padding = '10px';
        this.cardElement.style.border = '2px solid #aaa';
        this.cardElement.style.borderRadius = '8px';
        this.cardElement.style.backgroundColor = 'rgba(40,40,40,0.8)';
        this.cardElement.style.width = '160px';
        this.cardElement.style.textAlign = 'center';
        this.cardElement.style.cursor = 'pointer';
        this.cardElement.style.color = '#fff';

        // 1. Level/Class Text (Optional)
        if (this.data.levelText) {
            const levelClassText = document.createElement('div');
            levelClassText.textContent = this.data.levelText;
            levelClassText.style.fontSize = '14px';
            levelClassText.style.fontWeight = 'bold';
            levelClassText.style.marginBottom = '5px';
            this.cardElement.appendChild(levelClassText);
        }

        // 2. Image Preview
        this.imgPreviewElement = document.createElement('div');
        this.imgPreviewElement.id = `card-img-preview-${this.data.id}`; // Unique ID
        this.imgPreviewElement.style.width = `${this.FRAME_WIDTH}px`;
        this.imgPreviewElement.style.height = `${this.FRAME_WIDTH}px`;
        this.imgPreviewElement.style.backgroundImage = `url('${this.data.spritePaths.idle}')`;
        this.imgPreviewElement.style.backgroundPosition = '0px 0px';
        this.imgPreviewElement.style.backgroundRepeat = 'no-repeat';
        this.imgPreviewElement.style.marginBottom = '8px';
        this.imgPreviewElement.style.transformOrigin = 'center';
        this.imgPreviewElement.style.transform = `scale(${this.SCALE_FACTOR})`;
        this.imgPreviewElement.style.imageRendering = 'pixelated';
        this.cardElement.appendChild(this.imgPreviewElement);

        // 3. Name Text
        const nameText = document.createElement('div');
        nameText.textContent = this.data.name;
        nameText.style.fontSize = '16px';
        this.cardElement.appendChild(nameText);

        // Add Click Handler
        this.cardElement.onclick = () => {
            this.onClickCallback(this.data.id); // Notify scene
        };

        this.parentContainer.appendChild(this.cardElement);
    }

    // --- Public Methods ---

    getElement(): HTMLElement {
        return this.cardElement;
    }

    getId(): string {
        return this.data.id;
    }

    setSelected(isSelected: boolean): void {
        if (this.isSelected === isSelected) {
            return; // No change needed
        }
        this.isSelected = isSelected;
        this.updateAppearance();

        if (this.isSelected) {
            this.playAttackThenWalkAnimation();
        } else {
            this.stopAnimationAndReset();
        }
    }

    // Method to stop animation and reset visuals (e.g., for global reset)
    stopAnimationAndReset(): void {
        this.clearAttackInterval();
        this.clearWalkInterval();
        // Reset preview
        if (this.imgPreviewElement) {
             console.log(`Component Resetting preview for ${this.data.id}`);
            this.imgPreviewElement.style.backgroundImage = `url('${this.data.spritePaths.idle}')`;
            this.imgPreviewElement.style.backgroundPosition = '0px 0px';
        }
    }

    // --- Internal Methods ---

    private updateAppearance(): void {
        if (!this.cardElement) return;
        if (this.isSelected) {
            this.cardElement.style.borderColor = '#00ff00';
            this.cardElement.style.backgroundColor = 'rgba(0, 80, 0, 0.8)';
        } else {
            this.cardElement.style.borderColor = '#aaa';
            this.cardElement.style.backgroundColor = 'rgba(40, 40, 40, 0.8)';
        }
    }

    private clearAttackInterval(): void {
        if (this.attackIntervalId !== null) {
            clearInterval(this.attackIntervalId as any); // Cast to any for browser/node compatibility
            this.attackIntervalId = null;
             // Remove from dataset if we were storing it (optional now)
            // if (this.imgPreviewElement.dataset.attackIntervalId) {
            //     delete this.imgPreviewElement.dataset.attackIntervalId;
            // }
        }
    }

    private clearWalkInterval(): void {
         if (this.walkIntervalId !== null) {
            clearInterval(this.walkIntervalId as any);
            this.walkIntervalId = null;
        }
    }

    private loadImagesAndCalculateFrameCounts(): void {
        const attackSrc = this.data.spritePaths.attack;
        const walkSrc = this.data.spritePaths.walk;
        let attackLoaded = false;
        let walkLoaded = false;

        const checkCompletion = () => {
            if (attackLoaded && walkLoaded) {
                this.imagesLoaded = true;
                console.log(`Component ${this.data.id} finished loading images. Final counts:`, this.frameCounts);
                // If the card is currently selected and walking, we *could*
                // potentially restart the walk animation with the correct count,
                // but that might cause a visual jump. Let's keep it simple for now.
            }
        };

        if (attackSrc) {
            const attackImg = new Image();
            attackImg.onload = () => {
                const frameCount = Math.max(1, Math.floor(attackImg.width / this.FRAME_WIDTH));
                console.log(`Component ${this.data.id} loaded ${attackSrc}: w=${attackImg.width}, attack frames=${frameCount}`);
                this.frameCounts.attack = frameCount;
                attackLoaded = true;
                checkCompletion();
            };
            attackImg.onerror = () => {
                console.error(`Component ${this.data.id} failed to load attack image: ${attackSrc}`);
                this.frameCounts.attack = this.DEFAULT_ATTACK_FRAMES; // Use default on error
                attackLoaded = true;
                checkCompletion();
            };
            attackImg.src = attackSrc;
        } else {
             console.warn(`Component ${this.data.id} missing attack sprite path.`);
            this.frameCounts.attack = this.DEFAULT_ATTACK_FRAMES;
            attackLoaded = true; // Mark as 'loaded' (with default) if no path
        }

        if (walkSrc) {
            const walkImg = new Image();
            walkImg.onload = () => {
                const frameCount = Math.max(1, Math.floor(walkImg.width / this.FRAME_WIDTH));
                console.log(`Component ${this.data.id} loaded ${walkSrc}: w=${walkImg.width}, walk frames=${frameCount}`);
                this.frameCounts.walk = frameCount;
                walkLoaded = true;
                checkCompletion();
            };
            walkImg.onerror = () => {
                console.error(`Component ${this.data.id} failed to load walk image: ${walkSrc}`);
                this.frameCounts.walk = this.DEFAULT_WALK_FRAMES; // Use default on error
                walkLoaded = true;
                checkCompletion();
            };
            walkImg.src = walkSrc;
        } else {
            console.warn(`Component ${this.data.id} missing walk sprite path.`);
            this.frameCounts.walk = this.DEFAULT_WALK_FRAMES;
            walkLoaded = true; // Mark as 'loaded' (with default) if no path
        }
        
        // Check completion immediately in case paths were missing
        checkCompletion(); 
    }

    private playAttackThenWalkAnimation(): void {
        // Safety check: Clear any existing animations for this card first
        this.stopAnimationAndReset();

        if (!this.imgPreviewElement || !this.data.spritePaths.attack || !this.data.spritePaths.walk) {
            console.error(`Cannot play animation for ${this.data.id}, missing elements or data.`);
            return;
        }

        const attackFrameCount = this.frameCounts.attack;
        const walkFrameCount = this.frameCounts.walk;
        console.log(`Component starting Animation ${this.data.id}: Attack Frames=${attackFrameCount}, Walk Frames=${walkFrameCount} (Using component counts)`);

        let attackFrame = 0;
        this.imgPreviewElement.style.backgroundImage = `url('${this.data.spritePaths.attack}')`;

        this.attackIntervalId = setInterval(() => {
            // Store interval ID? Not strictly necessary if managed internally
            // this.imgPreviewElement.dataset.attackIntervalId = String(this.attackIntervalId);

            const currentX = -attackFrame * this.FRAME_WIDTH;
            this.imgPreviewElement.style.backgroundPosition = `${currentX}px 0px`;
            attackFrame++;

            if (attackFrame >= attackFrameCount) {
                this.clearAttackInterval(); // Clear attack interval
                console.log(`Component Attack finished for ${this.data.id}, starting walk.`);

                // Start Walk
                let walkFrame = 0;
                this.imgPreviewElement.style.backgroundImage = `url('${this.data.spritePaths.walk}')`;
                this.imgPreviewElement.style.backgroundPosition = '0px 0px'; // Set first frame immediately

                this.clearWalkInterval(); // Ensure no lingering walk interval

                this.walkIntervalId = setInterval(() => {
                    const currentWalkX = -walkFrame * this.FRAME_WIDTH;
                    this.imgPreviewElement.style.backgroundPosition = `${currentWalkX}px 0px`;
                    walkFrame = (walkFrame + 1) % walkFrameCount;
                }, this.ANIM_INTERVAL_MS);
            }
        }, this.ANIM_INTERVAL_MS);
    }
}