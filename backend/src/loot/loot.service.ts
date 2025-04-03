import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LootTable } from './loot-table.entity';
import { LootTableEntry } from './loot-table-entry.entity';
import { ItemTemplate } from '../item/item.entity';
import { ItemService } from '../item/item.service'; // May not be needed if template is eager loaded

interface DroppedItem {
  itemTemplate: ItemTemplate;
  quantity: number;
}

@Injectable()
export class LootService {
  private readonly logger = new Logger(LootService.name);

  constructor(
    @InjectRepository(LootTable)
    private lootTableRepository: Repository<LootTable>,
    @InjectRepository(LootTableEntry) // Need this if not eager loading entries on LootTable
    private lootTableEntryRepository: Repository<LootTableEntry>,
    // private readonly itemService: ItemService, // Inject if ItemTemplate isn't eager loaded
  ) {}

  async getLootTableWithEntries(lootTableId: string): Promise<LootTable | null> {
    return this.lootTableRepository.findOne({
        where: { id: lootTableId },
        relations: ['entries', 'entries.itemTemplate'], // Eager load entries and their items
    });
  }

  /**
   * Calculates the loot dropped based on a given loot table ID.
   * @param lootTableId The ID of the loot table to process.
   * @returns An array of DroppedItem objects representing the items dropped.
   */
  async calculateLootDrops(lootTableId: string): Promise<DroppedItem[]> {
    const lootTable = await this.getLootTableWithEntries(lootTableId);
    if (!lootTable || !lootTable.entries || lootTable.entries.length === 0) {
        this.logger.warn(`Loot table ${lootTableId} not found or has no entries.`);
        return []; // No loot table found or it's empty
    }

    const droppedItems: DroppedItem[] = [];
    const randomChance = Math.random() * 100; // Percentage roll (0.0 to 99.99...)

    for (const entry of lootTable.entries) {
        if (randomChance <= entry.dropChance) {
            // Drop chance succeeded, calculate quantity
            const quantity = Math.floor(
                Math.random() * (entry.maxQuantity - entry.minQuantity + 1)
            ) + entry.minQuantity;

            if (quantity > 0 && entry.itemTemplate) {
                droppedItems.push({
                    itemTemplate: entry.itemTemplate,
                    quantity: quantity,
                });
                this.logger.verbose(`Rolled ${randomChance.toFixed(2)}%, dropped ${quantity}x ${entry.itemTemplate.name} (chance: ${entry.dropChance}%)`);
            } else if (!entry.itemTemplate) {
                this.logger.error(`LootTableEntry ${entry.id} is missing its ItemTemplate!`);
            }
        } else {
             this.logger.verbose(`Rolled ${randomChance.toFixed(2)}%, failed to drop ${entry.itemTemplate?.name} (chance: ${entry.dropChance}%)`);
        }
    }

    return droppedItems;
  }

  // TODO: Add methods for creating/managing loot tables via admin tools later?
} 