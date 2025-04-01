export type AIActionType = 'IDLE' | 'MOVE_TO' | 'ATTACK';

export interface AIActionBase {
  type: AIActionType;
}

export interface AIActionIdle extends AIActionBase {
  type: 'IDLE';
}

export interface AIActionMoveTo extends AIActionBase {
  type: 'MOVE_TO';
  target: { x: number; y: number };
}

export interface AIActionAttack extends AIActionBase {
  type: 'ATTACK';
  targetEntityId: string;
  targetEntityType: 'character' | 'enemy'; // Or other types if needed
}

// Union type for all possible actions
export type AIAction = AIActionIdle | AIActionMoveTo | AIActionAttack; 