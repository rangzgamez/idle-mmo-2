import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ItemType, EquipmentSlot } from './item.types';

@Entity('item_templates') // Using 'item_templates' to be clear it's the template
export class ItemTemplate {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 100, unique: true }) // Ensure item names are unique
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ length: 100 }) // Assuming sprite keys are strings like 'sword_01'
  spriteKey: string;

  @Column({ type: 'enum', enum: ItemType })
  itemType: ItemType;

  @Column({ type: 'varchar', length: 50, nullable: true })
  equipSlot: string | null;

  @Column({ default: false })
  stackable: boolean;

  @Column({ type: 'integer', default: 0, comment: 'Bonus physical attack' })
  attackBonus: number;

  // Could add magicAttackBonus, etc. later

  @Column({ type: 'integer', default: 0, comment: 'Bonus physical defense' })
  defenseBonus: number;

  // Could add healthBonus, manaBonus, stat bonuses, etc. later

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
} 