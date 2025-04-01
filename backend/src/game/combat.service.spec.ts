// backend/src/game/combat.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { CombatService } from './combat.service';
import { ZoneService, RuntimeCharacterData } from './zone.service'; // Import necessary types
import { EnemyInstance } from './interfaces/enemy-instance.interface';
import { CombatResult } from './interfaces/combat.interface';
import { Character } from '../character/character.entity'; // Needed for RuntimeCharacterData base
import { User } from '../user/user.entity'; // Needed for RuntimeCharacterData base

// --- Reusable Mock Factory --- 
const createMockEnemy = (id: string, health: number, attack: number, defense: number): EnemyInstance => ({
  id: id,
  templateId: `template-${id}`,
  zoneId: 'test-zone',
  currentHealth: health,
  position: { x: 10, y: 10 },
  aiState: 'IDLE',
  baseAttack: attack,
  baseDefense: defense,
});

// Partial<Character> and Partial<User> help create the object without all entity fields
const createMockCharacter = (id: string, health: number, attack: number, defense: number): RuntimeCharacterData => ({
  id: id,
  userId: `user-${id}`,
  ownerId: `user-${id}`,
  name: `Char ${id}`,
  level: 1,
  xp: 0,
  positionX: 20,
  positionY: 20,
  targetX: null,
  targetY: null,
  currentZoneId: 'test-zone',
  baseHealth: 100, // Assuming base needed by RuntimeCharacterData
  currentHealth: health,
  baseAttack: attack,
  baseDefense: defense,
  // Mock the base Character properties needed by RuntimeCharacterData extension
  user: { id: `user-${id}`, username: `User ${id}` } as User,
  createdAt: new Date(),
  updatedAt: new Date(),
});

// --- Mock ZoneService --- 
const mockZoneService = {
  updateEnemyHealth: jest.fn(),
  updateCharacterHealth: jest.fn(),
  // Add other methods if CombatService ever needs them
};

describe('CombatService', () => {
  let combatService: CombatService;
  let zoneService: ZoneService;

  beforeEach(async () => {
    // Reset mocks before each test
    mockZoneService.updateEnemyHealth.mockClear();
    mockZoneService.updateCharacterHealth.mockClear();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CombatService,
        {
          provide: ZoneService, // Provide the actual ZoneService token
          useValue: mockZoneService, // Use our mock object implementation
        },
      ],
    }).compile();

    combatService = module.get<CombatService>(CombatService);
    zoneService = module.get<ZoneService>(ZoneService); // Get the mock instance if needed
  });

  it('should be defined', () => {
    expect(combatService).toBeDefined();
  });

  describe('calculateDamage', () => {
    it('should calculate damage when attackerAttack is greater than defenderDefense', () => {
      const attackerAttack = 10;
      const defenderDefense = 5;
      const expectedDamage = 5;
      const actualDamage = combatService.calculateDamage(attackerAttack, defenderDefense);
      expect(actualDamage).toBe(expectedDamage);
    });

    it('should return 0 damage when attackerAttack is less than defenderDefense', () => {
      const attackerAttack = 5;
      const defenderDefense = 10;
      const expectedDamage = 0;
      const actualDamage = combatService.calculateDamage(attackerAttack, defenderDefense);
      expect(actualDamage).toBe(expectedDamage);
    });

    it('should return 0 damage when attackerAttack is equal to defenderDefense', () => {
      const attackerAttack = 10;
      const defenderDefense = 10;
      const expectedDamage = 0;
      const actualDamage = combatService.calculateDamage(attackerAttack, defenderDefense);
      expect(actualDamage).toBe(expectedDamage);
    });
  });

  describe('handleAttack', () => {
    const zoneId = 'test-zone';

    it('should deal damage and update character health when enemy attacks character (no kill)', async () => {
      const attacker = createMockEnemy('enemy1', 100, 20, 5);
      const defender = createMockCharacter('char1', 80, 10, 8);
      const expectedDamage = 12; // 20 - 8
      const expectedFinalHealth = 68; // 80 - 12

      // Configure mock ZoneService response
      mockZoneService.updateCharacterHealth.mockResolvedValue(expectedFinalHealth);

      const result = await combatService.handleAttack(attacker, defender, zoneId);

      // Check ZoneService call
      expect(mockZoneService.updateCharacterHealth).toHaveBeenCalledWith(defender.ownerId, defender.id, -expectedDamage);
      expect(mockZoneService.updateEnemyHealth).not.toHaveBeenCalled();

      // Check result object
      expect(result.damageDealt).toBe(expectedDamage);
      expect(result.targetDied).toBe(false);
      expect(result.targetCurrentHealth).toBe(expectedFinalHealth);
      expect(result.error).toBeUndefined();
    });

    it('should deal damage and mark character as dead when enemy attack is lethal', async () => {
      const attacker = createMockEnemy('enemy1', 100, 50, 5); // High attack
      const defender = createMockCharacter('char1', 30, 10, 5); // Low health, low defense
      const expectedDamage = 45; // 50 - 5
      const expectedFinalHealth = 0; // 30 - 45 clamped to 0

      // Configure mock ZoneService response (returns 0 after update)
      mockZoneService.updateCharacterHealth.mockResolvedValue(expectedFinalHealth);

      const result = await combatService.handleAttack(attacker, defender, zoneId);

      expect(mockZoneService.updateCharacterHealth).toHaveBeenCalledWith(defender.ownerId, defender.id, -expectedDamage);
      expect(result.damageDealt).toBe(expectedDamage);
      expect(result.targetDied).toBe(true);
      expect(result.targetCurrentHealth).toBe(expectedFinalHealth);
      expect(result.error).toBeUndefined();
    });

    it('should deal zero damage when enemy attack is less than or equal to character defense', async () => {
      const attacker = createMockEnemy('enemy1', 100, 10, 5);
      const defender = createMockCharacter('char1', 80, 10, 15); // High defense
      const expectedDamage = 0; // 10 - 15 clamped
      const expectedFinalHealth = 80; // Health unchanged

      const result = await combatService.handleAttack(attacker, defender, zoneId);

      // Check ZoneService was NOT called for health update
      expect(mockZoneService.updateCharacterHealth).not.toHaveBeenCalled();
      expect(mockZoneService.updateEnemyHealth).not.toHaveBeenCalled();

      expect(result.damageDealt).toBe(expectedDamage);
      expect(result.targetDied).toBe(false);
      expect(result.targetCurrentHealth).toBe(expectedFinalHealth);
      expect(result.error).toBeUndefined();
    });

    it('should handle attacks on enemies (e.g., character attacking enemy)', async () => {
      const attacker = createMockCharacter('char1', 100, 25, 5);
      const defender = createMockEnemy('enemy1', 50, 10, 10);
      const expectedDamage = 15; // 25 - 10
      const expectedFinalHealth = 35; // 50 - 15

      mockZoneService.updateEnemyHealth.mockResolvedValue(expectedFinalHealth);

      const result = await combatService.handleAttack(attacker, defender, zoneId);

      expect(mockZoneService.updateEnemyHealth).toHaveBeenCalledWith(zoneId, defender.id, -expectedDamage);
      expect(mockZoneService.updateCharacterHealth).not.toHaveBeenCalled();
      expect(result.damageDealt).toBe(expectedDamage);
      expect(result.targetDied).toBe(false);
      expect(result.targetCurrentHealth).toBe(expectedFinalHealth);
      expect(result.error).toBeUndefined();
    });

    // TODO: Add test case for ZoneService update failing (returning null)
    // TODO: Add test case for errors during stat access (if stats could be missing)
  });
});