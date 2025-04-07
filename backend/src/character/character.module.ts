// backend/src/character/character.module.ts
import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CharacterService } from './character.service';
import { CharacterController } from './character.controller';
import { Character } from './character.entity';
// Import AuthModule to make JwtAuthGuard work correctly if guards are applied in CharacterController
import { AuthModule } from '../auth/auth.module';
import { InventoryModule } from '../inventory/inventory.module';
import { GameModule } from '../game/game.module';
import { CharacterClassModule } from '../character-class/character-class.module';
@Module({
  imports: [
    TypeOrmModule.forFeature([Character]), // Register Character repository
    AuthModule, // Needed for guards if applied here
    forwardRef(() => InventoryModule), // Use forwardRef for InventoryModule
    forwardRef(() => GameModule), // Use forwardRef for ZoneModule
    CharacterClassModule,
  ],
  controllers: [CharacterController],
  providers: [CharacterService],
  exports: [CharacterService], // Export if other modules need it later
})
export class CharacterModule {}