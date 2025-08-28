// backend/src/abilities/ability.service.ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Ability } from './ability.entity';

@Injectable()
export class AbilityService {
  constructor(
    @InjectRepository(Ability)
    private readonly abilityRepository: Repository<Ability>,
  ) {}

  async findAll(): Promise<Ability[]> {
    return this.abilityRepository.find();
  }

  async findById(id: string): Promise<Ability | null> {
    return this.abilityRepository.findOne({ where: { id } });
  }

  async findByName(name: string): Promise<Ability | null> {
    return this.abilityRepository.findOne({ where: { name } });
  }

  async create(abilityData: Partial<Ability>): Promise<Ability> {
    const ability = this.abilityRepository.create(abilityData);
    return this.abilityRepository.save(ability);
  }
}