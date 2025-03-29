import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { EnemyService } from './enemy.service';
import { Enemy } from './enemy.entity';

@Controller('enemy')
export class EnemyController {
  constructor(private readonly enemyService: EnemyService) {}

  @Post()
  create(@Body() enemyData: Partial<Enemy>) {
    return this.enemyService.create(enemyData);
  }

  @Get()
  findAll() {
    return this.enemyService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.enemyService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() enemyData: Partial<Enemy>) {
    return this.enemyService.update(id, enemyData);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.enemyService.remove(id);
  }
}