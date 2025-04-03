// backend/src/game/game.gateway.ts
import {
  WebSocketGateway,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger, OnApplicationShutdown, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt'; // Import JwtService
import { UserService } from '../user/user.service'; // Import UserService
import { User } from '../user/user.entity'; // Import User entity
import { CharacterService } from '../character/character.service'; // Import CharacterService
import { Character } from '../character/character.entity'; // Import Character entity
import { ZoneService, ZoneCharacterState, RuntimeCharacterData } from './zone.service'; // Import ZoneService
import * as sanitizeHtml from 'sanitize-html';
import { CombatService } from './combat.service';
import { EnemyService } from 'src/enemy/enemy.service';
import { AIService } from './ai.service'; // Import the AI Service
import { AIAction, AIActionAttack, AIActionMoveTo } from './interfaces/ai-action.interface'; // Import AIAction types
import { EnemyInstance } from './interfaces/enemy-instance.interface'; // Import EnemyInstance
import { SpawnNest } from './interfaces/spawn-nest.interface'; // Import SpawnNest

@WebSocketGateway({
  cors: { /* ... */ },
})
export class GameGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect, OnApplicationShutdown {
  @WebSocketServer() server: Server;
  private logger: Logger = new Logger('GameGateway');
  private gameLoopTimeout: NodeJS.Timeout | null = null; // Changed from Interval
  private isLoopRunning = false;
  private readonly TICK_RATE = 100; // ms (10 FPS)
  private readonly MOVEMENT_SPEED = 150; // Pixels per second
  private readonly ENEMY_MOVEMENT_SPEED = 75; // Pixels per second
  private readonly CHARACTER_HEALTH_REGEN_PERCENT_PER_SEC = 1.0; // Regenerate 1% of max health per second

  constructor(
    private jwtService: JwtService, // Inject JwtService
    private userService: UserService, // Inject UserService
    private characterService: CharacterService, // Inject CharacterService
    private zoneService: ZoneService, // Inject ZoneService
    private combatService: CombatService, // Inject CombatService
    private enemyService: EnemyService, // Inject EnemyService
    private aiService: AIService,     // Inject AIService
  ) {}

  afterInit(server: Server) {
    this.logger.log('WebSocket Gateway Initialized');

    // Socket.IO Middleware for Authentication
    server.use(async (socket: Socket, next) => {
      // Extract token from handshake - Standard way is via auth object
      const token = socket.handshake.auth?.token;
      // Alternative: Extract from query param (less secure)
      // const token = socket.handshake.query?.token as string;

      if (!token) {
        this.logger.error(`Authentication Error: No token provided by ${socket.id}`);
        return next(new UnauthorizedException('Authentication token not provided'));
      }

      try {
        this.logger.log(`Verifying token for ${socket.id}`);
        // Verify the token and decode payload
        const payload = await this.jwtService.verifyAsync(token, {
          // Use the same secret as in AuthModule/JwtStrategy
          secret: 'YOUR_VERY_SECRET_KEY_CHANGE_ME_LATER', // Replace with env var later!
        });

        // Token is valid, fetch user data
        const user = await this.userService.findOneById(payload.sub);

        if (!user) {
          this.logger.error(`Authentication Error: User not found for token sub ${payload.sub}`);
          return next(new UnauthorizedException('User not found'));
        }

        // Attach user to the socket object for later use
        // IMPORTANT: Use socket.data which is the official way in Socket.IO v3/v4
        // Avoid attaching directly like socket.user
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { passwordHash, ...userData } = user; // Exclude sensitive data
        socket.data.user = userData as User; // Store user data without hash

        this.logger.log(`Authentication Successful for ${socket.id}, User: ${user.username}`);
        next(); // Proceed with connection

      } catch (error) {
        this.logger.error(`Authentication Error for ${socket.id}: ${error.message}`);
        // Handle specific errors like TokenExpiredError if needed
        return next(new UnauthorizedException('Authentication failed: ' + error.message));
      }
    });
    // --- Start Game Loop using recursive setTimeout ---
    if (!this.isLoopRunning) {
        this.logger.log(`Starting game loop with tick rate ${this.TICK_RATE}ms`);
        this.isLoopRunning = true;
        this.scheduleNextTick();
    }
  }

  private scheduleNextTick(): void {
    // Clear previous timeout just in case
    if (this.gameLoopTimeout) {
        clearTimeout(this.gameLoopTimeout);
    }
    // Schedule the next tick
    this.gameLoopTimeout = setTimeout(async () => {
        if (this.isLoopRunning) { // Check if loop should still be running
             await this.tickGameLoop(); // Await the async tick
             this.scheduleNextTick(); // Schedule the next one after completion
        }
    }, this.TICK_RATE);
  }

  onApplicationShutdown(signal?: string) {
    this.logger.log('Stopping game loop...');
    this.isLoopRunning = false; // Signal the loop to stop
    if (this.gameLoopTimeout) {
        clearTimeout(this.gameLoopTimeout);
        this.gameLoopTimeout = null;
    }
    this.logger.log('Game loop stopped.');
  }

  // Make the game loop async
  private async tickGameLoop(): Promise<void> {
    const startTime = Date.now();
    const now = startTime; // Use consistent timestamp for checks within the tick
    const deltaTime = this.TICK_RATE / 1000.0; // Delta time in seconds

    try {
        for (const [zoneId, zone] of (this.zoneService as any).zones.entries()) { // Use getter later
            if (zone.players.size === 0 && zone.enemies.size === 0) continue; //Skip zones with no players or enemies

            const updates: Array<{ id: string, x?: number | null, y?: number | null, health?: number | null, state?: string }> = [];
            const combatActions: Array<any> = [];
            const deaths: Array<{ entityId: string, type: 'character' | 'enemy' }> = [];
            const spawnedEnemies: EnemyInstance[] = []; // Track newly spawned enemies this tick

            const enemies = this.zoneService.getZoneEnemies(zoneId); // Get enemies once per zone tick

            // --- Character Processing ---
            for (const player of zone.players.values()) {
                for (const character of player.characters) {
                    let needsPositionUpdate = false;
                    let healthChanged = false;

                    // --- -1. Respawn Check ---
                    if (character.state === 'dead' && character.timeOfDeath !== null) {
                         if (now >= character.timeOfDeath + 5000) {
                             // Keep this log
                             this.logger.log(`Character ${character.id} [${character.name}] respawning.`);
                             character.currentHealth = character.baseHealth;
                             character.state = 'idle';
                             character.timeOfDeath = null;
                             if (character.anchorX !== null && character.anchorY !== null) {
                                 character.positionX = character.anchorX;
                                 character.positionY = character.anchorY;
                             } else { character.positionX = 100; character.positionY = 100; }
                             character.attackTargetId = null;
                             character.targetX = null;
                             character.targetY = null;
                             healthChanged = true;
                             needsPositionUpdate = true;
                             continue;
                         }
                         continue;
                     }

                     // --- 0. Death Check ---
                     if (character.currentHealth <= 0 && character.state !== 'dead') {
                         // Keep this log
                         this.logger.log(`Character ${character.id} [${character.name}] has died.`);
                         character.timeOfDeath = Date.now();
                         character.state = 'dead';
                         character.attackTargetId = null;
                         character.targetX = null;
                         character.targetY = null;
                         deaths.push({ entityId: character.id, type: 'character' });
                         healthChanged = true;
                         continue;
                     }
                     if (character.state === 'dead') { continue; }

                    // --- 0.5 Health Regeneration ---
                    if (character.currentHealth < character.baseHealth) {
                        const regenAmount = (character.baseHealth * this.CHARACTER_HEALTH_REGEN_PERCENT_PER_SEC / 100) * deltaTime;
                        if (regenAmount > 0) {
                            const newHealth = await this.zoneService.updateCharacterHealth(player.user.id, character.id, regenAmount);
                            if (newHealth !== null && newHealth !== character.currentHealth) {
                                healthChanged = true;
                                // REMOVED: Verbose log for regen
                            }
                        }
                    }

                    // --- 1. Leashing Check ---
                    let isLeashing = false;
                    if (character.anchorX !== null && character.anchorY !== null && character.leashDistance > 0) {
                        const distToAnchorSq = (character.positionX - character.anchorX)**2 + (character.positionY - character.anchorY)**2;
                        if (distToAnchorSq > character.leashDistance * character.leashDistance) {
                            isLeashing = true;
                            if (character.state !== 'moving' || character.targetX !== character.anchorX || character.targetY !== character.anchorY) {
                                // REMOVED: Debug log for leash trigger
                                character.state = 'moving';
                                character.targetX = character.anchorX;
                                character.targetY = character.anchorY;
                                character.attackTargetId = null;
                            }
                        }
                    }

                    // --- 2. State Logic (Only if NOT leashing) ---
                    if (!isLeashing) {
                        switch (character.state) {
                            case 'attacking':
                                const targetEnemy = character.attackTargetId ? this.zoneService.getEnemyInstanceById(zoneId, character.attackTargetId) : undefined;
                                if (!targetEnemy || targetEnemy.currentHealth <= 0) {
                                    // REMOVED: Debug log for invalid target
                                    character.attackTargetId = null;
                                    character.state = 'idle';
                                    character.targetX = null;
                                    character.targetY = null;
                                } else {
                                    const distToTargetSq = (character.positionX - targetEnemy.position.x)**2 + (character.positionY - targetEnemy.position.y)**2;
                                    const attackRangeSq = character.attackRange * character.attackRange;
                                    if (distToTargetSq <= attackRangeSq) {
                                        // In Range: Attack
                                        if (character.targetX !== null || character.targetY !== null) {
                                            character.targetX = null;
                                            character.targetY = null;
                                        }
                                        if (now >= character.lastAttackTime + character.attackSpeed) {
                                            // REMOVED: Verbose log for attack attempt
                                            const combatResult = await this.combatService.handleAttack(character, targetEnemy, zoneId);
                                            character.lastAttackTime = now;
                                            combatActions.push({ attackerId: character.id, targetId: targetEnemy.id, damage: combatResult.damageDealt, type: 'attack' });
                                            const enemyUpdateIndex = updates.findIndex(u => u.id === targetEnemy.id);
                                            if (enemyUpdateIndex > -1) { updates[enemyUpdateIndex].health = combatResult.targetCurrentHealth; }
                                            else { updates.push({ id: targetEnemy.id, x: targetEnemy.position.x, y: targetEnemy.position.y, health: combatResult.targetCurrentHealth }); }
                                            if (combatResult.targetDied) {
                                                // Keep this log
                                                this.logger.log(`Enemy ${targetEnemy.id} died from attack by Character ${character.id}`);
                                                deaths.push({ entityId: targetEnemy.id, type: 'enemy' });
                                                character.attackTargetId = null;
                                                character.state = 'idle';
                                                this.zoneService.removeEnemy(zoneId, targetEnemy.id);
                                            }
                                        }
                                    } else {
                                        // Out of Range: Move Towards Target
                                        if (character.targetX !== targetEnemy.position.x || character.targetY !== targetEnemy.position.y) {
                                             // REMOVED: Verbose log for moving to attack
                                            character.targetX = targetEnemy.position.x;
                                            character.targetY = targetEnemy.position.y;
                                        }
                                    }
                                }
                                break;
                            case 'moving':
                                break;
                            case 'idle':
                                // REMOVED: Verbose log for processing idle state
                                if (character.aggroRange > 0) {
                                    // REMOVED: Verbose log for scanning
                                    const nearbyEnemies = enemies.filter(enemy => {
                                        if (enemy.currentHealth <= 0) return false; // Skip dead

                                        // Ensure positions are valid numbers before calculating distance
                                        if (character.positionX === null || character.positionY === null || typeof enemy.position.x !== 'number' || typeof enemy.position.y !== 'number') {
                                            // Keep this warning as it indicates a potential problem
                                            this.logger.warn(`    - Invalid position data for distance calculation: Char(${character.positionX}, ${character.positionY}), Enemy(${enemy.position.x}, ${enemy.position.y})`);
                                            return false;
                                        }
                                        // Correctly format character position for distance calculation
                                        const characterPos = { x: character.positionX, y: character.positionY };
                                        const dist = this.calculateDistance(characterPos, enemy.position);

                                        return dist <= character.aggroRange;
                                    });
                                    // REMOVED: Verbose log for number found
                                    if (nearbyEnemies.length > 0) {
                                        let closestEnemy: EnemyInstance | null = null;
                                        let minDistSq = Infinity;
                                        for (const enemy of nearbyEnemies) {
                                            const distSq = (character.positionX - enemy.position.x)**2 + (character.positionY - enemy.position.y)**2;
                                            if (distSq < minDistSq) {
                                                minDistSq = distSq;
                                                closestEnemy = enemy;
                                            }
                                        }
                                        if (closestEnemy) {
                                            // Keep this debug log for successful aggro start
                                            this.logger.debug(`Character ${character.id} [${character.name}] auto-aggroed onto Enemy ${closestEnemy.id} (Dist: ${Math.sqrt(minDistSq).toFixed(1)}). Switching to attacking state.`);
                                            character.state = 'attacking';
                                            character.attackTargetId = closestEnemy.id;
                                        } else { this.logger.warn(`Character ${character.id} found nearby enemies but failed to select a closest one?`); }
                                    } // else { REMOVED log for no enemies in range }
                                }
                                // Return to Anchor Check
                                if (character.state === 'idle' && character.anchorX !== null && character.anchorY !== null && (character.positionX !== character.anchorX || character.positionY !== character.anchorY)) {
                                    const distToAnchorSq = (character.positionX - character.anchorX)**2 + (character.positionY - character.anchorY)**2;
                                    if (distToAnchorSq > 1) {
                                         // REMOVED: Debug log for returning to anchor
                                         character.state = 'moving';
                                         character.targetX = character.anchorX;
                                         character.targetY = character.anchorY;
                                    }
                                }
                                break;
                        }
                    }

                    // --- 3. Movement Simulation ---
                    if (character.targetX !== null && character.targetY !== null) {
                        const dx = character.targetX - character.positionX;
                        const dy = character.targetY - character.positionY;
                        const distance = Math.sqrt(dx * dx + dy * dy);
                        const moveAmount = this.MOVEMENT_SPEED * deltaTime;
                        if (distance <= moveAmount) {
                            // Reached Target
                            character.positionX = character.targetX;
                            character.positionY = character.targetY;
                            character.targetX = null;
                            character.targetY = null;
                            if (character.state === 'moving') {
                                // REMOVED: Verbose log for reaching move target
                                character.state = 'idle';
                            }
                            needsPositionUpdate = true;
                        } else {
                            // Move towards Target
                            character.positionX += (dx / distance) * moveAmount;
                            character.positionY += (dy / distance) * moveAmount;
                            needsPositionUpdate = true;
                        }
                        this.zoneService.updateCharacterCurrentPosition(player.user.id, character.id, character.positionX, character.positionY);
                    } else if (character.state === 'moving') {
                        // Keep this warning
                        this.logger.warn(`Character ${character.id} was in moving state but had no target. Setting idle.`);
                        character.state = 'idle';
                    }

                    // --- Batch Update Preparation ---
                    if (needsPositionUpdate || healthChanged) {
                        const updateIndex = updates.findIndex(u => u.id === character.id);
                        const updateData: any = { id: character.id };
                        if (needsPositionUpdate) {
                            updateData.x = character.positionX;
                            updateData.y = character.positionY;
                        }
                        if (healthChanged) {
                            updateData.health = character.currentHealth;
                        }
                        // Always include state if updating?
                        updateData.state = character.state;

                        if (updateIndex > -1) {
                            // Merge new data into existing update
                            Object.assign(updates[updateIndex], updateData);
                        } else {
                            updates.push(updateData);
                        }
                    }
                } // End character loop
            } // End player loop

            // --- Enemy AI & Movement Processing ---
            const currentEnemies = this.zoneService.getZoneEnemies(zoneId); // Renamed to avoid conflict
            for (const enemy of currentEnemies) {
                if (enemy.currentHealth <= 0) continue;
                const action = this.aiService.updateEnemyAI(enemy, zoneId);
                let enemyNeedsUpdate = false;
                switch (action.type) {
                    case 'ATTACK':
                        const targetCharacterState = this.zoneService.getCharacterStateById(zoneId, action.targetEntityId);
                        if (targetCharacterState && targetCharacterState.currentHealth > 0) {
                            // REMOVED: Verbose log for enemy attack execution
                            const combatResult = await this.combatService.handleAttack(enemy, targetCharacterState, zoneId);
                            combatActions.push({ attackerId: enemy.id, targetId: action.targetEntityId, damage: combatResult.damageDealt, type: 'attack' });
                            const charUpdateIndex = updates.findIndex(u => u.id === action.targetEntityId);
                            if (charUpdateIndex > -1) { updates[charUpdateIndex].health = combatResult.targetCurrentHealth; }
                            else { updates.push({ id: action.targetEntityId, x: targetCharacterState.positionX, y: targetCharacterState.positionY, health: combatResult.targetCurrentHealth }); }
                            if (combatResult.targetDied) {
                                // Keep this log
                                this.logger.log(`Character ${action.targetEntityId} died from attack by Enemy ${enemy.id}`);
                                const deadCharUpdateIndex = updates.findIndex(u => u.id === action.targetEntityId);
                                if (deadCharUpdateIndex > -1) { updates[deadCharUpdateIndex].health = 0; updates[deadCharUpdateIndex].state = 'dead'; }
                                else { updates.push({ id: action.targetEntityId, x: targetCharacterState.positionX, y: targetCharacterState.positionY, health: 0, state: 'dead' }); }
                                deaths.push({ entityId: action.targetEntityId, type: 'character' });
                            }
                        } else {
                             // Keep this warning
                             this.logger.warn(`Enemy ${enemy.id} tried to attack invalid/dead target ${action.targetEntityId}. AI should prevent this.`);
                        }
                        break;
                    case 'MOVE_TO':
                         if (!enemy.target || enemy.target.x !== action.target.x || enemy.target.y !== action.target.y) {
                             this.zoneService.setEnemyTarget(zoneId, enemy.id, action.target);
                             enemy.target = action.target;
                         }
                        break;
                    case 'IDLE':
                        if (enemy.target) {
                            this.zoneService.setEnemyTarget(zoneId, enemy.id, null);
                            enemy.target = null;
                        }
                        break;
                }

                // Enemy Movement Simulation
                if (enemy.target) {
                    const dx = enemy.target.x - enemy.position.x;
                    const dy = enemy.target.y - enemy.position.y;
                    const distance = Math.sqrt(dx * dx + dy * dy);
                    const moveAmount = this.ENEMY_MOVEMENT_SPEED * deltaTime;
                    if (distance <= moveAmount) {
                        // Reached Target
                        enemy.position.x = enemy.target.x;
                        enemy.position.y = enemy.target.y;
                        const previousTarget = enemy.target;
                        enemy.target = null;
                        this.zoneService.setEnemyTarget(zoneId, enemy.id, null);
                        if (enemy.aiState === 'WANDERING' || enemy.aiState === 'LEASHED') {
                            // REMOVED: Verbose log for finishing wander/leash move
                            this.zoneService.setEnemyAiState(zoneId, enemy.id, 'IDLE');
                        } else if (enemy.aiState === 'CHASING'){
                            // REMOVED: Verbose log for reaching chase target
                        }
                        enemyNeedsUpdate = true;
                    } else {
                        // Move towards Target
                        enemy.position.x += (dx / distance) * moveAmount;
                        enemy.position.y += (dy / distance) * moveAmount;
                        enemyNeedsUpdate = true;
                    }
                    this.zoneService.updateEnemyPosition(zoneId, enemy.id, enemy.position);
                }
                if (enemyNeedsUpdate) {
                    const updateIndex = updates.findIndex(u => u.id === enemy.id);
                    if (updateIndex > -1) {
                        updates[updateIndex].x = enemy.position.x;
                        updates[updateIndex].y = enemy.position.y;
                        // Health was updated during combat calculation
                    } else {
                        updates.push({ id: enemy.id, x: enemy.position.x, y: enemy.position.y });
                    }
                }
            } // End enemy loop

            // --- Nest Spawning Check --- 
            const nests = this.zoneService.getZoneNests(zoneId);
            for (const nest of nests) {
                 if (nest.currentEnemyIds.size < nest.maxCapacity) {
                     if (now >= nest.lastSpawnCheckTime + nest.respawnDelayMs) {
                         // REMOVED: Verbose log for nest ready check
                         const newEnemy = await this.zoneService.addEnemyFromNest(nest);
                         if (newEnemy) {
                            spawnedEnemies.push(newEnemy);
                            updates.push({ id: newEnemy.id, x: newEnemy.position.x, y: newEnemy.position.y, health: newEnemy.currentHealth, state: newEnemy.aiState });
                         }
                     }
                 }
            } // End nest spawning check loop

            // --- Broadcast Updates ---
            if (updates.length > 0) { this.server.to(zoneId).emit('entityUpdate', { updates }); }
            if (spawnedEnemies.length > 0) {
                // REMOVED: Debug log for broadcasting spawns
                spawnedEnemies.forEach(enemy => { this.server.to(zoneId).emit('enemySpawned', enemy); });
            }
            if (combatActions.length > 0) { this.server.to(zoneId).emit('combatAction', { actions: combatActions }); }
             if (deaths.length > 0) {
                // REMOVED: Debug log for broadcasting deaths
                 deaths.forEach(death => { this.server.to(zoneId).emit('entityDied', death); });
            }
        } // End zone loop
    } catch (error) {
        this.logger.error(`Error in game loop: ${error.message}`, error.stack);
    }

    const endTime = Date.now();
    const duration = endTime - startTime;
    if (duration > this.TICK_RATE) {
        this.logger.warn(`Game loop took ${duration}ms, exceeding tick rate of ${this.TICK_RATE}ms.`);
    }
  }

  handleDisconnect(client: Socket) {
    const user = client.data.user as User;
    const username = user?.username || 'Unknown';
    this.logger.log(`Client disconnected: ${client.id} (${username})`);
    delete client.data.currentZoneId;
    // Remove player from zone and notify others
    const removalInfo = this.zoneService.removePlayerFromZone(client);
    if (removalInfo) {
      this.server.to(removalInfo.zoneId).emit('playerLeft', { playerId: removalInfo.userId }); // Broadcast user ID leaving
      this.logger.log(`Broadcast playerLeft for ${username} in zone ${removalInfo.zoneId}`);
    }
    // Clean up user state later (e.g., remove from zone)
    // delete client.data.user; // Clean up data if needed
  }

  // Connection is only established AFTER middleware 'next()' is called
  async handleConnection(client: Socket, ...args: any[]) {
    const username = client.data.user?.username; // Access authenticated user data
    this.logger.log(`Client connected: ${client.id} - User: ${username}`);
    // Proceed with game logic like adding to a lobby or requesting zone entry
  }

  // --- Chat Handler ---
  @SubscribeMessage('sendMessage')
  handleSendMessage(
      @MessageBody() data: { message: string },
      @ConnectedSocket() client: Socket,
  ): void { // No explicit return needed, just broadcast
      const user = client.data.user as User;
      const currentZoneId = client.data.currentZoneId as string;
      const partyCharacters = client.data.selectedCharacters as Character[];
      // Basic validation
      if (!user) {
          this.logger.warn(`sendMessage rejected: User not authenticated on socket ${client.id}`);
          return; // Or send error ack to client
      }
      if (!currentZoneId) {
          this.logger.warn(`sendMessage rejected: User ${user.username} not in a zone.`);
          return; // Or send error ack to client
      }
      if (!partyCharacters || partyCharacters.length === 0) {
        this.logger.warn(`sendMessage rejected: User ${user.username} has no party selected.`);
        return;
   }
      if (!data || typeof data.message !== 'string' || data.message.trim().length === 0) {
          this.logger.warn(`sendMessage rejected: Invalid message data from ${user.username}.`);
          return; // Or send error ack to client
      }

      const rawMessage = data.message;
      // Limit message length
      const MAX_MSG_LENGTH = 200;
      if (rawMessage.length > MAX_MSG_LENGTH) {
            this.logger.warn(`sendMessage rejected: Message too long from ${user.username}.`);
            // Optionally send an error back to the client here
            return;
      }

      // --- Sanitize Message ---
      const sanitizedMessage = sanitizeHtml(rawMessage.trim(), {
          allowedTags: [], // No HTML tags allowed
          allowedAttributes: {}, // No attributes allowed
      });

      if (sanitizedMessage.length === 0) {
            this.logger.warn(`sendMessage rejected: Message empty after sanitization from ${user.username}.`);
            return;
      }
      // -----------------------
      // --- Determine Sender Character ID (Assume Leader) ---
      const senderCharacterId = partyCharacters[0]?.id; // Get ID of the first character
      if (!senderCharacterId) {
          this.logger.error(`Could not determine senderCharacterId for user ${user.username}`);
          return; // Cannot proceed without a character ID
      }
      const payload = {
        senderName: user.username,
        senderCharacterId: senderCharacterId, // Example: ID of leader char
        message: sanitizedMessage,
        timestamp: Date.now(),
    };

      // Broadcast to the specific zone room
      this.logger.log(`>>> Broadcasting chatMessage to zone ${currentZoneId} with payload:`, payload); // Log BEFORE emit

      this.server.to(currentZoneId).emit('chatMessage', payload);
      
      this.logger.log(`>>> Broadcast COMPLETE for message from ${user.username}`); // Log AFTER emit

      this.logger.log(`[Chat][${currentZoneId}] ${user.username}: ${sanitizedMessage}`);
  }
  // Example message handler accessing authenticated user
  @SubscribeMessage('messageToServer')
  handleMessage(
    @MessageBody() data: string,
    @ConnectedSocket() client: Socket,
  ): string {
    const user = client.data.user as User; // Get user attached by middleware
    if (!user) {
      // This shouldn't happen if auth middleware is working, but good practice to check
      return 'Error: Not Authenticated';
    }
    this.logger.log(`Message from ${user.username} (${client.id}): ${data}`);
    return `Message received from ${user.username}!`;
  }
  @SubscribeMessage('selectParty')
  async handleSelectParty(
    @MessageBody() data: { characterIds: string[] },
    @ConnectedSocket() client: Socket,
  ): Promise<{ success: boolean; characters?: Character[]; message?: string }> { // Return acknowledge response
    const user = client.data.user as User;
    if (!user) {
      return { success: false, message: 'User not authenticated.' };
    }

    const characterIds = data.characterIds;

    // Validation
    if (!Array.isArray(characterIds) || characterIds.length === 0) {
        return { success: false, message: 'No characters selected.' };
    }
    if (characterIds.length > 3) { // Ensure limit (adjust if needed)
        return { success: false, message: 'Too many characters selected (max 3).' };
    }

    // Verify that all selected characters belong to the user and exist
    const characters: Character[] = [];
    for (const id of characterIds) {
      // Basic UUID check (optional, ParseUUIDPipe would do this on controller)
      // if (!isValidUUID(id)) return { success: false, message: `Invalid character ID format: ${id}` };

      const character = await this.characterService.findCharacterByIdAndUserId(id, user.id);
      if (!character) {
        this.logger.warn(`User ${user.username} tried to select invalid/unowned character ${id}`);
        return { success: false, message: `Character not found or not owned: ${id}` };
      }
      characters.push(character);
    }
    // --- Modify the returned character data ---
    const charactersWithUsername = characters.map(char => ({
      ...char, // Include all original character fields
      ownerName: user.username, // Add the username from the authenticated user
  }));
    // Store the selected party on the socket data for this session
    // This is the active party for this specific connection
    client.data.selectedCharacters = characters;
    this.logger.log(`User ${user.username} (${client.id}) selected party: ${characters.map(c => c.name).join(', ')}`);

    // Acknowledge success back to the client, optionally sending the validated character data
    return { success: true, characters: charactersWithUsername };
  }

  @SubscribeMessage('enterZone')
  async handleEnterZone(
    @MessageBody() data: { zoneId: string },
    @ConnectedSocket() client: Socket,
  ): Promise<{ success: boolean; zoneState?: ZoneCharacterState[]; enemyState?:any[]; message?: string }> {
      const user = client.data.user as User;
      const selectedCharacters = client.data.selectedCharacters as Character[];
      const zoneId = data.zoneId || 'startZone'; // Default to 'startZone' if not provided

      if (!user) return { success: false, message: 'User not authenticated.' };
      if (!selectedCharacters || selectedCharacters.length === 0) {
          return { success: false, message: 'No character party selected.' };
      }

      client.data.currentZoneId = zoneId;
      // TODO: Add validation if player is already in another zone?

      this.logger.log(`User ${user.username} attempting to enter zone ${zoneId}`);
      const existingEnemies = this.zoneService.getZoneEnemies(zoneId);
      // 1. Get state of other players already in the zone BEFORE adding the new player
      const playersAlreadyInZone = this.zoneService.getZoneCharacterStates(zoneId);

      // 2. Add the new player to the zone state
      this.zoneService.addPlayerToZone(zoneId, client, user, selectedCharacters);

      // 3. Notify OTHERS in the zone that a new player joined
      // Prepare data about the new player's characters
      const newPlayerCharacterStates: ZoneCharacterState[] = selectedCharacters.map(char => ({
          id: char.id,
          ownerId: user.id,
          ownerName: user.username,
          name: char.name,
          level: char.level,
          x: char.positionX,
          y: char.positionY,
      }));
      // Broadcast only the NEW player's characters to existing players in the room
      client.to(zoneId).emit('playerJoined', { characters: newPlayerCharacterStates }); // Send array of characters
      this.logger.log(`Broadcast playerJoined for ${user.username} to zone ${zoneId}`);

      // 4. Send the state of existing players to the NEW player
      return { success: true, zoneState: playersAlreadyInZone, enemyState: existingEnemies };
  }

  @SubscribeMessage('moveCommand')
  async handleMoveCommand(
    @MessageBody() data: { target: { x: number; y: number } }, // Remove characterId for now, move the whole party
    @ConnectedSocket() client: Socket,
) {
    const user = client.data.user as User;
    // Fetch the runtime character data which includes targetX/Y
    const partyCharacters = this.zoneService.getPlayerCharacters(user.id);

    if (!user || !partyCharacters || partyCharacters.length === 0) {
        this.logger.warn(`Move command ignored for user ${user?.username}: No party found`);
        return;
    }

    const formationCenter = data.target;
    const formationOffset = 30; // Pixels - distance from center for flanking characters

    // --- Calculate target positions for each character ---
    const targets: { charId: string, targetX: number, targetY: number }[] = [];

    // Simple triangle formation (adjust as needed)
    if (partyCharacters.length > 0) {
        // Character 1 (Leader) - Slightly ahead
        targets.push({
            charId: partyCharacters[0].id,
            targetX: formationCenter.x,
            targetY: formationCenter.y - formationOffset * 0.5 // Adjust vertical offset if needed
        });
    }
    if (partyCharacters.length > 1) {
        // Character 2 (Left Flank)
        targets.push({
            charId: partyCharacters[1].id,
            targetX: formationCenter.x - formationOffset,
            targetY: formationCenter.y + formationOffset * 0.5 // Adjust vertical offset if needed
        });
    }
    if (partyCharacters.length > 2) {
        // Character 3 (Right Flank)
        targets.push({
            charId: partyCharacters[2].id,
            targetX: formationCenter.x + formationOffset,
            targetY: formationCenter.y + formationOffset * 0.5 // Adjust vertical offset if needed
        });
    }
    // Handle > 3 characters later if needed

    // --- Update target positions AND anchor points in ZoneService ---
    for (const target of targets) {
        // Find the full character data in memory to update it
        const character = partyCharacters.find(c => c.id === target.charId);
        if (character) {
            // Set the movement target
            character.targetX = target.targetX;
            character.targetY = target.targetY;
            // Set the anchor point (leash point) to the destination
            character.anchorX = target.targetX;
            character.anchorY = target.targetY;
            // Clear any attack target, movement command overrides attacking
            character.attackTargetId = null;
            // Set state to moving
            character.state = 'moving';

            // Optional: Log the calculated target
            this.logger.debug(`MoveCmd: Set state=moving, target/anchor for char ${target.charId} to ${target.targetX}, ${target.targetY}`);
        } else {
            this.logger.warn(`MoveCmd: Could not find character ${target.charId} in runtime data for user ${user.id}`);
        }
    }

    // The actual movement happens in the game loop based on these targets and state
}
   @SubscribeMessage('attackCommand')
    handleAttackCommand(
        @MessageBody() data: { targetId: string },
        @ConnectedSocket() client: Socket,
    ): void {
        const user = client.data.user as User;
        const partyCharacters = this.zoneService.getPlayerCharacters(user.id);
        const zoneId = client.data.currentZoneId; // Use the zone ID stored on the socket

        if (!user || !partyCharacters || partyCharacters.length === 0) {
            this.logger.warn(`Attack command ignored for user ${user?.username}: No party found`);
            return;
        }
        if (!zoneId) {
            this.logger.warn(`Attack command ignored for user ${user?.username}: Not currently in a zone`);
            return;
        }

        // Validate the target enemy exists in the current zone
        const targetEnemy = this.zoneService.getEnemyInstanceById(zoneId, data.targetId);

        if (!targetEnemy) {
            this.logger.warn(`Attack command ignored: Target enemy ${data.targetId} not found in zone ${zoneId}.`);
            // TODO: Maybe send an acknowledgement back to the client indicating failure?
            return;
        }

        // Set the target and state for ALL characters in the party
        for (const character of partyCharacters) {
            character.attackTargetId = data.targetId;
            character.state = 'attacking';
            // Clear any existing movement target, attacking takes priority
            character.targetX = null;
            character.targetY = null;
            this.logger.debug(`AttackCmd: Set state=attacking, target=${data.targetId} for char ${character.id}`);
        }

        // The actual attacking/movement to target happens in the game loop
    }

        //  --------------------- AI ADDITIONS ---------------------
  private calculateDistance(point1: {x:number, y:number}, point2: {x:number, y:number}): number {
      const dx = point1.x - point2.x;
      const dy = point1.y - point2.y;
      return Math.sqrt(dx * dx + dy * dy);
  }
}