// backend/src/character/dto/create-character.dto.ts
import { IsString, Length } from 'class-validator';

export class CreateCharacterDto {
  @IsString()
  @Length(3, 50) // Character name length constraints
  name: string;
}