interface Point {
    x: number;
    y: number;
}

/**
 * Calculates the Euclidean distance between two points.
 * @param p1 Point 1 { x, y }
 * @param p2 Point 2 { x, y }
 * @returns The distance between the points.
 */
export function calculateDistance(p1: Point, p2: Point): number {
    const dx = p1.x - p2.x;
    const dy = p1.y - p2.y;
    return Math.sqrt(dx * dx + dy * dy);
} 