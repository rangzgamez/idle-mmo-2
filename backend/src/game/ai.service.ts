import { Injectable, Logger } from '@nestjs/common';
import { ZoneService, ZoneCharacterState } from './zone.service';
// import { EnemyService } from '../enemy/enemy.service'; // Keep commented for now
import { EnemyInstance } from './interfaces/enemy-instance.interface';
import { AIAction } from './interfaces/ai-action.interface';
import { Character } from 'src/character/character.entity'; // Needed for findCharacterFromPosition return type

@Injectable()
export class AIService {
  private readonly logger = new Logger(AIService.name);

  // Constants moved/added from GameGateway
  private readonly ENEMY_AGGRO_RANGE = 200;
  private readonly ENEMY_ATTACK_RANGE = 35; // Example range - adjust as needed
  private readonly ATTACK_COOLDOWN = 1500; // ms

  constructor(
    private readonly zoneService: ZoneService, // To get current state
    // Potentially inject EnemyService if needed for template data like range/speed
    // private readonly enemyService: EnemyService,
  ) {}

  /**
   * Determines the next action for a given enemy instance based on its state and surroundings.
   */
  updateEnemyAI(enemyInstance: EnemyInstance, zoneId: string): AIAction {
    // --- AI Decision Logic ---

    // 1. Check for targets and aggro
    const closestPlayer = this.findClosestPlayer(enemyInstance, zoneId);
    let targetCharacter: ZoneCharacterState | null = null;
    let distanceToTarget = Infinity;

    if (closestPlayer) {
        distanceToTarget = this.calculateDistance(enemyInstance.position, { x: closestPlayer.x!, y: closestPlayer.y! });
        targetCharacter = closestPlayer; // Found a potential target
    }

    // --- State Transitions ---

    // Check if currently attacking or cooling down
    const now = Date.now();
    if (enemyInstance.aiState === 'ATTACKING' || enemyInstance.aiState === 'COOLDOWN') {
        const timeSinceLastAttack = now - (enemyInstance.lastAttackTime || 0);
        if (timeSinceLastAttack < this.ATTACK_COOLDOWN) {
            // Still cooling down
            if(enemyInstance.aiState !== 'COOLDOWN') {
                 this.zoneService.setEnemyAiState(zoneId, enemyInstance.id, 'COOLDOWN'); // Update state if needed
            }
            return { type: 'IDLE' }; // No action while cooling down
        } else {
            // Cooldown finished, reset state to allow other actions
             this.zoneService.setEnemyAiState(zoneId, enemyInstance.id, 'IDLE');
             enemyInstance.aiState = 'IDLE'; // Reflect change locally for subsequent checks
        }
    }

    // Check for attack condition
    if (targetCharacter && distanceToTarget <= this.ENEMY_ATTACK_RANGE) {
        // In range, attack!
        this.zoneService.setEnemyAiState(zoneId, enemyInstance.id, 'ATTACKING');
        enemyInstance.lastAttackTime = now; // Record attack time
        this.zoneService.updateEnemyAttackTime(zoneId, enemyInstance.id, now); // Persist attack time
        return {
            type: 'ATTACK',
            targetEntityId: targetCharacter.id,
            targetEntityType: 'character',
        };
    }

    // Check for chase condition
    if (targetCharacter && distanceToTarget <= this.ENEMY_AGGRO_RANGE) {
        // In aggro range, but not attack range, chase!
        if (enemyInstance.aiState !== 'CHASING') {
             this.zoneService.setEnemyAiState(zoneId, enemyInstance.id, 'CHASING');
             this.logger.log(`Enemy ${enemyInstance.id} is now CHASING player ${targetCharacter.ownerName}'s char ${targetCharacter.name}`);
        }
        // Update target in ZoneService (GameGateway will handle actual movement)
        this.zoneService.setEnemyTarget(zoneId, enemyInstance.id, { x: targetCharacter.x!, y: targetCharacter.y! });
        return {
            type: 'MOVE_TO',
            target: { x: targetCharacter.x!, y: targetCharacter.y! },
        };
    }

    // Default: No target in range or lost target
    if (enemyInstance.aiState !== 'IDLE') {
        // If previously chasing/attacking but lost target, go back to IDLE
        this.logger.log(`Enemy ${enemyInstance.id} lost target or target out of range. Returning to IDLE.`);
        this.zoneService.setEnemyAiState(zoneId, enemyInstance.id, 'IDLE');
        this.zoneService.setEnemyTarget(zoneId, enemyInstance.id, null); // Clear target
    }
    return { type: 'IDLE' };
  }

  // --- Helper Methods (Moved from GameGateway) ---

  private findClosestPlayer(enemy: EnemyInstance, zoneId: string): ZoneCharacterState | undefined {
      let closestPlayer: ZoneCharacterState | undefined;
      let minDistance = Infinity;

      // Get runtime character states which include position
      const charactersInZone = this.zoneService.getZoneCharacterStates(zoneId);

      for (const character of charactersInZone) {
          if (!character.x || !character.y) continue; // Skip characters without position

          const distance = this.calculateDistance(enemy.position, {x: character.x, y: character.y});
          if (distance < minDistance) {
              minDistance = distance;
              closestPlayer = character;
          }
      }
      return closestPlayer;
  }

  private calculateDistance(point1: {x:number, y:number}, point2: {x:number, y:number}): number {
      const dx = point1.x - point2.x;
      const dy = point1.y - point2.y;
      return Math.sqrt(dx * dx + dy * dy);
  }

  // Finds character by *exact* position - may need refinement later (e.g., proximity check)
  private findCharacterFromPosition(position: {x:number, y:number}, zoneId:string): Character | undefined {
        let foundCharacter: Character | undefined; // Use actual Character type if possible

        const players = this.zoneService.getPlayersInZone(zoneId); // Gets Map<userId, RuntimePlayerData>
        for(const player of players.values()){
            for(const char of player.characters){ // char is RuntimeCharacterData
                // Use a small tolerance for floating point comparison?
                if(char.positionX === position.x && char.positionY === position.y){
                    // Need to return the base Character data or ZoneCharacterState?
                    // For now, let's assume we need something ZoneService can provide easily
                    // Returning the RuntimeCharacterData for now, adjust if needed
                    foundCharacter = char; // This is RuntimeCharacterData, not Character entity directly
                    break; // Found one at this position
                }
            }
            if (foundCharacter) break; // Stop searching players if found
        }
        // This method might not be needed if ATTACK action uses targetEntityId from findClosestPlayer
        this.logger.warn(`findCharacterFromPosition might be redundant now.`);
        return foundCharacter; // Returns RuntimeCharacterData or undefined
    }

} 