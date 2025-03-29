import { Module } from '@nestjs/common';
import { DebugController } from './debug.controller';
import { GameModule } from 'src/game/game.module';

@Module({
    imports: [GameModule],
    controllers: [DebugController],
})
export class DebugModule {}