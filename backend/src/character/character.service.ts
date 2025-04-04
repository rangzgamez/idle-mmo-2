// backend/src/character/character.service.ts
import { Injectable, ConflictException, NotFoundException, ForbiddenException, BadRequestException, forwardRef, Inject, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Character } from './character.entity';
import { CreateCharacterDto } from './dto/create-character.dto';
import { User } from '../user/user.entity'; // Import User for type hinting
import { InventoryService } from '../inventory/inventory.service'; // Import InventoryService
import { InventoryItem } from '../inventory/inventory.entity'; // Import InventoryItem
import { ItemTemplate } from '../item/item.entity'; // Import ItemTemplate
import { EquipmentSlot, ItemType } from '../item/item.types'; // Import Enums

@Injectable()
export class CharacterService {
  // Define character limit per user
  private readonly MAX_CHARACTERS_PER_USER = 10; // Or whatever limit you want

  constructor(
    @InjectRepository(Character)
    private characterRepository: Repository<Character>,
    // Use forwardRef to handle circular dependency (CharacterService <-> InventoryService)
    @Inject(forwardRef(() => InventoryService))
    private inventoryService: InventoryService,
  ) {}

  async createCharacter(
    createCharacterDto: CreateCharacterDto,
    user: User, // Receive the authenticated user object
  ): Promise<Character> {
    const { name } = createCharacterDto;

    // 1. Check character count for the user
    const count = await this.characterRepository.count({ where: { userId: user.id } });
    if (count >= this.MAX_CHARACTERS_PER_USER) {
      throw new ForbiddenException(`Maximum character limit (${this.MAX_CHARACTERS_PER_USER}) reached.`);
    }

    // 2. Check if character name already exists for this user (optional, maybe allow same name?)
    // const existingName = await this.characterRepository.findOneBy({ userId: user.id, name });
    // if (existingName) {
    //   throw new ConflictException('Character name already exists for this user.');
    // }

    // 3. Create and save the new character
    const newCharacter = this.characterRepository.create({
      name,
      userId: user.id,
      // user: user, // Can assign the relation object directly if needed later
      // Set initial stats/level if desired
      level: 1,
      xp: 0,
    });

    await this.characterRepository.save(newCharacter);
    return newCharacter; // Return the created character data
  }

  async findCharactersByUserId(userId: string): Promise<Character[]> {
    return this.characterRepository.find({
      where: { userId },
      order: { createdAt: 'ASC' }, // Order by creation date
    });
  }

  async findCharacterByIdAndUserId(id: string, userId: string): Promise<Character | null> {
      return this.characterRepository.findOneBy({ id, userId });
  }

  // --- Equipment Logic ---

  async equipItem(userId: string, characterId: string, inventoryItemId: string): Promise<{ success: boolean; message?: string }> {
    const character = await this.findCharacterByIdAndUserId(characterId, userId);
    if (!character) {
      throw new NotFoundException('Character not found or does not belong to user.');
    }

    const inventoryItem = await this.inventoryService.findInventoryItemById(inventoryItemId);
    if (!inventoryItem || inventoryItem.userId !== userId) {
      throw new NotFoundException('Inventory item not found or does not belong to user.');
    }

    const template = inventoryItem.itemTemplate;
    if (!template) {
        throw new Error('Inventory item is missing its template data.'); // Should not happen with eager loading
    }
    if (!template.equipSlot) {
        throw new BadRequestException(`Item '${template.name}' is not equippable.`);
    }

    // ** Validate Item Type vs Slot ** (Simplified - improve as needed)
    if (!this.isItemValidForSlot(template, template.equipSlot)) {
        throw new BadRequestException(`Item '${template.name}' (${template.itemType}) cannot be equipped in slot ${template.equipSlot}.`);
    }

    // ** Unequip existing item in the target slot **
    const currentItemIdInSlot = this.getItemIdInSlot(character, template.equipSlot);
    if (currentItemIdInSlot) {
        if (currentItemIdInSlot === inventoryItemId) {
            throw new BadRequestException('Item is already equipped in this slot.');
        }
        this.logger.log(`Unequipping ${currentItemIdInSlot} from slot ${template.equipSlot} before equipping ${inventoryItemId}`);
        const unequipResult = await this.unequipItem(userId, characterId, template.equipSlot);
        if (!unequipResult.success) {
            // Rollback or handle error - could get complex. For now, throw.
            throw new Error(`Failed to unequip current item in slot ${template.equipSlot}: ${unequipResult.message}`);
        }
        // Refresh character data after unequip (optional, depends if unequipItem returns updated char)
        // character = await this.findCharacterByIdAndUserId(characterId, userId);
        // if (!character) throw new Error('Character data lost after unequip.'); 
    }

    // ** Equip the new item **
    const slotFieldName = this.getCharacterSlotFieldName(template.equipSlot);
    (character as any)[slotFieldName] = inventoryItemId; // Assign the InventoryItem ID
    // Set the direct relation property as well (if needed, TypeORM often handles this)
    // const relationFieldName = slotFieldName.replace('Id', ''); 
    // (character as any)[relationFieldName] = inventoryItem;

    // ** Remove item from general inventory (handle quantity) **
    // Assume equipping 1 requires 1 from inventory
    const removedFromInv = await this.inventoryService.removeItemFromUser(userId, template.id, 1);
    if (!removedFromInv) {
        // This should ideally not happen if we validated ownership, but handle defensively
        // Rollback the equipment change? 
        (character as any)[slotFieldName] = currentItemIdInSlot; // Revert slot change
        throw new Error('Failed to remove equipped item from user inventory after equipping.');
    }

    // ** Save updated character **
    await this.characterRepository.save(character);

    // TODO: Calculate and update character stats based on new equipment (separate method?)

    return { success: true };
  }

  async unequipItem(userId: string, characterId: string, slot: EquipmentSlot): Promise<{ success: boolean; message?: string; unequippedItemId?: string }> {
    const character = await this.findCharacterByIdAndUserId(characterId, userId);
    if (!character) {
      throw new NotFoundException('Character not found or does not belong to user.');
    }

    const slotFieldName = this.getCharacterSlotFieldName(slot);
    const currentItemIdInSlot = (character as any)[slotFieldName] as string | null;

    if (!currentItemIdInSlot) {
      return { success: false, message: 'No item equipped in that slot.' };
    }

    // Fetch the InventoryItem being unequipped to get its templateId
    const inventoryItemToUnequip = await this.inventoryService.findInventoryItemById(currentItemIdInSlot);
    if (!inventoryItemToUnequip || !inventoryItemToUnequip.itemTemplate) {
        // Data inconsistency - item ID exists on char but not in inventory?
        this.logger.error(`Cannot unequip: InventoryItem ${currentItemIdInSlot} not found or missing template.`);
        // Clear the slot anyway to fix state?
        (character as any)[slotFieldName] = null;
        await this.characterRepository.save(character);
        throw new Error(`Data inconsistency: Equipped item ${currentItemIdInSlot} not found in inventory.`);
    }

    // ** Add item back to user inventory **
    // Add 1 unit back
    await this.inventoryService.addItemToUser(userId, inventoryItemToUnequip.itemTemplate.id, 1);

    // ** Clear the slot on the character **
    (character as any)[slotFieldName] = null;

    // ** Save updated character **
    await this.characterRepository.save(character);

    // TODO: Calculate and update character stats based on removed equipment

    return { success: true, unequippedItemId: currentItemIdInSlot };
  }

  // --- Helper Methods ---

  // Maps EquipmentSlot enum to the corresponding field name on the Character entity
  private getCharacterSlotFieldName(slot: EquipmentSlot): keyof Character {
      switch (slot) {
          case EquipmentSlot.MAINHAND: return 'equippedMainHandItemId';
          case EquipmentSlot.OFFHAND: return 'equippedOffHandItemId';
          case EquipmentSlot.HELM: return 'equippedHelmItemId';
          case EquipmentSlot.ARMOR: return 'equippedArmorItemId';
          case EquipmentSlot.GLOVES: return 'equippedGlovesItemId';
          case EquipmentSlot.BOOTS: return 'equippedBootsItemId';
          case EquipmentSlot.RING1: return 'equippedRing1ItemId';
          case EquipmentSlot.RING2: return 'equippedRing2ItemId';
          case EquipmentSlot.NECKLACE: return 'equippedNecklaceItemId';
          default: throw new Error(`Invalid equipment slot provided: ${slot}`);
      }
  }

  // Gets the InventoryItem ID currently in a character's slot
  private getItemIdInSlot(character: Character, slot: EquipmentSlot): string | null {
      const fieldName = this.getCharacterSlotFieldName(slot);
      return (character as any)[fieldName] || null;
  }

  // Basic validation if an item type can go into a specific slot type
  private isItemValidForSlot(itemTemplate: ItemTemplate, slot: EquipmentSlot): boolean {
    const type = itemTemplate.itemType;
    switch (slot) {
        case EquipmentSlot.MAINHAND:
        case EquipmentSlot.OFFHAND:
            return type === ItemType.WEAPON || type === ItemType.OFFHAND; // Allow shields/books in offhand too
        case EquipmentSlot.ARMOR: return type === ItemType.ARMOR;
        case EquipmentSlot.HELM: return type === ItemType.HELM;
        case EquipmentSlot.GLOVES: return type === ItemType.GLOVES;
        case EquipmentSlot.BOOTS: return type === ItemType.BOOTS;
        case EquipmentSlot.RING1: 
        case EquipmentSlot.RING2: 
            return type === ItemType.RING;
        case EquipmentSlot.NECKLACE: return type === ItemType.NECKLACE;
        default: return false;
    }
  }

  // Method to get a simplified equipment map for a character
  async getCharacterEquipment(characterId: string): Promise<Partial<Record<EquipmentSlot, InventoryItem>>> {
      const character = await this.characterRepository.findOne({ 
          where: { id: characterId },
          // Ensure all equipment relations are loaded (due to eager:true in Character entity)
          // relations: [ ... add relations if not eager ... ]
      });
      if (!character) {
          throw new NotFoundException('Character not found');
      }

      const equipment: Partial<Record<EquipmentSlot, InventoryItem>> = {};

      // Helper to add item if slot is filled
      const addEquippedItem = (slot: EquipmentSlot, item: InventoryItem | null) => {
        if (item) {
            equipment[slot] = item; 
        }
      };

      addEquippedItem(EquipmentSlot.MAINHAND, character.equippedMainHand);
      addEquippedItem(EquipmentSlot.OFFHAND, character.equippedOffHand);
      addEquippedItem(EquipmentSlot.HELM, character.equippedHelm);
      addEquippedItem(EquipmentSlot.ARMOR, character.equippedArmor);
      addEquippedItem(EquipmentSlot.GLOVES, character.equippedGloves);
      addEquippedItem(EquipmentSlot.BOOTS, character.equippedBoots);
      addEquippedItem(EquipmentSlot.RING1, character.equippedRing1);
      addEquippedItem(EquipmentSlot.RING2, character.equippedRing2);
      addEquippedItem(EquipmentSlot.NECKLACE, character.equippedNecklace);

      return equipment;
  }

  // TODO: Add getCharacterEquipment method for broadcasting
  // async getCharacterEquipment(characterId: string): Promise<Partial<Record<EquipmentSlot, InventoryItem>>> { ... }

  private readonly logger = new Logger(CharacterService.name); // Add logger

  // Add methods for deleting or updating characters later if needed
}