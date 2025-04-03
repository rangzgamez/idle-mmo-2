import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LootTable } from './loot-table.entity';
import { LootTableEntry } from './loot-table-entry.entity';
import { LootService } from './loot.service';
// Import ItemModule if ItemService is needed in LootService
// import { ItemModule } from '../item/item.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([LootTable, LootTableEntry]),
    // ItemModule, // If needed
  ],
  providers: [LootService],
  exports: [LootService], // Export for Game/Enemy/Combat services
})
export class LootModule {} 