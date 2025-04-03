import { Injectable, Logger } from '@nestjs/common';
import { ZoneService, ZoneCharacterState } from './zone.service';
// import { EnemyService } from '../enemy/enemy.service'; // Keep commented for now
import { EnemyInstance } from './interfaces/enemy-instance.interface';
import { AIAction, AIActionMoveTo } from './interfaces/ai-action.interface'; // Added AIActionMoveTo
import { Character } from 'src/character/character.entity'; // Needed for findCharacterFromPosition return type
import { RuntimeCharacterData } from './zone.service'; // Correct import path

@Injectable()
export class AIService {
  private readonly logger = new Logger(AIService.name);

  // Constants moved/added from GameGateway
  // TODO: Get these from Enemy entity/template eventually
  private readonly ENEMY_AGGRO_RANGE = 150; // Example
  private readonly ENEMY_ATTACK_RANGE = 40; // Example range
  private readonly ATTACK_COOLDOWN = 2000; // ms - Example
  private readonly WANDER_CHANCE = 0.03; // ~3% chance per AI tick to start wandering when idle
  private readonly ENEMY_LEASH_DISTANCE_FACTOR = 1.5; // How far beyond wander radius before leashing

  constructor(
    private readonly zoneService: ZoneService, // To get current state
    // Potentially inject EnemyService if needed for template data like range/speed
    // private readonly enemyService: EnemyService,
  ) {}

  /**
   * Determines the next action for a given enemy instance based on its state and surroundings.
   */
  updateEnemyAI(enemy: EnemyInstance, zoneId: string): AIAction {
    const now = Date.now();
  
    // --- Always check if dead first ---
    if (enemy.currentHealth <= 0) {
        if (enemy.aiState !== 'DEAD') {
             this.zoneService.setEnemyAiState(zoneId, enemy.id, 'DEAD');
             enemy.aiState = 'DEAD'; // Update local state
        }
        return { type: 'IDLE' };
    }

    // --- Handle Engaged States (Attacking, Cooldown, Chasing) --- 
    if (enemy.aiState === 'ATTACKING' || enemy.aiState === 'COOLDOWN' || enemy.aiState === 'CHASING') {
        const targetCharacter = enemy.currentTargetId ? this.zoneService.getCharacterStateById(zoneId, enemy.currentTargetId) : null;
        if (!targetCharacter || targetCharacter.currentHealth <= 0 || targetCharacter.state === 'dead') {
             this.setState(enemy, zoneId, 'IDLE', null);
             enemy.currentTargetId = null;
             return { type: 'IDLE' };
        }

         if (enemy.aiState === 'COOLDOWN') {
            const timeSinceLastAttack = now - (enemy.lastAttackTime || 0);
            if (timeSinceLastAttack < this.ATTACK_COOLDOWN) {
                return { type: 'IDLE' };
            } else {
                this.setState(enemy, zoneId, 'CHASING', null);
            }
        }

        const distanceToTarget = this.calculateDistance(enemy.position, targetCharacter);

        if (distanceToTarget <= this.ENEMY_ATTACK_RANGE) {
             this.setState(enemy, zoneId, 'ATTACKING', null);
             enemy.lastAttackTime = now;
             this.zoneService.updateEnemyAttackTime(zoneId, enemy.id, now);
             return { type: 'ATTACK', targetEntityId: targetCharacter.id, targetEntityType: 'character' };
        }

         this.setState(enemy, zoneId, 'CHASING', targetCharacter);
         return { type: 'MOVE_TO', target: { x: targetCharacter.positionX!, y: targetCharacter.positionY! } };
    }

    // --- Handle Non-Engaged States (Idle, Wandering, Leashed) ---
    else {
        // Leashing Check
        if (enemy.anchorX !== undefined && enemy.anchorY !== undefined && enemy.wanderRadius !== undefined) {
            const leashDistance = enemy.wanderRadius * this.ENEMY_LEASH_DISTANCE_FACTOR;
            const distToAnchorSq = (enemy.position.x - enemy.anchorX)**2 + (enemy.position.y - enemy.anchorY)**2;

            if (distToAnchorSq > leashDistance * leashDistance) {
                if (enemy.aiState !== 'LEASHED') {
                    this.setState(enemy, zoneId, 'LEASHED', { x: enemy.anchorX, y: enemy.anchorY });
                }
                return { type: 'MOVE_TO', target: { x: enemy.anchorX, y: enemy.anchorY } };
            }
        }

        // If was leashed but now back in range
        if (enemy.aiState === 'LEASHED') {
            this.setState(enemy, zoneId, 'IDLE', null);
            return { type: 'IDLE' };
        }

        // Wandering Logic (Only if IDLE)
        if (enemy.aiState === 'IDLE') {
             // Aggro Scan
             const closestPlayer = this.findClosestPlayer(enemy, zoneId);
             if (closestPlayer && this.calculateDistance(enemy.position, closestPlayer) <= this.ENEMY_AGGRO_RANGE) {
                 enemy.currentTargetId = closestPlayer.id;
                 this.setState(enemy, zoneId, 'CHASING', closestPlayer);
                 return { type: 'MOVE_TO', target: { x: closestPlayer.positionX!, y: closestPlayer.positionY! } };
             }

             // Wander Trigger
             if (enemy.anchorX !== undefined && enemy.anchorY !== undefined && enemy.wanderRadius !== undefined) {
                if (Math.random() < this.WANDER_CHANCE) {
                    const angle = Math.random() * Math.PI * 2;
                    const distance = Math.random() * enemy.wanderRadius;
                    const wanderTarget = {
                        x: enemy.anchorX + Math.cos(angle) * distance,
                        y: enemy.anchorY + Math.sin(angle) * distance,
                    };
                    this.setState(enemy, zoneId, 'WANDERING', wanderTarget);
                    return { type: 'MOVE_TO', target: wanderTarget };
                }
             }
        }

        // If Wandering, keep going
        if (enemy.aiState === 'WANDERING' && enemy.target) {
             return { type: 'MOVE_TO', target: enemy.target };
        }

        // Default: Remain IDLE if no other state applies
         if (enemy.aiState !== 'IDLE') {
             this.setState(enemy, zoneId, 'IDLE', null);
         }
         return { type: 'IDLE' };
    }
  }
    // --- Helper Methods defined within the Class --- 

    // Helper to set state and movement target consistently
    private setState(enemy: EnemyInstance, zoneId: string, newState: string, target: {x: number, y: number} | RuntimeCharacterData | null) {
        if (enemy.aiState !== newState) {
             this.zoneService.setEnemyAiState(zoneId, enemy.id, newState);
             enemy.aiState = newState;
        }
        let targetPos: {x: number, y: number} | null = null;
        if (target && 'positionX' in target) { targetPos = { x: target.positionX!, y: target.positionY! }; }
        else if (target) { targetPos = target as {x: number, y: number} | null; }
        if (enemy.target?.x !== targetPos?.x || enemy.target?.y !== targetPos?.y) {
             this.zoneService.setEnemyTarget(zoneId, enemy.id, targetPos);
             enemy.target = targetPos;
        }
    }

    private findClosestPlayer(enemy: EnemyInstance, zoneId: string): RuntimeCharacterData | undefined {
        let closestCharacter: RuntimeCharacterData | undefined;
        let minDistance = Infinity;
        const playersInZone = this.zoneService.getPlayersInZone(zoneId);

        for (const player of playersInZone) {
            for (const character of player.characters) {
                if (character.state === 'dead' || character.currentHealth <= 0 || character.positionX === null || character.positionY === null) {
                    continue;
                }
                const distance = this.calculateDistance(enemy.position, character);
                if (distance < minDistance) {
                    minDistance = distance;
                    closestCharacter = character;
                }
            }
        }
        return closestCharacter;
    }

    private calculateDistance(point1: {x: number, y: number}, point2: {x: number | null, y: number | null} | RuntimeCharacterData ): number {
        let p2x: number | null;
        let p2y: number | null;
        if ('positionX' in point2) { p2x = point2.positionX; p2y = point2.positionY; }
        else { p2x = point2.x; p2y = point2.y; }
        if (p2x === null || p2y === null) return Infinity;
        const dx = point1.x - p2x;
        const dy = point1.y - p2y;
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