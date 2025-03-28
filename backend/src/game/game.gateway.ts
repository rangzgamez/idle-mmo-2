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
import { ZoneService, ZoneCharacterState } from './zone.service'; // Import ZoneService
import * as sanitizeHtml from 'sanitize-html';
import { CombatService } from './combat.service';
import { EnemyService } from 'src/enemy/enemy.service';
@WebSocketGateway({
  cors: { /* ... */ },
})
export class GameGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect, OnApplicationShutdown {
  @WebSocketServer() server: Server;
  private logger: Logger = new Logger('GameGateway');
  private gameLoopInterval: NodeJS.Timeout | null = null;
  private readonly TICK_RATE = 100; // ms (10 FPS)
  private readonly MOVEMENT_SPEED = 150; // Pixels per second
  private readonly ENEMY_MOVEMENT_SPEED = 75; // Pixels per second
  private readonly ENEMY_AGGRO_RANGE = 200;

  constructor(
    private jwtService: JwtService, // Inject JwtService
    private userService: UserService, // Inject UserService
    private characterService: CharacterService, // Inject CharacterService
    private zoneService: ZoneService, // Inject ZoneService
    private combatService: CombatService, // Inject CombatService
    private enemyService: EnemyService, // Inject EnemyService
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
    // --- Start Game Loop ---
    if (!this.gameLoopInterval) {
      this.gameLoopInterval = setInterval(() => {
          this.tickGameLoop();
      }, this.TICK_RATE);
      this.logger.log(`Game loop started with tick rate ${this.TICK_RATE}ms`);
    }

  }
  // Called on server shutdown (e.g., via OnApplicationShutdown interface)
  onApplicationShutdown(signal?: string) {
    this.logger.log('Clearing game loop interval...');
    if (this.gameLoopInterval) {
        clearInterval(this.gameLoopInterval);
        this.gameLoopInterval = null;
    }
  }
  private tickGameLoop(): void {
    const deltaTime = this.TICK_RATE / 1000.0; // Delta time in seconds

    for (const [zoneId, zone] of (this.zoneService as any).zones.entries()) { // Use getter later
        if (zone.players.size === 0 && zone.enemies.size === 0) continue; //Skip zones with no players or enemies

        const updates: Array<{ id: string, x: number | null, y: number | null, health?: number | null }> = [];

        // --- Character Movement ---
        for (const player of zone.players.values()) {
            for (const character of player.characters) { // character is RuntimeCharacterData
                let moved = false;
                // --- Movement Simulation ---
                if (character.targetX !== null && character.targetY !== null &&
                    (character.positionX !== character.targetX || character.positionY !== character.targetY))
                {
                    const dx = character.targetX - character.positionX;
                    const dy = character.targetY - character.positionY;
                    const distance = Math.sqrt(dx*dx + dy*dy);
                    const maxMove = this.MOVEMENT_SPEED * deltaTime;

                    if (distance <= maxMove) {
                        // Reached target
                        character.positionX = character.targetX;
                        character.positionY = character.targetY;
                        character.targetX = null; // Clear Target
                        character.targetY = null;
                        moved = true;
                    } else {
                        // Move towards target
                        const moveX = (dx / distance) * maxMove;
                        const moveY = (dy / distance) * maxMove;
                        character.positionX += moveX;
                        character.positionY += moveY;
                        moved = true;
                    }

                    // Update the character's current position in ZoneService
                    // (This updates the object directly since it's in memory)
                    // No need to call zoneService.updateCharacterPosition here
                }
                // -------------------------

                // Always include character in update for now (or only if moved)
                // if (moved) {
                    updates.push({
                        id: character.id,
                        x: character.positionX,
                        y: character.positionY,
                    });
                // }
            }
        }

        // --- Enemy AI & Movement ---
        const enemies = this.zoneService.getZoneEnemies(zoneId);
        for (const enemy of enemies) {
            if (enemy.aiState === 'IDLE') {
                // Check for nearby players and switch to CHASING state
                const closestPlayer = this.findClosestPlayer(enemy, zoneId);
                if (closestPlayer) {
                    const distance = this.calculateDistance(enemy.position, { x: closestPlayer.x!, y: closestPlayer.y! });
                    if (distance <= this.ENEMY_AGGRO_RANGE) {
                      enemy.aiState = 'CHASING';
                      enemy.target = { x: closestPlayer.x!, y: closestPlayer.y! };
                      this.zoneService.setEnemyAiState(zoneId, enemy.instanceId, 'CHASING');
                      this.zoneService.setEnemyTarget(zoneId, enemy.instanceId, enemy.target);
                      this.logger.log(`Enemy ${enemy.instanceId} is now CHASING player ${closestPlayer.ownerName}'s char ${closestPlayer.name}`);
                    }

                }
            } else if (enemy.aiState === 'CHASING') {
                // Move towards the target
                if (!enemy.target) {
                    // Target lost, go back to idle (THIS SHOULD NOT HAPPEN)
                    this.logger.warn(`Enemy ${enemy.instanceId} has no target while CHASING!  Going back to IDLE`);
                    enemy.aiState = 'IDLE';
                    this.zoneService.setEnemyAiState(zoneId, enemy.instanceId, 'IDLE');
                    continue;
                }
                // Calculate movement step
                const distance = this.calculateDistance(enemy.position, enemy.target);

                if (distance > 0) {
                    const step = this.ENEMY_MOVEMENT_SPEED * deltaTime;
                    let newX: number, newY: number;

                    if (step >= distance) {
                        // Close enough, snap to target (Reached target)
                        newX = enemy.target.x;
                        newY = enemy.target.y;

                        // If close enough, switch to ATTACKING state
                        enemy.aiState = 'ATTACKING';
                        this.zoneService.setEnemyAiState(zoneId, enemy.instanceId, 'ATTACKING');
                        this.logger.log(`Enemy ${enemy.instanceId} is now ATTACKING`);
                    } else {
                        // Move towards target
                        const dx = enemy.target.x - enemy.position.x;
                        const dy = enemy.target.y - enemy.position.y;
                        newX = enemy.position.x + (dx / distance) * step;
                        newY = enemy.position.y + (dy / distance) * step;
                    }

                    // Update enemy position
                    this.zoneService.updateEnemyPosition(zoneId, enemy.instanceId, { x: newX, y: newY });
                    enemy.position = { x: newX, y: newY };
                    updates.push({ id: enemy.instanceId, x: newX, y: newY });
                }
            } else if (enemy.aiState === 'ATTACKING') {
                // Find a character in the same position
                const targetChar = this.findCharacterFromPosition(enemy.position, zoneId);

                if (targetChar) {
                    // Calculate Damage
                    // Get stats, currently hardcoded for simplicity
                    const enemyAttack = 10; // example number
                    const playerDefense = 5; // example Number

                    const damage = this.combatService.calculateDamage(enemyAttack, playerDefense);

                    // Apply Damage
                    this.zoneService.updateEnemyHealth(zoneId, enemy.instanceId, -damage);
                    const currentHealth = this.zoneService.getEnemy(zoneId, enemy.instanceId)?.currentHealth;

                    updates.push({ id: enemy.instanceId, x: enemy.position.x, y: enemy.position.y, health: currentHealth })

                    if (currentHealth! <= 0) {
                        this.logger.log(`Enemy ${enemy.instanceId} has died!`);
                        this.zoneService.removeEnemy(zoneId, enemy.instanceId);
                        this.server.to(zoneId).emit('entityDied', { entityId: enemy.instanceId, type: 'enemy' });
                    }

                    // Set AI state back to IDLE (for now)
                    enemy.aiState = 'IDLE';
                    enemy.target = null;
                    this.zoneService.setEnemyAiState(zoneId, enemy.instanceId, 'IDLE');
                    this.zoneService.setEnemyTarget(zoneId, enemy.instanceId, null);

                    this.logger.log(`Enemy ${enemy.instanceId} attacks character ${targetChar.id} for ${damage} damage!`);
                } else {
                  enemy.aiState = 'IDLE';
                  enemy.target = null;
                  this.zoneService.setEnemyAiState(zoneId, enemy.instanceId, 'IDLE');
                  this.zoneService.setEnemyTarget(zoneId, enemy.instanceId, null);
                }
            }
        }

        // Broadcast batched updates
        if (updates.length > 0) {
            this.server.to(zoneId).emit('entityUpdate', { updates });
        }
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
  ): Promise<{ success: boolean; zoneState?: ZoneCharacterState[]; message?: string }> {
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
      return { success: true, zoneState: playersAlreadyInZone };
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

    // --- Update target positions in ZoneService ---
    for (const target of targets) {
        this.zoneService.setCharacterTargetPosition(user.id, target.charId, target.targetX, target.targetY);
         // Optional: Log the calculated target
         // this.logger.log(`Set target for char ${target.charId} to ${target.targetX}, ${target.targetY}`);
    }

    // The actual movement happens in the game loop based on these targets
}
   @SubscribeMessage('attackCommand')
    handleAttackCommand(
        @MessageBody() data: { targetId: string },
        @ConnectedSocket() client: Socket,
    ): void {
        const user = client.data.user as User;
        const partyCharacters = this.zoneService.getPlayerCharacters(user.id);

        if (partyCharacters && partyCharacters.length > 0) {
            const zoneId = partyCharacters[0].currentZoneId ? partyCharacters[0].currentZoneId : 'startZone';
            const attacker = partyCharacters[0];
            const target = this.zoneService.getEnemy(zoneId, data.targetId);

            if (target) {
                // Set the character's target for auto-attack in the game loop
                attacker.targetX = target.position.x;
                attacker.targetY = target.position.y;
                client.data.attackTarget = target.instanceId;
            }
        }
    }

        //  --------------------- AI ADDITIONS ---------------------
  private findClosestPlayer(enemy: any, zoneId: string): ZoneCharacterState | undefined {
      let closestPlayer: ZoneCharacterState | undefined;
      let minDistance = Infinity;

      const players = this.zoneService.getZoneCharacterStates(zoneId);
      for (const player of players) {
          const distance = this.calculateDistance(enemy.position, {x: player.x!, y: player.y!});
          if (distance < minDistance) {
              minDistance = distance;
              closestPlayer = player;
          }
      }
      return closestPlayer;
  }
  private calculateDistance(point1: {x:number, y:number}, point2: {x:number, y:number}): number {
      const dx = point1.x - point2.x;
      const dy = point1.y - point2.y;
      return Math.sqrt(dx * dx + dy * dy);
  }
    private findCharacterFromPosition(position: {x:number, y:number}, zoneId:string): any | undefined{
        let foundCharacter: any | undefined;

        const players = this.zoneService.getPlayersInZone(zoneId);
        for(const player of players){
            for(const char of player.characters){
                if(char.positionX == position.x && char.positionY == position.y){
                    foundCharacter = char;
                }
            }
        }
        return foundCharacter;
    }
}