import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InventoryItem } from './inventory.entity';
import { ItemTemplate } from '../item/item.entity';
import { ItemService } from '../item/item.service';

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
   * @throws Error for other invalid arguments.
   */
  async addItemToUser(
    userId: string,
    itemTemplateId: string,
    quantity: number = 1,
  ): Promise<InventoryItem> {
    if (!userId || !itemTemplateId || quantity <= 0) {
      throw new Error('Invalid arguments for adding item to user.');
    }

    const itemTemplate = await this.itemService.findTemplateById(itemTemplateId);
    if (!itemTemplate) {
        throw new NotFoundException(`Item template ${itemTemplateId} not found.`);
    }

    let inventoryItem: InventoryItem | null = null;

    // If the item is stackable, check if the user already has a stack
    if (itemTemplate.stackable) {
      inventoryItem = await this.inventoryItemRepository.findOne({
        where: {
          userId: userId,
          itemTemplateId: itemTemplate.id,
        },
      });
    }

    if (inventoryItem) {
      // Update existing stack
      inventoryItem.quantity += quantity;
      return this.inventoryItemRepository.save(inventoryItem);
    } else {
      // Create new inventory item entry
      const newItem = this.inventoryItemRepository.create({
        userId: userId,
        itemTemplateId: itemTemplate.id,
        quantity: quantity,
      });
      return this.inventoryItemRepository.save(newItem);
    }
  }

  /**
   * Removes an item from a user's inventory. Handles stacking.
   * @param userId The ID of the user.
   * @param itemTemplateId The ID of the item template to remove.
   * @param quantity The quantity to remove (default 1).
   * @returns True if the item was successfully removed/decremented, false otherwise (not found or not enough quantity).
   * @throws Error for invalid arguments.
   */
  async removeItemFromUser(
    userId: string,
    itemTemplateId: string,
    quantity: number = 1,
  ): Promise<boolean> {
     if (!userId || !itemTemplateId || quantity <= 0) {
      throw new Error('Invalid arguments for removing item from user.');
    }

    const inventoryItem = await this.inventoryItemRepository.findOne({
      where: { userId, itemTemplateId },
    });

    if (!inventoryItem) {
      console.warn(`Item ${itemTemplateId} not found in inventory for user ${userId}`);
      return false; // Item not found
    }

    if (inventoryItem.quantity < quantity) {
       console.warn(`Not enough quantity of item ${itemTemplateId} for user ${userId}`);
      return false; // Not enough quantity
    }

    inventoryItem.quantity -= quantity;

    if (inventoryItem.quantity <= 0) {
      // Remove the item entirely
      await this.inventoryItemRepository.remove(inventoryItem);
    } else {
      // Update the quantity
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
       where: { userId },
       relations: ['itemTemplate'],
       order: { itemTemplate: { name: 'ASC' } }
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
        relations: ['itemTemplate', 'user']
     });
  }

  // TODO: Add methods for equip/unequip later
} 