// backend/src/game/zone.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { Socket } from 'socket.io';
import { Character } from '../character/character.entity';
import { User } from '../user/user.entity';
import { EnemyInstance } from './interfaces/enemy-instance.interface';
import { v4 as uuidv4 } from 'uuid';
import { EnemyService } from '../enemy/enemy.service'; // Import EnemyService

// Interface for player data within a zone
interface PlayerInZone {
    socket: Socket;
    user: User; // Basic user info
    characters: RuntimeCharacterData[]; // Use the extended type
}

// Interface for simplified character state broadcasted to others
export interface ZoneCharacterState {
    id: string; // Character ID
    ownerId: string; // User ID
    ownerName: string; // Username
    name: string;
    level: number;
    x: number | null;
    y: number | null;
    // Add appearance/class info later
}

// Interface for the overall zone state

interface ZoneState {
    players: Map<string, PlayerInZone>; // Existing player state
    enemies: Map<string, EnemyInstance>; // Enemy instances, keyed by id
    // Add items map/list later
}
// Export this interface so CombatService can use it
export interface RuntimeCharacterData extends Character {
    targetX: number | null;
    targetY: number | null;
    currentHealth: number;
    ownerId: string; // Should always be present after addPlayerToZone
    baseAttack: number;
    baseDefense: number;
    // --- RTS Combat State ---
    state: 'idle' | 'moving' | 'attacking';
    attackTargetId: string | null;
    anchorX: number | null; // Last commanded position or spawn point
    anchorY: number | null;
    attackRange: number; // How close to attack
    aggroRange: number; // How far to automatically look for targets when idle
    leashDistance: number; // How far from anchor before returning
}
@Injectable()
export class ZoneService {
    // In-memory store for all active zones
    // Key: zoneId (string), Value: ZoneState
    private zones: Map<string, ZoneState> = new Map();
    private logger: Logger = new Logger('ZoneService');

    constructor(private readonly enemyService: EnemyService) { // Inject EnemyService
        // Initialize zone state for default zone(s).
        this.zones.set('startZone', { players: new Map(), enemies: new Map() });
        this.startSpawningEnemies('startZone'); // Start spawning enemies in the default zone.
      }
    // --- Player Management ---

    addPlayerToZone(zoneId: string, playerSocket: Socket, user: User, characters: Character[]): void {
        if (!this.zones.has(zoneId)) {
            this.logger.log(`Creating new zone: ${zoneId}`);
            this.zones.set(zoneId, { players: new Map(), enemies: new Map() });
        }
        const zone = this.zones.get(zoneId)!; // Zone is guaranteed to exist now

        const runtimeCharacters: RuntimeCharacterData[] = characters.map(char => ({
            ...char,
            positionX: char.positionX ?? (100 + Math.random() * 50), // Existing spawn logic
            positionY: char.positionY ?? (100 + Math.random() * 50),
            targetX: char.positionX ?? (100 + Math.random() * 50), // Initial target is current position
            targetY: char.positionY ?? (100 + Math.random() * 50),
            currentZoneId: zoneId,
            ownerId: user.id, // <-- ADD OWNER ID
            currentHealth: char.baseHealth, // <-- INITIALIZE HEALTH
            baseAttack: char.baseAttack, // <-- ADD BASE STATS
            baseDefense: char.baseDefense, // <-- ADD BASE STATS
            // --- Initialize RTS Combat State ---
            state: 'idle',
            attackTargetId: null,
            anchorX: char.positionX ?? (100 + Math.random() * 50), // Initial anchor is spawn point
            anchorY: char.positionY ?? (100 + Math.random() * 50),
            attackRange: 50, // TODO: Make this configurable/stat-based
            aggroRange: 150, // TODO: Make this configurable/stat-based
            leashDistance: 400, // TODO: Make this configurable
        }));

        zone.players.set(user.id, { socket: playerSocket, user, characters: runtimeCharacters });
        console.log(zone);
        console.log(this.zones);
        this.logger.log(`User ${user.username} (${user.id}) added to zone ${zoneId}`);

        // Add socket to the Socket.IO room for this zone
        playerSocket.join(zoneId);
        this.logger.log(`Socket ${playerSocket.id} joined room ${zoneId}`);
    }

    removePlayerFromZone(playerSocket: Socket): { zoneId: string, userId: string } | null {
        const user = playerSocket.data.user as User;
        if (!user) return null; // Should not happen if authenticated

        let affectedZoneId: string | null = null;
        let affectedUserId: string | null = null;

        // Find which zone the player is in and remove them
        for (const [zoneId, zone] of this.zones.entries()) {
            if (zone.players.has(user.id)) {
                zone.players.delete(user.id);
                affectedZoneId = zoneId;
                affectedUserId = user.id;
                this.logger.log(`User ${user.username} (${user.id}) removed from zone ${zoneId}`);

                // Remove socket from the Socket.IO room
                playerSocket.leave(zoneId);
                this.logger.log(`Socket ${playerSocket.id} left room ${zoneId}`);

                // If zone becomes empty, clean it up (optional)
                if (zone.players.size === 0) {
                    this.logger.log(`Zone ${zoneId} is now empty, removing.`);
                    this.zones.delete(zoneId);
                }
                break; // Player found and removed
            }
        }

        if (affectedZoneId && affectedUserId) {
            return { zoneId: affectedZoneId, userId: affectedUserId };
        }
        return null; // Player wasn't found in any zone
    }
    async addEnemy(zoneId: string, templateId: string, position: { x: number; y: number }): Promise<EnemyInstance | null> {
        const zone = this.zones.get(zoneId);
        if (!zone) {
          console.warn(`Zone ${zoneId} does not exist.  Cannot add enemy.`);
          return null; // Zone doesn't exist.
        }
    
        // Fetch the template from the EnemyService
        const enemyTemplate = await this.enemyService.findOne(templateId);
        if (!enemyTemplate) {
            console.warn(`Enemy template ${templateId} does not exist.  Cannot add enemy.`);
          return null; // Template doesn't exist.
        }
    
        const id = uuidv4();
        // Ensure EnemyInstance includes base stats needed by CombatService
        const newEnemy: EnemyInstance = {
          id,
          templateId,
          zoneId,
          currentHealth: enemyTemplate.baseHealth,
          position,
          aiState: 'IDLE',
          // Add base stats from template
          baseAttack: enemyTemplate.baseAttack,
          baseDefense: enemyTemplate.baseDefense,
          // Add other relevant properties if needed
          // name: enemyTemplate.name, 
        };
    
        zone.enemies.set(id, newEnemy);
        console.log(`Added enemy ${enemyTemplate.name} at ${position.x}, ${position.y} (${id}) to zone ${zoneId}`);
        return newEnemy;
      }


  removeEnemy(zoneId: string, id: string): boolean {
    const zone = this.zones.get(zoneId);
    if (!zone) {
      return false;
    }
    return zone.enemies.delete(id);
  }

  getEnemy(zoneId: string, id: string): EnemyInstance | undefined {
    const zone = this.zones.get(zoneId);
    if (!zone) {
      return undefined;
    }
    return zone.enemies.get(id);
  }

  updateEnemyPosition(zoneId: string, id: string, position: { x: number; y: number }): boolean {
      const enemy = this.getEnemy(zoneId, id);
      if (!enemy) return false;
      enemy.position = position;
      return true;
  }

  setEnemyTarget(zoneId: string, id: string, target: { x: number; y: number } | null): boolean {
      const enemy = this.getEnemy(zoneId, id);
      if (!enemy) return false;
      enemy.target = target;
      return true;
  }

  setEnemyAiState(zoneId: string, id: string, aiState: string): boolean {
      const enemy = this.getEnemy(zoneId, id);
      if (!enemy) return false;
      enemy.aiState = aiState;
      return true;
  }

  // --- New method to update last attack time ---
  updateEnemyAttackTime(zoneId: string, id: string, timestamp: number): boolean {
    const enemy = this.getEnemy(zoneId, id);
    if (!enemy) return false;
    enemy.lastAttackTime = timestamp;
    return true;
  }
  // --------------------------------------------

  getZoneEnemies(zoneId: string): EnemyInstance[] {
      const zone = this.zones.get(zoneId);
      if (!zone) return [];
      return Array.from(zone.enemies.values());
  }
    // --- State Retrieval ---
    private async spawnEnemy(zoneId: string) {
        // Simple spawning logic:
        // 1. Get a random enemy template ID from the EnemyService.
        // 2. Generate a random position within the zone.
        // 3. Call addEnemy.

        const enemyTemplates = await this.enemyService.findAll();
        if (enemyTemplates.length === 0) {
        console.warn('No enemy templates found.  Cannot spawn enemies.');
        return;
        }

        const randomTemplate = enemyTemplates[Math.floor(Math.random() * enemyTemplates.length)];
        const randomPosition = {
        x: Math.random() * 500, // Example zone size (500x500).  Replace with actual zone dimensions
        y: Math.random() * 500,
        };

        await this.addEnemy(zoneId, randomTemplate.id, randomPosition);
        console.log(`Spawned enemy ${randomTemplate.name} (${randomTemplate.id}) in zone ${zoneId}`);

        // TODO: Broadcast enemySpawned event to clients in the zone (later).
    }

    private startSpawningEnemies(zoneId: string) {
        setInterval(() => {
            this.spawnEnemy(zoneId);
        }, 5000); // Spawn every 5 seconds (adjust as needed)
    } 
    getPlayersInZone(zoneId: string): PlayerInZone[] {
        const zone = this.zones.get(zoneId);
        return zone ? Array.from(zone.players.values()) : [];
    }

    getZoneCharacterStates(zoneId: string, excludeUserId?: string): ZoneCharacterState[] {
        const players = this.getPlayersInZone(zoneId);
        const characterStates: ZoneCharacterState[] = [];

        for (const player of players) {
            if (player.user.id === excludeUserId) continue; // Skip self if requested

            for (const char of player.characters) {
                 characterStates.push({
                     id: char.id,
                     ownerId: player.user.id,
                     ownerName: player.user.username,
                     name: char.name,
                     level: char.level,
                     x: char.positionX,
                     y: char.positionY,
                 });
            }
        }
        return characterStates;
    }

    getPlayerCharacters(userId: string, zoneId?: string): RuntimeCharacterData[] | undefined {
         // Find the zone the player is in (or use provided zoneId)
         let zone: ZoneState | undefined;
         if (zoneId) {
             zone = this.zones.get(zoneId);
         } else {
             for(const z of this.zones.values()) {
                 if (z.players.has(userId)) {
                     zone = z;
                     break;
                 }
             }
         }
         return zone?.players.get(userId)?.characters;
    }

    // --- State Updates ---
    setCharacterTargetPosition(
        userId: string,
        characterId: string,
        targetX: number,
        targetY: number
    ): { zoneId: string, character: RuntimeCharacterData } | null {
        // Find the zone the player/character is in
         for (const [zoneId, zone] of this.zones.entries()) {
            const player = zone.players.get(userId);
            if (player) {
                 const character = player.characters.find(c => c.id === characterId);
                 if (character) {
                     character.targetX = targetX; // Set target X
                     character.targetY = targetY; // Set target Y
                     // Don't update positionX/Y here directly anymore
                     return { zoneId, character };
                 }
            }
        }
        return null; // Character or player not found
    }
    // Add a method to update the CURRENT position (used by game loop)
    updateCharacterCurrentPosition(
        userId: string,
        characterId: string,
        currentX: number,
        currentY: number
    ): RuntimeCharacterData | null {
            // Find the zone the player/character is in
            for (const [, zone] of this.zones.entries()) {
                const player = zone.players.get(userId);
                if (player) {
                    const character = player.characters.find(c => c.id === characterId);
                    if (character) {
                        character.positionX = currentX;
                        character.positionY = currentY;
                        return character;
                    }
                }
            }
            return null;
    }
    updateCharacterPosition(
        userId: string,
        characterId: string,
        x: number,
        y: number
    ): { zoneId: string, character: Character } | null {
        // Find the zone the player/character is in
         for (const [zoneId, zone] of this.zones.entries()) {
            const player = zone.players.get(userId);
            if (player) {
                 const character = player.characters.find(c => c.id === characterId);
                 if (character) {
                     character.positionX = x;
                     character.positionY = y;
                     character.currentZoneId = zoneId; // Keep track of current zone conceptually
                     // Note: We are NOT saving to DB on every move for performance.
                     // DB saving could happen periodically or on zone change/logout.
                     return { zoneId, character };
                 }
            }
        }
        return null; // Character or player not found in any active zone
    }

    // Add getter for single enemy instance
    getEnemyInstanceById(zoneId: string, id: string): EnemyInstance | undefined {
        return this.zones.get(zoneId)?.enemies.get(id);
    }

    /**
     * Updates enemy health and returns the new health value.
     * Returns null if enemy not found.
     */
    async updateEnemyHealth(zoneId: string, id: string, healthChange: number): Promise<number | null> {
      const enemy = this.getEnemyInstanceById(zoneId, id);
      if (!enemy) return null;

      // TODO: Get base stats from EnemyService if not already on EnemyInstance
      // This might be needed if max health checks are added

      enemy.currentHealth = (enemy.currentHealth ?? 0) + healthChange;

      // Ensure health doesn't go below 0
      if (enemy.currentHealth < 0) {
        enemy.currentHealth = 0;
      }
      // TODO: Add check for health exceeding max health based on template

      return enemy.currentHealth;
    }

    /**
     * Finds a specific character's runtime data within a zone by their ID.
     */
    getCharacterStateById(zoneId: string, characterId: string): RuntimeCharacterData | undefined {
        const zone = this.zones.get(zoneId);
        if (!zone) return undefined;

        for (const player of zone.players.values()) {
            const character = player.characters.find(c => c.id === characterId);
            if (character) {
                return character;
            }
        }
        return undefined; // Not found in this zone
    }

    /**
     * Updates character health and returns the new health value.
     * Returns null if character or owner not found.
     */
    async updateCharacterHealth(ownerId: string, characterId: string, healthChange: number): Promise<number | null> {
        // Find the zone the player is in first
        let character: RuntimeCharacterData | undefined;
        for (const zone of this.zones.values()) { // Search all zones
             const player = zone.players.get(ownerId);
             if (player) {
                 character = player.characters.find(c => c.id === characterId);
                 if (character) break; // Found it
             }
        }

        if (!character) {
            this.logger.warn(`updateCharacterHealth: Character ${characterId} for owner ${ownerId} not found in any zone.`);
            return null;
        }

        // Ensure currentHealth is initialized
        if (character.currentHealth === undefined || character.currentHealth === null) {
             character.currentHealth = character.baseHealth ?? 100; // Use baseHealth from Character entity
             this.logger.log(`Initialized currentHealth for ${characterId} to ${character.currentHealth}`);
        }

        character.currentHealth = (character.currentHealth ?? 0) + healthChange;

        // Ensure health constraints
        if (character.currentHealth < 0) {
            character.currentHealth = 0;
        }
        // TODO: Add check for exceeding max health (character.baseHealth)
        // if (character.currentHealth > character.baseHealth) {
        //     character.currentHealth = character.baseHealth;
        // }

        return character.currentHealth ?? null;
    }
}