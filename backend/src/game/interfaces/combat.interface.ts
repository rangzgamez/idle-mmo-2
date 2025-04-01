export interface CombatResult {
    damageDealt: number;
    targetDied: boolean;
    targetCurrentHealth: number;
    error?: string; // Optional error message if something went wrong
}