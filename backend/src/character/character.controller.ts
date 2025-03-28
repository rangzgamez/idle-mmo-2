// backend/src/character/character.controller.ts
import { Controller, Get, Post, Body, UseGuards, Request, Param, ParseUUIDPipe, NotFoundException } from '@nestjs/common';
import { CharacterService } from './character.service';
import { CreateCharacterDto } from './dto/create-character.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard'; // Import the guard
import { User } from '../user/user.entity'; // For type hint on req.user
import { Character } from './character.entity';

@Controller('characters') // Base route: /characters
@UseGuards(JwtAuthGuard) // Apply guard to ALL routes in this controller
export class CharacterController {
  constructor(private readonly characterService: CharacterService) {}

  @Post() // POST /characters
  async create(
    @Body() createCharacterDto: CreateCharacterDto,
    @Request() req: { user: User }, // Access the user attached by JwtStrategy
  ): Promise<Character> {
    // req.user contains the user object validated by the JWT strategy
    return this.characterService.createCharacter(createCharacterDto, req.user);
  }

  @Get() // GET /characters
  async findAllForUser(
    @Request() req: { user: User },
  ): Promise<Character[]> {
    // Fetch characters belonging only to the logged-in user
    return this.characterService.findCharactersByUserId(req.user.id);
  }

  // Optional: Endpoint to get a single character (might not be needed initially)
  @Get(':id') // GET /characters/:id
  async findOne(
    @Param('id', ParseUUIDPipe) id: string, // Validate that id is a UUID
    @Request() req: { user: User },
  ): Promise<Character> {
    const character = await this.characterService.findCharacterByIdAndUserId(id, req.user.id);
    if (!character) {
      // Ensure users can only fetch their own characters
      throw new NotFoundException(`Character with ID ${id} not found or does not belong to user.`);
    }
    return character;
  }
}