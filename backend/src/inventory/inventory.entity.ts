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

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  // We might add position/slot within inventory later if needed
} 