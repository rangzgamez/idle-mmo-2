// backend/src/game/zone.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { ZoneService } from './zone.service';
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
  baseSpeed: 20,
  attackRange: 30,
  xpReward: 10,
  behaviorFlags: {
    isAggressive: true,
    isStationary: false,
  },
  spriteKey: 'goblin',
};

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


describe('ZoneService', () => {
  let zoneService: ZoneService;
  let enemyService: { findOne: jest.Mock, findAll: jest.Mock };
  let enemyRepository: { create: jest.Mock, save: jest.Mock, find: jest.Mock, findOne: jest.Mock, merge: jest.Mock, remove: jest.Mock};

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ZoneService,
        {
          provide: EnemyService,
          useValue: mockEnemyService,
        },
        {
          provide: getRepositoryToken(Enemy),
          useValue: mockEnemyRepository
        }
      ],
    }).compile();

    zoneService = module.get<ZoneService>(ZoneService);
    enemyService = module.get(EnemyService);
    enemyRepository = module.get(getRepositoryToken(Enemy));
  });

  it('should be defined', () => {
    expect(zoneService).toBeDefined();
  });

  // Helper function to add an enemy for testing purposes
  const addTestEnemy = async (zoneId: string, position: { x: number; y: number }) => {
    enemyService.findOne.mockResolvedValue(mockEnemyTemplate);
    return await zoneService.addEnemy(zoneId, mockEnemyTemplate.id, position);
  };

  // Helper function to add a player to a zone for testing purposes
  const addTestPlayer = (zoneId: string, socket: Socket, user: User, characters: Character[]) => {
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
        currentZoneId: 'default',
        createdAt: new Date(),
        updatedAt: new Date(),
        user: mockUser
    };

  describe('addEnemy', () => {
    it('should add an enemy to the zone', async () => {
      const zoneId = 'default';
      const position = { x: 10, y: 20 };

      const enemyInstance = await addTestEnemy(zoneId, position);

      expect(enemyService.findOne).toHaveBeenCalledWith(mockEnemyTemplate.id);
      expect(enemyInstance).toBeDefined();
      expect(enemyInstance?.templateId).toBe(mockEnemyTemplate.id);
      expect(zoneService.getZoneEnemies(zoneId).length).toBe(1);
    });

    it('should return null if the zone does not exist', async () => {
      const zoneId = 'nonExistentZone';
      const position = { x: 10, y: 20 };

      const enemyInstance = await zoneService.addEnemy(zoneId, mockEnemyTemplate.id, position);

      expect(enemyInstance).toBeNull();
    });

    it('should return null if the template does not exist', async () => {
      const zoneId = 'default';
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
      const zoneId = 'default';
      const position = { x: 10, y: 20 };

      const enemyInstance = await addTestEnemy(zoneId, position);
      const instanceId = enemyInstance?.instanceId;

      const result = zoneService.removeEnemy(zoneId, instanceId!);

      expect(result).toBe(true);
      expect(zoneService.getZoneEnemies(zoneId).length).toBe(0);
    });

    it('should return false if the zone does not exist', () => {
      const zoneId = 'nonExistentZone';
      const instanceId = 'someInstanceId';

      const result = zoneService.removeEnemy(zoneId, instanceId);

      expect(result).toBe(false);
    });

    it('should return false if the instanceId does not exist', async () => {
      const zoneId = 'default';
      const instanceId = 'nonExistentInstanceId';
      const result = zoneService.removeEnemy(zoneId, instanceId);

      expect(result).toBe(false);
    });
  });

  describe('getEnemy', () => {
    it('should return the enemy if it exists', async () => {
      const zoneId = 'default';
      const position = { x: 10, y: 20 };

      const enemyInstance = await addTestEnemy(zoneId, position);
      const instanceId = enemyInstance?.instanceId;

      const result = zoneService.getEnemy(zoneId, instanceId!);

      expect(result).toBeDefined();
      expect(result?.instanceId).toBe(instanceId);
    });

    it('should return undefined if the zone does not exist', () => {
      const zoneId = 'nonExistentZone';
      const instanceId = 'someInstanceId';

      const result = zoneService.getEnemy(zoneId, instanceId);

      expect(result).toBeUndefined();
    });

    it('should return undefined if the instanceId does not exist', async () => {
      const zoneId = 'default';
      const instanceId = 'nonExistentInstanceId';

      const result = zoneService.getEnemy(zoneId, instanceId);

      expect(result).toBeUndefined();
    });
  });

  describe('updateEnemyPosition', () => {
    it('should update the enemy position', async () => {
      const zoneId = 'default';
      const position = { x: 10, y: 20 };

      const enemyInstance = await addTestEnemy(zoneId, position);
      const instanceId = enemyInstance?.instanceId;
      const newPosition = { x: 30, y: 40 };

      const result = zoneService.updateEnemyPosition(zoneId, instanceId!, newPosition);

      expect(result).toBe(true);
      expect(zoneService.getEnemy(zoneId, instanceId!)?.position).toEqual(newPosition);
    });

    it('should return false if the zone does not exist', () => {
      const zoneId = 'nonExistentZone';
      const instanceId = 'someInstanceId';
      const newPosition = { x: 30, y: 40 };

      const result = zoneService.updateEnemyPosition(zoneId, instanceId, newPosition);

      expect(result).toBe(false);
    });

    it('should return false if the instanceId does not exist', async () => {
      const zoneId = 'default';
      const instanceId = 'nonExistentInstanceId';
      const newPosition = { x: 30, y: 40 };

      const result = zoneService.updateEnemyPosition(zoneId, instanceId, newPosition);

      expect(result).toBe(false);
    });
  });

  describe('setEnemyTarget', () => {
    it('should set the enemy target', async () => {
      const zoneId = 'default';
      const position = { x: 10, y: 20 };

      const enemyInstance = await addTestEnemy(zoneId, position);
      const instanceId = enemyInstance?.instanceId;
      const newTarget = { x: 30, y: 40 };

      const result = zoneService.setEnemyTarget(zoneId, instanceId!, newTarget);

      expect(result).toBe(true);
      expect(zoneService.getEnemy(zoneId, instanceId!)?.target).toEqual(newTarget);
    });

    it('should return false if the zone does not exist', () => {
      const zoneId = 'nonExistentZone';
      const instanceId = 'someInstanceId';
      const newTarget = { x: 30, y: 40 };

      const result = zoneService.setEnemyTarget(zoneId, instanceId, newTarget);

      expect(result).toBe(false);
    });

    it('should return false if the instanceId does not exist', async () => {
      const zoneId = 'default';
      const instanceId = 'nonExistentInstanceId';
      const newTarget = { x: 30, y: 40 };

      const result = zoneService.setEnemyTarget(zoneId, instanceId, newTarget);

      expect(result).toBe(false);
    });
  });

  describe('setEnemyAiState', () => {
    it('should set the enemy AI state', async () => {
      const zoneId = 'default';
      const position = { x: 10, y: 20 };

      const enemyInstance = await addTestEnemy(zoneId, position);
      const instanceId = enemyInstance?.instanceId;
      const newAiState = 'CHASING';

      const result = zoneService.setEnemyAiState(zoneId, instanceId!, newAiState);

      expect(result).toBe(true);
      expect(zoneService.getEnemy(zoneId, instanceId!)?.aiState).toBe(newAiState);
    });

    it('should return false if the zone does not exist', () => {
      const zoneId = 'nonExistentZone';
      const instanceId = 'someInstanceId';
      const newAiState = 'CHASING';

      const result = zoneService.setEnemyAiState(zoneId, instanceId, newAiState);

      expect(result).toBe(false);
    });

    it('should return false if the instanceId does not exist', async () => {
      const zoneId = 'default';
      const instanceId = 'nonExistentInstanceId';
      const newAiState = 'CHASING';

      const result = zoneService.setEnemyAiState(zoneId, instanceId, newAiState);

      expect(result).toBe(false);
    });
  });

  describe('updateEnemyHealth', () => {
    it('should update the enemy health', async () => {
      const zoneId = 'default';
      const position = { x: 10, y: 20 };

      const enemyInstance = await addTestEnemy(zoneId, position);
      const instanceId = enemyInstance?.instanceId;
      const healthChange = -10;

      const result = zoneService.updateEnemyHealth(zoneId, instanceId!, healthChange);

      expect(result).toBe(true);
      expect(zoneService.getEnemy(zoneId, instanceId!)?.currentHealth).toBe(40);
    });

    it('should not let the health go below 0', async () => {
      const zoneId = 'default';
      const position = { x: 10, y: 20 };

      const enemyInstance = await addTestEnemy(zoneId, position);
      const instanceId = enemyInstance?.instanceId;
      const healthChange = -100;

      const result = zoneService.updateEnemyHealth(zoneId, instanceId!, healthChange);

      expect(result).toBe(true);
      expect(zoneService.getEnemy(zoneId, instanceId!)?.currentHealth).toBe(0);
    });

    it('should return false if the zone does not exist', () => {
      const zoneId = 'nonExistentZone';
      const instanceId = 'someInstanceId';
      const healthChange = -10;

      const result = zoneService.updateEnemyHealth(zoneId, instanceId, healthChange);

      expect(result).toBe(false);
    });

    it('should return false if the instanceId does not exist', async () => {
      const zoneId = 'default';
      const instanceId = 'nonExistentInstanceId';
      const healthChange = -10;

      const result = zoneService.updateEnemyHealth(zoneId, instanceId, healthChange);

      expect(result).toBe(false);
    });
  });

  describe('spawnEnemy', () => {
    it('should spawn an enemy in the zone', async () => {
      const zoneId = 'default';
      enemyService.findAll.mockResolvedValue([mockEnemyTemplate]);
      enemyService.findOne.mockResolvedValue(mockEnemyTemplate); // Add mock for findOne, since spawnEnemy calls addEnemy

      // Mock Math.random to ensure consistent test results
      jest.spyOn(Math, 'random').mockReturnValue(0.5);

      //Spy on addEnemy for spawnEnemy test to ensure addEnemy is only called once and that the position has been calculated correctly
      const addEnemySpy = jest.spyOn(zoneService, 'addEnemy');

      // Mock the startSpawningEnemies method so that it spawns only once
      jest.spyOn(zoneService as any, 'startSpawningEnemies').mockImplementation(() => {
          (zoneService as any).spawnEnemy(zoneId);
      });

      (zoneService as any).startSpawningEnemies(zoneId);

      expect(enemyService.findAll).toHaveBeenCalled();
      expect(addEnemySpy).toHaveBeenCalledTimes(1);

      const expectedPosition = {x: 250, y: 250}; // Since Math.random is mocked to return 0.5
      expect(addEnemySpy).toHaveBeenCalledWith(zoneId, mockEnemyTemplate.id, expectedPosition);

      // Restore Math.random to its original implementation.
      (Math.random as unknown as jest.SpyInstance).mockRestore();
      jest.restoreAllMocks();
    });

    it('should not spawn an enemy if no templates are found', async () => {
      const zoneId = 'default';
      enemyService.findAll.mockResolvedValue([]);

      const consoleWarnSpy = jest.spyOn(console, 'warn');

       // Mock the startSpawningEnemies method so that it spawns only once
       jest.spyOn(zoneService as any, 'startSpawningEnemies').mockImplementation(() => {
            (zoneService as any).spawnEnemy(zoneId);
        });
      (zoneService as any).startSpawningEnemies(zoneId);

      expect(enemyService.findAll).toHaveBeenCalled();
      expect(consoleWarnSpy).toHaveBeenCalledWith('No enemy templates found.  Cannot spawn enemies.');
      jest.restoreAllMocks();
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
        it('should remove a player from the zone', () => {
            const zoneId = 'default';

            // Mock the addPlayerToZone method
            jest.spyOn(zoneService, 'addPlayerToZone').mockImplementation(() => {
              // Intentionally empty mock implementation
            });

            mockSocket.data.user = mockUser; // Simulate user being attached to socket
            zoneService.addPlayerToZone(zoneId, mockSocket, mockUser, [mockCharacter]);

            const result = zoneService.removePlayerFromZone(mockSocket);

            const zone = (zoneService as any).zones.get(zoneId);
            expect(zone?.players.has(mockUser.id)).toBe(false);
            expect(mockSocket.leave).toHaveBeenCalledWith(zoneId);
            expect(result).toEqual({ zoneId: 'default', userId: 'mockUserId' });
        });

        it('should return null if the user is not in any zone', () => {
            mockSocket.data.user = mockUser; // Simulate user being attached to socket
            const result = zoneService.removePlayerFromZone(mockSocket);
            expect(result).toBeNull();
        });

        it('should return null if the socket does not have user data', () => {
            mockSocket.data.user = null; // Simulate no user on socket
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