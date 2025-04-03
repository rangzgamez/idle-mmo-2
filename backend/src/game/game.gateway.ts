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
    const deltaTime = this.TICK_RATE / 1000.0; // Delta time in seconds

    try {
        for (const [zoneId, zone] of (this.zoneService as any).zones.entries()) { // Use getter later
            if (zone.players.size === 0 && zone.enemies.size === 0) continue; //Skip zones with no players or enemies

            const updates: Array<{ id: string, x: number | null, y: number | null, health?: number | null }> = [];
            const combatActions: Array<any> = [];
            const deaths: Array<{ entityId: string, type: 'character' | 'enemy' }> = [];

            const enemies = this.zoneService.getZoneEnemies(zoneId); // Get enemies once per zone tick

            // --- Character Processing (RTS Style) ---
            for (const player of zone.players.values()) {
                for (const character of player.characters) { // character is RuntimeCharacterData
                    let needsPositionUpdate = false;

                     // --- -1. Respawn Check (if dead) ---
                     if (character.state === 'dead' && character.timeOfDeath !== null) {
                         const now = Date.now();
                         const RESPAWN_DELAY = 5000; // 5 seconds
                         if (now >= character.timeOfDeath + RESPAWN_DELAY) {
                             this.logger.log(`Character ${character.id} [${character.name}] respawning.`);
                             character.currentHealth = character.baseHealth; // Restore health
                             character.state = 'idle';
                             character.timeOfDeath = null;
                             // Move back to anchor point upon respawn
                             if (character.anchorX !== null && character.anchorY !== null) {
                                 character.positionX = character.anchorX;
                                 character.positionY = character.anchorY;
                             }
                             // No targets after respawn
                             character.attackTargetId = null;
                             character.targetX = null;
                             character.targetY = null;

                            // Add/update the character state in updates array
                            const updateIndex = updates.findIndex(u => u.id === character.id);
                            if (updateIndex > -1) {
                                updates[updateIndex].x = character.positionX;
                                updates[updateIndex].y = character.positionY;
                                updates[updateIndex].health = character.currentHealth;
                                // Optionally include state? Needs client handling
                            } else {
                                updates.push({ id: character.id, x: character.positionX, y: character.positionY, health: character.currentHealth });
                            }
                            // Continue to next character, skip dead processing this tick
                            continue;
                         }
                         // Still dead and waiting for respawn timer, skip all other processing
                         continue;
                     }

                     // --- 0. Death Check (Transition to dead state) ---
                     if (character.currentHealth <= 0) {
                         // If already dead, do nothing further (handled by respawn check above)
                         // Transition to dead state
                         this.logger.log(`Character ${character.id} [${character.name}] has died.`);
                         character.timeOfDeath = Date.now(); // Record time of death
                         character.state = 'dead';
                         character.attackTargetId = null;
                         character.targetX = null;
                         character.targetY = null;

                        // Add final state to updates if not already present
                         const existingUpdateIndex = updates.findIndex(u => u.id === character.id);
                         if (existingUpdateIndex === -1) {
                             // Ensure the death state (health=0) is broadcast if not already
                              updates.push({ id: character.id, x: character.positionX, y: character.positionY, health: 0 });
                         } else if (updates[existingUpdateIndex].health !== 0) {
                             // Ensure existing update reflects health is 0
                            updates[existingUpdateIndex].health = 0;
                         }
                         continue; // Skip further processing for dead characters
                     }

                    // --- 1. Leashing Check ---
                    let isLeashing = false;
                    if (character.anchorX !== null && character.anchorY !== null && character.leashDistance > 0) { // Check leashDistance > 0
                        const distToAnchorSq = (character.positionX - character.anchorX)**2 + (character.positionY - character.anchorY)**2;
                        if (distToAnchorSq > character.leashDistance * character.leashDistance) {
                            isLeashing = true;
                            // Only update state/target if not already moving back to anchor
                            if (character.state !== 'moving' || character.targetX !== character.anchorX || character.targetY !== character.anchorY) {
                                this.logger.debug(`Character ${character.id} [${character.name}] leash triggered. Returning to anchor (${character.anchorX.toFixed(0)}, ${character.anchorY.toFixed(0)}).`);
                                character.state = 'moving';
                                character.targetX = character.anchorX;
                                character.targetY = character.anchorY;
                                character.attackTargetId = null; // Stop attacking when leashing
                            }
                        }
                    }

                    // --- 2. State Logic (Only if NOT leashing) ---
                    if (!isLeashing) {
                        switch (character.state) {
                            case 'attacking':
                                const targetEnemy = character.attackTargetId ? this.zoneService.getEnemyInstanceById(zoneId, character.attackTargetId) : undefined;

                                // Validate target
                                if (!targetEnemy || targetEnemy.currentHealth <= 0) {
                                    if (character.attackTargetId) {
                                        this.logger.debug(`Character ${character.id} [${character.name}] target ${character.attackTargetId} invalid/dead. Switching to idle.`);
                                    }
                                    character.attackTargetId = null;
                                    character.state = 'idle';
                                    character.targetX = null; // Stop moving if was approaching
                                    character.targetY = null;
                                } else {
                                    // Target is valid, check range
                                    const distToTargetSq = (character.positionX - targetEnemy.position.x)**2 + (character.positionY - targetEnemy.position.y)**2;
                                    const attackRangeSq = character.attackRange * character.attackRange;

                                    if (distToTargetSq <= attackRangeSq) {
                                        // --- In Range: Attack ---
                                        if (character.targetX !== null || character.targetY !== null) {
                                            character.targetX = null; // Stop moving
                                            character.targetY = null;
                                        }

                                        // TODO: Implement attack cooldown check here
                                        const now = Date.now();
                                        if (now >= character.lastAttackTime + character.attackSpeed) {
                                            this.logger.debug(`Character ${character.id} [${character.name}] attacking enemy ${targetEnemy.id}`);
                                            // Ensure combat service exists and can handle Character attacking Enemy
                                            if (this.combatService && typeof this.combatService.handleAttack === 'function') {
                                                const combatResult = await this.combatService.handleAttack(
                                                    character,   // Attacker (Character)
                                                    targetEnemy, // Defender (Enemy)
                                                    zoneId
                                                );

                                                // Update lastAttackTime ONLY after attempting the attack
                                                character.lastAttackTime = now;

                                                if (combatResult && !combatResult.error) {
                                                    combatActions.push({
                                                        attackerId: character.id,
                                                        targetId: targetEnemy.id,
                                                        damage: combatResult.damageDealt,
                                                        type: 'character_attack', // Distinguish from enemy attack if needed
                                                    });
                                                    // Update target enemy's health in the updates array
                                                    const enemyUpdateIndex = updates.findIndex(u => u.id === targetEnemy.id);
                                                    if (enemyUpdateIndex > -1) {
                                                        updates[enemyUpdateIndex].health = combatResult.targetCurrentHealth;
                                                    } else {
                                                        updates.push({ id: targetEnemy.id, x: targetEnemy.position.x, y: targetEnemy.position.y, health: combatResult.targetCurrentHealth });
                                                    }

                                                    if (combatResult.targetDied) {
                                                        this.logger.log(`Enemy ${targetEnemy.id} died from attack by character ${character.id} [${character.name}].`);
                                                        deaths.push({ entityId: targetEnemy.id, type: 'enemy' });
                                                        // Clear target and go idle
                                                        character.attackTargetId = null;
                                                        character.state = 'idle';
                                                        // --- Remove enemy from zone state ---
                                                        this.zoneService.removeEnemy(zoneId, targetEnemy.id);
                                                        this.logger.debug(`Removed dead enemy ${targetEnemy.id} from zone ${zoneId}.`);
                                                    }
                                                    // TODO: Add lastAttackTime update for cooldown - REMOVED, handled above
                                                } else if (combatResult?.error) {
                                                    this.logger.error(`Combat Error (Char->Enemy): ${character.id} vs ${targetEnemy.id}: ${combatResult.error}`);
                                                    // Consider stopping attack on error? Maybe switch to idle.
                                                    // character.attackTargetId = null;
                                                    // character.state = 'idle';
                                                }
                                            } else {
                                                this.logger.error(`CombatService or handleAttack method not available.`);
                                            }
                                        } /* else { // Optional: Log cooldown state 
                                            // this.logger.silly(`Character ${character.id} on attack cooldown.`);
                                        } */ // End cooldown check
                                        // REMOVE THE MISPLACED ELSE BLOCK BELOW
                                        /*
                                        } else {
                                            this.logger.error(`CombatService or handleAttack method not available.`);
                                        }
                                        */

                                    } else {
                                        // --- Out of Range: Move Towards Target ---
                                        // Only set target if not already moving to the correct spot
                                        if (character.targetX !== targetEnemy.position.x || character.targetY !== targetEnemy.position.y) {
                                            this.logger.debug(`Character ${character.id} [${character.name}] moving towards enemy ${targetEnemy.id}`);
                                            character.targetX = targetEnemy.position.x;
                                            character.targetY = targetEnemy.position.y;
                                            // State remains 'attacking', movement simulation will handle moving
                                        }
                                    }
                                }
                                break; // End attacking state

                            case 'idle':
                                // --- Scan for Enemies --- (Only scan if not already targetting)
                                if (!character.attackTargetId) { // Avoid scanning if already decided to attack
                                     let closestEnemy: EnemyInstance | null = null;
                                     let minDistSq = character.aggroRange * character.aggroRange; // Use squared distance

                                     for (const enemy of enemies) { // Use pre-fetched enemy list
                                         if (enemy.currentHealth <= 0) continue; // Skip dead enemies

                                         const dx = enemy.position.x - character.positionX;
                                         const dy = enemy.position.y - character.positionY;
                                         const distSq = dx * dx + dy * dy;

                                         if (distSq <= minDistSq) {
                                             minDistSq = distSq;
                                             closestEnemy = enemy;
                                         }
                                     }

                                     if (closestEnemy) {
                                         this.logger.debug(`Character ${character.id} [${character.name}] found target ${closestEnemy.id} via aggro. Switching to attacking.`);
                                         character.attackTargetId = closestEnemy.id;
                                         character.state = 'attacking';
                                         // Movement towards target will be handled in the 'attacking' state logic or movement simulation
                                     }
                                    // --- No Target Found: Return to Anchor? ---
                                    else if (character.anchorX !== null && character.anchorY !== null &&
                                             (character.positionX !== character.anchorX || character.positionY !== character.anchorY))
                                    {
                                        // Only start moving if not already moving to the anchor
                                        if (character.state !== 'moving' || character.targetX !== character.anchorX || character.targetY !== character.anchorY) {
                                            this.logger.debug(`Character ${character.id} [${character.name}] idle, no targets. Returning to anchor.`);
                                            character.state = 'moving';
                                            character.targetX = character.anchorX;
                                            character.targetY = character.anchorY;
                                        }
                                    }
                                }
                                break; // End idle state

                            case 'moving':
                                // Movement simulation handles actual position change.
                                // Check if the destination (which might be the anchor) is reached.
                                if (character.targetX !== null && character.targetY !== null &&
                                    character.positionX === character.targetX && character.positionY === character.targetY)
                                {
                                     this.logger.debug(`Character ${character.id} [${character.name}] reached move target (${character.targetX.toFixed(0)}, ${character.targetY.toFixed(0)}). Switching to idle.`);
                                     character.targetX = null;
                                     character.targetY = null;
                                     character.state = 'idle';
                                     // Important: Don't clear anchorX/Y here
                                }
                                break; // End moving state
                        } // End switch(character.state)
                    } // End if(!isLeashing)

                    // --- 3. Movement Simulation (Applies if targetX/Y is set, regardless of state) ---
                    let moved = false;
                    if (character.targetX !== null && character.targetY !== null &&
                        (character.positionX !== character.targetX || character.positionY !== character.targetY))
                    {
                        const dx = character.targetX - character.positionX;
                        const dy = character.targetY - character.positionY;
                        const distance = Math.sqrt(dx*dx + dy*dy);
                        const maxMove = this.MOVEMENT_SPEED * deltaTime;

                        if (distance <= maxMove) {
                            // Reached target this tick
                            character.positionX = character.targetX;
                            character.positionY = character.targetY;
                            // State transition ('moving' to 'idle') is handled in state logic above when pos === target
                            moved = true;
                        } else {
                            // Move towards target
                            const moveX = (dx / distance) * maxMove;
                            const moveY = (dy / distance) * maxMove;
                            character.positionX += moveX;
                            character.positionY += moveY;
                            moved = true;
                        }
                        needsPositionUpdate = true;
                    }

                    // --- 4. Add Character Position to Updates Array (if needed) ---
                    // Always update position for simplicity, mirroring previous logic.
                    // Health updates for characters (from enemy attacks) happen in the enemy processing section.
                    const existingUpdateIndex = updates.findIndex(u => u.id === character.id);
                    if (existingUpdateIndex !== -1) {
                         // Update position in existing entry (health might be added by enemy attacks later)
                         updates[existingUpdateIndex].x = character.positionX;
                         updates[existingUpdateIndex].y = character.positionY;
                    } else {
                         // Add new update entry if not present
                         updates.push({ id: character.id, x: character.positionX, y: character.positionY, health: character.currentHealth }); // Include current health
                    }

                } // End character loop
            } // End player loop

            // --- Enemy Processing (Refactored) ---
            for (const enemy of enemies) {
                // Skip processing if enemy is already dead (e.g. died earlier this tick)
                if (enemy.currentHealth <= 0) {
                    continue;
                }

                // --- Get Attacker Object --- 
                // We already have the 'enemy' object (which is an EnemyInstance)
                // Ensure it has baseAttack/baseDefense (added in ZoneService.addEnemy)
                const attacker = enemy;

                // 1. Get AI Action
                const action = this.aiService.updateEnemyAI(attacker, zoneId);

                // 2. Execute Action
                switch (action.type) {
                    case 'MOVE_TO': {
                        const moveTo = action as AIActionMoveTo;
                        const target = moveTo.target;
                        const distance = this.calculateDistance(enemy.position, target);

                        if (distance > 0) {
                            const step = this.ENEMY_MOVEMENT_SPEED * deltaTime;
                            let newX: number, newY: number;

                            if (step >= distance) {
                                // Reached target (or close enough)
                                newX = target.x;
                                newY = target.y;
                                // AI Service handles state transition (e.g., to ATTACKING if range allows)
                                // No need to change aiState here
                            } else {
                                // Move towards target
                                const dx = target.x - enemy.position.x;
                                const dy = target.y - enemy.position.y;
                                newX = enemy.position.x + (dx / distance) * step;
                                newY = enemy.position.y + (dy / distance) * step;
                            }

                            // Update enemy position in ZoneService
                            this.zoneService.updateEnemyPosition(zoneId, enemy.id, { x: newX, y: newY });
                            // Update local copy for broadcast
                            enemy.position = { x: newX, y: newY }; 
                            updates.push({ id: enemy.id, x: newX, y: newY });
                        }
                        break;
                    }
                    case 'ATTACK': {
                        const attackAction = action as AIActionAttack;
                        this.logger.debug(`Enemy ${attacker.id} attempting ATTACK on ${attackAction.targetEntityType} ${attackAction.targetEntityId}`);

                        // --- Get Defender Object ---
                        let defender: RuntimeCharacterData | EnemyInstance | undefined;
                        if (attackAction.targetEntityType === 'character') {
                            defender = this.zoneService.getCharacterStateById(zoneId, attackAction.targetEntityId);
                        } else { // Target is an enemy (currently unlikely)
                            defender = this.zoneService.getEnemyInstanceById(zoneId, attackAction.targetEntityId);
                        }

                        if (!defender) {
                            this.logger.warn(`ATTACK action failed: Target ${attackAction.targetEntityType} ${attackAction.targetEntityId} not found in zone ${zoneId}.`);
                            continue; // Skip to next enemy
                        }

                        // --- Perform Combat --- 
                        // Pass the actual attacker/defender objects
                        const combatResult = await this.combatService.handleAttack(
                            attacker, // Attacker object (EnemyInstance)
                            defender, // Defender object (RuntimeCharacterData or EnemyInstance)
                            zoneId
                        );

                        // Process Combat Result
                        if (combatResult && !combatResult.error) {
                            // Use attackAction.targetEntityId for targetId
                            combatActions.push({
                                attackerId: attacker.id,
                                targetId: attackAction.targetEntityId, // Use ID from action
                                damage: combatResult.damageDealt,
                                type: 'attack',
                            });
                            // Use attackAction.targetEntityId for health update ID
                            updates.push({
                                id: attackAction.targetEntityId, // Use ID from action
                                x: null, y: null,
                                health: combatResult.targetCurrentHealth
                            });
                            // Check if target died
                            if (combatResult.targetDied) {
                                this.logger.log(`${attackAction.targetEntityType} ${attackAction.targetEntityId} died.`);
                                // Use attackAction.targetEntityId for death event ID
                                deaths.push({ entityId: attackAction.targetEntityId, type: attackAction.targetEntityType }); // Use ID from action
                                // ZoneService should handle removal of the dead entity (if character)
                                // Enemy removal happens within CombatService or needs handling here
                                if (attackAction.targetEntityType === 'enemy') { 
                                    // This case shouldn't happen with current AI (enemy attacking enemy)
                                    // But handle it if needed in future
                                    this.zoneService.removeEnemy(zoneId, attackAction.targetEntityId); 
                                }
                                // Character removal/state change needs handling
                                 if (attackAction.targetEntityType === 'character') {
                                    // TODO: Implement character death handling (e.g., mark as dead, respawn logic?)
                                    this.logger.warn(`Character ${attackAction.targetEntityId} death handling not fully implemented!`);
                                }
                            }
                        } else if (combatResult?.error) {
                            // Use attackAction.targetEntityId in error log
                            this.logger.error(`Combat calculation error for ${attacker.id} -> ${attackAction.targetEntityId}: ${combatResult.error}`);
                        }
                        break;
                    }
                    case 'IDLE':
                    // case 'COOLDOWN': // Handled within IDLE case implicitly
                        // No movement or attack action required from the gateway
                        // May need to push state update if AI state changed to IDLE
                        // updates.push({ id: enemy.id, x: enemy.position.x, y: enemy.position.y }); // Ensure position is sent
                        break;
                }
                
                // Always add enemy position to updates if not already handled by MOVE_TO
                // This ensures enemies that go IDLE still broadcast their final position.
                if (action.type !== 'MOVE_TO') {
                     const existingUpdateIndex = updates.findIndex(u => u.id === enemy.id);
                     if (existingUpdateIndex !== -1) {
                         // Update existing entry if health changed (e.g., from ATTACK result)
                         updates[existingUpdateIndex].x = enemy.position.x;
                         updates[existingUpdateIndex].y = enemy.position.y;
                     } else {
                         // Add new update entry if not present
                         updates.push({ id: enemy.id, x: enemy.position.x, y: enemy.position.y, health: enemy.currentHealth });
                     }
                }

            }
            // --- Broadcasting --- 
            // Broadcast batched entity updates (positions, health)
            if (updates.length > 0) {
                this.server.to(zoneId).emit('entityUpdate', { updates });
            }
            // Broadcast batched combat actions (visuals)
            for (const action of combatActions) {
                this.server.to(zoneId).emit('combatAction', action);
            }
            // Broadcast batched deaths
            for (const death of deaths) {
                 this.logger.log(`<<< Broadcasting entityDied event: ${JSON.stringify(death)} to zone ${zoneId}`);
                 this.server.to(zoneId).emit('entityDied', death);
            }
        }
    } catch (error) {
        this.logger.error(`Error during game loop tick: ${error}`, error.stack);
    }
    // Optional: Log tick duration
    // const duration = Date.now() - startTime;
    // this.logger.verbose(`Game loop tick finished in ${duration}ms`);
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