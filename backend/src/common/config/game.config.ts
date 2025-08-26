// Game configuration constants
export const GameConfig = {
  // === Server Configuration ===
  SERVER: {
    PORT: parseInt(process.env.PORT || '3000'),
    FRONTEND_URL: process.env.FRONTEND_URL || 'http://localhost:5173',
  },

  // === Character System ===
  CHARACTER: {
    MAX_CHARACTERS_PER_USER: parseInt(process.env.MAX_CHARACTERS_PER_USER || '10'),
    DEFAULT_SPAWN_X: parseInt(process.env.DEFAULT_SPAWN_X || '100'),
    DEFAULT_SPAWN_Y: parseInt(process.env.DEFAULT_SPAWN_Y || '100'),
    STARTING_LEVEL: 1,
    STARTING_XP: 0,
    
    // Health and regen
    RESPAWN_TIME_MS: parseInt(process.env.RESPAWN_TIME_MS || '5000'),
    HEALTH_REGEN_PERCENT_PER_SEC: parseFloat(process.env.HEALTH_REGEN_PERCENT_PER_SEC || '1.0'),
    
    // Default combat stats (fallbacks when class template doesn't provide)
    DEFAULT_BASE_HEALTH: 100,
    DEFAULT_BASE_ATTACK: 15,
    DEFAULT_BASE_DEFENSE: 5,
    DEFAULT_ATTACK_SPEED_MS: 1500,
    DEFAULT_ATTACK_RANGE: 50,
    DEFAULT_AGGRO_RANGE: 150,
    DEFAULT_LEASH_DISTANCE: 400,
  },

  // === Experience and Leveling ===
  EXPERIENCE: {
    BASE_XP: parseInt(process.env.BASE_XP || '100'),
    LEVEL_EXPONENT: parseFloat(process.env.LEVEL_EXPONENT || '1.5'),
    
    // Stat gains per level up
    HEALTH_PER_LEVEL: 5,
    ATTACK_PER_LEVEL: 2,
    DEFENSE_PER_LEVEL: 1,
  },

  // === Inventory System ===
  INVENTORY: {
    SIZE: parseInt(process.env.INVENTORY_SIZE || '216'), // 6 pages * 36 slots
    PAGES: 6,
    SLOTS_PER_PAGE: 36,
    ITEM_PICKUP_RANGE: 5, // pixels
  },

  // === Combat System ===
  COMBAT: {
    // Item despawn timing
    ITEM_DESPAWN_TIME_MS: parseInt(process.env.ITEM_DESPAWN_TIME_MS || '300000'), // 5 minutes
    
    // Movement precision
    MOVEMENT_EPSILON: 0.1, // Consider reached if within this distance
  },

  // === Security ===
  SECURITY: {
    BCRYPT_SALT_ROUNDS: parseInt(process.env.BCRYPT_SALT_ROUNDS || '10'),
    JWT_SECRET: process.env.JWT_SECRET || 'your-secret-key', // Should be overridden in production
  },

  // === Game Loop ===
  GAME_LOOP: {
    TICK_RATE_MS: parseInt(process.env.TICK_RATE_MS || '100'), // 10 TPS
    DELTA_TIME_SEC: parseFloat(process.env.DELTA_TIME_SEC || '0.1'),
  },

  // === Enemy/AI System ===
  ENEMY: {
    DEFAULT_SPEED: 75,
    DEFAULT_ATTACK_RANGE: 30,
    DEFAULT_XP_REWARD: 10,
  }
} as const;

// Type for the config to ensure type safety
export type GameConfigType = typeof GameConfig;