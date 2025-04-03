// backend/src/game/game.module.ts
import { Module, Logger } from '@nestjs/common';
import { GameGateway } from './game.gateway';
import { UserModule } from '../user/user.module'; // Import UserModule
import { CharacterModule } from '../character/character.module'; // Import CharacterModule
import { ZoneService } from './zone.service';
import { EnemyModule } from 'src/enemy/enemy.module';
import { CombatService } from './combat.service';
import { AIService } from './ai.service'; // Import the new AI Service
import { GameLoopService } from './game-loop.service'; // <-- Add this import
import { CharacterStateService } from './character-state.service'; // <-- Add this import
import { MovementService } from './movement.service'; // <-- Add this import
import { EnemyStateService } from './enemy-state.service'; // <-- Add this import
import { SpawningService } from './spawning.service'; // <-- Add this import
import { BroadcastService } from './broadcast.service'; // <-- Add this import
import { InventoryModule } from 'src/inventory/inventory.module';
import { LootModule } from 'src/loot/loot.module';

@Module({
  imports: [UserModule, CharacterModule, EnemyModule, InventoryModule, LootModule], // Make services available for injection
  providers: [
    GameGateway,
    ZoneService,
    CombatService,
    AIService,
    GameLoopService,
    CharacterStateService,
    MovementService,
    EnemyStateService,
    SpawningService,
    BroadcastService,
    Logger,
  ],
  exports: [ZoneService, AIService]
})
export class GameModule {}