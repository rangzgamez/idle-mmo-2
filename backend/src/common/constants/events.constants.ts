// WebSocket event names - centralized to avoid typos
export const SocketEvents = {
  // Client -> Server
  CLIENT_TO_SERVER: {
    AUTHENTICATE: 'authenticate',
    SELECT_PARTY: 'selectParty',
    ENTER_ZONE: 'enterZone', 
    MOVE_COMMAND: 'moveCommand',
    ATTACK_COMMAND: 'attackCommand',
    SEND_MESSAGE: 'sendMessage',
    PICKUP_ITEM: 'pickup_item',
    LOOT_ALL_COMMAND: 'loot_all_command',
    MOVE_INVENTORY_ITEM: 'moveInventoryItem',
    DROP_INVENTORY_ITEM: 'dropInventoryItem',
    EQUIP_ITEM_COMMAND: 'equipItemCommand',
    UNEQUIP_ITEM: 'unequipItem',
    REQUEST_EQUIPMENT: 'requestEquipment',
    SORT_INVENTORY_COMMAND: 'sortInventoryCommand',
    TELEPORT_PLAYER: 'teleportPlayer', // Debug only
  },

  // Server -> Client  
  SERVER_TO_CLIENT: {
    CONNECT_ERROR: 'connect_error',
    PLAYER_JOINED: 'playerJoined',
    PLAYER_LEFT: 'playerLeft', 
    ENTITY_UPDATE: 'entityUpdate',
    CHAT_MESSAGE: 'chatMessage',
    COMBAT_ACTION: 'combatAction',
    ENTITY_DIED: 'entityDied',
    ENEMY_SPAWNED: 'enemySpawned',
    INVENTORY_UPDATE: 'inventoryUpdate',
    EQUIPMENT_UPDATE: 'equipmentUpdate',
    ITEM_DROPPED: 'itemDropped',
    ITEMS_DROPPED: 'itemsDropped', 
    ITEM_PICKED_UP: 'itemPickedUp',
    ITEM_DESPAWNED: 'itemDespawned',
    LEVEL_UP_NOTIFICATION: 'levelUpNotification',
    XP_UPDATE: 'xpUpdate',
    CHARACTER_STATE_UPDATES: 'characterStateUpdates',
  },
} as const;

// Combat action types
export const CombatActionTypes = {
  ATTACK: 'attack',
  HEAL: 'heal', 
  CRIT: 'crit',
  MISS: 'miss',
} as const;

export type CombatActionType = typeof CombatActionTypes[keyof typeof CombatActionTypes];

// Entity types for death/spawn events
export const EntityTypes = {
  CHARACTER: 'character',
  ENEMY: 'enemy',
} as const;

export type EntityType = typeof EntityTypes[keyof typeof EntityTypes];