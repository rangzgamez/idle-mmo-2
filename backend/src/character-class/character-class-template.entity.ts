import { Entity, PrimaryColumn, Column } from 'typeorm';
import { CharacterClass } from '../common/enums/character-class.enum';
import { AttackType } from '../common/enums/attack-type.enum';

@Entity('character_class_templates')
export class CharacterClassTemplate {
  @PrimaryColumn({ type: 'enum', enum: CharacterClass })
  classId: CharacterClass;

  @Column({ length: 50 })
  name: string;

  @Column({ type: 'text' })
  description: string;

  // --- BASE STATS ---
  @Column({ type: 'integer', default: 120 })
  baseHealth: number;

  @Column({ type: 'integer', default: 18 })
  baseAttack: number; // Might represent heal power for Priest

  @Column({ type: 'integer', default: 8 })
  baseDefense: number;

  // --- COMBAT/AI STATS ---
  @Column({ type: 'integer', default: 1500, comment: 'Milliseconds between attacks/heals' })
  attackSpeed: number;

  @Column({ type: 'integer', default: 50, comment: 'Pixel distance for attacks/heals' })
  attackRange: number;

  // Attack Type to determine behavior
  @Column({ type: 'enum', enum: AttackType, default: AttackType.MELEE })
  attackType: AttackType;

  // Base key for loading assets
  @Column({ length: 50 })
  spriteKeyBase: string;
} 