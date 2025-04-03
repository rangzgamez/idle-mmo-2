import { Injectable, Logger } from '@nestjs/common';
import { ZoneService } from './zone.service';
import { EnemyInstance } from './interfaces/enemy-instance.interface';
import { SpawnNest } from './interfaces/spawn-nest.interface'; // Import SpawnNest

@Injectable()
export class SpawningService {
    private readonly logger = new Logger(SpawningService.name);

    constructor(
        private zoneService: ZoneService,
        // EnemyService might not be needed directly if ZoneService handles template fetching
    ) {}

    /**
     * Processes spawning logic for all nests within a given zone for the current tick.
     * Checks respawn timers and triggers new enemy spawns via ZoneService.
     *
     * @param zoneId The ID of the zone to process spawns for.
     * @param now The current timestamp (Date.now()).
     * @returns An array of EnemyInstance objects for any enemies spawned this tick.
     */
    async processNestSpawns(zoneId: string, now: number): Promise<EnemyInstance[]> {
        const spawnedThisTick: EnemyInstance[] = [];
        const nests = this.zoneService.getZoneNests(zoneId);

        if (!nests || nests.length === 0) {
            return spawnedThisTick; // No nests in this zone
        }

        for (const nest of nests) {
            // Check if nest needs spawning (below capacity and timer elapsed)
            if (nest.currentEnemyIds.size < nest.maxCapacity) {
                if (now >= nest.lastSpawnCheckTime + nest.respawnDelayMs) {
                    // this.logger.debug(`Nest ${nest.id} in zone ${zoneId} attempting spawn.`); // Optional debug log
                    
                    // Attempt to spawn an enemy via ZoneService
                    const newEnemy = await this.zoneService.addEnemyFromNest(nest);
                    
                    if (newEnemy) {
                        // this.logger.debug(`Nest ${nest.id} successfully spawned enemy ${newEnemy.id}.`); // Optional debug log
                        spawnedThisTick.push(newEnemy);
                        // ZoneService.addEnemyFromNest already updates nest.lastSpawnCheckTime
                    } else {
                        // Spawn failed (e.g., template invalid), ZoneService should log details.
                        // Update check time to prevent spamming checks for bad nests/templates
                        nest.lastSpawnCheckTime = now; 
                    }
                }
                // else { Timer not yet elapsed }
            } else {
                // Nest is full, reset check time so it checks again immediately after one dies
                 nest.lastSpawnCheckTime = now;
            }
        } // End nest loop

        return spawnedThisTick;
    }
}
