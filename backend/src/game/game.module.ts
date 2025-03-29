// backend/src/game/game.module.ts
import { Module } from '@nestjs/common';
import { GameGateway } from './game.gateway';
import { UserModule } from '../user/user.module'; // Import UserModule
import { CharacterModule } from '../character/character.module'; // Import CharacterModule
import { ZoneService } from './zone.service';
import { EnemyModule } from 'src/enemy/enemy.module';
import { CombatService } from './combat.service';

@Module({
  imports: [UserModule, CharacterModule, EnemyModule], // Make services available for injection
  providers: [GameGateway, ZoneService, CombatService],
  exports: [ZoneService]
})
export class GameModule {}