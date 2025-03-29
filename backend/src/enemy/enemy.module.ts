// backend/src/enemy/enemy.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Enemy } from './enemy.entity';
import { EnemyService } from './enemy.service';
import { EnemyController } from './enemy.controller'; // Import only if you created it

@Module({
  imports: [TypeOrmModule.forFeature([Enemy])],
  providers: [EnemyService],
  exports: [EnemyService], // Export the service to be used in other modules
  controllers: [EnemyController], // Add only if you created it
})
export class EnemyModule {}