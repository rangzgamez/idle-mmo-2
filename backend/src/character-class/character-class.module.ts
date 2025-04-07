import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CharacterClassTemplate } from './character-class-template.entity';
import { CharacterClassService } from './character-class.service';
import { CharacterClassController } from './character-class.controller';

@Module({
  imports: [TypeOrmModule.forFeature([CharacterClassTemplate])],
  providers: [CharacterClassService],
  controllers: [CharacterClassController],
  exports: [TypeOrmModule, CharacterClassService],
})
export class CharacterClassModule {} 