import { Injectable, NotFoundException, ConflictException, Logger, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull, Not, In } from 'typeorm';
import { InventoryItem } from './inventory.entity';
import { ItemTemplate } from '../item/item.entity';
import { ItemService } from '../item/item.service';
import { EquipmentSlot } from '../item/item.types';
import { User } from '../user/user.entity';
import { BroadcastService } from '../game/broadcast.service';
import { GameConfig } from '../common/config/game.config';

@Injectable()
export class InventoryService {
  private readonly logger = new Logger(InventoryService.name);
  constructor(
    @InjectRepository(InventoryItem)
    private inventoryItemRepository: Repository<InventoryItem>,
    private readonly itemService: ItemService,
    private readonly broadcastService: BroadcastService,
  ) {}

  // --- Helper to find empty slot ---
  public async findFirstEmptyInventorySlot(userId: string, inventorySize: number = 36 * 6): Promise<number | null> {
    const occupiedSlotsResult = await this.inventoryItemRepository
        .createQueryBuilder("item")
        .select("item.inventorySlot", "slot")
        .where("item.userId = :userId", { userId })
        .andWhere("item.equippedByCharacterId IS NULL")
        .andWhere("item.inventorySlot IS NOT NULL") 
        .getRawMany<{ slot: number }>();

    const occupiedSlots = new Set(occupiedSlotsResult.map(result => result.slot));

    for (let i = 0; i < inventorySize; i++) {
        if (!occupiedSlots.has(i)) {
            return i; 
        }
    }

    this.logger.warn(`[InventoryService] No empty slot found for user ${userId} (Size: ${inventorySize})`);
    return null; // Inventory is full
  }
  // -------------------------------

  /**
   * Adds an item to a user's inventory. Handles stacking.
   * @param userId The ID of the user.
   * @param itemTemplateId The ID of the item template to add.
   * @param quantity The quantity to add (default 1).
   * @returns The created or updated InventoryItem.
   * @throws NotFoundException if the item template doesn't exist.
   * @throws ConflictException for invalid quantity.
   */
  async addItemToUser(userId: string, itemTemplateId: string, quantity: number = 1): Promise<InventoryItem | InventoryItem[]> {
    if (quantity <= 0) {
      throw new ConflictException('Quantity must be positive.');
    }
    const template = await this.itemService.findTemplateById(itemTemplateId); 
    if (!template) {
      throw new NotFoundException(`Item template with ID ${itemTemplateId} not found.`);
    }

    if (template.stackable) {
      let existingItem = await this.inventoryItemRepository.findOne({
        where: { 
            userId: userId, 
            itemTemplateId: itemTemplateId, 
            equippedByCharacterId: IsNull(),
            inventorySlot: Not(IsNull()) // Ensure we only stack with items in slots
          }
      });
      
      if (existingItem) {
        existingItem.quantity += quantity;
        return this.inventoryItemRepository.save(existingItem);
      } else {
        const emptySlot = await this.findFirstEmptyInventorySlot(userId);
        if (emptySlot === null) {
            throw new ConflictException('Inventory is full.');
        }
        const newItem = this.inventoryItemRepository.create({
          userId,
          itemTemplateId,
          quantity,
          equippedByCharacterId: null,
          inventorySlot: emptySlot // Assign slot
        });
        this.logger.log(`[InventoryService] Adding new stack ${template.name} to slot ${emptySlot} for user ${userId}`);
        return this.inventoryItemRepository.save(newItem);
      }
    } else {
        const addedItems: InventoryItem[] = [];
        for (let i = 0; i < quantity; i++) {
             const emptySlot = await this.findFirstEmptyInventorySlot(userId);
             if (emptySlot === null) {
                 this.logger.warn(`[InventoryService] Inventory full while adding non-stackable item ${i + 1}/${quantity} for user ${userId}`);
                 throw new ConflictException(`Inventory became full while adding items.`);
             }
            const newItem = this.inventoryItemRepository.create({
                userId,
                itemTemplateId,
                quantity: 1,
                equippedByCharacterId: null,
                inventorySlot: emptySlot // Assign slot
            });
             this.logger.log(`[InventoryService] Adding non-stackable ${template.name} to slot ${emptySlot} for user ${userId}`);
            const savedItem = await this.inventoryItemRepository.save(newItem);
            addedItems.push(savedItem);
        }
        return quantity === 1 ? addedItems[0] : addedItems;
    }
  }

  /**
   * Removes an item from a user's inventory. Handles stacking.
   * @param userId The ID of the user.
   * @param itemTemplateId The ID of the item template to remove.
   * @param quantity The quantity to remove (default 1).
   * @returns True if the item was successfully removed/decremented, false otherwise (not found or not enough quantity).
   * @throws ConflictException for invalid quantity.
   */
  async removeItemFromUser(
    userId: string,
    itemTemplateId: string,
    quantity: number = 1,
  ): Promise<boolean> {
    if (quantity <= 0) {
      throw new ConflictException('Quantity must be positive.');
    }

    let inventoryItem = await this.inventoryItemRepository.findOne({
      where: {
        userId: userId,
        itemTemplateId: itemTemplateId,
        equippedByCharacterId: IsNull(),
      },
    });

    if (!inventoryItem || inventoryItem.quantity < quantity) {
      console.warn(`User ${userId} tried to remove ${quantity} of item ${itemTemplateId}, but has insufficient quantity or item is equipped.`);
      return false;
    }

    inventoryItem.quantity -= quantity;

    if (inventoryItem.quantity <= 0) {
      await this.inventoryItemRepository.remove(inventoryItem);
    } else {
      await this.inventoryItemRepository.save(inventoryItem);
    }
    return true;
  }

  /**
   * Retrieves all inventory items for a given user.
   * @param userId The ID of the user.
   * @returns An array of InventoryItem objects, including their item templates.
   */
  async getUserInventory(userId: string): Promise<InventoryItem[]> {
    return this.inventoryItemRepository.find({
      where: {
        userId: userId,
        equippedByCharacterId: IsNull(),
      },
      relations: ['itemTemplate'],
      order: { inventorySlot: 'ASC' },
    });
  }

  /**
   * Finds a specific inventory item instance by its unique ID.
   * @param inventoryItemId The unique ID of the InventoryItem record.
   * @returns The InventoryItem object including template and user, or null if not found.
   */
  async findInventoryItemById(inventoryItemId: string): Promise<InventoryItem | null> {
    return this.inventoryItemRepository.findOne({
      where: { id: inventoryItemId },
    });
  }

  async saveInventoryItem(item: InventoryItem): Promise<InventoryItem> {
    return this.inventoryItemRepository.save(item);
  }

  // Find ALL items equipped by a specific character
  async findEquippedItemsByCharacterId(characterId: string): Promise<InventoryItem[]> {
    return this.inventoryItemRepository.find({
      where: { equippedByCharacterId: characterId },
      relations: ['itemTemplate'],
    });
  }

  // Find the ONE item equipped by a character in a SPECIFIC slot
  async findEquippedItemBySlot(characterId: string, specificSlotId: EquipmentSlot): Promise<InventoryItem | null> {
    return this.inventoryItemRepository.findOne({
      where: { 
        equippedByCharacterId: characterId,
        equippedSlotId: specificSlotId 
      },
      relations: ['itemTemplate'],
    });
  }

  // TODO: Add methods for equip/unequip later

  // TODO: Consider inventory size limit from User entity or config?
  async getUserInventorySlots(userId: string, inventorySize: number = 36): Promise<(InventoryItem | null)[]> {
    // Fetch all unequipped items that have an assigned slot for this user
    const itemsInSlots = await this.inventoryItemRepository.find({
      where: {
        userId: userId,
        equippedByCharacterId: IsNull(),
        inventorySlot: Not(IsNull()) // Only fetch items with a slot assigned
      },
      relations: ['itemTemplate'], // Ensure template data is loaded
      // No specific order needed here, we will place them by slot index
    });

    // Create a sparse array representing the inventory slots
    const inventorySlots: (InventoryItem | null)[] = new Array(inventorySize).fill(null);

    // Place items into the correct slots
    itemsInSlots.forEach(item => {
      if (item.inventorySlot !== null && item.inventorySlot >= 0 && item.inventorySlot < inventorySize) {
        if (inventorySlots[item.inventorySlot]) {
          // This shouldn't happen if DB constraints/logic are correct, but handle it
          console.warn(`[InventoryService] Duplicate item found for user ${userId} at slot ${item.inventorySlot}. Overwriting.`);
        }
        inventorySlots[item.inventorySlot] = item;
      } else {
        console.warn(`[InventoryService] Item ${item.id} for user ${userId} has invalid inventorySlot ${item.inventorySlot}. Ignoring.`);
      }
    });

    return inventorySlots;
  }

  /**
   * Moves an item from one inventory slot to another.
   * Handles swapping if the target slot is occupied.
   * Assumes indices are 0-based.
   * @param userId The ID of the user.
   * @param fromIndex The source inventory slot index.
   * @param toIndex The target inventory slot index.
   * @returns True if the move/swap was successful, false otherwise.
   */
  async moveItemInInventory(userId: string, fromIndex: number, toIndex: number): Promise<boolean> {
    console.log(`[InventoryService] moveItem: User ${userId}, From ${fromIndex}, To ${toIndex}`); // Log input
    if (fromIndex === toIndex) {
        console.log(`[InventoryService] moveItem: fromIndex === toIndex, skipping.`);
        return true; // No move needed
    }

    // TODO: Add validation for indices based on user's actual inventory size?

    return this.inventoryItemRepository.manager.transaction(async transactionalEntityManager => {
        const repo = transactionalEntityManager.getRepository(InventoryItem);

        console.log(`[InventoryService] moveItem: Querying for itemFrom at slot ${fromIndex} for user ${userId}...`);
        const itemFrom = await repo.findOne({
            where: {
                userId: userId,
                inventorySlot: fromIndex,
                equippedByCharacterId: IsNull()
            }
        });

        if (!itemFrom) {
            console.warn(`[InventoryService] moveItem: No UNEQUIPPED item found at slot ${fromIndex}.`);
            // --- Add diagnostic query ---
            const equippedItemAtSlot = await repo.findOne({
                 where: {
                    userId: userId,
                    inventorySlot: fromIndex, 
                    equippedByCharacterId: Not(IsNull()) // Check if it's equipped
                 }
            });
            if(equippedItemAtSlot) {
                console.warn(`[InventoryService] moveItem: Found EQUIPPED item ${equippedItemAtSlot.id} at slot ${fromIndex}. Cannot move.`);
            } else {
                 console.warn(`[InventoryService] moveItem: No item (equipped or unequipped) found at slot ${fromIndex}.`);
            }
            // --------------------------
            return false; // Item not found or is equipped
        }

        console.log(`[InventoryService] moveItem: Found itemFrom: ${itemFrom.id} (Template: ${itemFrom.itemTemplateId})`);

        // Find if an item exists in the target slot
        console.log(`[InventoryService] moveItem: Querying for itemTo at slot ${toIndex} for user ${userId}...`);
        const itemTo = await repo.findOne({
            where: {
                userId: userId,
                inventorySlot: toIndex,
                equippedByCharacterId: IsNull()
            }
        });

        // --- Perform the move/swap --- 
        itemFrom.inventorySlot = toIndex;
        await repo.save(itemFrom);
        console.log(`[InventoryService] moveItem: Saved itemFrom ${itemFrom.id} with new slot ${toIndex}.`);

        if (itemTo) {
            console.log(`[InventoryService] moveItem: Found itemTo: ${itemTo.id}, swapping slots.`);
            itemTo.inventorySlot = fromIndex;
            await repo.save(itemTo);
            console.log(`[InventoryService] Swapped items between slots ${fromIndex} and ${toIndex} for user ${userId}.`);
        } else {
            console.log(`[InventoryService] Moved item from slot ${fromIndex} to empty slot ${toIndex} for user ${userId}.`);
        }

        return true; // Indicate success
    }).catch(error => {
        console.error(`[InventoryService] Error during moveItemInInventory transaction for user ${userId}:`, error);
        return false; // Indicate failure on transaction error
    });
  }

  /**
   * Calculates the total attack and defense bonuses from all items equipped by a character.
   * @param characterId The ID of the character.
   * @returns An object containing the total attack and defense bonuses.
   */
  async getCharacterEquipmentBonuses(characterId: string): Promise<{ totalAttackBonus: number, totalDefenseBonus: number }> {
    this.logger.verbose(`Calculating equipment bonuses for character ${characterId}`);
    const equippedItems = await this.findEquippedItemsByCharacterId(characterId);

    let totalAttackBonus = 0;
    let totalDefenseBonus = 0;

    for (const item of equippedItems) {
      // Ensure itemTemplate is loaded (relations: ['itemTemplate'] in findEquippedItemsByCharacterId should handle this)
      if (item.itemTemplate) {
        totalAttackBonus += item.itemTemplate.attackBonus || 0; // Add bonus, default to 0 if undefined/null
        totalDefenseBonus += item.itemTemplate.defenseBonus || 0; // Add bonus, default to 0 if undefined/null
      } else {
          this.logger.warn(`Equipped item ${item.id} for character ${characterId} is missing its itemTemplate relation.`);
      }
    }

    this.logger.verbose(`Character ${characterId} bonuses - Attack: ${totalAttackBonus}, Defense: ${totalDefenseBonus}`);
    return { totalAttackBonus, totalDefenseBonus };
  }

  // --- NEW: Sort Inventory ---
  async sortInventory(userId: string, sortType: 'name' | 'type' | 'newest'): Promise<void> {
    console.log(`[InventoryService] Sorting inventory for user ${userId} by ${sortType}`);

    // 1. Fetch items currently in inventory slots (not equipped)
    const itemsInSlots = await this.inventoryItemRepository.find({
      where: {
        userId: userId,
        inventorySlot: Not(IsNull()), // Only items with a slot assigned
        equippedByCharacterId: IsNull() // Explicitly exclude equipped items
      },
      relations: ['itemTemplate'], // Need template for sorting
      order: {
        inventorySlot: 'ASC' // Fetch in current order initially (optional, but can be useful)
      }
    });

    if (itemsInSlots.length <= 1) {
      console.log(`[InventoryService] No sorting needed for ${itemsInSlots.length} item(s).`);
      // Still might need to broadcast if the state wasn't perfectly consistent before?
      // For now, let's just broadcast the current state regardless.
      await this.broadcastInventoryUpdate(userId);
      return; 
    }

    // 2. Sort the items based on the criteria
    itemsInSlots.sort((a, b) => {
      if (!a.itemTemplate || !b.itemTemplate) return 0; // Handle missing template data gracefully

      if (sortType === 'name') {
        return a.itemTemplate.name.localeCompare(b.itemTemplate.name);
      } else if (sortType === 'type') {
        // Sort by type, then by name as a secondary criterion
        const typeComparison = (a.itemTemplate.itemType || '').localeCompare(b.itemTemplate.itemType || '');
        if (typeComparison !== 0) {
          return typeComparison;
        }
        return a.itemTemplate.name.localeCompare(b.itemTemplate.name);
      } else if (sortType === 'newest') {
        // Sort by creation date, newest first
        // Fallback to 0 if createdAt is somehow missing, though it shouldn't be
        const dateA = a.createdAt?.getTime() || 0;
        const dateB = b.createdAt?.getTime() || 0;
        return dateB - dateA; // Newest (larger timestamp) comes first
      }
      return 0;
    });

    // 3. Re-assign sequential inventorySlot values
    const updatedItems: InventoryItem[] = [];
    for (let i = 0; i < itemsInSlots.length; i++) {
      const item = itemsInSlots[i];
      const newSlotIndex = i; // Assign slots 0, 1, 2, ... based on sorted order
      if (item.inventorySlot !== newSlotIndex) {
        console.log(`[InventoryService] Moving item ${item.id} (${item.itemTemplate?.name}) from slot ${item.inventorySlot} to ${newSlotIndex}`);
        item.inventorySlot = newSlotIndex;
        updatedItems.push(item); // Add to list of items needing saving
      }
    }

    // 4. Save updated items (only if changes were made)
    if (updatedItems.length > 0) {
      console.log(`[InventoryService] Saving ${updatedItems.length} items with updated slots.`);
      await this.inventoryItemRepository.save(updatedItems);
    }

    // 5. Broadcast the final state
    await this.broadcastInventoryUpdate(userId);
    console.log(`[InventoryService] Finished sorting and broadcasted update for user ${userId}.`);
  }

  // --- Helper to broadcast inventory update ---
  private async broadcastInventoryUpdate(userId: string): Promise<void> {
    const payload = await this._getInventoryUpdatePayload(userId);
    this.broadcastService.sendEventToUser(userId, 'inventoryUpdate', payload);
  }

  // --- Helper to get the sparse inventory array ---
  private async _getInventoryUpdatePayload(userId: string): Promise<{ inventory: (InventoryItem | null)[] }> {
    // Fetch all items belonging to the user that are either equipped or in an inventory slot
    const allUserItems = await this.inventoryItemRepository.find({
        where: [
            { userId: userId, equippedByCharacterId: Not(IsNull()) }, // Equipped items
            { userId: userId, inventorySlot: Not(IsNull()) }      // Items in inventory slots
        ],
        relations: ['itemTemplate'], // Ensure template data is loaded
    });

    // Determine the total size of the inventory from config
    const INVENTORY_SIZE = GameConfig.INVENTORY.SIZE;
    const sparseInventory: (InventoryItem | null)[] = Array(INVENTORY_SIZE).fill(null);

    // Populate the sparse array based on inventorySlot
    allUserItems.forEach(item => {
        if (item.inventorySlot !== null && item.inventorySlot >= 0 && item.inventorySlot < INVENTORY_SIZE) {
            // Place the item in its designated slot
            // We might need to transform the item data slightly if the frontend expects a specific format
            // For now, let's assume the entity structure is okay, but we must include template details
            sparseInventory[item.inventorySlot] = item; // Directly assign the InventoryItem entity
        } else if (item.equippedByCharacterId) {
            // Equipped items don't go into the sparse array directly
            // They are handled by equipmentUpdate
        } else {
            // Items that are owned but neither equipped nor in a valid slot (shouldn't normally happen)
            console.warn(`[InventoryService] User ${userId} has item ${item.id} (${item.itemTemplate?.name}) with invalid/null slot: ${item.inventorySlot} and not equipped.`);
        }
    });

    // The frontend expects the raw sparse array under the 'inventory' key
    return { inventory: sparseInventory }; 
  }
} 