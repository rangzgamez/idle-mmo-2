import { ItemType } from '../../item/item.types';

/**
 * Represents an item instance lying on the ground within a zone.
 */
export interface DroppedItem {
  id: string; // Unique instance ID (UUID) for this specific dropped item
  itemTemplateId: string;
  itemName: string; // Denormalized from template for client display
  itemType: ItemType; // Denormalized from template for client display/filtering
  position: { x: number; y: number };
  quantity: number;
  timeDropped: number; // Timestamp (Date.now()) when the item was dropped
  despawnTime: number; // Timestamp (Date.now()) when the item should be removed
} 