import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { InventoryItem } from './inventory.entity';
import { ItemTemplate } from '../item/item.entity';
import { ItemService } from '../item/item.service';
import { EquipmentSlot } from '../item/item.types';

@Injectable()
export class InventoryService {
  constructor(
    @InjectRepository(InventoryItem)
    private inventoryItemRepository: Repository<InventoryItem>,
    private readonly itemService: ItemService,
  ) {}

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
    // Allow adding multiple *non-stackable* items as separate rows
    if (quantity <= 0) {
      throw new ConflictException('Quantity must be positive.');
    }

    const template = await this.itemService.findTemplateById(itemTemplateId); 
    if (!template) {
      throw new NotFoundException(`Item template with ID ${itemTemplateId} not found.`);
    }

    // --- Handle Stackable vs Non-Stackable --- 
    if (template.stackable) {
      // Logic for stackable items (find existing stack or create new)
      let existingItem = await this.inventoryItemRepository.findOne({
        where: { 
            userId: userId, 
            itemTemplateId: itemTemplateId, 
            equippedByCharacterId: IsNull() // Ensure we only stack with unequipped items
          }
      });
      
      if (existingItem) {
        // TODO: Handle maxStackSize from template if implemented
        existingItem.quantity += quantity;
        return this.inventoryItemRepository.save(existingItem);
      } else {
        // Create a new stack
        const newItem = this.inventoryItemRepository.create({
          userId,
          itemTemplateId,
          quantity, // Start stack with the given quantity
          equippedByCharacterId: null 
        });
        return this.inventoryItemRepository.save(newItem);
      }
    } else {
        // Logic for non-stackable items (always create new rows)
        const addedItems: InventoryItem[] = [];
        for (let i = 0; i < quantity; i++) {
            const newItem = this.inventoryItemRepository.create({
                userId,
                itemTemplateId,
                quantity: 1, // Non-stackable items always have quantity 1
                equippedByCharacterId: null 
            });
            const savedItem = await this.inventoryItemRepository.save(newItem);
            addedItems.push(savedItem);
        }
        // Return array if multiple added, or single item if quantity was 1
        return quantity === 1 ? addedItems[0] : addedItems;
    }
    // -----------------------------------------
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
      order: { createdAt: 'ASC' },
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
} 