// backend/src/character/character.service.ts
import { Injectable, ConflictException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Character } from './character.entity';
import { CreateCharacterDto } from './dto/create-character.dto';
import { User } from '../user/user.entity'; // Import User for type hinting

@Injectable()
export class CharacterService {
  // Define character limit per user
  private readonly MAX_CHARACTERS_PER_USER = 10; // Or whatever limit you want

  constructor(
    @InjectRepository(Character)
    private characterRepository: Repository<Character>,
  ) {}

  async createCharacter(
    createCharacterDto: CreateCharacterDto,
    user: User, // Receive the authenticated user object
  ): Promise<Character> {
    const { name } = createCharacterDto;

    // 1. Check character count for the user
    const count = await this.characterRepository.count({ where: { userId: user.id } });
    if (count >= this.MAX_CHARACTERS_PER_USER) {
      throw new ForbiddenException(`Maximum character limit (${this.MAX_CHARACTERS_PER_USER}) reached.`);
    }

    // 2. Check if character name already exists for this user (optional, maybe allow same name?)
    // const existingName = await this.characterRepository.findOneBy({ userId: user.id, name });
    // if (existingName) {
    //   throw new ConflictException('Character name already exists for this user.');
    // }

    // 3. Create and save the new character
    const newCharacter = this.characterRepository.create({
      name,
      userId: user.id,
      // user: user, // Can assign the relation object directly if needed later
      // Set initial stats/level if desired
      level: 1,
      xp: 0,
    });

    await this.characterRepository.save(newCharacter);
    return newCharacter; // Return the created character data
  }

  async findCharactersByUserId(userId: string): Promise<Character[]> {
    return this.characterRepository.find({
      where: { userId },
      order: { createdAt: 'ASC' }, // Order by creation date
    });
  }

  async findCharacterByIdAndUserId(id: string, userId: string): Promise<Character | null> {
      return this.characterRepository.findOneBy({ id, userId });
  }

  // Add methods for deleting or updating characters later if needed
}