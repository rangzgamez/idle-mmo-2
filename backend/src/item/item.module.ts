import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ItemTemplate } from './item.entity';
import { ItemService } from './item.service';
// Import ItemController here if/when created

@Module({
  imports: [TypeOrmModule.forFeature([ItemTemplate])],
  providers: [ItemService],
  exports: [ItemService], // Export service for other modules (Inventory, Loot)
  // controllers: [ItemController], // Add controller if created
})
export class ItemModule {} 