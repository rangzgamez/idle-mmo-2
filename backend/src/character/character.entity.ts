// backend/src/character/character.entity.ts
import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    UpdateDateColumn,
    ManyToOne, // To link to User
    JoinColumn, // To specify foreign key column name
  } from 'typeorm';
  import { User } from '../user/user.entity'; // Import User entity
  
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
  
    @CreateDateColumn()
    createdAt: Date;
  
    @UpdateDateColumn()
    updatedAt: Date;
  }