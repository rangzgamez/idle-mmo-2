// backend/src/character/character.entity.ts
import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    UpdateDateColumn,
    ManyToOne, // To link to User
    JoinColumn, // To specify foreign key column name
    OneToMany, // Add this import
    OneToOne, // Add this import
  } from 'typeorm';
  import { User } from '../user/user.entity'; // Import User entity
  import { InventoryItem } from '../inventory/inventory.entity'; // Re-add InventoryItem import for equipment slots
  // import { EquipmentSlot } from '../item/item.types'; // We might need this for validation/logic later
  
  @Entity('characters') // Database table name
  export class Character {
    @PrimaryGeneratedColumn('uuid')
    id: string;
  
    // --- Relation to User ---
    // Many characters can belong to one user
    @ManyToOne(() => User, (user) => user.id, { onDelete: 'CASCADE' }) // Cascade delete if user is deleted
    @JoinColumn({ name: 'userId' }) // Explicitly name the foreign key column
    user: User;
  
    @Column('uuid') // Store the user ID directly for easier querying if needed
    userId: string;
    // ------------------------
    @Column('float', { nullable: true, default: null }) // Use float for coordinates
    positionX: number | null;

    @Column('float', { nullable: true, default: null })
    positionY: number | null;

    @Column({ type: 'varchar', length: 100, nullable: true, default: null }) // ID of the zone the character is in
    currentZoneId: string | null;
    @Column({ length: 50 })
    name: string;
  
    @Column({ default: 1 })
    level: number;
  
    @Column({ type: 'bigint', default: 0 }) // Use bigint for potentially large XP numbers
    xp: number;
  
    // --- ADDED BASIC STATS (As per documentation plan) ---
    @Column({ type: 'integer', default: 100 })
    baseHealth: number;

    @Column({ type: 'integer', default: 15 })
    baseAttack: number;

    @Column({ type: 'integer', default: 5 })
    baseDefense: number;

    // --- ADDED COMBAT/AI STATS ---
    @Column({ type: 'integer', default: 1500, comment: 'Milliseconds between attacks' })
    attackSpeed: number;

    @Column({ type: 'integer', default: 50, comment: 'Pixel distance for attacks' })
    attackRange: number;

    @Column({ type: 'integer', default: 150, comment: 'Pixel distance for auto-aggro' })
    aggroRange: number;

    @Column({ type: 'integer', default: 400, comment: 'Pixel distance from anchor before returning' })
    leashDistance: number;
    // ------------------------------------------------------
  
    // --- REMOVE Relation to Inventory Items ---
    // @OneToMany(() => InventoryItem, (item) => item.character, {
    //   cascade: true,
    //   // lazy: true
    // })
    // inventoryItems: InventoryItem[];
    // ------------------------------------
  
    // TODO: Define stats later (hp, mp, str, int, def, speed, etc.)
    // @Column('jsonb', { default: {} })
    // stats: Record<string, any>;
  
    // We'll add position and zone later in Phase 2
    // @Column('float', { nullable: true })
    // positionX: number;
    // @Column('float', { nullable: true })
    // positionY: number;
    // @Column({ nullable: true })
    // currentZoneId: string;
  
    // TODO: Add equipment relations later
    // @OneToOne(() => InventoryItem, { nullable: true, eager: true })
    // @JoinColumn()
    // equippedWeapon: InventoryItem | null;
    // @Column({ nullable: true }) equippedWeaponId: string | null;
  
    // --- Equipment Slots ---
    // Using OneToOne allows eager loading the InventoryItem if needed,
    // and TypeORM manages the foreign key column (`equippedMainHandItemId`) automatically via @JoinColumn.

    @OneToOne(() => InventoryItem, { nullable: true, eager: true, onDelete: 'SET NULL' }) // Clear slot if item deleted
    @JoinColumn({ name: 'equippedMainHandItemId' })
    equippedMainHand: InventoryItem | null;
    @Column({ type: 'uuid', nullable: true }) // Explicit FK column for potential direct queries
    equippedMainHandItemId: string | null;

    @OneToOne(() => InventoryItem, { nullable: true, eager: true, onDelete: 'SET NULL' })
    @JoinColumn({ name: 'equippedOffHandItemId' })
    equippedOffHand: InventoryItem | null;
    @Column({ type: 'uuid', nullable: true })
    equippedOffHandItemId: string | null;

    @OneToOne(() => InventoryItem, { nullable: true, eager: true, onDelete: 'SET NULL' })
    @JoinColumn({ name: 'equippedHelmItemId' })
    equippedHelm: InventoryItem | null;
    @Column({ type: 'uuid', nullable: true })
    equippedHelmItemId: string | null;

    @OneToOne(() => InventoryItem, { nullable: true, eager: true, onDelete: 'SET NULL' })
    @JoinColumn({ name: 'equippedArmorItemId' })
    equippedArmor: InventoryItem | null;
    @Column({ type: 'uuid', nullable: true })
    equippedArmorItemId: string | null;

    @OneToOne(() => InventoryItem, { nullable: true, eager: true, onDelete: 'SET NULL' })
    @JoinColumn({ name: 'equippedGlovesItemId' })
    equippedGloves: InventoryItem | null;
    @Column({ type: 'uuid', nullable: true })
    equippedGlovesItemId: string | null;

    @OneToOne(() => InventoryItem, { nullable: true, eager: true, onDelete: 'SET NULL' })
    @JoinColumn({ name: 'equippedBootsItemId' })
    equippedBoots: InventoryItem | null;
    @Column({ type: 'uuid', nullable: true })
    equippedBootsItemId: string | null;

    @OneToOne(() => InventoryItem, { nullable: true, eager: true, onDelete: 'SET NULL' })
    @JoinColumn({ name: 'equippedRing1ItemId' })
    equippedRing1: InventoryItem | null;
    @Column({ type: 'uuid', nullable: true })
    equippedRing1ItemId: string | null;

    @OneToOne(() => InventoryItem, { nullable: true, eager: true, onDelete: 'SET NULL' })
    @JoinColumn({ name: 'equippedRing2ItemId' })
    equippedRing2: InventoryItem | null;
    @Column({ type: 'uuid', nullable: true })
    equippedRing2ItemId: string | null;

    @OneToOne(() => InventoryItem, { nullable: true, eager: true, onDelete: 'SET NULL' })
    @JoinColumn({ name: 'equippedNecklaceItemId' })
    equippedNecklace: InventoryItem | null;
    @Column({ type: 'uuid', nullable: true })
    equippedNecklaceItemId: string | null;

    // ----------------------
  
    @CreateDateColumn()
    createdAt: Date;
  
    @UpdateDateColumn()
    updatedAt: Date;
  }