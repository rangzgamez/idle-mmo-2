import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToMany,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { LootTableEntry } from './loot-table-entry.entity';
import { Enemy } from '../enemy/enemy.entity'; // Import Enemy

@Entity('loot_tables')
export class LootTable {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 100, unique: true, comment: 'Unique identifier name for the loot table, e.g., GOBLIN_COMMON' })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @OneToMany(() => LootTableEntry, (entry) => entry.lootTable, { cascade: true })
  entries: LootTableEntry[];

  // Inverse relation to Enemies using this table (optional, but can be useful)
  @OneToMany(() => Enemy, (enemy) => enemy.lootTable)
  enemies: Enemy[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
} 