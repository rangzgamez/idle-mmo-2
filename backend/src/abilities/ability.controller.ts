// backend/src/abilities/ability.controller.ts
import { Controller, Get } from '@nestjs/common';
import { AbilityService } from './ability.service';
import { Ability } from './ability.entity';

@Controller('abilities')
export class AbilityController {
  constructor(private readonly abilityService: AbilityService) {}

  @Get()
  async findAll(): Promise<Ability[]> {
    return this.abilityService.findAll();
  }
}