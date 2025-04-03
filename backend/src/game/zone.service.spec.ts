// backend/src/game/zone.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { ZoneService, RuntimeCharacterData } from './zone.service';
import { EnemyService } from '../enemy/enemy.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Enemy } from '../enemy/enemy.entity';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { EnemyInstance } from './interfaces/enemy-instance.interface';
import { Socket } from 'socket.io'; // Import Socket
import { Character } from '../character/character.entity';
import { User } from '../user/user.entity';

//Reusable mock enemy template
const mockEnemyTemplate = {
  id: 'goblin',
  name: 'Goblin Warrior',
  level: 1,
  baseHealth: 50,
  baseAttack: 5,
  baseDefense: 2,
  baseSpeed: 75,
  attackRange: 30,
  xpReward: 10,
  behaviorFlags: {
    isAggressive: true,
    isStationary: false,
  },
  spriteKey: 'goblin',
  createdAt: new Date(),
  updatedAt: new Date(),
};

// --- Re-add Reusable Mock Factories ---
const createMockEnemy = (id: string, health: number, attack: number, defense: number): EnemyInstance => ({
  id: id, 
  templateId: `template-${id}`,
  zoneId: 'startZone', // Use consistent zone ID
  name: `Enemy ${id}`,
  currentHealth: health,
  position: { x: 10, y: 10 },
  aiState: 'IDLE',
  baseAttack: attack,
  baseDefense: defense,
  baseSpeed: 75,
});

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
  currentZoneId: 'startZone', // Use consistent zone ID
  baseHealth: 100, 
  currentHealth: health,
  baseAttack: attack,
  baseDefense: defense,
  user: { id: `user-${id}`, username: `User ${id}` } as User,
  createdAt: new Date(),
  updatedAt: new Date(),
  state: 'idle',
  attackTargetId: null,
  anchorX: 20,
  anchorY: 20,
  attackRange: 50,
  aggroRange: 150,
  leashDistance: 400,
  attackSpeed: 1500,
  lastAttackTime: 0,
  timeOfDeath: null,
});
// -------------------------------------

// Mock EnemyService
const mockEnemyService = {
  findOne: jest.fn(),
  findAll: jest.fn(),
};

// Mock EnemyRepository
const mockEnemyRepository = {
  create: jest.fn(),
  save: jest.fn(),
  find: jest.fn(),
  findOne: jest.fn(),
  merge: jest.fn(),
  remove: jest.fn(),
}

// Mock Socket
const mockSocket = {
  id: 'mockSocketId',
  join: jest.fn(),
  leave: jest.fn(),
  data: {} // Add data property
} as any; // Type assertion to any to bypass strict Socket typing

const DEFAULT_ZONE_ID = 'startZone';

describe('ZoneService', () => {
  let zoneService: ZoneService;
  let enemyService: { findOne: jest.Mock, findAll: jest.Mock };

  // Mock timers
  jest.useFakeTimers();

  beforeEach(async () => {
    // Reset mocks
    mockEnemyService.findOne.mockClear();
    mockEnemyService.findAll.mockClear();
    mockSocket.join.mockClear();
    mockSocket.leave.mockClear();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ZoneService,
        {
          provide: EnemyService,
          useValue: mockEnemyService,
        },
      ],
    }).compile();

    zoneService = module.get<ZoneService>(ZoneService);
    enemyService = module.get(EnemyService);

    // --- Prevent auto-spawning & clear default state for isolation ---
    // Stop any pending timers from constructor (like startSpawningEnemies)
    jest.clearAllTimers();
    // Reset the internal zones map for a clean slate each time
    (zoneService as any).zones = new Map();
    // Re-create the default zone needed by many tests
    (zoneService as any).zones.set(DEFAULT_ZONE_ID, { players: new Map(), enemies: new Map() });
    // -----------------------------------------------------------------
  });

  afterEach(() => {
      // Clear timers after each test
      jest.clearAllTimers();
  });

  it('should be defined and have the default zone', () => {
    expect(zoneService).toBeDefined();
    expect((zoneService as any).zones.has(DEFAULT_ZONE_ID)).toBe(true);
    expect((zoneService as any).zones.get(DEFAULT_ZONE_ID)?.players.size).toBe(0);
    expect((zoneService as any).zones.get(DEFAULT_ZONE_ID)?.enemies.size).toBe(0);
  });

  // Helper function to add an enemy for testing purposes
  const addTestEnemy = async (zoneId: string, position: { x: number; y: number }): Promise<EnemyInstance | null> => {
    // Ensure findOne is mocked *before* addEnemy is called
    enemyService.findOne.mockResolvedValue(mockEnemyTemplate);
    return await zoneService.addEnemy(zoneId, mockEnemyTemplate.id, position);
  };

  // Helper function to add a player to a zone for testing purposes
  const addTestPlayer = (zoneId: string, socket: Socket, user: User, characters: Character[]) => {
    // Explicitly ensure the zone exists before adding player for robustness in tests?
    // if (!(zoneService as any).zones.has(zoneId)) {
    //     (zoneService as any).zones.set(zoneId, { players: new Map(), enemies: new Map() });
    // }
    zoneService.addPlayerToZone(zoneId, socket, user, characters);
  };

    // Mock User and Character data
    const mockUser: User = {
        id: 'mockUserId',
        username: 'testuser',
        characters: [],
        createdAt: new Date(),
        updatedAt: new Date(),
        passwordHash: 'password'
    };
    const mockCharacter: Character = {
        id: 'mockCharId',
        name: 'TestCharacter',
        level: 1,
        xp: 0,
        userId: 'mockUserId',
        positionX: 100,
        positionY: 100,
        currentZoneId: 'startZone',
        baseHealth: 100,
        baseAttack: 15,
        baseDefense: 5,
        createdAt: new Date(),
        updatedAt: new Date(),
        user: mockUser,
        attackSpeed: 1500,
        attackRange: 50,
        aggroRange: 150,
        leashDistance: 400,
    };

  describe('addEnemy', () => {
    it('should add an enemy to the default zone', async () => {
      const zoneId = DEFAULT_ZONE_ID;
      const position = { x: 10, y: 20 };
      enemyService.findOne.mockResolvedValue(mockEnemyTemplate);
      const enemyInstance = await zoneService.addEnemy(zoneId, mockEnemyTemplate.id, position);
      expect(enemyService.findOne).toHaveBeenCalledWith(mockEnemyTemplate.id);
      expect(enemyInstance).toBeDefined();
      expect(zoneService.getZoneEnemies(zoneId).length).toBe(1);
      expect(zoneService.getZoneEnemies(zoneId)[0].id).toBe(enemyInstance?.id);
    });

    it('should return null if the zone does not exist', async () => {
      const zoneId = 'nonExistentZone';
      const position = { x: 10, y: 20 };

      const enemyInstance = await zoneService.addEnemy(zoneId, mockEnemyTemplate.id, position);

      expect(enemyInstance).toBeNull();
    });

    it('should return null if the template does not exist', async () => {
      const zoneId = DEFAULT_ZONE_ID;
      const position = { x: 10, y: 20 };

      enemyService.findOne.mockResolvedValue(undefined);

      const enemyInstance = await zoneService.addEnemy(zoneId, mockEnemyTemplate.id, position);

      expect(enemyService.findOne).toHaveBeenCalledWith(mockEnemyTemplate.id);
      expect(enemyInstance).toBeNull();
      expect(zoneService.getZoneEnemies(zoneId).length).toBe(0);
    });
  });

  describe('removeEnemy', () => {
    it('should remove an enemy from the zone', async () => {
      const zoneId = DEFAULT_ZONE_ID;
      const position = { x: 10, y: 20 };
      const enemyInstance = await addTestEnemy(zoneId, position);
      if (!enemyInstance) throw new Error('Test setup failed: addTestEnemy returned null');
      const enemyId = enemyInstance.id;
      expect(zoneService.getEnemyInstanceById(zoneId, enemyId)).toBeDefined(); // Pre-check
      const result = zoneService.removeEnemy(zoneId, enemyId);
      expect(result).toBe(true);
      expect(zoneService.getZoneEnemies(zoneId).length).toBe(0);
      expect(zoneService.getEnemyInstanceById(zoneId, enemyId)).toBeUndefined(); // Post-check
    });

    it('should return false if the zone does not exist', () => {
      const zoneId = 'nonExistentZone';
      const enemyId = 'someEnemyId';

      const result = zoneService.removeEnemy(zoneId, enemyId);

      expect(result).toBe(false);
    });

    it('should return false if the enemyId does not exist', async () => {
      const zoneId = DEFAULT_ZONE_ID;
      const enemyId = 'nonExistentEnemyId';

      const result = zoneService.removeEnemy(zoneId, enemyId);

      expect(result).toBe(false);
    });
  });

  describe('getEnemy', () => {
    it('should return the enemy if it exists', async () => {
      const zoneId = DEFAULT_ZONE_ID;
      const position = { x: 10, y: 20 };

      const enemyInstance = await addTestEnemy(zoneId, position);
      // Add null check for safety
      if (!enemyInstance) throw new Error('Test setup failed: addTestEnemy returned null');
      const enemyId = enemyInstance.id;

      const result = zoneService.getEnemy(zoneId, enemyId);

      expect(result).toBeDefined();
      expect(result?.id).toBe(enemyId);
    });

    it('should return undefined if the zone does not exist', () => {
      const zoneId = 'nonExistentZone';
      const enemyId = 'someEnemyId';

      const result = zoneService.getEnemy(zoneId, enemyId);

      expect(result).toBeUndefined();
    });

    it('should return undefined if the enemyId does not exist', async () => {
      const zoneId = DEFAULT_ZONE_ID;
      const enemyId = 'nonExistentEnemyId';

      const result = zoneService.getEnemy(zoneId, enemyId);

      expect(result).toBeUndefined();
    });
  });

  describe('updateEnemyPosition', () => {
    it('should update the enemy position', async () => {
      const currentZoneId = DEFAULT_ZONE_ID; // Use different variable name
      const position = { x: 10, y: 20 };
      const enemyInstance = await addTestEnemy(currentZoneId, position);
      if (!enemyInstance) throw new Error('Test setup failed: addTestEnemy returned null');
      const enemyId = enemyInstance.id; // Use 'id'
      const newPosition = { x: 30, y: 40 };
      const result = zoneService.updateEnemyPosition(currentZoneId, enemyId, newPosition);
      expect(result).toBe(true);
      expect(zoneService.getEnemyInstanceById(currentZoneId, enemyId)?.position).toEqual(newPosition);
    });
    it('should return false if the zone does not exist', () => {
        const result = zoneService.updateEnemyPosition('nonExistentZone', 'someId', {x:0, y:0});
        expect(result).toBe(false);
    });
    it('should return false if the enemyId does not exist', async () => {
        const currentZoneId = DEFAULT_ZONE_ID; // Use different variable name
        const result = zoneService.updateEnemyPosition(currentZoneId, 'nonExistentId', {x:0, y:0});
        expect(result).toBe(false);
    });
  });

  describe('setEnemyTarget', () => {
      it('should set the enemy target', async () => {
          const currentZoneId = DEFAULT_ZONE_ID;
          const position = { x: 10, y: 20 };
          const enemyInstance = await addTestEnemy(currentZoneId, position);
          if (!enemyInstance) throw new Error('Test setup failed: addTestEnemy returned null');
          const enemyId = enemyInstance.id; // Use 'id'
          const target = { x: 50, y: 50 };
          const result = zoneService.setEnemyTarget(currentZoneId, enemyId, target);
          expect(result).toBe(true);
          expect(zoneService.getEnemyInstanceById(currentZoneId, enemyId)?.target).toEqual(target);
      });
       it('should return false if enemy not found', () => {
            const result = zoneService.setEnemyTarget(DEFAULT_ZONE_ID, 'nonExistentId', {x:0, y:0});
            expect(result).toBe(false);
       });
  });

  describe('setEnemyAiState', () => {
      it('should set the enemy AI state', async () => {
          const currentZoneId = DEFAULT_ZONE_ID;
          const position = { x: 10, y: 20 };
          const enemyInstance = await addTestEnemy(currentZoneId, position);
           if (!enemyInstance) throw new Error('Test setup failed: addTestEnemy returned null');
          const enemyId = enemyInstance.id; // Use 'id'
          const newState = 'CHASING';
          const result = zoneService.setEnemyAiState(currentZoneId, enemyId, newState);
          expect(result).toBe(true);
          expect(zoneService.getEnemyInstanceById(currentZoneId, enemyId)?.aiState).toBe(newState);
      });
       it('should return false if enemy not found', () => {
            const result = zoneService.setEnemyAiState(DEFAULT_ZONE_ID, 'nonExistentId', 'IDLE');
            expect(result).toBe(false);
       });
  });
  
  describe('updateEnemyAttackTime', () => {
     it('should update the enemy last attack time', async () => {
      const currentZoneId = DEFAULT_ZONE_ID;
      const position = { x: 10, y: 20 };
      const enemyInstance = await addTestEnemy(currentZoneId, position);
       if (!enemyInstance) throw new Error('Test setup failed: addTestEnemy returned null');
      const enemyId = enemyInstance.id; // Use 'id'
      const timestamp = Date.now();
      const result = zoneService.updateEnemyAttackTime(currentZoneId, enemyId, timestamp);
      expect(result).toBe(true);
      expect(zoneService.getEnemyInstanceById(currentZoneId, enemyId)?.lastAttackTime).toBe(timestamp);
    });
     it('should return false if enemy not found', () => {
         const result = zoneService.updateEnemyAttackTime(DEFAULT_ZONE_ID, 'nonExistentId', Date.now());
         expect(result).toBe(false);
     });
  });

  describe('updateEnemyHealth', () => {
    it('should update enemy health and return new health', async () => {
        const currentZoneId = DEFAULT_ZONE_ID;
        const position = { x: 10, y: 20 };
        const initialHealth = mockEnemyTemplate.baseHealth;
        const enemyInstance = await addTestEnemy(currentZoneId, position);
         if (!enemyInstance) throw new Error('Test setup failed: addTestEnemy returned null');
        const enemyId = enemyInstance.id; // Use 'id'
        const healthChange = -10;
        const expectedHealth = initialHealth + healthChange;
        const newHealth = await zoneService.updateEnemyHealth(currentZoneId, enemyId, healthChange);
        expect(newHealth).toBe(expectedHealth);
        expect(zoneService.getEnemyInstanceById(currentZoneId, enemyId)?.currentHealth).toBe(expectedHealth);
    });
    it('should return null if the enemyId does not exist', async () => {
        const zoneId = DEFAULT_ZONE_ID;
        const result = await zoneService.updateEnemyHealth(zoneId, 'nonExistentEnemyId', -10);
        expect(result).toBeNull();
    });
    it('should return null if the zone does not exist', async () => {
         const result = await zoneService.updateEnemyHealth('nonExistentZone', 'someEnemyId', -10);
         expect(result).toBeNull();
     });
  });

  describe('addPlayerToZone', () => {
        it('should add a player to the zone', () => {
            const zoneId = 'default';
            addTestPlayer(zoneId, mockSocket, mockUser, [mockCharacter]);

            const zone = zoneService['zones'].get(zoneId);
            expect(zone).toBeDefined();
            expect(zone?.players.has(mockUser.id)).toBe(true);
            expect(mockSocket.join).toHaveBeenCalledWith(zoneId);
        });

        it('should create a new zone if it does not exist', () => {
            const zoneId = 'newZone';
            addTestPlayer(zoneId, mockSocket, mockUser, [mockCharacter]);

            const zone = zoneService['zones'].get(zoneId);
            expect(zone).toBeDefined();
            expect(zone?.players.has(mockUser.id)).toBe(true);
            expect(mockSocket.join).toHaveBeenCalledWith(zoneId);
        });
    });

    describe('removePlayerFromZone', () => {
        it('should remove a player from the zone and call socket.leave', () => {
            const zoneId = DEFAULT_ZONE_ID;
            // Use the helper to add the player
            addTestPlayer(zoneId, mockSocket, mockUser, [mockCharacter]);
            // Assign user to socket data BEFORE calling remove
            mockSocket.data.user = mockUser; 
            
            // Pre-check: Ensure player exists in the map
            const zoneMap = (zoneService as any).zones.get(zoneId);
            expect(zoneMap?.players.has(mockUser.id)).toBe(true);

            const result = zoneService.removePlayerFromZone(mockSocket);

            // Check result
            expect(result).toEqual({ zoneId: zoneId, userId: mockUser.id });
            expect((zoneService as any).zones.get(zoneId)?.players.size).toBe(0);
            // Assert the zone still exists (current behavior)
            expect((zoneService as any).zones.has(zoneId)).toBe(true); // Should be true
            expect(mockSocket.leave).toHaveBeenCalledWith(zoneId); // Socket left room
        });

         it('should return null if user not found on socket data', () => {
              mockSocket.data.user = undefined; // Simulate missing user data
              const result = zoneService.removePlayerFromZone(mockSocket);
              expect(result).toBeNull();
         });
         it('should return null if player not found in any zone', () => {
              // Reset zones map to ensure player isn't lingering from other tests
              (zoneService as any).zones = new Map(); 
              (zoneService as any).zones.set(DEFAULT_ZONE_ID, { players: new Map(), enemies: new Map() });
              mockSocket.data.user = mockUser;
              const result = zoneService.removePlayerFromZone(mockSocket);
              expect(result).toBeNull();
         });
    });

    describe('getPlayersInZone', () => {
        it('should return an array of players in the zone', () => {
            const zoneId = 'default';
            addTestPlayer(zoneId, mockSocket, mockUser, [mockCharacter]);

            const players = zoneService.getPlayersInZone(zoneId);
            expect(players).toBeDefined();
            expect(players.length).toBe(1);
            expect(players[0].user.id).toBe(mockUser.id);
        });

        it('should return an empty array if the zone does not exist', () => {
            const zoneId = 'nonExistentZone';
            const players = zoneService.getPlayersInZone(zoneId);
            expect(players).toEqual([]);
        });
    });

    describe('getZoneCharacterStates', () => {
        it('should return an array of character states in the zone', () => {
            const zoneId = 'default';
            addTestPlayer(zoneId, mockSocket, mockUser, [mockCharacter]);

            const characterStates = zoneService.getZoneCharacterStates(zoneId);
            expect(characterStates).toBeDefined();
            expect(characterStates.length).toBe(1);
            expect(characterStates[0].id).toBe(mockCharacter.id);
        });

        it('should exclude a specific user ID if provided', () => {
            const zoneId = 'default';
            addTestPlayer(zoneId, mockSocket, mockUser, [mockCharacter]);

            const characterStates = zoneService.getZoneCharacterStates(zoneId, mockUser.id);
            expect(characterStates).toBeDefined();
            expect(characterStates.length).toBe(0); //Should be 0, since we excluded the user
        });

        it('should return an empty array if the zone does not exist', () => {
            const zoneId = 'nonExistentZone';
            const characterStates = zoneService.getZoneCharacterStates(zoneId);
            expect(characterStates).toEqual([]);
        });
    });

    describe('getPlayerCharacters', () => {
      it('should return an array of characters for a given user ID', () => {
          const zoneId = 'default';
          addTestPlayer(zoneId, mockSocket, mockUser, [mockCharacter]);

          const characters = zoneService.getPlayerCharacters(mockUser.id);
          expect(characters).toBeDefined();
          expect(characters?.length).toBe(1);
          //expect(characters?[0]?.id).toBe(mockCharacter.id);
      });

      it('should return undefined if the user is not in any zone', () => {
          const userId = 'nonExistentUser';
          const characters = zoneService.getPlayerCharacters(userId);
          expect(characters).toBeUndefined();
      });
  });

  describe('setCharacterTargetPosition', () => {
    it('should set the target position for a character', () => {
        const zoneId = 'default';
        addTestPlayer(zoneId, mockSocket, mockUser, [mockCharacter]);

        const newTargetX = 200;
        const newTargetY = 200;

        const result = zoneService.setCharacterTargetPosition(mockUser.id, mockCharacter.id, newTargetX, newTargetY);

        expect(result).toBeDefined();
        expect(result?.character.targetX).toBe(newTargetX);
        expect(result?.character.targetY).toBe(newTargetY);
    });

    it('should return null if the user or character is not found', () => {
        const newTargetX = 200;
        const newTargetY = 200;

        const result = zoneService.setCharacterTargetPosition('nonExistentUser', 'nonExistentCharacter', newTargetX, newTargetY);
        expect(result).toBeNull();
    });
});

describe('updateCharacterCurrentPosition', () => {
    it('should update the current position for a character', () => {
        const zoneId = 'default';
        addTestPlayer(zoneId, mockSocket, mockUser, [mockCharacter]);

        const newX = 200;
        const newY = 200;

        const result = zoneService.updateCharacterCurrentPosition(mockUser.id, mockCharacter.id, newX, newY);

        expect(result).toBeDefined();
        expect(result?.positionX).toBe(newX);
        expect(result?.positionY).toBe(newY);
    });

    it('should return null if the user or character is not found', () => {
        const newX = 200;
        const newY = 200;

        const result = zoneService.updateCharacterCurrentPosition('nonExistentUser', 'nonExistentCharacter', newX, newY);
        expect(result).toBeNull();
    });
});

describe('updateCharacterPosition', () => {
    it('should update the position for a character', () => {
        const zoneId = 'default';
        addTestPlayer(zoneId, mockSocket, mockUser, [mockCharacter]);

        const newX = 200;
        const newY = 200;

        const result = zoneService.updateCharacterPosition(mockUser.id, mockCharacter.id, newX, newY);

        expect(result).toBeDefined();
        expect(result?.character.positionX).toBe(newX);
        expect(result?.character.positionY).toBe(newY);
    });

    it('should return null if the user or character is not found', () => {
        const newX = 200;
        const newY = 200;

        const result = zoneService.updateCharacterPosition('nonExistentUser', 'nonExistentCharacter', newX, newY);
        expect(result).toBeNull();
    });
});

});