// backend/src/character/character.service.ts
import { Injectable, ConflictException, NotFoundException, ForbiddenException, BadRequestException, forwardRef, Inject, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
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
    if (!character) { throw new NotFoundException('Character not found or does not belong to user.'); }
    const itemToEquip = await this.inventoryService.findInventoryItemById(inventoryItemId);
    if (!itemToEquip || itemToEquip.userId !== userId) { throw new NotFoundException('Inventory item not found or does not belong to user.'); }
    if (itemToEquip.equippedByCharacterId) { throw new BadRequestException('This item instance is already equipped.'); }

    const template = itemToEquip.itemTemplate;
    if (!template || !template.equipSlot) { throw new BadRequestException('Item is not equippable or template data missing.'); }
    
    const possibleTargetSlots = this.getPossibleSpecificSlots(template.equipSlot);
    if (!possibleTargetSlots.length) {
        this.logger.error(`No specific slots defined for base slot type: ${template.equipSlot}`);
        throw new Error(`Configuration error: Cannot determine specific slots for ${template.equipSlot}.`);
    }
    
    let targetSpecificSlot: EquipmentSlot | null = null;
    const currentlyEquippedItems = await this.inventoryService.findEquippedItemsByCharacterId(characterId);
    
    for (const slot of possibleTargetSlots) {
        const isSlotFilled = currentlyEquippedItems.some(item => item.equippedSlotId === slot);
        if (!isSlotFilled) {
            targetSpecificSlot = slot;
            break;
        }
    }

    if (!targetSpecificSlot) {
        throw new BadRequestException(`All available slots (${possibleTargetSlots.join(', ')}) for this item type are already full.`);
    }
    this.logger.log(`Determined target slot for item ${itemToEquip.id} is ${targetSpecificSlot}`);

    if (!this.isItemValidForSlot(template, targetSpecificSlot)) {
        throw new BadRequestException(`Item '${template.name}' (${template.itemType}) cannot be equipped in calculated slot ${targetSpecificSlot}.`);
    }

    // --- Assign item to character/slot --- 
    itemToEquip.equippedByCharacterId = characterId; 
    itemToEquip.equippedSlotId = targetSpecificSlot;
    // --- Clear inventory slot --- 
    const originalInventorySlot = itemToEquip.inventorySlot; // For logging
    itemToEquip.inventorySlot = null; 
    // --------------------------

    await this.inventoryService.saveInventoryItem(itemToEquip); 
    this.logger.log(`Item ${itemToEquip.id} (from inv slot ${originalInventorySlot}) equipped by Character ${characterId} in Slot ${targetSpecificSlot}.`);

    return { success: true };
  }

  async unequipSpecificItem(userId: string, inventoryItemId: string): Promise<{ success: boolean; message?: string; unequippedItemId?: string }> {
      const itemToUnequip = await this.inventoryService.findInventoryItemById(inventoryItemId);
      
      if (!itemToUnequip) { throw new NotFoundException(`Inventory item ${inventoryItemId} not found.`); }
      if (itemToUnequip.userId !== userId) { throw new ForbiddenException('Cannot unequip item that does not belong to user.'); }
      if (!itemToUnequip.equippedByCharacterId) { return { success: false, message: 'Item is not currently equipped.', unequippedItemId: inventoryItemId }; }
      
      // --- Find empty slot BEFORE modifying item ---
      const emptySlot = await this.inventoryService.findFirstEmptyInventorySlot(userId);
      if (emptySlot === null) {
          this.logger.warn(`User ${userId} cannot unequip item ${inventoryItemId}: Inventory full.`);
          throw new ConflictException("Inventory is full. Cannot unequip.");
      }
      // --------------------------------------------
      
      const characterId = itemToUnequip.equippedByCharacterId;
      const originalSlotId = itemToUnequip.equippedSlotId;
      
      // --- Now update item state ---
      itemToUnequip.equippedByCharacterId = null; 
      itemToUnequip.equippedSlotId = null;
      itemToUnequip.inventorySlot = emptySlot; // Assign to empty slot
      // ---------------------------

      await this.inventoryService.saveInventoryItem(itemToUnequip); 
      this.logger.log(`Marked InventoryItem ${itemToUnequip.id} (from slot ${originalSlotId}) as unequipped and moved to inventory slot ${emptySlot}.`);
  
      return { success: true, unequippedItemId: inventoryItemId };
  }
  
  async unequipItem(userId: string, characterId: string, specificSlotId: EquipmentSlot): Promise<{ success: boolean; message?: string; unequippedItemId?: string }> {
    const character = await this.findCharacterByIdAndUserId(characterId, userId);
    if (!character) { throw new NotFoundException('Character not found or does not belong to user.'); }

    const itemInSlot = await this.inventoryService.findEquippedItemBySlot(characterId, specificSlotId);

    if (!itemInSlot) {
      return { success: false, message: `No item equipped in slot ${specificSlotId} by this character.` };
    }

    return this.unequipSpecificItem(userId, itemInSlot.id);
  }

  async getCharacterEquipment(characterId: string): Promise<Partial<Record<EquipmentSlot, InventoryItem>>> {
      const equippedItems = await this.inventoryService.findEquippedItemsByCharacterId(characterId);

      const equipment: Partial<Record<EquipmentSlot, InventoryItem>> = {};

      for (const item of equippedItems) {
          if (item.equippedSlotId) { 
              equipment[item.equippedSlotId] = item;
          } else {
              this.logger.warn(`Item ${item.id} equipped by ${characterId} is missing equippedSlotId.`);
          }
      }
      return equipment;
  }

  private getPossibleSpecificSlots(baseSlot: string | null): EquipmentSlot[] {
    if (!baseSlot) return []; // Not equippable

    switch (baseSlot.toUpperCase()) { // Use uppercase for case-insensitivity
        case 'RING': 
            return [EquipmentSlot.RING1, EquipmentSlot.RING2]; 
        case 'WEAPON':
            // Depending on game rules, a weapon might go in MAINHAND or OFFHAND?
            // For now, assume primarily MAINHAND, OFFHAND is separate type?
             return [EquipmentSlot.MAINHAND]; // Or [EquipmentSlot.MAINHAND, EquipmentSlot.OFFHAND]?
        case 'OFFHAND': // If templates explicitly define OFFHAND type
            return [EquipmentSlot.OFFHAND];
        case 'HELM': 
            return [EquipmentSlot.HELM];
        case 'ARMOR': 
            return [EquipmentSlot.ARMOR];
        case 'GLOVES': 
            return [EquipmentSlot.GLOVES];
        case 'BOOTS': 
            return [EquipmentSlot.BOOTS];
        case 'NECKLACE': 
            return [EquipmentSlot.NECKLACE];
        // Add other base types like 'SHIELD' -> [EquipmentSlot.OFFHAND] if needed
        default: 
            this.logger.warn(`Requested possible slots for unknown base slot type string: ${baseSlot}`);
            return []; 
    }
  }

  private isItemValidForSlot(itemTemplate: ItemTemplate, specificSlotId: EquipmentSlot): boolean {
    const type = itemTemplate.itemType;
    // Check if the specific slot is compatible with the item's base type
    switch (specificSlotId) {
        case EquipmentSlot.MAINHAND: return type === ItemType.WEAPON;
        case EquipmentSlot.OFFHAND: return type === ItemType.WEAPON || type === ItemType.OFFHAND;
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

  private readonly logger = new Logger(CharacterService.name); // Add logger

  // Add methods for deleting or updating characters later if needed
}