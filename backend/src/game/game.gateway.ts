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
import { GameLoopService } from './game-loop.service'; // Import the new GameLoopService

@WebSocketGateway({
  cors: { /* ... */ },
})
export class GameGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;
  private logger: Logger = new Logger('GameGateway');

  constructor(
    private jwtService: JwtService, // Inject JwtService
    private userService: UserService, // Inject UserService
    private characterService: CharacterService, // Inject CharacterService
    private zoneService: ZoneService, // Inject ZoneService
    private gameLoopService: GameLoopService, // Inject GameLoopService
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
    // --- Start Game Loop via GameLoopService ---
    this.gameLoopService.startLoop(this.server);
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
}