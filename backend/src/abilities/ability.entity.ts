// backend/src/abilities/ability.entity.ts
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum AbilityType {
  DAMAGE = 'damage',
  HEAL = 'heal',
  BUFF = 'buff',
  DEBUFF = 'debuff',
}

export enum TargetType {
  AOE = 'aoe',
  SINGLE = 'single',
  SELF = 'self',
  LINE = 'line',
}

@Entity('abilities')
export class Ability {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({
    type: 'enum',
    enum: AbilityType,
  })
  type: AbilityType;

  @Column({
    type: 'enum',
    enum: TargetType,
  })
  targetType: TargetType;

  @Column({ type: 'integer', nullable: true })
  radius?: number;

  @Column({ type: 'integer', nullable: true })
  damage?: number;

  @Column({ type: 'integer', nullable: true })
  duration?: number;

  @Column({ type: 'integer' })
  cooldown: number;

  @Column({ type: 'integer', nullable: true })
  manaCost?: number;

  @Column({ type: 'integer', nullable: true })
  castTime?: number;

  @Column({ type: 'varchar', length: 255, nullable: true })
  icon?: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}