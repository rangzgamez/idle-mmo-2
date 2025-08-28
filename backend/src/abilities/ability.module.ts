// backend/src/abilities/ability.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Ability } from './ability.entity';
import { AbilityService } from './ability.service';
import { AbilityController } from './ability.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Ability])],
  controllers: [AbilityController],
  providers: [AbilityService],
  exports: [AbilityService],
})
export class AbilityModule {}