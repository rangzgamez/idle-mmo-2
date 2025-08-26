// Character state constants
export const CharacterStates = {
  IDLE: 'idle',
  MOVING: 'moving',
  ATTACKING: 'attacking',
  DEAD: 'dead',
  MOVING_TO_LOOT: 'moving_to_loot',
  LOOTING_AREA: 'looting_area',
} as const;

export type CharacterState = typeof CharacterStates[keyof typeof CharacterStates];

// Enemy AI state constants
export const EnemyAIStates = {
  IDLE: 'IDLE',
  CHASING: 'CHASING', 
  ATTACKING: 'ATTACKING',
  COOLDOWN: 'COOLDOWN',
  DEAD: 'DEAD',
  WANDERING: 'WANDERING',
} as const;

export type EnemyAIState = typeof EnemyAIStates[keyof typeof EnemyAIStates];

// AI Action types
export const AIActionTypes = {
  ATTACK: 'ATTACK',
  MOVE_TO: 'MOVE_TO',
  IDLE: 'IDLE',
  WANDER: 'WANDER',
  NONE: 'NONE',
} as const;

export type AIActionType = typeof AIActionTypes[keyof typeof AIActionTypes];

// Command states for multi-step actions
export const CommandStates = {
  LOOT_AREA: 'loot_area',
} as const;

export type CommandState = typeof CommandStates[keyof typeof CommandStates] | null;