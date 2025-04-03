import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ItemTemplate } from './item.entity';

@Injectable()
export class ItemService {
  constructor(
    @InjectRepository(ItemTemplate)
    private itemTemplateRepository: Repository<ItemTemplate>,
  ) {}

  // Basic CRUD methods will go here later if needed
  // e.g., findById, findAll, create (for admin tools)
  async findTemplateById(id: string): Promise<ItemTemplate | null> {
    return this.itemTemplateRepository.findOneBy({ id });
  }
} 