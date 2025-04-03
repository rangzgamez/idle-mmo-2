import { Test, TestingModule } from '@nestjs/testing';
import { CharacterStateService } from './character-state.service';
import { ZoneService } from './zone.service';
import { CombatService } from './combat.service';
import { CombatResult } from './interfaces/combat.interface';
import { RuntimeCharacterData } from './zone.service'; // Assuming this interface exists
import { EnemyInstance } from './interfaces/enemy-instance.interface';
import { User } from '../user/user.entity'; // Import User entity

// Minimal mock User
const mockUser: User = {
    id: 'player1',
    username: 'TestUser',
    // Add other required User properties if necessary, default to dummy values
    passwordHash: 'hashed_password', // Assuming this is required
    characters: [], // Assuming this is required
    createdAt: new Date(),
    updatedAt: new Date(),
};

// Helper to create default character data
const createMockCharacter = (overrides: Partial<RuntimeCharacterData> = {}): RuntimeCharacterData => ({
    id: 'char1',
    name: 'Test Character',
    user: mockUser,
    userId: mockUser.id,
    ownerId: mockUser.id, // Explicitly add ownerId required by RuntimeCharacterData
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
    attackSpeed: 1000, // ms
    lastAttackTime: 0,
    aggroRange: 10,
    timeOfDeath: null,
    // Add other Character entity properties if required by RuntimeCharacterData
    level: 1,
    xp: 0,
    currentZoneId: 'zone1',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
});

// Mock implementations
const mockZoneService = {
  getEnemyInstanceById: jest.fn(),
  getEnemiesInZone: jest.fn(),
  getCharacterById: jest.fn(), // Might be needed if we directly fetch character state
  updateCharacterHealth: jest.fn(), // If health updates are direct
};

const mockCombatService = {
  handleAttack: jest.fn(),
  calculateDistance: jest.fn(), // Assuming distance calc might be here or in a helper
};

describe('CharacterStateService', () => {
  let service: CharacterStateService;
  let zoneService: ZoneService;
  let combatService: CombatService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CharacterStateService,
        { provide: ZoneService, useValue: mockZoneService },
        { provide: CombatService, useValue: mockCombatService },
      ],
    }).compile();

    service = module.get<CharacterStateService>(CharacterStateService);
    zoneService = module.get<ZoneService>(ZoneService);
    combatService = module.get<CombatService>(CombatService);

    // Reset mocks before each test
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // --- Death and Respawn Tests ---

  it('should handle character death', async () => {
    const character = createMockCharacter({ currentHealth: 5 });
    const now = Date.now();

    // Simulate taking lethal damage (health <= 0)
    character.currentHealth = 0;

    const results = await service.processCharacterTick(character, 'player1', 'zone1', [], now, 0.1);

    expect(results.diedThisTick).toBe(true);
    expect(results.respawnedThisTick).toBe(false);
    expect(results.characterData.state).toBe('dead');
    expect(results.characterData.timeOfDeath).toBe(now);
    expect(results.characterData.attackTargetId).toBeNull();
    expect(results.characterData.targetX).toBeNull();
    expect(results.characterData.targetY).toBeNull();
  });

  it('should handle character respawn', async () => {
    const respawnTime = 5000; // Match the service constant
    const timeOfDeath = Date.now() - respawnTime - 100; // Died just over 5 seconds ago
    const character = createMockCharacter({
      state: 'dead',
      currentHealth: 0,
      timeOfDeath: timeOfDeath,
      anchorX: 50, // Respawn at anchor
      anchorY: 50,
      positionX: 0, // Current position doesn't matter when dead
      positionY: 0,
    });
    const now = Date.now();

    const results = await service.processCharacterTick(character, 'player1', 'zone1', [], now, 0.1);

    expect(results.respawnedThisTick).toBe(true);
    expect(results.diedThisTick).toBe(false);
    expect(results.characterData.state).toBe('idle');
    expect(results.characterData.currentHealth).toBe(character.baseHealth);
    expect(results.characterData.timeOfDeath).toBeNull();
    expect(results.characterData.positionX).toBe(character.anchorX);
    expect(results.characterData.positionY).toBe(character.anchorY);
    expect(results.characterData.attackTargetId).toBeNull();
    expect(results.characterData.targetX).toBeNull();
    expect(results.characterData.targetY).toBeNull();
  });

  it('should do nothing if dead but respawn timer not elapsed', async () => {
    const respawnTime = 5000;
    const timeOfDeath = Date.now() - respawnTime + 1000; // Died 4 seconds ago
    const character = createMockCharacter({
        state: 'dead',
        currentHealth: 0,
        timeOfDeath: timeOfDeath,
    });
    const originalCharacterState = { ...character }; // Shallow copy to compare
    const now = Date.now();

    const results = await service.processCharacterTick(character, 'player1', 'zone1', [], now, 0.1);

    expect(results.respawnedThisTick).toBe(false);
    expect(results.diedThisTick).toBe(false);
    // Ensure character data is largely unchanged (except potentially object reference)
    expect(results.characterData.state).toBe('dead');
    expect(results.characterData.currentHealth).toBe(0);
    expect(results.characterData.timeOfDeath).toBe(timeOfDeath);
  });

  // --- Idle State Tests ---

  it('should regenerate health when idle and below max health', async () => {
    const character = createMockCharacter({ currentHealth: 50, state: 'idle' });
    const now = Date.now();
    const deltaTime = 1; // Simulate 1 second passing

    const results = await service.processCharacterTick(character, 'player1', 'zone1', [], now, deltaTime);

    expect(results.characterData.currentHealth).toBeGreaterThan(50);
    // Calculate expected regen: 1% of base health (100) per second
    const expectedRegen = (character.baseHealth * 1.0 / 100) * deltaTime;
    expect(results.characterData.currentHealth).toBeCloseTo(50 + expectedRegen);
    expect(results.characterData.state).toBe('idle'); // Should remain idle
  });

  it('should not regenerate health when idle and at max health', async () => {
    const character = createMockCharacter({ currentHealth: 100, state: 'idle' });
    const now = Date.now();
    const deltaTime = 1;

    const results = await service.processCharacterTick(character, 'player1', 'zone1', [], now, deltaTime);

    expect(results.characterData.currentHealth).toBe(100);
    expect(results.characterData.state).toBe('idle');
  });

  it('should not regenerate health when attacking', async () => {
    const character = createMockCharacter({ currentHealth: 50, state: 'attacking' });
    const now = Date.now();
    const deltaTime = 1;

    // Need a mock enemy for the attacking state to be valid
    const mockEnemy: EnemyInstance = {
      id: 'enemy1',
      templateId: 'goblin',
      zoneId: 'zone1',
      name: 'Goblin',
      currentHealth: 80,
      position: { x: character.positionX! + 1, y: character.positionY! + 1 }, // Within attack range (Added !)
      aiState: 'IDLE',
      baseAttack: 8,
      baseDefense: 3,
      baseSpeed: 50, // Added missing required property
    };
    mockZoneService.getEnemyInstanceById.mockReturnValue(mockEnemy);

    const results = await service.processCharacterTick(character, 'player1', 'zone1', [mockEnemy], now, deltaTime);

    // Health should not have changed due to regen (might change due to combat, but we aren't testing that here explicitly)
    // So we check it stays at 50, assuming no combat happened yet this tick.
    expect(results.characterData.currentHealth).toBe(50);
    // State might change depending on combat outcome/cooldown, but it started as attacking
    // Let's just ensure it didn't change JUST because of regen.
  });

  it('should auto-aggro the closest enemy when idle and in range', async () => {
    const character = createMockCharacter({ state: 'idle', aggroRange: 100 });
    const enemyInRange = {
      id: 'enemy1',
      templateId: 'goblin',
      zoneId: 'zone1',
      name: 'Goblin Near',
      currentHealth: 50,
      position: { x: character.positionX! + 50, y: character.positionY! }, // 50 units away (Added !)
      aiState: 'IDLE', baseAttack: 1, baseDefense: 1, baseSpeed: 50, // Added baseSpeed
    } as EnemyInstance;
    const enemyOutOfRange = {
      id: 'enemy2',
      templateId: 'goblin',
      zoneId: 'zone1',
      name: 'Goblin Far',
      currentHealth: 50,
      position: { x: character.positionX! + 150, y: character.positionY! }, // 150 units away (Added !)
      aiState: 'IDLE', baseAttack: 1, baseDefense: 1, baseSpeed: 50, // Added baseSpeed
    } as EnemyInstance;
    const deadEnemyInRange = {
        id: 'enemy3',
        templateId: 'goblin',
        zoneId: 'zone1',
        name: 'Goblin Dead',
        currentHealth: 0, // Dead
        position: { x: character.positionX! + 20, y: character.positionY! }, // 20 units away (Added !)
        aiState: 'IDLE', baseAttack: 1, baseDefense: 1, baseSpeed: 50, // Added baseSpeed
    } as EnemyInstance;

    const enemiesInZone = [enemyInRange, enemyOutOfRange, deadEnemyInRange];
    const now = Date.now();

    const results = await service.processCharacterTick(character, 'player1', 'zone1', enemiesInZone, now, 0.1);

    expect(results.characterData.state).toBe('attacking');
    expect(results.characterData.attackTargetId).toBe(enemyInRange.id); // Should target the closest, living enemy
    expect(results.characterData.targetX).toBeNull(); // Should not set move target yet (might happen next tick)
    expect(results.characterData.targetY).toBeNull();
  });

  it('should remain idle if no enemies are in aggro range', async () => {
    const character = createMockCharacter({ state: 'idle', aggroRange: 100 });
    const enemyOutOfRange = {
      id: 'enemy1',
      templateId: 'goblin',
      zoneId: 'zone1',
      name: 'Goblin Far',
      currentHealth: 50,
      position: { x: character.positionX! + 150, y: character.positionY! }, // 150 units away (Added !)
      aiState: 'IDLE', baseAttack: 1, baseDefense: 1, baseSpeed: 50, // Added baseSpeed
    } as EnemyInstance;
    const enemiesInZone = [enemyOutOfRange];
    const now = Date.now();

    const results = await service.processCharacterTick(character, 'player1', 'zone1', enemiesInZone, now, 0.1);

    expect(results.characterData.state).toBe('idle');
    expect(results.characterData.attackTargetId).toBeNull();
  });

  // --- Attacking State Tests ---

  it('should attack target when in range and attack cooldown is ready', async () => {
    const attackSpeed = 1000; // ms
    const lastAttackTime = Date.now() - attackSpeed - 100; // Cooldown finished
    const character = createMockCharacter({
      state: 'attacking',
      attackTargetId: 'enemy1',
      attackRange: 50,
      attackSpeed: attackSpeed,
      lastAttackTime: lastAttackTime,
      positionX: 100,
      positionY: 100,
    });
    const targetEnemy: EnemyInstance = {
      id: 'enemy1',
      templateId: 'goblin',
      zoneId: 'zone1',
      name: 'Goblin Target',
      currentHealth: 80,
      position: { x: 120, y: 100 }, // In range (distance 20)
      aiState: 'IDLE',
      baseAttack: 8, baseDefense: 3, baseSpeed: 50,
    };
    mockZoneService.getEnemyInstanceById.mockReturnValue(targetEnemy);
    mockCombatService.handleAttack.mockResolvedValue({ damageDealt: 5, targetDied: false, targetCurrentHealth: 75 });

    const now = Date.now();
    const results = await service.processCharacterTick(character, 'player1', 'zone1', [targetEnemy], now, 0.1);

    expect(mockZoneService.getEnemyInstanceById).toHaveBeenCalledWith('zone1', 'enemy1');
    expect(mockCombatService.handleAttack).toHaveBeenCalledWith(character, targetEnemy, 'zone1');
    expect(results.characterData.lastAttackTime).toBe(now);
    expect(results.combatActions).toHaveLength(1);
    expect(results.combatActions[0]).toEqual({ attackerId: character.id, targetId: targetEnemy.id, damage: 5, type: 'attack' });
    expect(results.enemyHealthUpdates).toHaveLength(1);
    expect(results.enemyHealthUpdates[0]).toEqual({ id: targetEnemy.id, health: 75 });
    expect(results.characterData.state).toBe('attacking'); // Remains attacking
    expect(results.targetDied).toBe(false);
  });

  it('should move towards target if attacking but out of range', async () => {
    const character = createMockCharacter({
      state: 'attacking',
      attackTargetId: 'enemy1',
      attackRange: 50,
      positionX: 100,
      positionY: 100,
      targetX: null, // Not currently moving explicitly
      targetY: null,
    });
    const targetEnemy: EnemyInstance = {
      id: 'enemy1',
      templateId: 'goblin',
      zoneId: 'zone1',
      name: 'Goblin Target',
      currentHealth: 80,
      position: { x: 200, y: 100 }, // Out of range (distance 100)
      aiState: 'IDLE',
      baseAttack: 8, baseDefense: 3, baseSpeed: 50,
    };
    mockZoneService.getEnemyInstanceById.mockReturnValue(targetEnemy);

    const now = Date.now();
    const results = await service.processCharacterTick(character, 'player1', 'zone1', [targetEnemy], now, 0.1);

    expect(mockCombatService.handleAttack).not.toHaveBeenCalled();
    expect(results.characterData.state).toBe('attacking'); // State remains attacking
    expect(results.characterData.targetX).toBe(targetEnemy.position.x);
    expect(results.characterData.targetY).toBe(targetEnemy.position.y);
  });

  it('should not attack if attack cooldown is not ready', async () => {
    const attackSpeed = 1000;
    const lastAttackTime = Date.now() - attackSpeed + 100; // Cooldown NOT finished (only 900ms passed)
    const character = createMockCharacter({
      state: 'attacking',
      attackTargetId: 'enemy1',
      attackRange: 50,
      attackSpeed: attackSpeed,
      lastAttackTime: lastAttackTime,
      positionX: 100,
      positionY: 100,
    });
    const targetEnemy: EnemyInstance = {
      id: 'enemy1',
      templateId: 'goblin',
      zoneId: 'zone1',
      name: 'Goblin Target',
      currentHealth: 80,
      position: { x: 120, y: 100 }, // In range
      aiState: 'IDLE',
      baseAttack: 8, baseDefense: 3, baseSpeed: 50,
    };
    mockZoneService.getEnemyInstanceById.mockReturnValue(targetEnemy);

    const now = Date.now();
    const results = await service.processCharacterTick(character, 'player1', 'zone1', [targetEnemy], now, 0.1);

    expect(mockCombatService.handleAttack).not.toHaveBeenCalled();
    expect(results.characterData.lastAttackTime).toBe(lastAttackTime); // Should not have updated
    expect(results.characterData.state).toBe('attacking');
    expect(results.combatActions).toHaveLength(0);
    expect(results.enemyHealthUpdates).toHaveLength(0);
  });

  it('should transition to idle if target dies after attack', async () => {
    const character = createMockCharacter({
      state: 'attacking',
      attackTargetId: 'enemy1',
      attackRange: 50,
      attackSpeed: 1000,
      lastAttackTime: 0, // Cooldown ready
      positionX: 100,
      positionY: 100,
    });
    const targetEnemy: EnemyInstance = {
      id: 'enemy1',
      templateId: 'goblin',
      zoneId: 'zone1',
      name: 'Goblin Target',
      currentHealth: 5, // Low health
      position: { x: 120, y: 100 }, // In range
      aiState: 'IDLE',
      baseAttack: 8, baseDefense: 3, baseSpeed: 50,
    };
    mockZoneService.getEnemyInstanceById.mockReturnValue(targetEnemy);
    // Simulate attack resulting in death
    mockCombatService.handleAttack.mockResolvedValue({ damageDealt: 10, targetDied: true, targetCurrentHealth: -5 });

    const now = Date.now();
    const results = await service.processCharacterTick(character, 'player1', 'zone1', [targetEnemy], now, 0.1);

    expect(mockCombatService.handleAttack).toHaveBeenCalled();
    expect(results.targetDied).toBe(true);
    expect(results.characterData.state).toBe('idle');
    expect(results.characterData.attackTargetId).toBeNull();
    expect(results.combatActions).toHaveLength(1);
    expect(results.enemyHealthUpdates).toHaveLength(1);
  });

  it('should transition to idle if attack target becomes invalid', async () => {
    const character = createMockCharacter({
      state: 'attacking',
      attackTargetId: 'enemy1',
    });
    // Simulate enemy not being found
    mockZoneService.getEnemyInstanceById.mockReturnValue(undefined);

    const now = Date.now();
    const results = await service.processCharacterTick(character, 'player1', 'zone1', [], now, 0.1);

    expect(mockCombatService.handleAttack).not.toHaveBeenCalled();
    expect(results.characterData.state).toBe('idle');
    expect(results.characterData.attackTargetId).toBeNull();
  });

  // --- Leashing Tests ---

  it('should start leashing (moving to anchor) if outside leash distance', async () => {
    const anchorX = 100;
    const anchorY = 100;
    const leashDistance = 50;
    const character = createMockCharacter({
      state: 'idle', // Could be idle or moving away
      anchorX: anchorX,
      anchorY: anchorY,
      leashDistance: leashDistance,
      positionX: anchorX + leashDistance + 10, // Clearly outside leash range
      positionY: anchorY,
      attackTargetId: null,
    });

    const now = Date.now();
    const results = await service.processCharacterTick(character, 'player1', 'zone1', [], now, 0.1);

    expect(results.characterData.state).toBe('moving');
    expect(results.characterData.targetX).toBe(anchorX);
    expect(results.characterData.targetY).toBe(anchorY);
    expect(results.characterData.attackTargetId).toBeNull(); // Ensure no target while leashing
  });

  it('should stop attacking and start leashing if attacking outside leash distance', async () => {
    const anchorX = 100;
    const anchorY = 100;
    const leashDistance = 50;
    const character = createMockCharacter({
      state: 'attacking',
      anchorX: anchorX,
      anchorY: anchorY,
      leashDistance: leashDistance,
      positionX: anchorX + leashDistance + 10, // Outside leash range
      positionY: anchorY,
      attackTargetId: 'enemy1', // Was attacking something
      targetX: 300, // Might have been moving towards enemy
      targetY: 300,
    });
    // Add a dummy enemy just so the 'attacking' state doesn't immediately flip to idle due to invalid target
    const dummyEnemy: EnemyInstance = { id: 'enemy1', templateId: 't', zoneId: 'z1', name: 'Dummy', currentHealth: 1, position: { x: 300, y: 300 }, aiState: 'IDLE', baseAttack: 1, baseDefense: 1, baseSpeed: 1 };
    mockZoneService.getEnemyInstanceById.mockReturnValue(dummyEnemy);

    const now = Date.now();
    const results = await service.processCharacterTick(character, 'player1', 'zone1', [dummyEnemy], now, 0.1);

    expect(results.characterData.state).toBe('moving'); // Leashing overrides attacking
    expect(results.characterData.targetX).toBe(anchorX);
    expect(results.characterData.targetY).toBe(anchorY);
    expect(results.characterData.attackTargetId).toBeNull(); // Should stop attacking
    expect(mockCombatService.handleAttack).not.toHaveBeenCalled();
  });

  it('should continue normal state logic if within leash distance', async () => {
    const anchorX = 100;
    const anchorY = 100;
    const leashDistance = 50;
    const character = createMockCharacter({
      state: 'idle', // Start idle
      anchorX: anchorX,
      anchorY: anchorY,
      leashDistance: leashDistance,
      positionX: anchorX + leashDistance - 10, // Within leash range
      positionY: anchorY,
      aggroRange: 30, // Will aggro nearby enemy
    });
    const enemyNearby: EnemyInstance = {
      id: 'enemy1',
      templateId: 'goblin',
      zoneId: 'zone1',
      name: 'Goblin Nearby',
      currentHealth: 50,
      position: { x: character.positionX! + 10, y: character.positionY! }, // Close enough to aggro
      aiState: 'IDLE', baseAttack: 1, baseDefense: 1, baseSpeed: 50,
    };

    const now = Date.now();
    const results = await service.processCharacterTick(character, 'player1', 'zone1', [enemyNearby], now, 0.1);

    // Should not be leashing, should have aggroed instead
    expect(results.characterData.state).toBe('attacking');
    expect(results.characterData.attackTargetId).toBe(enemyNearby.id);
    expect(results.characterData.targetX).toBeNull(); // Not moving towards anchor
    expect(results.characterData.targetY).toBeNull();
  });

  // --- Moving State Tests ---

  it('should transition from moving to idle when destination is reached', async () => {
    const anchorX = 100;
    const anchorY = 100;
    const leashDistance = 50;
    const targetX = anchorX + 20; // 120 (Within leash range of anchor)
    const targetY = anchorY + 20; // 120
    const character = createMockCharacter({
      state: 'moving',
      anchorX: anchorX,
      anchorY: anchorY,
      leashDistance: leashDistance,
      positionX: targetX - 0.5, // 119.5 (Very close to target, also within leash range)
      positionY: targetY - 0.5, // 119.5
      targetX: targetX,
      targetY: targetY,
    });

    const now = Date.now();
    const results = await service.processCharacterTick(character, 'player1', 'zone1', [], now, 0.1);

    // Leashing should NOT interfere now
    expect(results.characterData.state).toBe('idle');
    expect(results.characterData.positionX).toBe(targetX); // Should snap to target
    expect(results.characterData.positionY).toBe(targetY);
    expect(results.characterData.targetX).toBeNull();
    expect(results.characterData.targetY).toBeNull();
  });

  it('should remain in moving state if destination is not reached', async () => {
    const anchorX = 100;
    const anchorY = 100;
    const leashDistance = 50;
    const targetX = anchorX + 40; // 140 (Destination is within leash range)
    const targetY = anchorY + 40; // 140
    const character = createMockCharacter({
      state: 'moving',
      anchorX: anchorX,
      anchorY: anchorY,
      leashDistance: leashDistance,
      positionX: anchorX + 10, // 110 (Start pos also within leash range)
      positionY: anchorY + 10, // 110 (Still far from target)
      targetX: targetX,
      targetY: targetY,
    });

    const now = Date.now();
    const results = await service.processCharacterTick(character, 'player1', 'zone1', [], now, 0.1);

    // Leashing should NOT interfere
    expect(results.characterData.state).toBe('moving');
    expect(results.characterData.targetX).toBe(targetX); // Should remain targeting 140
    expect(results.characterData.targetY).toBe(targetY); // Should remain targeting 140
  });

  // --- Test cases will go here ---

}); 