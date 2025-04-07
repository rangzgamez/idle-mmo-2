import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CharacterClassTemplate } from './character-class-template.entity';
import { CharacterClass } from '../common/enums/character-class.enum';
import { AttackType } from '../common/enums/attack-type.enum';

@Injectable()
export class CharacterClassService implements OnModuleInit {
  private readonly logger = new Logger(CharacterClassService.name);

  constructor(
    @InjectRepository(CharacterClassTemplate)
    private readonly classTemplateRepository: Repository<CharacterClassTemplate>,
  ) {}

  async onModuleInit() {
    this.logger.log('Seeding character class templates...');
    await this.seedClasses();
  }

  private async seedClasses() {
    const classesToSeed: CharacterClassTemplate[] = [
      {
        classId: CharacterClass.FIGHTER,
        name: 'Fighter',
        description: 'A sturdy warrior adept at close-quarters combat.',
        baseHealth: 150,
        baseAttack: 15,
        baseDefense: 10,
        attackSpeed: 1500,
        attackRange: 50, // Melee range
        attackType: AttackType.MELEE,
        spriteKeyBase: 'Fighter', // Placeholder sprite base
      },
      {
        classId: CharacterClass.ARCHER,
        name: 'Archer',
        description: 'A keen-eyed marksman who attacks enemies from a distance.',
        baseHealth: 100,
        baseAttack: 17,
        baseDefense: 5,
        attackSpeed: 1400,
        attackRange: 250, // Long range
        attackType: AttackType.RANGED,
        spriteKeyBase: 'Archer', // Placeholder sprite base
      },
      {
        classId: CharacterClass.WIZARD,
        name: 'Wizard',
        description: 'A master of arcane energies, unleashing powerful ranged attacks.',
        baseHealth: 90,
        baseAttack: 20,
        baseDefense: 4,
        attackSpeed: 1600,
        attackRange: 200, // Ranged
        attackType: AttackType.RANGED,
        spriteKeyBase: 'Wizard', // Use the base name for provided sprites
      },
      {
        classId: CharacterClass.PRIEST,
        name: 'Priest',
        description: 'A devoted healer who restores the vitality of allies.',
        baseHealth: 110,
        baseAttack: 15, // Represents heal power
        baseDefense: 8,
        attackSpeed: 1800, // Slower 'attack' for heals
        attackRange: 150, // Heal range
        attackType: AttackType.HEAL,
        spriteKeyBase: 'Priest', // Placeholder sprite base
      },
    ];

    for (const templateData of classesToSeed) {
      const existing = await this.classTemplateRepository.findOne({
        where: { classId: templateData.classId },
      });

      if (!existing) {
        this.logger.log(`Creating template for ${templateData.name}...`);
        const newTemplate = this.classTemplateRepository.create(templateData);
        await this.classTemplateRepository.save(newTemplate);
      } else {
        // Optional: Update existing templates if needed, or just log
        this.logger.log(`Template for ${templateData.name} already exists.`);
        // Example update: await this.classTemplateRepository.update({ classId: templateData.classId }, templateData);
      }
    }
    this.logger.log('Character class template seeding complete.');
  }

  // Method to fetch all classes for the character creation screen later
  async findAll(): Promise<CharacterClassTemplate[]> {
      return this.classTemplateRepository.find();
  }

  async findOneByClassId(classId: CharacterClass): Promise<CharacterClassTemplate | null> {
      return this.classTemplateRepository.findOne({ where: { classId } });
  }
} 