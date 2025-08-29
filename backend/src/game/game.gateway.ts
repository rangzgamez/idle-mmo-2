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
  WsException,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt'; // Import JwtService
import { UserService } from '../user/user.service'; // Import UserService
import { User } from '../user/user.entity'; // Import User entity
import { CharacterService } from '../character/character.service'; // Import CharacterService
import { Character } from '../character/character.entity'; // Import Character entity
import { ZoneService, ZoneCharacterState, RuntimeCharacterData } from './zone.service'; // Import ZoneService & RuntimeCharacterData
import * as sanitizeHtml from 'sanitize-html';
import { GameLoopService } from './game-loop.service'; // Import the new GameLoopService
import { InventoryService } from '../inventory/inventory.service'; // Import InventoryService
import { BroadcastService } from './broadcast.service'; // Import BroadcastService
import { calculateDistance } from './utils/geometry.utils'; // Import distance util
import { EquipmentSlot } from '../item/item.types'; // <-- Import EquipmentSlot
import { AbilityService } from '../abilities/ability.service'; // Import AbilityService
import { CombatService } from './combat.service'; // Import CombatService

// Add pickup range constant
// const ITEM_PICKUP_RANGE = 50; // pixels // No longer used for initial command

// Type for moveInventoryItem message body
interface MoveInventoryItemPayload {
  fromIndex: number;
  toIndex: number;
}

// --- ADD Type for pickup_item message body ---
interface PickupItemPayload {
    itemId: string;
}
// -----------------------------------------

// Define payload types for clarity
// ... other payload types ...
interface DropInventoryItemPayload {
  inventoryIndex: number;
}
interface EquipItemPayload {
  inventoryItemId: string;
  characterId: string;
}

// Cast spell payload
interface CastSpellPayload {
  abilityId: string;
  targetX: number;
  targetY: number;
}
interface UnequipItemPayload {
  characterId: string;
  slot: EquipmentSlot;
  // inventoryItemId?: string; // Optional way to specify item - not used currently
}
interface RequestEquipmentPayload {
  characterId: string;
}
interface SortInventoryPayload { // NEW Payload Interface
  sortType: 'name' | 'type' | 'newest';
}

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
    private inventoryService: InventoryService, // Inject InventoryService
    private broadcastService: BroadcastService, // Inject BroadcastService
    private abilityService: AbilityService, // Inject AbilityService
    private combatService: CombatService, // Inject CombatService
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

  // --- ADD PICKUP ITEM COMMAND HANDLER ---
  @SubscribeMessage('pickup_item')
  handlePickupItemCommand(
    @MessageBody() data: PickupItemPayload,
    @ConnectedSocket() client: Socket,
  ): { success: boolean; message?: string } {
    const user = client.data.user as User;
    const party = client.data.selectedCharacters as RuntimeCharacterData[];
    const zoneId = client.data.currentZoneId as string;
    const itemIdToPickup = data?.itemId;

    if (!user || !party || party.length === 0 || !zoneId) {
      this.logger.warn(`[Pickup Command] Invalid state for user ${user?.id}`);
      return { success: false, message: 'Invalid state.' };
    }
    if (!itemIdToPickup) {
      this.logger.warn(`[Pickup Command] Missing item ID from user ${user.id}`);
      return { success: false, message: 'Missing item ID.' };
    }

    // 1. Find the dropped item in the current zone
    const droppedItem = this.zoneService.getDroppedItemById(zoneId, itemIdToPickup); // Assuming getDroppedItemById exists
    if (!droppedItem) {
      // Dropped item not found in zone
      return { success: false, message: 'Item not found or already picked up.' };
    }

    // 2. Find all player characters currently in the zone state (not just from client.data)
    const playerCharactersInZone = this.zoneService.getPlayerCharacters(user.id, zoneId);
    if (!playerCharactersInZone || playerCharactersInZone.length === 0) {
        this.logger.error(`[Pickup Command] User ${user.id} has no characters in zone ${zoneId} state.`);
        return { success: false, message: 'Characters not found in zone.' };
    }

    // 3. Find the closest *alive* character to the item
    let closestChar: RuntimeCharacterData | null = null;
    let minDistance = Infinity;

    for (const char of playerCharactersInZone) {
      if (char.state === 'dead' || char.positionX === null || char.positionY === null) continue; // Skip dead or positionless chars

      const distance = calculateDistance(
        { x: char.positionX, y: char.positionY },
        droppedItem.position
      );

      if (distance < minDistance) {
        minDistance = distance;
        closestChar = char;
      }
    }

    if (!closestChar) {
      this.logger.log(`[Pickup Command] No alive characters found for user ${user.id} to pick up item ${itemIdToPickup}.`);
      return { success: false, message: 'No available characters to pick up the item.' };
    }

    // 4. Set the closest character's state to move towards the item
    this.logger.log(`[Pickup Command] Character ${closestChar.id} [${closestChar.name}] assigned to pick up item ${droppedItem.itemName} (${itemIdToPickup})`);

    // Clear any potential loot_area command state when issuing a specific pickup
    closestChar.commandState = null; 

    const success = this.zoneService.setCharacterLootTarget(
        user.id,
        closestChar.id,
        itemIdToPickup,
        droppedItem.position.x,
        droppedItem.position.y
    );

    if (!success) {
        this.logger.error(`[Pickup Command] Failed to set loot target for character ${closestChar.id} in ZoneService.`);
        return { success: false, message: 'Failed to assign character to item.' };
    }

    // Acknowledge the command was received and processed
    // The actual pickup happens in the game loop
    return { success: true };
  }
  // -------------------------------------

  
  // --- Equip/Unequip Handlers ---
  @SubscribeMessage('equipItemCommand')
  async handleEquipItem(
    @MessageBody() data: { inventoryItemId: string, characterId: string /* Equip for specific char */ },
    @ConnectedSocket() client: Socket,
  ): Promise<{ success: boolean; message?: string }> { // Ack structure
    const user = client.data.user as User;
    const party = client.data.selectedCharacters as RuntimeCharacterData[]; // Use runtime data
    const inventoryItemId = data?.inventoryItemId;
    const characterId = data?.characterId; // ID of character equipping the item

    if (!user || !party || party.length === 0) {
      return { success: false, message: 'Invalid state.' };
    }
    if (!inventoryItemId || !characterId) {
      return { success: false, message: 'Missing inventory item ID or character ID.' };
    }
     // Validate character ID belongs to user's party
     const characterInParty = party.find(c => c.id === characterId);
     if (!characterInParty) {
        return { success: false, message: 'Character not in current party.' };
     }

    try {
        this.logger.debug(`[EQUIP] User ${user.username} trying to equip item ${inventoryItemId} on char ${characterId}`);
        // *** Call CharacterService ***
        const result = await this.characterService.equipItem(user.id, characterId, inventoryItemId);
        this.logger.debug(`[EQUIP] CharacterService.equipItem returned: ${JSON.stringify(result)}`);
        // No need to check result.success, service throws on error
        
        // TEMP Removed
        // await new Promise(res => setTimeout(res, 50));
        // console.log(`PLACEHOLDER: Equip successful`);

        // *** Broadcast equipmentUpdate ***
        const updatedEquipment = await this.characterService.getCharacterEquipment(characterId);
        this.logger.debug(`[EQUIP] Updated equipment: ${JSON.stringify(updatedEquipment)}`);
        client.emit('equipmentUpdate', { characterId: characterId, equipment: updatedEquipment });
        // Also update inventory since an item was removed
        // --- Use new slots method ---
        const updatedInventorySlotsEquip = await this.inventoryService.getUserInventorySlots(user.id);
        this.logger.debug(`[EQUIP] Sending inventory update and equipment update to client`);
        client.emit('inventoryUpdate', { inventory: updatedInventorySlotsEquip }); 
        // -------------------------

        return { success: true };

    } catch (error: any) {
        this.logger.debug(`[EQUIP] Error equipping item ${inventoryItemId} for user ${user.username}: ${error.message}`);
        this.logger.error(`Error equipping item ${inventoryItemId} for user ${user.username}: ${error.message}`, error.stack);
        return { success: false, message: error.message || 'Failed to equip item.' };
    }
  }

  @SubscribeMessage('unequipItem')
  async handleUnequipItem(
    @MessageBody() data: { slot: EquipmentSlot, characterId: string },
    @ConnectedSocket() client: Socket,
  ): Promise<{ success: boolean; message?: string }> {
    this.logger.log(`ENTERED handleUnequipItem with data: ${JSON.stringify(data)}`); 

    const user = client.data.user as User;
    const party = client.data.selectedCharacters as RuntimeCharacterData[];
    const slot = data?.slot;
    const characterId = data?.characterId;

    if (!user || !party || party.length === 0) {
      return { success: false, message: 'Invalid state.' };
    }
    if (!slot || !characterId) {
      return { success: false, message: 'Missing slot or character ID.' };
    }
    // Validate slot value is a valid EquipmentSlot enum key?
    if (!Object.values(EquipmentSlot).includes(slot)) {
        return { success: false, message: 'Invalid equipment slot specified.' };
    }
     // Validate character ID belongs to user's party
     const characterInParty = party.find(c => c.id === characterId);
     if (!characterInParty) {
        return { success: false, message: 'Character not in current party.' };
     }

    try {
        console.log(`User ${user.username} trying to unequip slot ${slot} on char ${characterId}`);
        // *** Call CharacterService ***
        const result = await this.characterService.unequipItem(user.id, characterId, slot);
        // No need to check result.success, service throws on error
        
        // TEMP Removed
        // await new Promise(res => setTimeout(res, 50));
        // console.log(`PLACEHOLDER: Unequip successful`);

        // *** Broadcast equipmentUpdate and inventoryUpdate ***
        const updatedEquipment = await this.characterService.getCharacterEquipment(characterId);
        client.emit('equipmentUpdate', { characterId: characterId, equipment: updatedEquipment });
        // --- Use new slots method ---
        const updatedInventorySlotsUnequip = await this.inventoryService.getUserInventorySlots(user.id);
        client.emit('inventoryUpdate', { inventory: updatedInventorySlotsUnequip });
        // -------------------------

        return { success: true };

    } catch (error: any) {
        this.logger.error(`Error unequipping slot ${slot} for user ${user.username}: ${error.message}`, error.stack);
        return { success: false, message: error.message || 'Failed to unequip item.' };
    }
  }

  // --- Request Inventory Handler ---
  @SubscribeMessage('requestInventory')
  async handleRequestInventory(
    @ConnectedSocket() client: Socket,
  ): Promise<void> { // No explicit ack needed, just send update
    const user = client.data.user as User;
    if (!user) {
        this.logger.warn(`requestInventory rejected: User not authenticated on socket ${client.id}`);
        client.emit('operation_error', { message: 'Not authenticated.' }); 
        return;
    }

    try {
        this.logger.log(`User ${user.id} requested inventory.`);
        // --- Use the new service method --- 
        const currentInventorySlots = await this.inventoryService.getUserInventorySlots(user.id);
        // ---------------------------------
        client.emit('inventoryUpdate', { inventory: currentInventorySlots });
    } catch (error) {
        this.logger.error(`[requestInventory] Error processing request for user ${user.id}:`, error);
        client.emit('operation_error', { message: 'Server error retrieving inventory.' }); 
    }
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
          className: char.class,
          x: char.positionX,
          y: char.positionY,
          state: 'idle',
      }));
      // Broadcast only the NEW player's characters to existing players in the room
      client.to(zoneId).emit('playerJoined', { characters: newPlayerCharacterStates }); // Send array of characters
      this.logger.log(`Broadcast playerJoined for ${user.username} to zone ${zoneId}`);

      // 4. Send the state of existing players to the NEW player
      return { success: true, zoneState: playersAlreadyInZone, enemyState: existingEnemies };
  }

  @SubscribeMessage('moveCommand')
  async handleMoveCommand(
    @MessageBody() data: { target: { x: number; y: number } },
    @ConnectedSocket() client: Socket,
  ) {
      const user = client.data.user as User;
      const partyCharactersData = client.data.selectedCharacters as Character[]; // Get the base Character data
      const zoneId = client.data.currentZoneId as string;

      if (!user || !partyCharactersData || partyCharactersData.length === 0 || !zoneId) {
          this.logger.warn(`Move command ignored for user ${user?.username}: Invalid state (user, party, or zone).`);
          return; // Exit early
      }

      const formationCenter = data.target;
      const formationOffset = 30; // Pixels

      // --- Calculate target positions --- 
      const targets: { charId: string, targetX: number, targetY: number }[] = [];
      if (partyCharactersData.length > 0) {
          targets.push({ charId: partyCharactersData[0].id, targetX: formationCenter.x, targetY: formationCenter.y - formationOffset * 0.5 });
      }
      if (partyCharactersData.length > 1) {
          targets.push({ charId: partyCharactersData[1].id, targetX: formationCenter.x - formationOffset, targetY: formationCenter.y + formationOffset * 0.5 });
      }
      if (partyCharactersData.length > 2) {
          targets.push({ charId: partyCharactersData[2].id, targetX: formationCenter.x + formationOffset, targetY: formationCenter.y + formationOffset * 0.5 });
      }
      // --------------------------------

      // --- Use ZoneService to set targets and state --- 
      for (const target of targets) {
          const success = this.zoneService.setMovementTarget(
              zoneId,
              target.charId,
              target.targetX,
              target.targetY
          );
          if (!success) {
              this.logger.warn(`[MoveCmd] Failed to set movement target for char ${target.charId} via ZoneService.`);
          }
      }
      // No need to directly manipulate character state here anymore
  }

  @SubscribeMessage('attackCommand')
  handleAttackCommand(
      @MessageBody() data: { targetId: string },
      @ConnectedSocket() client: Socket,
  ): void {
      const user = client.data.user as User;
      const partyCharactersData = client.data.selectedCharacters as Character[]; // Get base Character data
      const zoneId = client.data.currentZoneId as string;

      if (!user || !partyCharactersData || partyCharactersData.length === 0 || !zoneId) {
          this.logger.warn(`Attack command ignored for user ${user?.username}: Invalid state (user, party, or zone).`);
          return;
      }

      const targetEnemyId = data.targetId;

      // --- Use ZoneService to set targets and state --- 
      // Set the target and state for ALL characters in the party
      for (const character of partyCharactersData) {
           const success = this.zoneService.setAttackTarget(
              zoneId,
              character.id,
              targetEnemyId
          );
          if (!success) {
               // ZoneService already logs warnings if enemy/char not found or state change fails
               this.logger.warn(`[AttackCmd] Failed to set attack target for char ${character.id} via ZoneService (target: ${targetEnemyId}).`);
          }
      }
      // No need to directly manipulate character state here anymore
  }

  // --- Handler to request equipment state --- 
  @SubscribeMessage('requestEquipment')
  async handleRequestEquipment(
      @MessageBody() data: { characterId: string },
      @ConnectedSocket() client: Socket,
  ): Promise<void> {
      const user = client.data.user as User;
      const characterId = data?.characterId;
      if (!user || !characterId) {
          this.logger.warn(`requestEquipment rejected: Invalid state or missing characterId.`);
          return;
      }
       // Validate character belongs to user (important!)
       const character = await this.characterService.findCharacterByIdAndUserId(characterId, user.id);
       if (!character) {
          this.logger.warn(`requestEquipment rejected: Character ${characterId} not found or not owned by ${user.username}.`);
           // client.emit('equipmentError', { message: 'Character not found or invalid.' });
           return;
       }

      try {
          // User requested equipment data
          const currentEquipment = await this.characterService.getCharacterEquipment(characterId);
          client.emit('equipmentUpdate', { characterId: characterId, equipment: currentEquipment });
          // Sent equipment update to user
      } catch (error) {
          this.logger.error(`Error fetching equipment for char ${characterId}: ${error.message}`, error.stack);
           // client.emit('equipmentError', { message: 'Failed to load equipment.' });
      }
  }

  // --- Move Item in Inventory Handler ---
  @SubscribeMessage('moveInventoryItem')
  async handleMoveInventoryItem(
    @MessageBody() data: MoveInventoryItemPayload,
    @ConnectedSocket() client: Socket,
  ): Promise<void> { // No explicit ack needed, just update client
    const user = client.data.user as User;
    if (!user) {
        this.logger.warn(`[moveInventoryItem] Unauthorized attempt from socket ${client.id}`);
        // Optionally emit an error event to the client
        client.emit('operation_error', { message: 'Not authenticated.' }); 
        return;
    }

    if (typeof data?.fromIndex !== 'number' || typeof data?.toIndex !== 'number') {
        this.logger.warn(`[moveInventoryItem] Invalid payload from user ${user.id}:`, data);
         client.emit('operation_error', { message: 'Invalid move payload.' }); 
        return;
    }

    try {
        const success = await this.inventoryService.moveItemInInventory(
            user.id,
            data.fromIndex,
            data.toIndex
        );

        if (success) {
            this.logger.log(`User ${user.id} moved item from ${data.fromIndex} to ${data.toIndex}.`);
            // Send updated inventory back to the client
            const updatedInventorySlots = await this.inventoryService.getUserInventorySlots(user.id);
            client.emit('inventoryUpdate', { inventory: updatedInventorySlots });
        } else {
            this.logger.warn(`[moveInventoryItem] Service reported failure for user ${user.id} moving ${data.fromIndex} -> ${data.toIndex}.`);
            // Optionally send back the current inventory state anyway to resync client
            const currentInventorySlots = await this.inventoryService.getUserInventorySlots(user.id);
            client.emit('inventoryUpdate', { inventory: currentInventorySlots });
            client.emit('operation_error', { message: 'Failed to move item.' }); 
        }
    } catch (error) {
        this.logger.error(`[moveInventoryItem] Error processing request for user ${user.id}:`, error);
        client.emit('operation_error', { message: 'Server error while moving item.' }); 
    }
  }

  // --- ADD LOOT ALL COMMAND HANDLER ---
  @SubscribeMessage('loot_all_command')
  handleLootAllCommand(
    @ConnectedSocket() client: Socket,
  ): { success: boolean; message?: string } { // Acknowledge receipt
    const user = client.data.user as User;
    const zoneId = client.data.currentZoneId as string;

    if (!user || !zoneId) {
      this.logger.warn(`[Loot All] Invalid state for user ${user?.id}.`);
      return { success: false, message: 'Invalid state.' };
    }

    const playerCharactersInZone = this.zoneService.getPlayerCharacters(user.id, zoneId);
    if (!playerCharactersInZone || playerCharactersInZone.length === 0) {
        this.logger.error(`[Loot All] User ${user.id} has no characters in zone ${zoneId} state.`);
        return { success: false, message: 'Characters not found in zone.' };
    }

    this.logger.log(`[Loot All] Received command from user ${user.id}. Processing ${playerCharactersInZone.length} characters.`);
    let charactersSetToLoot = 0;

    // Iterate through each character and attempt to set their state to looting_area
    for (const char of playerCharactersInZone) {
        if (char.state !== 'dead') {
            const success = this.zoneService.setCharacterLootArea(user.id, char.id);
            if (success) {
                charactersSetToLoot++;
            } else {
                this.logger.warn(`[Loot All] Failed to set looting state for character ${char.id}.`);
            }
        }
    }

    if (charactersSetToLoot > 0) {
        this.logger.log(`[Loot All] ${charactersSetToLoot} character(s) set to looting state for user ${user.id}.`);
        return { success: true };
    } else {
        this.logger.log(`[Loot All] No alive characters could be set to looting state for user ${user.id}.`);
        return { success: false, message: 'No characters available to loot.' };
    }
  }
  // --- END LOOT ALL COMMAND HANDLER ---

  // --- NEW: Inventory Sorting Handler ---
  @SubscribeMessage('sortInventoryCommand')
  async handleSortInventory(
      @ConnectedSocket() client: Socket, 
      @MessageBody() payload: SortInventoryPayload
  ): Promise<void> { // No specific ack needed, client updates via inventoryUpdate
      const userId = client.data.user?.id; // Access userId via user object
      if (!userId) {
          console.error('[GameGateway] Missing user.id on authenticated socket for sortInventoryCommand');
          throw new WsException('User not authenticated for sorting inventory.');
      }

      const { sortType } = payload;
      if (!sortType || (sortType !== 'name' && sortType !== 'type' && sortType !== 'newest')) {
          console.warn(`[GameGateway] Received invalid sortType: ${sortType} from userId: ${userId}`);
          // Optionally throw WsException or just ignore
          return; 
      }

      console.log(`[GameGateway] User ${userId} requested inventory sort by ${sortType}`);

      try {
          await this.inventoryService.sortInventory(userId, sortType);
          // Sorting triggers inventoryUpdate via InventoryService/BroadcastService
      } catch (error) {
          console.error(`[GameGateway] Error sorting inventory for user ${userId}:`, error);
          // Optionally inform the client via a specific error event or WsException
          throw new WsException('Failed to sort inventory.');
      }
  }

  // =========================
  // SPELL CASTING
  // =========================
  @SubscribeMessage('requestAbilities')
  async handleRequestAbilities(
    @ConnectedSocket() client: Socket,
  ): Promise<void> {
    try {
      const abilities = await this.abilityService.findAll();
      client.emit('abilitiesData', { abilities });
      this.logger.log(`Sent ${abilities.length} abilities to client`);
    } catch (error) {
      this.logger.error(`Failed to fetch abilities: ${error.message}`);
      client.emit('abilitiesData', { abilities: [] });
    }
  }

  @SubscribeMessage('castSpell')
  async handleCastSpell(
    @MessageBody() data: CastSpellPayload,
    @ConnectedSocket() client: Socket,
  ): Promise<{ success: boolean; message?: string }> {
    const user = client.data.user as User;
    const zoneId = client.data.currentZoneId as string;

    if (!user) {
      this.logger.error(`Cast spell: User not authenticated`);
      return { success: false, message: 'Not authenticated' };
    }

    if (!zoneId) {
      this.logger.error(`Cast spell: User ${user.id} not in any zone`);
      return { success: false, message: 'Not in a zone' };
    }

    const { abilityId, targetX, targetY } = data;

    try {
      // Basic validation - ability exists
      const ability = await this.abilityService.findById(abilityId);
      if (!ability) {
        return { success: false, message: 'Ability not found' };
      }

      // Get user's characters in the zone
      const userCharacters = this.zoneService.getPlayerCharactersInZone(zoneId, user.id);
      if (!userCharacters || userCharacters.length === 0) {
        return { success: false, message: 'No characters in zone' };
      }

      // For now, use the first character to cast the spell
      const caster = userCharacters[0];

      // Queue spell cast for processing by game loop (like move/attack commands)
      const success = this.zoneService.queueSpellCast(zoneId, caster.id, abilityId, targetX, targetY);
      
      if (success) {
        this.logger.log(`🎯 SPELL QUEUED: User ${user.username} queued ${ability.name} at (${targetX}, ${targetY}) with character ${caster.id}`);
        return { success: true };
      } else {
        this.logger.warn(`🎯 SPELL QUEUE FAILED: Could not queue spell for character ${caster.id}`);
        return { success: false, message: 'Failed to queue spell cast' };
      }

    } catch (error) {
      this.logger.error(`Error queueing spell cast: ${error.message}`);
      return { success: false, message: 'Spell casting failed' };
    }
  }

  // Spell damage now handled by CombatService for consistency
}