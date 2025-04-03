// backend/src/game/zone.service.ts
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Socket } from 'socket.io';
import { Character } from '../character/character.entity';
import { User } from '../user/user.entity';
import { EnemyInstance } from './interfaces/enemy-instance.interface';
import { v4 as uuidv4 } from 'uuid';
import { EnemyService } from '../enemy/enemy.service'; // Import EnemyService
import { SpawnNest } from './interfaces/spawn-nest.interface'; // Import SpawnNest
import { Enemy } from 'src/enemy/enemy.entity'; // Import Enemy entity

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
    nests: Map<string, SpawnNest>; // <-- ADD Nests map
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
    state: 'idle' | 'moving' | 'attacking' | 'dead';
    attackTargetId: string | null;
    anchorX: number | null; // Last commanded position or spawn point
    anchorY: number | null;
    attackRange: number; // How close to attack
    aggroRange: number; // How far to automatically look for targets when idle
    leashDistance: number; // How far from anchor before returning
    // --- Attack Timing ---
    attackSpeed: number; // Milliseconds between attacks
    lastAttackTime: number; // Timestamp of the last attack (Date.now())
    // --- Death State ---
    timeOfDeath: number | null; // Timestamp when health reached 0
}
@Injectable()
export class ZoneService implements OnModuleInit {
    // In-memory store for all active zones
    // Key: zoneId (string), Value: ZoneState
    private zones: Map<string, ZoneState> = new Map();
    private logger: Logger = new Logger('ZoneService');

    // Define Zone Boundaries (adjust as needed)
    private readonly ZONE_WIDTH = 1000;
    private readonly ZONE_HEIGHT = 1000;
    private readonly NESTS_PER_TEMPLATE = 6; // How many nests to create per enemy type

    constructor(private readonly enemyService: EnemyService) {
        // Initialize default zone(s) structure first
        this.zones.set('startZone', {
            players: new Map(),
            enemies: new Map(),
            nests: new Map() // Initialize empty nests map
        });
    }

    // Use OnModuleInit to ensure EnemyService is ready and nests are created
    async onModuleInit() {
        await this.initializeDynamicNests('startZone');
    }

    // Method to dynamically populate nests for a given zone
    private async initializeDynamicNests(zoneId: string): Promise<void> {
        const zone = this.zones.get(zoneId);
        if (!zone) {
            this.logger.error(`Cannot initialize dynamic nests: Zone ${zoneId} not found.`);
            return;
        }

        let enemyTemplates: Enemy[] = [];
        try {
            enemyTemplates = await this.enemyService.findAll();
            if (enemyTemplates.length === 0) {
                this.logger.warn(`No enemy templates found. Cannot create dynamic nests for zone ${zoneId}.`);
                return;
            }
        } catch (error) {
            this.logger.error(`Failed to fetch enemy templates: ${error.message}`, error.stack);
            return;
        }

        this.logger.log(`Found ${enemyTemplates.length} enemy templates. Generating ${this.NESTS_PER_TEMPLATE} nests per template for zone ${zoneId}...`);

        const nests = new Map<string, SpawnNest>();
        enemyTemplates.forEach(template => {
            for (let i = 1; i <= this.NESTS_PER_TEMPLATE; i++) {
                const nestId = `${template.name.toLowerCase().replace(/\s+/g, '-')}-nest-${i}`;

                // Generate random parameters within defined ranges
                const center = {
                    x: Math.random() * this.ZONE_WIDTH,
                    y: Math.random() * this.ZONE_HEIGHT,
                };
                const radius = Math.floor(Math.random() * (120 - 70 + 1)) + 70; // 70-120
                const maxCapacity = Math.floor(Math.random() * (18 - 8 + 1)) + 8; // 8-18
                const respawnDelayMs = Math.floor(Math.random() * (15000 - 8000 + 1)) + 8000; // 8-15 seconds

                const newNest: SpawnNest = {
                    id: nestId,
                    zoneId: zoneId,
                    templateId: template.id, // Use ID from the fetched template
                    center: center,
                    radius: radius,
                    maxCapacity: maxCapacity,
                    currentEnemyIds: new Set(),
                    respawnDelayMs: respawnDelayMs,
                    lastSpawnCheckTime: 0,
                };
                nests.set(nestId, newNest);
            }
        });

        zone.nests = nests;
        this.logger.log(`Initialized ${nests.size} dynamic enemy nests for zone ${zoneId}.`);
    }

    // --- Player Management ---

    addPlayerToZone(zoneId: string, playerSocket: Socket, user: User, characters: Character[]): void {
        if (!this.zones.has(zoneId)) {
            this.logger.log(`Creating new zone: ${zoneId}`);
            // If creating a new zone, decide how/if to initialize nests
            // For now, only 'startZone' has predefined nests.
            // TODO: Maybe call initializeDynamicNests here if a new zone is created?
            this.zones.set(zoneId, { players: new Map(), enemies: new Map(), nests: new Map() });
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
            attackRange: char.attackRange, // Use value from entity
            aggroRange: char.aggroRange,   // Use value from entity
            leashDistance: char.leashDistance, // Use value from entity
            // --- Initialize Attack Timing ---
            attackSpeed: char.attackSpeed, // Use value from entity
            lastAttackTime: 0, // Initialize to 0, meaning they can attack immediately
            // --- Initialize Death State ---
            timeOfDeath: null, // Initialize as not dead
        }));

        zone.players.set(user.id, { socket: playerSocket, user, characters: runtimeCharacters });
        // console.log(zone);
        // console.log(this.zones);
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

                // If zone becomes empty of PLAYERS, stop spawning checks for it (enemies remain)
                if (zone.players.size === 0) {
                    this.logger.log(`Zone ${zoneId} is now empty of players.`);
                    // Decide if we want to clear enemies or keep them. For now, keep them.
                    // Optionally stop nest checks if no players are present
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
          name: enemyTemplate.name,
          currentHealth: enemyTemplate.baseHealth,
          position,
          aiState: 'IDLE',
          // Add base stats from template
          baseAttack: enemyTemplate.baseAttack,
          baseDefense: enemyTemplate.baseDefense,
          // Add other relevant properties if needed
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
    if (zone.enemies.has(id)) {
        const enemy = zone.enemies.get(id);
        if (enemy && enemy.nestId) {
            const nest = zone.nests.get(enemy.nestId);
            if (nest) {
                nest.currentEnemyIds.delete(id);
            }
        }
        return zone.enemies.delete(id);
    }
    return false;
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
        // Find the character across all zones (might be inefficient if many zones)
        let foundCharacter: RuntimeCharacterData | null = null;
        let foundZoneId: string | null = null;

        // Find the character across all zones (might be inefficient if many zones)
        for (const [zoneId, zone] of this.zones.entries()) {
            const player = zone.players.get(ownerId);
            if (player) {
                const character = player.characters.find(c => c.id === characterId);
                if (character) {
                    foundCharacter = character;
                    foundZoneId = zoneId;
                    break;
                }
            }
        }

        if (!foundCharacter || !foundZoneId) {
            this.logger.warn(`Attempted to update health for non-existent character ${characterId} (owner: ${ownerId})`);
            return null; // Character not found
        }

        const currentHealth = foundCharacter.currentHealth ?? foundCharacter.baseHealth; // Default to base health if null/undefined
        let newHealth = currentHealth + healthChange;

        // Clamp health between 0 and baseHealth
        newHealth = Math.max(0, newHealth);
        newHealth = Math.min(foundCharacter.baseHealth, newHealth); // <-- Clamp at max

        // Only update if health actually changed
        if (newHealth !== foundCharacter.currentHealth) {
             foundCharacter.currentHealth = newHealth;

             // Handle potential death state transition
             if (foundCharacter.currentHealth <= 0 && foundCharacter.state !== 'dead') {
                 this.logger.log(`Character ${characterId} died.`);
                 foundCharacter.state = 'dead';
                 foundCharacter.timeOfDeath = Date.now();
                 // Stop actions
                 foundCharacter.attackTargetId = null;
                 foundCharacter.targetX = null;
                 foundCharacter.targetY = null;
             } else if (foundCharacter.currentHealth > 0 && foundCharacter.state === 'dead') {
                 // This handles respawn health setting
                  this.logger.log(`Character ${characterId} health updated above 0 while dead (likely respawn).`);
                 // State transition back to idle happens elsewhere (e.g., GameGateway respawn logic)
             }

             this.logger.verbose(`Updated health for character ${characterId} in zone ${foundZoneId}. New health: ${foundCharacter.currentHealth}/${foundCharacter.baseHealth}`);
        }

        return foundCharacter.currentHealth; // Return the new health value
    }

    // --- Nest-Based Spawning Logic ---

    // Modified addEnemy to optionally link to a nest
    async addEnemyFromNest(nest: SpawnNest): Promise<EnemyInstance | null> {
        const zone = this.zones.get(nest.zoneId);
        if (!zone) {
            console.warn(`Nest ${nest.id} references non-existent zone ${nest.zoneId}.`);
            return null;
        }

        const enemyTemplate = await this.enemyService.findOne(nest.templateId);
        if (!enemyTemplate) {
            console.warn(`Nest ${nest.id} references non-existent enemy template ${nest.templateId}.`);
            nest.lastSpawnCheckTime = Date.now(); // Prevent spamming checks for bad template
            return null;
        }

        const id = uuidv4();
        // Spawn within the nest radius
        const angle = Math.random() * Math.PI * 2;
        const distance = Math.random() * nest.radius;
        const position = {
            x: nest.center.x + Math.cos(angle) * distance,
            y: nest.center.y + Math.sin(angle) * distance,
        };

        const newEnemy: EnemyInstance = {
            id,
            templateId: nest.templateId,
            zoneId: nest.zoneId,
            name: enemyTemplate.name,
            currentHealth: enemyTemplate.baseHealth,
            position,
            aiState: 'IDLE', // Start idle
            baseAttack: enemyTemplate.baseAttack,
            baseDefense: enemyTemplate.baseDefense,
            nestId: nest.id, // <-- Link to nest
            anchorX: nest.center.x, // <-- Set anchor to nest center
            anchorY: nest.center.y,
            wanderRadius: nest.radius, // <-- Set wander radius
            // Add other relevant properties if needed
        };

        zone.enemies.set(id, newEnemy);
        nest.currentEnemyIds.add(id); // <-- Track enemy in nest
        nest.lastSpawnCheckTime = Date.now(); // Update last spawn time for this nest

        return newEnemy;
    }

    // Helper to get all nests in a zone (potentially for debug or AI)
    getZoneNests(zoneId: string): SpawnNest[] {
        const zone = this.zones.get(zoneId);
        if (!zone) return [];
        return Array.from(zone.nests.values());
    }
}