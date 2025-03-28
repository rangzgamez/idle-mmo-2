// backend/src/user/user.service.ts
import { Injectable, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User } from './user.entity';
import { CreateUserDto } from './dto/create-user.dto'; // We'll create this DTO

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
  ) {}

  async createUser(createUserDto: CreateUserDto): Promise<User> {
    const { username, password } = createUserDto;

    // Check if username already exists
    const existingUser = await this.userRepository.findOneBy({ username });
    if (existingUser) {
      throw new ConflictException('Username already exists');
    }

    // Hash the password
    const saltOrRounds = 10; // Recommended salt rounds for bcrypt
    const passwordHash = await bcrypt.hash(password, saltOrRounds);

    // Create and save the new user
    const newUser = this.userRepository.create({
      username,
      passwordHash,
    });

    await this.userRepository.save(newUser);

    // Don't return the password hash in the response
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { passwordHash: _, ...result } = newUser;
    return result as User; // Type assertion might be needed depending on strictness
  }

  async findOneByUsername(username: string): Promise<User | null> {
    return this.userRepository.findOneBy({ username });
  }

  async findOneById(id: string): Promise<User | null> {
    return this.userRepository.findOneBy({ id });
  }

  // Helper to compare passwords (will be used in AuthService)
  async comparePassword(plainPassword: string, hash: string): Promise<boolean> {
    return bcrypt.compare(plainPassword, hash);
  }
}