import { Injectable, Logger } from '@nestjs/common';
import { Server } from 'socket.io';
import { EnemyInstance } from './interfaces/enemy-instance.interface'; // For spawn data type
import { ItemType } from '../item/item.types'; // Import ItemType for payload

// Define interfaces for the data structures used in updates (can be refined)
interface EntityUpdateData {
    id: string;
    x?: number | null;
    y?: number | null;
    health?: number | null;
    state?: string;
}

interface CombatActionData {
    attackerId: string;
    targetId: string;
    damage: number;
    type: string; // e.g., 'attack'
}

interface DeathData {
    entityId: string;
    type: 'character' | 'enemy';
}

// Add payload interface for dropped items
interface DroppedItemPayload {
    id: string;
    itemTemplateId: string;
    itemName: string;
    itemType: ItemType;
    spriteKey: string;
    position: { x: number; y: number };
    quantity: number;
}

type SpawnData = EnemyInstance; // The full enemy instance data for a new spawn

@Injectable()
export class BroadcastService {
    private server: Server | null = null;

    // Queues to hold events per zone before flushing
    private entityUpdateQueue: Map<string, EntityUpdateData[]> = new Map();
    private combatActionQueue: Map<string, CombatActionData[]> = new Map();
    private deathQueue: Map<string, DeathData[]> = new Map();
    private spawnQueue: Map<string, SpawnData[]> = new Map();
    private itemDroppedQueue: Map<string, DroppedItemPayload[]> = new Map(); // Add queue

    // Inject Logger through the constructor
    constructor(private readonly logger: Logger) {
        // Optionally set context once - REMOVED as Logger type doesn't have this method directly
        // this.logger.setContext(BroadcastService.name);
    }

    /**
     * Stores the Socket.IO Server instance for broadcasting.
     * Should be called once after the server is initialized.
     */
    setServerInstance(server: Server): void {
        if (!this.server) {
            this.server = server;
            this.logger.log('Socket.IO Server instance set.');
        } else {
            this.logger.warn('Attempted to set Socket.IO Server instance more than once.');
        }
    }

    // --- Queueing Methods ---

    queueEntityUpdate(zoneId: string, updateData: EntityUpdateData): void {
        if (!this.entityUpdateQueue.has(zoneId)) {
            this.entityUpdateQueue.set(zoneId, []);
        }
        // Potential optimization: Merge updates for the same entity ID within a tick?
        // For simplicity now, just add it.
        this.entityUpdateQueue.get(zoneId)?.push(updateData);
    }

    queueCombatAction(zoneId: string, actionData: CombatActionData): void {
        if (!this.combatActionQueue.has(zoneId)) {
            this.combatActionQueue.set(zoneId, []);
        }
        this.combatActionQueue.get(zoneId)?.push(actionData);
    }

    queueDeath(zoneId: string, deathData: DeathData): void {
        if (!this.deathQueue.has(zoneId)) {
            this.deathQueue.set(zoneId, []);
        }
         // Avoid queuing duplicate death events for the same entity in one tick
         const queue = this.deathQueue.get(zoneId);
         if (queue && !queue.some(d => d.entityId === deathData.entityId)) {
            queue.push(deathData);
         }
    }

    queueSpawn(zoneId: string, spawnData: SpawnData): void {
        if (!this.spawnQueue.has(zoneId)) {
            this.spawnQueue.set(zoneId, []);
        }
        this.spawnQueue.get(zoneId)?.push(spawnData);
        // Also queue an entity update for the newly spawned enemy's initial state
        this.queueEntityUpdate(zoneId, {
            id: spawnData.id,
            x: spawnData.position.x,
            y: spawnData.position.y,
            health: spawnData.currentHealth,
            state: spawnData.aiState,
        });
    }

    queueItemDropped(zoneId: string, itemPayload: DroppedItemPayload): void {
        if (!this.itemDroppedQueue.has(zoneId)) {
            this.itemDroppedQueue.set(zoneId, []);
        }
        this.itemDroppedQueue.get(zoneId)?.push(itemPayload);
    }

    // --- Broadcasting Method ---

    /**
     * Sends all queued events for a specific zone to the clients in that zone
     * and clears the queues for that zone.
     * Should be called at the end of processing each zone in the game loop.
     */
    flushZoneEvents(zoneId: string): void {
        if (!this.server) {
            this.logger.error(`Cannot flush events for zone ${zoneId}: Server instance not set.`);
            return;
        }

        const updates = this.entityUpdateQueue.get(zoneId);
        const actions = this.combatActionQueue.get(zoneId);
        const deaths = this.deathQueue.get(zoneId);
        const spawns = this.spawnQueue.get(zoneId);
        const itemsDropped = this.itemDroppedQueue.get(zoneId); // Get dropped items

        // Emit events only if there's data for them
        if (updates && updates.length > 0) {
            // Client expects { updates: [...] }
            this.server.to(zoneId).emit('entityUpdate', { updates });
            this.entityUpdateQueue.delete(zoneId); // Clear queue after sending
        }

        if (actions && actions.length > 0) {
             // Client expects { actions: [...] }
            this.server.to(zoneId).emit('combatAction', { actions });
            this.combatActionQueue.delete(zoneId); // Clear queue
        }

        if (deaths && deaths.length > 0) {
             // Client expects individual 'entityDied' events
            deaths.forEach(death => {
                this.server?.to(zoneId).emit('entityDied', death);
            });
            this.deathQueue.delete(zoneId); // Clear queue
        }

        if (spawns && spawns.length > 0) {
            // Client expects individual 'enemySpawned' events
            spawns.forEach(spawn => {
                this.server?.to(zoneId).emit('enemySpawned', spawn);
            });
            this.spawnQueue.delete(zoneId); // Clear queue
             // Note: The initial entityUpdate for the spawn was queued separately and sent above.
        }

        if (itemsDropped && itemsDropped.length > 0) {
            this.logger.verbose(`[Broadcast] Emitting itemsDropped for zone ${zoneId} with ${itemsDropped.length} item(s). First item ID: ${itemsDropped[0].id}`);
            // Client expects { items: [...] }
            this.server.to(zoneId).emit('itemsDropped', { items: itemsDropped });
            this.itemDroppedQueue.delete(zoneId); // Clear queue
        }
    }
}