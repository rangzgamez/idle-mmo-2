// backend/src/user/user.entity.ts
import { Character } from 'src/character/character.entity';
import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    UpdateDateColumn,
    OneToMany, // We'll add relations later
  } from 'typeorm';
  // Import Character, InventoryItem, Pet later when defined
  // import { Character } from '../character/character.entity';
  // import { InventoryItem } from '../inventory/inventory-item.entity';
  // import { Pet } from '../pet/pet.entity';
  
  @Entity('users') // Specifies the table name in the database
  export class User {
    @PrimaryGeneratedColumn('uuid')
    id: string;
  
    @Column({ unique: true, length: 50 }) // Ensure usernames are unique and have a max length
    username: string;
  
    @Column() // Password hash will be stored here
    passwordHash: string;
  
    // Add the OneToMany relation (optional for loading characters via User)
    @OneToMany(() => Character, (character) => character.user)
    characters: Character[];
  
    // @OneToMany(() => InventoryItem, item => item.owner)
    // inventory: InventoryItem[];
  
    // @OneToMany(() => Pet, pet => pet.owner)
    // pets: Pet[];
  
    @CreateDateColumn()
    createdAt: Date;
  
    @UpdateDateColumn()
    updatedAt: Date;
  }