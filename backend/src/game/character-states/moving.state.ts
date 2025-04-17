import { Logger } from '@nestjs/common';
import { RuntimeCharacterData } from '../zone.service';
import { EnemyInstance } from '../interfaces/enemy-instance.interface';
import {
    CharacterStateDependencies,
    ICharacterState,
    StateProcessResult,
} from './character-state.interface';

export class MovingState implements ICharacterState {
    private readonly logger = new Logger(MovingState.name);

    async processTick(
        character: RuntimeCharacterData,
        dependencies: CharacterStateDependencies,
        zoneId: string,
        enemiesInZone: EnemyInstance[],
        siblingCharacters: RuntimeCharacterData[],
        now: number,
        deltaTime: number,
    ): Promise<StateProcessResult> {
        const results: StateProcessResult = {
            combatActions: [],
            enemyHealthUpdates: [],
            targetDied: false,
            pickedUpItemId: null,
        };

        const { zoneService } = dependencies;

        if (character.targetX !== null && character.targetY !== null) {
            const dx = character.targetX - character.positionX!;
            const dy = character.targetY - character.positionY!;
            const distSq = dx*dx + dy*dy;
            // Use a small threshold to prevent floating point issues and overshooting
            const closeEnoughThresholdSq = 1; // Arrived threshold

            if (distSq <= closeEnoughThresholdSq) {
                this.logger.debug(`Character ${character.id} reached target (${character.targetX}, ${character.targetY}). Transitioning to idle.`);
                zoneService.setCharacterState(zoneId, character.id, 'idle');
                // Snap to target position precisely
                character.positionX = character.targetX;
                character.positionY = character.targetY;
                character.targetX = null;
                character.targetY = null;

                // If the character reached the anchor point, clear command state
                 // Check if the reached target *was* the anchor
                 const isAtAnchor = character.anchorX !== null && character.anchorY !== null &&
                                    character.positionX === character.anchorX &&
                                    character.positionY === character.anchorY;

                 if (isAtAnchor && character.commandState) {
                    this.logger.debug(`Character ${character.id} reached anchor, clearing command state: ${character.commandState}`);
                    character.commandState = null;
                 } else if (character.commandState !== 'loot_area') {
                     // If reached a non-anchor target and command wasn't loot_area, clear it
                     // This handles completing a standard move command.
                     if (character.commandState) {
                         this.logger.debug(`Character ${character.id} reached target, clearing command state: ${character.commandState}`);
                         character.commandState = null;
                     }
                 }
                 // If commandState is 'loot_area', reaching the anchor might mean starting the looting scan (handled by idle state transition)

            } else {
                // Still moving towards target. Position update is handled by MovementService later.
                // No state change needed here. commandState persists.
                this.logger.verbose(`Character ${character.id} still moving towards (${character.targetX}, ${character.targetY})`);
            }
        } else {
             // This case should ideally not happen if state transitions are correct
             this.logger.warn(`Character ${character.id} in 'moving' state but has no target (targetX/Y are null). Setting idle.`);
             zoneService.setCharacterState(zoneId, character.id, 'idle');
             character.targetX = null;
             character.targetY = null;
             character.commandState = null; // Clear command state if move was invalid/aborted
        }

        return results; // Moving state itself doesn't generate combat actions etc.
    }
} 