import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { User } from '../user/user.entity';
import { ItemTemplate } from '../item/item.entity';
import { Character } from '../character/character.entity';
import { EquipmentSlot } from '../item/item.types';

@Entity('inventory_items')
export class InventoryItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // Relation to the User who owns this item stack
  @ManyToOne(() => User, (user) => user.inventoryItems, {
    nullable: false,
    onDelete: 'CASCADE', // If user is deleted, delete their items
  })
  @JoinColumn({ name: 'userId' }) // Change FK column name
  user: User; // Rename property

  @Column() // TypeORM automatically infers this from the relation if name isn't specified in JoinColumn
  userId: string; // Rename ID property

  // Relation to the Item Template defining this item
  @ManyToOne(() => ItemTemplate, {
    eager: true, // Automatically load the template when loading inventory item
    nullable: false,
    onDelete: 'RESTRICT', // Prevent deleting an item template if inventory items exist? Or CASCADE? Let's start with RESTRICT.
  })
  @JoinColumn({ name: 'itemTemplateId' })
  itemTemplate: ItemTemplate;

  @Column()
  itemTemplateId: string;

  @Column({ type: 'integer', default: 1 })
  quantity: number;

  // Add nullable relation to the Character equipping this item
  @ManyToOne(() => Character, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'equippedByCharacterId' })
  equippedByCharacter: Character | null;

  @Column({ type: 'uuid', nullable: true })
  equippedByCharacterId: string | null;

  // Add the specific slot ID where the item is equipped
  @Column({ type: 'enum', enum: EquipmentSlot, nullable: true })
  equippedSlotId: EquipmentSlot | null;

  // --- Add inventory slot position ---
  @Column({ type: 'integer', nullable: true, comment: '0-based index in the main inventory grid' })
  inventorySlot: number | null;
  // ---------------------------------

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  // We might add position/slot within inventory later if needed
} 