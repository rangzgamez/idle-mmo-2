// backend/src/character/character.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CharacterService } from './character.service';
import { CharacterController } from './character.controller';
import { Character } from './character.entity';
// Import AuthModule to make JwtAuthGuard work correctly if guards are applied in CharacterController
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Character]), // Register Character repository
    AuthModule, // Needed for guards if applied here
  ],
  controllers: [CharacterController],
  providers: [CharacterService],
  exports: [CharacterService], // Export if other modules need it later
})
export class CharacterModule {}