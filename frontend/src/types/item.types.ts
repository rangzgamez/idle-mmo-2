// frontend/src/types/item.types.ts
// Duplicated from backend/src/item/item.types.ts

export enum ItemType {
    WEAPON = 'WEAPON',
    ARMOR = 'ARMOR', // Chest
    HELM = 'HELM',
    GLOVES = 'GLOVES',
    BOOTS = 'BOOTS',
    RING = 'RING',
    NECKLACE = 'NECKLACE',
    OFFHAND = 'OFFHAND', // Shields, books, etc.
    CONSUMABLE = 'CONSUMABLE',
    MATERIAL = 'MATERIAL',
    QUEST = 'QUEST',
    ITEM = 'ITEM', // Generic item type for default cases
  }
  
  // Note: If you need EquipmentSlot enum in the frontend later,
  // copy it here as well.
  // export enum EquipmentSlot { ... }
  