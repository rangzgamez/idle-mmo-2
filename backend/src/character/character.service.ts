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
import { ZoneService } from '../game/zone.service'; // <-- Import ZoneService
import { BroadcastService } from '../game/broadcast.service'; // + ADDED
import { CharacterClassService } from '../character-class/character-class.service'; // +++ IMPORT CLASS SERVICE
import { CharacterClassTemplate } from '../character-class/character-class-template.entity'; // +++ IMPORT CLASS TEMPLATE
import { GameConfig } from '../common/config/game.config';

@Injectable()
export class CharacterService {
  // Define character limit per user
  private readonly MAX_CHARACTERS_PER_USER = GameConfig.CHARACTER.MAX_CHARACTERS_PER_USER;

  constructor(
    @InjectRepository(Character)
    private characterRepository: Repository<Character>,
    // Use forwardRef to handle circular dependency (CharacterService <-> InventoryService)
    @Inject(forwardRef(() => InventoryService))
    private inventoryService: InventoryService,
    // --- NEW: Inject ZoneService using forwardRef for circular dependency ---
    @Inject(forwardRef(() => ZoneService))
    private zoneService: ZoneService,
    // + ADDED BroadcastService injection
    @Inject(forwardRef(() => BroadcastService))
    private broadcastService: BroadcastService,
    // +++ INJECT CHARACTER CLASS SERVICE +++
    private readonly characterClassService: CharacterClassService,
  ) {}

  // Add logger instance at the end of the class definition
  private readonly logger = new Logger(CharacterService.name);

  async createCharacter(
    createCharacterDto: CreateCharacterDto,
    user: User, // Receive the authenticated user object
  ): Promise<Character> {
    // +++ Destructure classId +++
    const { name, classId } = createCharacterDto;

    // 1. Check character count for the user
    const count = await this.characterRepository.count({ where: { userId: user.id } });
    if (count >= this.MAX_CHARACTERS_PER_USER) {
      throw new ForbiddenException(`Maximum character limit (${this.MAX_CHARACTERS_PER_USER}) reached.`);
    }

    // +++ 2. Fetch the Class Template +++
    const classTemplate = await this.characterClassService.findOneByClassId(classId); // Assuming findOneByClassId exists
    if (!classTemplate) {
      throw new BadRequestException(`Invalid character class ID: ${classId}`);
    }

    // 3. Check if character name already exists (optional)
    // ... (existing name check logic)

    // +++ 4. Create and save the new character with class stats +++
    const newCharacter = this.characterRepository.create({
      name,
      userId: user.id,
      class: classId, // Assign the chosen class
      level: GameConfig.CHARACTER.STARTING_LEVEL,
      xp: GameConfig.CHARACTER.STARTING_XP,
      // Assign stats from the template
      baseHealth: classTemplate.baseHealth,
      baseAttack: classTemplate.baseAttack,
      baseDefense: classTemplate.baseDefense,
      attackSpeed: classTemplate.attackSpeed,
      attackRange: classTemplate.attackRange,
      // Keep existing defaults for aggro/leash unless defined in template
      // aggroRange: classTemplate.aggroRange ?? 150, 
      // leashDistance: classTemplate.leashDistance ?? 400,
    });

    await this.characterRepository.save(newCharacter);
    this.logger.log(`Created character ${newCharacter.id} (${newCharacter.name}) for user ${user.id} with class ${classId}`);
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

  // --- NEW: Method to calculate effective stats ---
  /**
   * Calculates the effective attack and defense for a character, including equipment bonuses.
   * @param characterId The ID of the character.
   * @returns An object containing effectiveAttack and effectiveDefense.
   * @throws NotFoundException if the character is not found.
   */
  async calculateEffectiveStats(characterId: string): Promise<{ effectiveAttack: number, effectiveDefense: number }> {
    const character = await this.characterRepository.findOneBy({ id: characterId });
    if (!character) {
      this.logger.error(`Character ${characterId} not found during effective stat calculation.`);
      throw new NotFoundException(`Character with ID ${characterId} not found.`);
    }

    // Default to base stats
    let effectiveAttack = character.baseAttack ?? 0;
    let effectiveDefense = character.baseDefense ?? 0;

    try {
      const bonuses = await this.inventoryService.getCharacterEquipmentBonuses(characterId);
      effectiveAttack += bonuses.totalAttackBonus;
      effectiveDefense += bonuses.totalDefenseBonus;
      this.logger.verbose(`Calculated effective stats for ${characterId}: Attack=${effectiveAttack} (Base:${character.baseAttack}+${bonuses.totalAttackBonus}), Defense=${effectiveDefense} (Base:${character.baseDefense}+${bonuses.totalDefenseBonus})`);
    } catch (error) {
      this.logger.error(`Failed to get equipment bonuses for character ${characterId} during stat calculation: ${error.message}`, error.stack);
      // Proceed with base stats if bonus calculation fails
    }

    return { effectiveAttack, effectiveDefense };
  }
  // --- End NEW Method ---

  // --- Equipment Logic ---

  async equipItem(userId: string, characterId: string, inventoryItemId: string): Promise<{ success: boolean; message?: string }> {
    this.logger.debug(`[EQUIP] CharacterService.equipItem called - userId: ${userId}, characterId: ${characterId}, inventoryItemId: ${inventoryItemId}`);
    
    const character = await this.findCharacterByIdAndUserId(characterId, userId);
    if (!character) { 
      this.logger.debug(`[EQUIP] Character not found for characterId: ${characterId}, userId: ${userId}`);
      throw new NotFoundException('Character not found or does not belong to user.'); 
    }
    this.logger.debug(`[EQUIP] Found character: ${character.name} (id: ${character.id})`);
    
    const itemToEquip = await this.inventoryService.findInventoryItemById(inventoryItemId);
    if (!itemToEquip || itemToEquip.userId !== userId) { 
      this.logger.debug(`[EQUIP] Inventory item not found or ownership mismatch - itemToEquip: ${itemToEquip ? 'exists' : 'null'}, itemUserId: ${itemToEquip?.userId}, requestUserId: ${userId}`);
      throw new NotFoundException('Inventory item not found or does not belong to user.'); 
    }
    this.logger.debug(`[EQUIP] Found inventory item: ${itemToEquip.itemTemplate?.name} (id: ${itemToEquip.id})`);
    
    if (itemToEquip.equippedByCharacterId) { 
      this.logger.debug(`[EQUIP] Item already equipped by character: ${itemToEquip.equippedByCharacterId}`);
      throw new BadRequestException('This item instance is already equipped.'); 
    }

    const template = itemToEquip.itemTemplate;
    if (!template || !template.equipSlot) { 
      this.logger.debug(`[EQUIP] Item template issue - template: ${template ? 'exists' : 'null'}, equipSlot: ${template?.equipSlot}`);
      throw new BadRequestException('Item is not equippable or template data missing.'); 
    }
    this.logger.debug(`[EQUIP] Item template valid - name: ${template.name}, equipSlot: ${template.equipSlot}`);
    
    const possibleTargetSlots = this.getPossibleSpecificSlots(template.equipSlot);
    this.logger.debug(`[EQUIP] Getting possible slots for equipSlot: ${template.equipSlot}, found: [${possibleTargetSlots.join(', ')}]`);
    if (!possibleTargetSlots.length) {
        this.logger.error(`[EQUIP] No specific slots defined for base slot type: ${template.equipSlot}`);
        throw new Error(`Configuration error: Cannot determine specific slots for ${template.equipSlot}.`);
    }
    
    let targetSpecificSlot: EquipmentSlot | null = null;
    const currentlyEquippedItems = await this.inventoryService.findEquippedItemsByCharacterId(characterId);
    this.logger.debug(`[EQUIP] Found ${currentlyEquippedItems.length} currently equipped items for character ${characterId}`);
    
    for (const slot of possibleTargetSlots) {
        const isSlotFilled = currentlyEquippedItems.some(item => item.equippedSlotId === slot);
        this.logger.debug(`[EQUIP] Checking slot ${slot}: ${isSlotFilled ? 'filled' : 'available'}`);
        if (!isSlotFilled) {
            targetSpecificSlot = slot;
            break;
        }
    }

    if (!targetSpecificSlot) {
        this.logger.debug(`[EQUIP] All slots full for item type. Possible slots: [${possibleTargetSlots.join(', ')}]`);
        throw new BadRequestException(`All available slots (${possibleTargetSlots.join(', ')}) for this item type are already full.`);
    }
    this.logger.debug(`[EQUIP] Determined target slot for item ${itemToEquip.id} is ${targetSpecificSlot}`);

    if (!this.isItemValidForSlot(template, targetSpecificSlot)) {
        this.logger.debug(`[EQUIP] Item validation failed - ${template.name} (${template.itemType}) cannot be equipped in slot ${targetSpecificSlot}`);
        throw new BadRequestException(`Item '${template.name}' (${template.itemType}) cannot be equipped in calculated slot ${targetSpecificSlot}.`);
    }
    this.logger.debug(`[EQUIP] Item validation passed - ${template.name} can be equipped in slot ${targetSpecificSlot}`);

    // --- Assign item to character/slot --- 
    this.logger.debug(`[EQUIP] Assigning item to character/slot - characterId: ${characterId}, slot: ${targetSpecificSlot}`);
    itemToEquip.equippedByCharacterId = characterId; 
    itemToEquip.equippedSlotId = targetSpecificSlot;
    // --- Clear inventory slot --- 
    const originalInventorySlot = itemToEquip.inventorySlot; // For logging
    this.logger.debug(`[EQUIP] Clearing inventory slot ${originalInventorySlot} for equipped item`);
    itemToEquip.inventorySlot = null; 
    // --------------------------

    this.logger.debug(`[EQUIP] Saving inventory item changes...`);
    await this.inventoryService.saveInventoryItem(itemToEquip); 
    this.logger.debug(`[EQUIP] Successfully saved item ${itemToEquip.id} (from inv slot ${originalInventorySlot}) equipped by Character ${characterId} in Slot ${targetSpecificSlot}`);

    // --- NEW: Recalculate stats and update ZoneService ---
    this.logger.debug(`[EQUIP] Recalculating effective stats after equip...`);
    try {
        const newStats = await this.calculateEffectiveStats(characterId);
        this.logger.debug(`[EQUIP] Calculated new stats - Attack: ${newStats.effectiveAttack}, Defense: ${newStats.effectiveDefense}`);
        await this.zoneService.updateCharacterEffectiveStats(characterId, newStats);
        this.logger.debug(`[EQUIP] Updated effective stats in ZoneService for character ${characterId} after equip`);
    } catch (error) {
        this.logger.error(`[EQUIP] Failed to update effective stats in ZoneService for ${characterId} after equip: ${error.message}`, error.stack);
        // Decide how critical this is. Should the equip fail? For now, just log.
    }
    // --- End NEW ---

    this.logger.debug(`[EQUIP] Equipment process completed successfully`);
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
  
      // --- NEW: Recalculate stats and update ZoneService ---
      try {
          const newStats = await this.calculateEffectiveStats(characterId); // Use the stored characterId
          await this.zoneService.updateCharacterEffectiveStats(characterId, newStats);
          this.logger.log(`Updated effective stats in ZoneService for character ${characterId} after unequip.`);
      } catch (error) {
          this.logger.error(`Failed to update effective stats in ZoneService for ${characterId} after unequip: ${error.message}`, error.stack);
          // Decide how critical this is. For now, just log.
      }
      // --- End NEW ---

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
        case 'RING1':
            return [EquipmentSlot.RING1];
        case 'RING2':
            return [EquipmentSlot.RING2];
        case 'WEAPON':
            // Depending on game rules, a weapon might go in MAINHAND or OFFHAND?
            // For now, assume primarily MAINHAND, OFFHAND is separate type?
             return [EquipmentSlot.MAINHAND]; // Or [EquipmentSlot.MAINHAND, EquipmentSlot.OFFHAND]?
        case 'MAINHAND': // Direct specific slot mapping
            return [EquipmentSlot.MAINHAND];
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

  // --- NEW: Method to calculate XP needed for a specific level ---
  /**
   * Calculates the total XP required to reach a given level.
   * Uses the formula: baseXP * (level - 1) ^ exponent
   * @param level The target level.
   * @returns The total XP required to reach that level.
   */
  private calculateXpForLevel(level: number): number {
    const baseXP = GameConfig.EXPERIENCE.BASE_XP;
    const exponent = GameConfig.EXPERIENCE.LEVEL_EXPONENT;

    if (level <= 1) {
      return 0; // Level 1 requires 0 XP
    }

    // Calculate XP needed for the target level
    const xpNeeded = Math.floor(baseXP * Math.pow(level - 1, exponent));
    return xpNeeded;
  }
  // --- End NEW Method ---

  // --- NEW: Method to add XP to a character ---
  async addXp(characterId: string, xpToAdd: number): Promise<Character> {
    if (xpToAdd <= 0) {
      this.logger.warn(`Attempted to add non-positive XP (${xpToAdd}) to character ${characterId}. Skipping.`);
      // Find the character to return its current state without modification
      const character = await this.characterRepository.findOneBy({ id: characterId });
      if (!character) {
        this.logger.error(`Character ${characterId} not found when trying to add XP.`);
        throw new NotFoundException(`Character with ID ${characterId} not found.`);
      }
      return character; 
    }

    const character = await this.characterRepository.findOneBy({ id: characterId });
    if (!character) {
      this.logger.error(`Character ${characterId} not found when trying to add XP.`);
      throw new NotFoundException(`Character with ID ${characterId} not found.`);
    }

    // --- Safeguard Check ---
    const MAX_REASONABLE_XP = 100000000; // Example threshold - adjust as needed
    if (character.xp > MAX_REASONABLE_XP) {
        this.logger.warn(`Character ${characterId} has unusually high starting XP (${character.xp}) before adding ${xpToAdd}.`);
    }
    // ---------------------

    // Convert character.xp from string (due to bigint) to number for calculation
    let currentXpNumber = parseInt(character.xp?.toString() || '0', 10);
    
    // Perform numerical addition
    currentXpNumber += xpToAdd;
    
    // Assign the result back. TypeORM should handle converting number back to bigint string on save.
    character.xp = currentXpNumber; 
    
    // Note: Do not log or broadcast simple XP add yet, wait until after level checks & save
    // this.logger.log(`Added ${xpToAdd} XP to character ${characterId}. New Total XP: ${character.xp}`);

    // --- Level Up Check (Reinstated While Loop) ---
    let leveledUp = false;
    const initialLevelBeforeCheck = character.level; // Store level before loop
    let xpNeededForNextLevel = this.calculateXpForLevel(character.level + 1);

    // Loop while the character's TOTAL XP meets the requirement for the NEXT level
    while (character.xp >= xpNeededForNextLevel) {
      this.logger.debug(`Level Up Triggered: Level ${character.level} -> ${character.level + 1}. Current Total XP=${character.xp}, Total XP Needed=${xpNeededForNextLevel}`);
      character.level += 1;
      leveledUp = true;

      // Apply Stat Gains for each level gained in the loop
      const healthGain = 10;
      const attackGain = 2;
      const defenseGain = 1;
      character.baseHealth += healthGain;
      character.baseAttack += attackGain;
      character.baseDefense += defenseGain;
      
      // IMPORTANT: Check XP requirement for the *new* next level for the loop condition
      xpNeededForNextLevel = this.calculateXpForLevel(character.level + 1);
    }
    // --- End Level Up Check ---

    let savedCharacter: Character; // Declare variable to hold saved character

    if (leveledUp) {
        this.logger.log(`*** CHARACTER ${character.id} [${character.name}] LEVELED UP FROM ${initialLevelBeforeCheck} TO ${character.level}! *** Final Stats: HP=${character.baseHealth}, ATK=${character.baseAttack}, DEF=${character.baseDefense}. Total XP: ${character.xp}`);
        // Save the character FIRST to persist new base stats and level
        savedCharacter = await this.characterRepository.save(character);
        this.logger.log(`Saved character ${characterId} after level up(s).`);

        // Now update the runtime state (stats and health)
        try {
            const newStats = await this.calculateEffectiveStats(characterId);
            await this.zoneService.updateCharacterEffectiveStats(characterId, newStats);
            this.zoneService.setCharacterHealth(characterId, savedCharacter.baseHealth); // Full heal on level up
            this.logger.log(`Updated runtime stats and health for character ${characterId} in ZoneService after level up.`);
        } catch (error) {
            this.logger.error(`Failed to update runtime stats/health in ZoneService for ${characterId} after level up: ${error.message}`, error.stack);
        }

        // --- Broadcast Level Up Notification --- 
        try {
             // Calculate XP needed for the level AFTER the loop finished
            const finalXpNeeded = this.calculateXpForLevel(savedCharacter.level + 1);
            const levelUpPayload = {
                characterId: savedCharacter.id,
                newLevel: savedCharacter.level,
                newBaseStats: {
                    health: savedCharacter.baseHealth,
                    attack: savedCharacter.baseAttack,
                    defense: savedCharacter.baseDefense,
                },
                xp: savedCharacter.xp, // Current total XP
                xpToNextLevel: finalXpNeeded, // Total XP needed for the next level
            };
            this.broadcastService.sendEventToUser(savedCharacter.userId, 'levelUpNotification', levelUpPayload);
            this.logger.log(`Sent levelUpNotification to user ${savedCharacter.userId} for character ${characterId}.`);
        } catch (error) {
            this.logger.error(`Failed to send levelUpNotification for character ${characterId}: ${error.message}`, error.stack);
        }

    } else {
        // If no level up, just save the XP update
        savedCharacter = await this.characterRepository.save(character);
        // Log non-level-up XP gain here
        const xpNeededLog = this.calculateXpForLevel(savedCharacter.level + 1);
        this.logger.log(`Character ${characterId} gained ${xpToAdd} XP but did not level up. Current Lvl: ${savedCharacter.level}, Total XP: ${savedCharacter.xp}, XP Needed for Lvl ${savedCharacter.level + 1}: ${xpNeededLog}`);
    }

    // --- ALWAYS Broadcast XP Update (AFTER saving) --- 
    // Send this regardless of level up, using the final saved state
    try {
        const finalXpNeededForNextLevel = this.calculateXpForLevel(savedCharacter.level + 1);
        const xpUpdatePayload = {
            characterId: savedCharacter.id,
            level: savedCharacter.level,
            xp: savedCharacter.xp, // Use final saved XP
            xpToNextLevel: finalXpNeededForNextLevel,
        };
        this.logger.log(`[CharacterService] Attempting to broadcast xpUpdate for user ${savedCharacter.userId}, char ${savedCharacter.id}. Payload:`, xpUpdatePayload);
        this.broadcastService.sendEventToUser(savedCharacter.userId, 'xpUpdate', xpUpdatePayload);
        this.logger.verbose(`Sent xpUpdate to user ${savedCharacter.userId} for character ${characterId}.`);
    } catch (error) {
        this.logger.error(`Failed to send xpUpdate for character ${characterId}: ${error.message}`, error.stack);
    }
    // -------------------------------------------------

    return savedCharacter; // Return the final saved character state
  }
  // --- End NEW Method ---

  // Add methods for deleting or updating characters later if needed
}