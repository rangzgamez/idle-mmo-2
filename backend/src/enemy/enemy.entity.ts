// backend/src/enemy/enemy.entity.ts
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { LootTable } from '../loot/loot-table.entity';

@Entity()
export class Enemy {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 100 })
  name: string;

  @Column({ type: 'integer', default: 1 })
  level: number;

  @Column({ type: 'integer', default: 100 })
  baseHealth: number;

  @Column({ type: 'integer', default: 10 })
  baseAttack: number;

  @Column({ type: 'integer', default: 5 })
  baseDefense: number;

  @Column({ type: 'integer', default: 75 })
  baseSpeed: number;

  @Column({ type: 'integer', default: 30 })
  attackRange: number;

  @Column({ type: 'integer', default: 10 })
  xpReward: number;

  @Column({ type: 'jsonb', default: { isAggressive: true, isStationary: false, canFlee: false } })
  behaviorFlags: {
    isAggressive: boolean;
    isStationary: boolean;
    canFlee: boolean;
  };

  @ManyToOne(() => LootTable, (table) => table.enemies, {
    nullable: true,
    eager: false,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'lootTableId' })
  lootTable: LootTable | null;

  @Column({ type: 'uuid', nullable: true })
  lootTableId: string | null;

  @Column({ length: 50 })
  spriteKey: string; // Key to use for the enemy's sprite in the frontend. (e.g. "goblin")

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}