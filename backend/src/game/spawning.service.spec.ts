import { Test, TestingModule } from '@nestjs/testing';
import { SpawningService } from './spawning.service';
import { ZoneService } from './zone.service';
import { SpawnNest } from './interfaces/spawn-nest.interface';
import { EnemyInstance } from './interfaces/enemy-instance.interface';
import { Logger } from '@nestjs/common';

// Simple mock logger implementation
const mockLogger = {
  log: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  verbose: jest.fn(),
  setContext: jest.fn(),
};

// Mock ZoneService
const mockZoneService = {
  getZoneNests: jest.fn(),
  addEnemyFromNest: jest.fn(),
};

// Helper to create a mock nest
const createMockNest = (id: string, templateId: string, capacity: number, currentCount: number, delayMs: number, lastCheckTime: number): SpawnNest => ({
  id,
  zoneId: 'test-zone',
  templateId,
  center: { x: 100, y: 100 },
  radius: 100,
  maxCapacity: capacity,
  currentEnemyIds: new Set(Array.from({ length: currentCount }, (_, i) => `enemy-${id}-${i}`)),
  respawnDelayMs: delayMs,
  lastSpawnCheckTime: lastCheckTime,
});

// Helper to create a mock enemy instance
const createMockEnemy = (id: string, templateId: string): EnemyInstance => ({
    id,
    templateId,
    zoneId: 'test-zone',
    name: `Spawned ${templateId}`,
    currentHealth: 100,
    position: { x: 105, y: 105 },
    aiState: 'IDLE',
    baseAttack: 10,
    baseDefense: 5,
    baseSpeed: 75,
    nestId: `nest-${templateId}`,
    anchorX: 100,
    anchorY: 100,
    wanderRadius: 100,
});


describe('SpawningService', () => {
  let service: SpawningService;
  let zoneService: ZoneService;

  beforeEach(async () => {
    // Reset mocks
    mockZoneService.getZoneNests.mockClear();
    mockZoneService.addEnemyFromNest.mockClear();
    jest.clearAllMocks(); // Clear logger mocks too

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SpawningService,
        { provide: ZoneService, useValue: mockZoneService },
        { provide: Logger, useValue: mockLogger },
      ],
    }).compile();

    service = module.get<SpawningService>(SpawningService);
    zoneService = module.get<ZoneService>(ZoneService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('processNestSpawns', () => {
    const zoneId = 'test-zone';
    const now = Date.now(); // Consistent time for tests

    it('should return empty array if no nests exist in the zone', async () => {
      mockZoneService.getZoneNests.mockReturnValue([]); // No nests
      const result = await service.processNestSpawns(zoneId, now);
      expect(result).toEqual([]);
      expect(mockZoneService.getZoneNests).toHaveBeenCalledWith(zoneId);
      expect(mockZoneService.addEnemyFromNest).not.toHaveBeenCalled();
    });

    it('should not spawn if nest is at max capacity', async () => {
        const nest1 = createMockNest('nest1', 'goblin', 5, 5, 10000, now - 15000); // Full
        mockZoneService.getZoneNests.mockReturnValue([nest1]);
        
        const result = await service.processNestSpawns(zoneId, now);
        
        expect(result).toEqual([]);
        expect(mockZoneService.addEnemyFromNest).not.toHaveBeenCalled();
        expect(nest1.lastSpawnCheckTime).toBe(now); // Check time should be updated even if full
    });

    it('should not spawn if nest timer has not elapsed', async () => {
        const nest1 = createMockNest('nest1', 'goblin', 5, 3, 10000, now - 5000); // Timer not ready
        mockZoneService.getZoneNests.mockReturnValue([nest1]);
        
        const result = await service.processNestSpawns(zoneId, now);
        
        expect(result).toEqual([]);
        expect(mockZoneService.addEnemyFromNest).not.toHaveBeenCalled();
        // lastSpawnCheckTime should NOT be updated in this case
        expect(nest1.lastSpawnCheckTime).toBe(now - 5000); 
    });
     
     it('should call addEnemyFromNest and return spawned enemy if nest is ready', async () => {
         const nest1 = createMockNest('nest1', 'goblin', 5, 3, 10000, now - 15000); // Ready!
         const spawnedEnemy = createMockEnemy('spawned-goblin-1', 'goblin');
         mockZoneService.getZoneNests.mockReturnValue([nest1]);
         mockZoneService.addEnemyFromNest.mockResolvedValue(spawnedEnemy); // Mock successful spawn

         const result = await service.processNestSpawns(zoneId, now);

         expect(mockZoneService.addEnemyFromNest).toHaveBeenCalledWith(nest1);
         expect(result).toHaveLength(1);
         expect(result[0]).toEqual(spawnedEnemy);
         // addEnemyFromNest is responsible for updating lastSpawnCheckTime on success
     });

     it('should return empty array if addEnemyFromNest fails (returns null)', async () => {
         const nest1 = createMockNest('nest1', 'orc', 5, 3, 10000, now - 15000); // Ready!
         mockZoneService.getZoneNests.mockReturnValue([nest1]);
         mockZoneService.addEnemyFromNest.mockResolvedValue(null); // Mock failed spawn

         const result = await service.processNestSpawns(zoneId, now);

         expect(mockZoneService.addEnemyFromNest).toHaveBeenCalledWith(nest1);
         expect(result).toEqual([]);
         // Check time should be updated on failure to prevent spam
         expect(nest1.lastSpawnCheckTime).toBe(now); 
     });

     it('should process multiple nests correctly (one ready, one not, one full)', async () => {
         const nestReady = createMockNest('nestR', 'goblin', 5, 3, 10000, now - 15000); // Ready
         const nestWaiting = createMockNest('nestW', 'orc', 5, 2, 10000, now - 5000);   // Waiting
         const nestFull = createMockNest('nestF', 'troll', 3, 3, 10000, now - 15000);    // Full
         
         const spawnedGoblin = createMockEnemy('spawned-goblin-1', 'goblin');
         
         mockZoneService.getZoneNests.mockReturnValue([nestReady, nestWaiting, nestFull]);
         // Mock addEnemyFromNest to only succeed for the ready nest
         mockZoneService.addEnemyFromNest.mockImplementation(async (nest) => {
             if (nest.id === 'nestR') {
                 return spawnedGoblin;
             }
             return null;
         });

         const result = await service.processNestSpawns(zoneId, now);

         // Check calls
         expect(mockZoneService.addEnemyFromNest).toHaveBeenCalledTimes(1); // Only called for nestReady
         expect(mockZoneService.addEnemyFromNest).toHaveBeenCalledWith(nestReady);

         // Check results
         expect(result).toHaveLength(1);
         expect(result[0]).toEqual(spawnedGoblin);

         // Check last check times
         // expect(nestReady.lastSpawnCheckTime).toBe(now); // Updated by addEnemyFromNest mock implicitly
         expect(nestWaiting.lastSpawnCheckTime).toBe(now - 5000); // Not updated
         expect(nestFull.lastSpawnCheckTime).toBe(now);         // Updated because it was checked while full
     });
  });
});