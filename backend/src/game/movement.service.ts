import { Injectable, Logger } from '@nestjs/common';
import { GameConfig } from '../common/config/game.config';

// Ensure these interfaces are exported
export interface Point {
    x: number;
    y: number;
}

export interface MovementResult {
    newPosition: Point;
    reachedTarget: boolean;
}

@Injectable()
export class MovementService {
    private readonly logger = new Logger(MovementService.name);

    /**
     * Calculates the distance between two points.
     * Returns Infinity if input points are invalid.
     */
    // Make sure the method is public (default in TypeScript, but explicit is fine)
    public calculateDistance(point1: Point | null, point2: Point | null): number {
        if (!point1 || !point2 ||
            typeof point1.x !== 'number' || typeof point1.y !== 'number' ||
            typeof point2.x !== 'number' || typeof point2.y !== 'number') {
            this.logger.error(`Invalid input for calculateDistance: p1=${JSON.stringify(point1)}, p2=${JSON.stringify(point2)}`);
            return Infinity;
        }
        const dx = point1.x - point2.x;
        const dy = point1.y - point2.y;
        return Math.sqrt(dx * dx + dy * dy);
    }

    /**
     * Simulates the movement of an entity towards a target point for one tick.
     *
     * @param currentPosition The entity's current {x, y} coordinates.
     * @param targetPosition The entity's target {x, y} coordinates. Can be null if no target.
     * @param speed The entity's movement speed in pixels per second.
     * @param deltaTime The time elapsed since the last tick in seconds.
     * @returns MovementResult containing the new position and whether the target was reached.
     *          If targetPosition is null, returns the currentPosition and reachedTarget: false.
     */
     // Ensure this method is public as well
    public simulateMovement(
        currentPosition: Point,
        targetPosition: Point | null,
        speed: number,
        deltaTime: number
    ): MovementResult {

        // Basic validation of current position
        if (typeof currentPosition.x !== 'number' || typeof currentPosition.y !== 'number') {
             this.logger.error(`Invalid currentPosition provided to simulateMovement: ${JSON.stringify(currentPosition)}`);
             // Return current position without moving
             return { newPosition: currentPosition, reachedTarget: false };
        }

        // If no target, don't move
        if (!targetPosition || typeof targetPosition.x !== 'number' || typeof targetPosition.y !== 'number') {
            return { newPosition: currentPosition, reachedTarget: false };
        }

        const dx = targetPosition.x - currentPosition.x;
        const dy = targetPosition.y - currentPosition.y;
        const distance = Math.sqrt(dx * dx + dy * dy); // Direct distance calculation

        // Avoid division by zero or negligible movement
        if (distance <= GameConfig.COMBAT.MOVEMENT_EPSILON) { // Consider a small epsilon for floating point comparisons
            return { newPosition: targetPosition, reachedTarget: true }; // Already at or very close to target
        }

        const moveAmount = speed * deltaTime;

        if (distance <= moveAmount) {
            // Will reach or pass the target this tick
            return { newPosition: targetPosition, reachedTarget: true };
        } else {
            // Move towards the target
            const newX = currentPosition.x + (dx / distance) * moveAmount;
            const newY = currentPosition.y + (dy / distance) * moveAmount;
            return { newPosition: { x: newX, y: newY }, reachedTarget: false };
        }
    }
}