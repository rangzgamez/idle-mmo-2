import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InventoryItem } from './inventory.entity';
import { InventoryService } from './inventory.service';
// We need ItemModule because InventoryService injects ItemService
import { ItemModule } from '../item/item.module';
// Import InventoryController here if/when created

@Module({
  imports: [
    TypeOrmModule.forFeature([InventoryItem]),
    ItemModule, // <-- Add ItemModule here
  ],
  providers: [InventoryService],
  exports: [InventoryService], // Export service for other modules (Game, Character?)
  // controllers: [InventoryController], // Add controller if created
})
export class InventoryModule {} 