// backend/src/character/dto/create-character.dto.ts
import { IsString, Length, IsEnum } from 'class-validator';
import { CharacterClass } from '../../common/enums/character-class.enum'; // Adjust path as needed

export class CreateCharacterDto {
  @IsString()
  @Length(3, 50) // Character name length constraints
  name: string;

  // Add classId field
  @IsEnum(CharacterClass)
  classId: CharacterClass;
}