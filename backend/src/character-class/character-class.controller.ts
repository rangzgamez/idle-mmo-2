import { Controller, Get } from '@nestjs/common';
import { CharacterClassService } from './character-class.service';
import { CharacterClassTemplate } from './character-class-template.entity';

@Controller('classes') // Route prefix
export class CharacterClassController {
  constructor(private readonly characterClassService: CharacterClassService) {}

  @Get() // Handles GET requests to /classes
  async findAll(): Promise<CharacterClassTemplate[]> {
    // Return only essential info for selection UI?
    // Example: return (await this.characterClassService.findAll()).map(c => ({ classId: c.classId, name: c.name, description: c.description }));
    return this.characterClassService.findAll(); // Return full template for now
  }
} 