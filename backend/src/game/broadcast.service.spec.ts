import { Test, TestingModule } from '@nestjs/testing';
import { BroadcastService } from './broadcast.service';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io'; // Import Server type for mocking

// Simple mock logger implementation
const mockLogger = {
  log: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  verbose: jest.fn(),
  setContext: jest.fn(),
};

// --- Mock Socket.IO Server ---
// We need to mock the 'to' method which returns an object with an 'emit' method
const mockEmit = jest.fn();
const mockTo = jest.fn().mockReturnValue({ emit: mockEmit });
const mockIoServer = {
  to: mockTo,
  // Add other server properties/methods if needed by BroadcastService
} as unknown as Server; // Use 'unknown as Server' for type casting complex mocks

describe('BroadcastService', () => {
  let service: BroadcastService;

  beforeEach(async () => {
    // Reset mocks before each test
    jest.clearAllMocks();
    // Also reset internal queues of the service instance if necessary (will be new instance each time)

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BroadcastService,
        { provide: Logger, useValue: mockLogger },
      ],
    }).compile();

    service = module.get<BroadcastService>(BroadcastService);
    // IMPORTANT: Reset internal state if service wasn't re-created (usually is with Test.createTestingModule)
     (service as any).entityUpdateQueue = new Map();
     (service as any).combatActionQueue = new Map();
     (service as any).deathQueue = new Map();
     (service as any).spawnQueue = new Map();
     (service as any).server = null; // Ensure server is null initially
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('setServerInstance', () => {
    it('should store the server instance and log', () => {
      service.setServerInstance(mockIoServer);
      expect((service as any).server).toBe(mockIoServer);
      expect(mockLogger.log).toHaveBeenCalledWith('Socket.IO Server instance set.');
    });

    it('should warn if called more than once', () => {
      service.setServerInstance(mockIoServer); // First call
      service.setServerInstance(mockIoServer); // Second call
      expect(mockLogger.warn).toHaveBeenCalledWith('Attempted to set Socket.IO Server instance more than once.');
      expect((service as any).server).toBe(mockIoServer); // Should still hold the instance
    });
  });

  describe('Queueing Methods', () => {
    const zoneId1 = 'zone-1';
    const zoneId2 = 'zone-2';

    it('queueEntityUpdate should add updates to the correct zone queue', () => {
      const update1 = { id: 'p1', x: 10 };
      const update2 = { id: 'e1', health: 50 };
      service.queueEntityUpdate(zoneId1, update1);
      service.queueEntityUpdate(zoneId1, update2);
      expect((service as any).entityUpdateQueue.get(zoneId1)).toEqual([update1, update2]);
      expect((service as any).entityUpdateQueue.has(zoneId2)).toBe(false);
    });

    it('queueCombatAction should add actions to the correct zone queue', () => {
      const action1 = { attackerId: 'p1', targetId: 'e1', damage: 10, type: 'attack' };
      service.queueCombatAction(zoneId1, action1);
      expect((service as any).combatActionQueue.get(zoneId1)).toEqual([action1]);
    });

    it('queueDeath should add deaths and prevent duplicates per zone per tick', () => {
      const death1 = { entityId: 'p1', type: 'character' as const };
      const death2 = { entityId: 'e1', type: 'enemy' as const };
      service.queueDeath(zoneId1, death1);
      service.queueDeath(zoneId1, death2);
      service.queueDeath(zoneId1, death1); // Duplicate
      expect((service as any).deathQueue.get(zoneId1)).toEqual([death1, death2]);
    });

     it('queueSpawn should add spawns and also queue an entity update', () => {
       const spawnData: any = {
         id: 'newEnemy1',
         position: { x: 5, y: 5 },
         currentHealth: 100,
         aiState: 'IDLE',
         // Other EnemyInstance fields needed by update
       };
       service.queueSpawn(zoneId1, spawnData);

       // Check spawn queue
       expect((service as any).spawnQueue.get(zoneId1)).toEqual([spawnData]);

       // Check entity update queue
       const expectedUpdate = {
         id: spawnData.id,
         x: spawnData.position.x,
         y: spawnData.position.y,
         health: spawnData.currentHealth,
         state: spawnData.aiState,
       };
       expect((service as any).entityUpdateQueue.get(zoneId1)).toEqual([expectedUpdate]);
     });
  });


  describe('flushZoneEvents', () => {
    const zoneId = 'test-flush-zone';

    beforeEach(() => {
        // Ensure server instance is set for flush tests
        service.setServerInstance(mockIoServer);
    });

    it('should log an error and do nothing if server instance is not set', () => {
        (service as any).server = null; // Unset the server
        service.flushZoneEvents(zoneId);
        expect(mockLogger.error).toHaveBeenCalledWith(`Cannot flush events for zone ${zoneId}: Server instance not set.`);
        expect(mockIoServer.to).not.toHaveBeenCalled();
    });

    it('should emit entityUpdate with correct format if updates are queued', () => {
        const update1 = { id: 'p1', x: 10, y: 11 };
        const update2 = { id: 'e1', health: 45 };
        service.queueEntityUpdate(zoneId, update1);
        service.queueEntityUpdate(zoneId, update2);

        service.flushZoneEvents(zoneId);

        expect(mockIoServer.to).toHaveBeenCalledWith(zoneId);
        expect(mockEmit).toHaveBeenCalledWith('entityUpdate', { updates: [update1, update2] });
        expect((service as any).entityUpdateQueue.has(zoneId)).toBe(false); // Queue cleared
    });

    it('should emit combatAction with correct format if actions are queued', () => {
        const action1 = { attackerId: 'p1', targetId: 'e1', damage: 10, type: 'attack' };
        service.queueCombatAction(zoneId, action1);

        service.flushZoneEvents(zoneId);

        expect(mockIoServer.to).toHaveBeenCalledWith(zoneId);
        expect(mockEmit).toHaveBeenCalledWith('combatAction', { actions: [action1] });
        expect((service as any).combatActionQueue.has(zoneId)).toBe(false); // Queue cleared
    });

    it('should emit individual entityDied events if deaths are queued', () => {
        const death1 = { entityId: 'p1', type: 'character' as const };
        const death2 = { entityId: 'e1', type: 'enemy' as const };
        service.queueDeath(zoneId, death1);
        service.queueDeath(zoneId, death2);

        service.flushZoneEvents(zoneId);

        expect(mockIoServer.to).toHaveBeenCalledWith(zoneId);
        expect(mockEmit).toHaveBeenCalledWith('entityDied', death1);
        expect(mockEmit).toHaveBeenCalledWith('entityDied', death2);
        expect(mockEmit).toHaveBeenCalledTimes(2); // Called once per death
        expect((service as any).deathQueue.has(zoneId)).toBe(false); // Queue cleared
    });

     it('should emit individual enemySpawned events if spawns are queued', () => {
        const spawnData1: any = { id: 's1', position: {x:1,y:1}, currentHealth:50, aiState:'IDLE' };
        const spawnData2: any = { id: 's2', position: {x:2,y:2}, currentHealth:50, aiState:'IDLE' };
        // queueSpawn also adds to entityUpdateQueue, handled in separate tests or combined test
        (service as any).spawnQueue.set(zoneId, [spawnData1, spawnData2]); // Manually set queue for this test

        service.flushZoneEvents(zoneId);

        expect(mockIoServer.to).toHaveBeenCalledWith(zoneId);
        expect(mockEmit).toHaveBeenCalledWith('enemySpawned', spawnData1);
        expect(mockEmit).toHaveBeenCalledWith('enemySpawned', spawnData2);
        expect(mockEmit).toHaveBeenCalledTimes(2); // Called once per spawn
        expect((service as any).spawnQueue.has(zoneId)).toBe(false); // Queue cleared
     });

    it('should only flush events for the specified zoneId', () => {
        const zoneId1 = 'zone-f1';
        const zoneId2 = 'zone-f2';
        const update1 = { id: 'p1', x: 10 };
        const update2 = { id: 'p2', x: 20 };
        service.queueEntityUpdate(zoneId1, update1);
        service.queueEntityUpdate(zoneId2, update2);

        service.flushZoneEvents(zoneId1); // Flush only zone 1

        // Check emission for zone 1
        expect(mockIoServer.to).toHaveBeenCalledWith(zoneId1);
        expect(mockEmit).toHaveBeenCalledWith('entityUpdate', { updates: [update1] });
        // Check queues
        expect((service as any).entityUpdateQueue.has(zoneId1)).toBe(false); // Zone 1 cleared
        expect((service as any).entityUpdateQueue.has(zoneId2)).toBe(true);  // Zone 2 remains
        expect((service as any).entityUpdateQueue.get(zoneId2)).toEqual([update2]);
    });

     it('should handle multiple event types being flushed in the same tick', () => {
       const update1 = { id: 'p1', x: 10 };
       const action1 = { attackerId: 'p1', targetId: 'e1', damage: 10, type: 'attack' };
       const death1 = { entityId: 'e1', type: 'enemy' as const };
       
       service.queueEntityUpdate(zoneId, update1);
       service.queueCombatAction(zoneId, action1);
       service.queueDeath(zoneId, death1);

       service.flushZoneEvents(zoneId);

       expect(mockIoServer.to).toHaveBeenCalledWith(zoneId);
       expect(mockEmit).toHaveBeenCalledWith('entityUpdate', { updates: [update1] });
       expect(mockEmit).toHaveBeenCalledWith('combatAction', { actions: [action1] });
       expect(mockEmit).toHaveBeenCalledWith('entityDied', death1);

       // Check all relevant queues are cleared
       expect((service as any).entityUpdateQueue.has(zoneId)).toBe(false);
       expect((service as any).combatActionQueue.has(zoneId)).toBe(false);
       expect((service as any).deathQueue.has(zoneId)).toBe(false);
     });

  });
});