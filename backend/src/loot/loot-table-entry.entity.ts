import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { LootTable } from './loot-table.entity';
import { ItemTemplate } from '../item/item.entity';

@Entity('loot_table_entries')
export class LootTableEntry {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // Relation to the Loot Table this entry belongs to
  @ManyToOne(() => LootTable, (table) => table.entries, {
    nullable: false,
    onDelete: 'CASCADE', // If LootTable is deleted, delete its entries
  })
  @JoinColumn({ name: 'lootTableId' })
  lootTable: LootTable;

  @Column()
  lootTableId: string;

  // Relation to the Item Template that can drop
  @ManyToOne(() => ItemTemplate, {
    nullable: false,
    eager: true, // Usually want to know what item it is when loading entry
    onDelete: 'CASCADE', // If ItemTemplate is deleted, remove this drop entry
  })
  @JoinColumn({ name: 'itemTemplateId' })
  itemTemplate: ItemTemplate;

  @Column()
  itemTemplateId: string;

  @Column({
    type: 'float',
    comment: 'Drop chance percentage (e.g., 5.5 for 5.5%)',
    default: 100.0,
  })
  dropChance: number;

  @Column({ type: 'integer', default: 1, comment: 'Minimum quantity to drop' })
  minQuantity: number;

  @Column({ type: 'integer', default: 1, comment: 'Maximum quantity to drop' })
  maxQuantity: number;


  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
} 