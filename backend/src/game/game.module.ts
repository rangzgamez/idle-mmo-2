// backend/src/game/game.module.ts
import { Module } from '@nestjs/common';
import { GameGateway } from './game.gateway';
import { UserModule } from '../user/user.module'; // Import UserModule
import { CharacterModule } from '../character/character.module'; // Import CharacterModule
import { ZoneService } from './zone.service';

@Module({
  imports: [UserModule, CharacterModule], // Make services available for injection
  providers: [GameGateway, ZoneService],
  exports: [ZoneService]
})
export class GameModule {}