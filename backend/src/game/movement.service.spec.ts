import { Test, TestingModule } from '@nestjs/testing';
import { MovementService, Point, MovementResult } from './movement.service';
import { Logger } from '@nestjs/common';

// Simple mock logger implementation
const mockLogger = {
  log: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  verbose: jest.fn(),
  setContext: jest.fn(), // Add setContext if needed by the service constructor
};

describe('MovementService', () => {
  let service: MovementService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MovementService,
        // Provide the mock logger instance
        { provide: Logger, useValue: mockLogger },
      ],
    })
    // Disable logger output during testing if preferred
    // .setLogger(false)
    .compile();

    service = module.get<MovementService>(MovementService);
     // Reset mocks before each test if needed
     jest.clearAllMocks(); 
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // --- Tests for simulateMovement ---

  describe('simulateMovement', () => {
    const currentPos: Point = { x: 100, y: 100 };
    const speed = 100; // pixels per second
    const deltaTime = 0.1; // 100ms tick -> 0.1 seconds

    it('should move towards the target', () => {
      const targetPos: Point = { x: 200, y: 100 }; // 100px away horizontally
      const expectedMoveAmount = speed * deltaTime; // 10 pixels
      const result = service.simulateMovement(currentPos, targetPos, speed, deltaTime);

      expect(result.reachedTarget).toBe(false);
      expect(result.newPosition.x).toBeCloseTo(currentPos.x + expectedMoveAmount);
      expect(result.newPosition.y).toBeCloseTo(currentPos.y);
    });

     it('should move diagonally towards the target', () => {
         const targetPos: Point = { x: 107, y: 107 }; // 7px right, 7px down (approx 9.9px away)
         const expectedMoveAmount = speed * deltaTime; // 10 pixels
         const result = service.simulateMovement(currentPos, targetPos, speed, deltaTime);

         // Since distance < moveAmount, it should reach the target
         expect(result.reachedTarget).toBe(true);
         expect(result.newPosition.x).toBeCloseTo(targetPos.x);
         expect(result.newPosition.y).toBeCloseTo(targetPos.y);
     });

    it('should reach the target exactly if distance equals move amount', () => {
      const targetPos: Point = { x: 110, y: 100 }; // 10px away
      const result = service.simulateMovement(currentPos, targetPos, speed, deltaTime);

      expect(result.reachedTarget).toBe(true);
      expect(result.newPosition.x).toBeCloseTo(targetPos.x);
      expect(result.newPosition.y).toBeCloseTo(targetPos.y);
    });

    it('should stop exactly at the target if move amount exceeds distance', () => {
      const targetPos: Point = { x: 105, y: 100 }; // 5px away
      const result = service.simulateMovement(currentPos, targetPos, speed, deltaTime); // moveAmount is 10

      expect(result.reachedTarget).toBe(true);
      expect(result.newPosition.x).toBeCloseTo(targetPos.x); // Should not overshoot
      expect(result.newPosition.y).toBeCloseTo(targetPos.y);
    });

    it('should not move if there is no target', () => {
      const result = service.simulateMovement(currentPos, null, speed, deltaTime);
      expect(result.reachedTarget).toBe(false);
      expect(result.newPosition).toEqual(currentPos);
    });

    it('should not move if already at the target', () => {
      const targetPos: Point = { x: 100, y: 100 };
      const result = service.simulateMovement(currentPos, targetPos, speed, deltaTime);
      expect(result.reachedTarget).toBe(true); // Technically already there
      expect(result.newPosition).toEqual(currentPos);
    });
     
     it('should return current position if current position is invalid', () => {
       const invalidPos: any = { x: undefined, y: 100 };
       const targetPos: Point = { x: 200, y: 100 };
       const result = service.simulateMovement(invalidPos, targetPos, speed, deltaTime);
       expect(result.reachedTarget).toBe(false);
       expect(result.newPosition).toEqual(invalidPos);
     });

     it('should return current position if target position is invalid', () => {
       const targetPos: any = { x: 200, y: null };
       const result = service.simulateMovement(currentPos, targetPos, speed, deltaTime);
       expect(result.reachedTarget).toBe(false);
       expect(result.newPosition).toEqual(currentPos);
     });
  });

  // --- Tests for calculateDistance ---

  describe('calculateDistance', () => {
    const p1: Point = { x: 10, y: 10 };

    it('should return 0 for the same point', () => {
      expect(service.calculateDistance(p1, p1)).toBe(0);
    });

    it('should calculate horizontal distance', () => {
      const p2: Point = { x: 20, y: 10 };
      expect(service.calculateDistance(p1, p2)).toBe(10);
    });

    it('should calculate vertical distance', () => {
      const p2: Point = { x: 10, y: 0 };
      expect(service.calculateDistance(p1, p2)).toBe(10);
    });

    it('should calculate diagonal distance (3-4-5 triangle)', () => {
      const p2: Point = { x: 13, y: 14 };
      expect(service.calculateDistance(p1, p2)).toBe(5);
    });

    it('should return Infinity if first point is null', () => {
      const p2: Point = { x: 10, y: 0 };
      expect(service.calculateDistance(null, p2)).toBe(Infinity);
    });

    it('should return Infinity if second point is null', () => {
      expect(service.calculateDistance(p1, null)).toBe(Infinity);
    });
     
     it('should return Infinity if point coordinates are invalid', () => {
        const invalidP1: any = { x: undefined, y: 10 };
        const invalidP2: any = { x: 10, y: null };
        const p2: Point = { x: 10, y: 0 };
        expect(service.calculateDistance(invalidP1, p2)).toBe(Infinity);
        expect(service.calculateDistance(p1, invalidP2)).toBe(Infinity);
     });
  });
});