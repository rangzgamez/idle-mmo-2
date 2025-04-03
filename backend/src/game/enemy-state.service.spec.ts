import { Test, TestingModule } from '@nestjs/testing';
import { EnemyStateService } from './enemy-state.service';
import { ZoneService, RuntimeCharacterData } from './zone.service';
import { CombatService } from './combat.service';
import { CombatResult } from './interfaces/combat.interface';
import { AIService } from './ai.service';
import { AIAction } from './interfaces/ai-action.interface';
import { MovementService, MovementResult } from './movement.service';
import { EnemyInstance } from './interfaces/enemy-instance.interface';
import { User } from '../user/user.entity'; // Needed for RuntimeCharacterData mock

// Minimal mock User for character data
const mockUser: User = {
    id: 'player1',
    username: 'TestUser',
    passwordHash: 'hashed_password',
    characters: [],
    createdAt: new Date(),
    updatedAt: new Date(),
};

// Helper to create default enemy data
const createMockEnemy = (overrides: Partial<EnemyInstance> = {}): EnemyInstance => ({
    id: 'enemy1',
    templateId: 'goblin',
    zoneId: 'zone1',
    name: 'Test Goblin',
    currentHealth: 50,
    baseAttack: 8,
    baseDefense: 3,
    baseSpeed: 60,
    position: { x: 150, y: 150 },
    anchorX: 150,
    anchorY: 150,
    aiState: 'IDLE',
    lastAttackTime: 0,
    // Add other potentially required fields from EnemyInstance with defaults
    target: null,
    nestId: 'nest1',
    wanderRadius: 50,
    currentTargetId: null,
    ...overrides,
});

// Helper to create default character data (for mocking targets)
const createMockCharacter = (id: string, overrides: Partial<RuntimeCharacterData> = {}): RuntimeCharacterData => ({
    id: id,
    name: `Char ${id}`,
    user: mockUser,
    userId: mockUser.id,
    ownerId: mockUser.id,
    baseHealth: 100,
    currentHealth: 100,
    baseAttack: 10,
    baseDefense: 5,
    positionX: 100,
    positionY: 100,
    anchorX: 100,
    anchorY: 100,
    leashDistance: 50,
    state: 'idle',
    attackTargetId: null,
    targetX: null,
    targetY: null,
    attackRange: 5,
    attackSpeed: 1000,
    lastAttackTime: 0,
    aggroRange: 10,
    timeOfDeath: null,
    level: 1,
    xp: 0,
    currentZoneId: 'zone1',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
});

// Mock implementations
const mockZoneService = {
  getCharacterById: jest.fn(),
  getCharactersInZone: jest.fn(),
  getEnemyInstanceById: jest.fn(), // Might be needed if AI targets other enemies
  updateEnemyHealth: jest.fn(), // If health updates are direct
  setEnemyTarget: jest.fn(),
  getCharacterStateById: jest.fn(),
  setEnemyAiState: jest.fn(),
};

const mockCombatService = {
  handleAttack: jest.fn(),
};

const mockAIService = {
  determineAction: jest.fn(),
  updateEnemyAI: jest.fn(),
};

const mockMovementService = {
  simulateMovement: jest.fn(),
};

describe('EnemyStateService', () => {
  let service: EnemyStateService;
  let zoneService: ZoneService;
  let combatService: CombatService;
  let aiService: AIService;
  let movementService: MovementService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EnemyStateService,
        { provide: ZoneService, useValue: mockZoneService },
        { provide: CombatService, useValue: mockCombatService },
        { provide: AIService, useValue: mockAIService },
        { provide: MovementService, useValue: mockMovementService },
      ],
    }).compile();

    service = module.get<EnemyStateService>(EnemyStateService);
    zoneService = module.get<ZoneService>(ZoneService);
    combatService = module.get<CombatService>(CombatService);
    aiService = module.get<AIService>(AIService);
    movementService = module.get<MovementService>(MovementService);

    // Reset mocks before each test
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // --- Test Cases ---

  it('should clear target when AI action is IDLE', async () => {
    const enemy = createMockEnemy({ target: { x: 100, y: 100 } }); // Start with a target
    const idleAction: AIAction = { type: 'IDLE' };
    mockAIService.updateEnemyAI.mockReturnValue(idleAction);

    const results = await service.processEnemyTick(enemy, 'zone1', Date.now(), 0.1);

    expect(mockAIService.updateEnemyAI).toHaveBeenCalledWith(enemy, 'zone1');
    expect(mockZoneService.setEnemyTarget).toHaveBeenCalledWith('zone1', enemy.id, null);
    expect(results.aiActionType).toBe('IDLE');
    expect(results.combatActions).toHaveLength(0);
    expect(results.characterHealthUpdates).toHaveLength(0);
  });

  it('should set target when AI action is MOVE_TO', async () => {
    const enemy = createMockEnemy({ target: null }); // Start without a target
    const targetPosition = { x: 200, y: 250 };
    const moveAction: AIAction = { type: 'MOVE_TO', target: targetPosition };
    mockAIService.updateEnemyAI.mockReturnValue(moveAction);

    const results = await service.processEnemyTick(enemy, 'zone1', Date.now(), 0.1);

    expect(mockAIService.updateEnemyAI).toHaveBeenCalledWith(enemy, 'zone1');
    expect(mockZoneService.setEnemyTarget).toHaveBeenCalledWith('zone1', enemy.id, targetPosition);
    expect(results.aiActionType).toBe('MOVE_TO');
    expect(results.combatActions).toHaveLength(0);
    expect(results.characterHealthUpdates).toHaveLength(0);
  });

  it('should call combatService and record results when AI action is ATTACK', async () => {
    const enemy = createMockEnemy();
    const characterTarget = createMockCharacter('charTarget1', { currentHealth: 100 });
    const attackAction: AIAction = { type: 'ATTACK', targetEntityId: characterTarget.id, targetEntityType: 'character' };
    const combatResult: CombatResult = { damageDealt: 15, targetDied: false, targetCurrentHealth: 85 };

    mockAIService.updateEnemyAI.mockReturnValue(attackAction);
    mockZoneService.getCharacterStateById.mockReturnValue(characterTarget);
    mockCombatService.handleAttack.mockResolvedValue(combatResult);

    const results = await service.processEnemyTick(enemy, 'zone1', Date.now(), 0.1);

    expect(mockAIService.updateEnemyAI).toHaveBeenCalledWith(enemy, 'zone1');
    expect(mockZoneService.getCharacterStateById).toHaveBeenCalledWith('zone1', characterTarget.id);
    expect(mockCombatService.handleAttack).toHaveBeenCalledWith(enemy, characterTarget, 'zone1');
    expect(results.aiActionType).toBe('ATTACK');
    expect(results.combatActions).toHaveLength(1);
    expect(results.combatActions[0]).toEqual({ attackerId: enemy.id, targetId: characterTarget.id, damage: combatResult.damageDealt, type: 'attack' });
    expect(results.characterHealthUpdates).toHaveLength(1);
    expect(results.characterHealthUpdates[0]).toEqual({ id: characterTarget.id, health: combatResult.targetCurrentHealth });
    expect(results.targetDied).toBe(false);
  });

  // --- ATTACK Action Edge Cases ---

  it('should record targetDied when combat result indicates death', async () => {
    const enemy = createMockEnemy();
    const characterTarget = createMockCharacter('charTarget1', { currentHealth: 10 }); // Low health
    const attackAction: AIAction = { type: 'ATTACK', targetEntityId: characterTarget.id, targetEntityType: 'character' };
    const combatResult: CombatResult = { damageDealt: 15, targetDied: true, targetCurrentHealth: -5 }; // Target dies

    mockAIService.updateEnemyAI.mockReturnValue(attackAction);
    mockZoneService.getCharacterStateById.mockReturnValue(characterTarget);
    mockCombatService.handleAttack.mockResolvedValue(combatResult);

    const results = await service.processEnemyTick(enemy, 'zone1', Date.now(), 0.1);

    expect(mockCombatService.handleAttack).toHaveBeenCalled();
    expect(results.targetDied).toBe(true);
    // Ensure health updates and combat actions are still recorded even on death
    expect(results.combatActions).toHaveLength(1);
    expect(results.characterHealthUpdates).toHaveLength(1);
    expect(results.characterHealthUpdates[0].health).toBe(combatResult.targetCurrentHealth);
  });

  it('should not call combatService if target is invalid (not found)', async () => {
    const enemy = createMockEnemy();
    const attackAction: AIAction = { type: 'ATTACK', targetEntityId: 'nonExistentChar', targetEntityType: 'character' };

    mockAIService.updateEnemyAI.mockReturnValue(attackAction);
    mockZoneService.getCharacterStateById.mockReturnValue(undefined); // Simulate target not found

    const results = await service.processEnemyTick(enemy, 'zone1', Date.now(), 0.1);

    expect(mockAIService.updateEnemyAI).toHaveBeenCalled();
    expect(mockZoneService.getCharacterStateById).toHaveBeenCalledWith('zone1', 'nonExistentChar');
    expect(mockCombatService.handleAttack).not.toHaveBeenCalled();
    expect(results.aiActionType).toBe('ATTACK'); // AI still chose attack
    expect(results.targetDied).toBe(false); // No death occurred
    expect(results.combatActions).toHaveLength(0);
    expect(results.characterHealthUpdates).toHaveLength(0);
    // Check if enemy was forced back to IDLE (as per code comment)
    expect(mockZoneService.setEnemyAiState).toHaveBeenCalledWith('zone1', enemy.id, 'IDLE');
    expect(mockZoneService.setEnemyTarget).toHaveBeenCalledWith('zone1', enemy.id, null);
  });

  it('should not call combatService if target is already dead', async () => {
    const enemy = createMockEnemy();
    // Target character is in 'dead' state
    const deadCharacterTarget = createMockCharacter('charTarget1', { currentHealth: 0, state: 'dead', timeOfDeath: Date.now() - 1000 });
    const attackAction: AIAction = { type: 'ATTACK', targetEntityId: deadCharacterTarget.id, targetEntityType: 'character' };

    mockAIService.updateEnemyAI.mockReturnValue(attackAction);
    mockZoneService.getCharacterStateById.mockReturnValue(deadCharacterTarget);

    const results = await service.processEnemyTick(enemy, 'zone1', Date.now(), 0.1);

    expect(mockAIService.updateEnemyAI).toHaveBeenCalled();
    expect(mockZoneService.getCharacterStateById).toHaveBeenCalledWith('zone1', deadCharacterTarget.id);
    expect(mockCombatService.handleAttack).not.toHaveBeenCalled();
    expect(results.aiActionType).toBe('ATTACK');
    expect(results.targetDied).toBe(false);
    expect(results.combatActions).toHaveLength(0);
    expect(results.characterHealthUpdates).toHaveLength(0);
    // Check if enemy was forced back to IDLE
    expect(mockZoneService.setEnemyAiState).toHaveBeenCalledWith('zone1', enemy.id, 'IDLE');
    expect(mockZoneService.setEnemyTarget).toHaveBeenCalledWith('zone1', enemy.id, null);
  });

}); 