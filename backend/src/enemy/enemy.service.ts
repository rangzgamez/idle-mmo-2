// backend/src/enemy/enemy.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Enemy } from './enemy.entity';

@Injectable()
export class EnemyService {
  constructor(
    @InjectRepository(Enemy)
    private enemyRepository: Repository<Enemy>,
  ) {}

  async create(enemyData: Partial<Enemy>): Promise<Enemy> {
    const enemy = this.enemyRepository.create(enemyData);
    return this.enemyRepository.save(enemy);
  }

  async findAll(): Promise<Enemy[]> {
    return this.enemyRepository.find();
  }

  async findOne(id: string): Promise<Enemy> {
    const enemy = await this.enemyRepository.findOne({ where: { id } });
    if (!enemy) {
      throw new NotFoundException(`Enemy with ID "${id}" not found`);
    }
    return enemy;
  }

  async update(id: string, enemyData: Partial<Enemy>): Promise<Enemy> {
    const enemy = await this.findOne(id); // Ensure the enemy exists
    this.enemyRepository.merge(enemy, enemyData);
    return this.enemyRepository.save(enemy);
  }

  async remove(id: string): Promise<void> {
    const enemy = await this.findOne(id); // Ensure the enemy exists
    await this.enemyRepository.remove(enemy);
  }
}