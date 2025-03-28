// backend/src/game/game.module.ts
import { Module } from '@nestjs/common';
import { GameGateway } from './game.gateway';
import { UserModule } from '../user/user.module'; // Import UserModule
import { CharacterModule } from '../character/character.module'; // Import CharacterModule

@Module({
  imports: [UserModule, CharacterModule], // Make services available for injection
  providers: [GameGateway],
})
export class GameModule {}