// backend/src/user/user.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserService } from './user.service';
import { User } from './user.entity';

@Module({
  imports: [TypeOrmModule.forFeature([User])], // Import User entity repository
  providers: [UserService],
  exports: [UserService], // Export UserService so AuthModule can use it
})
export class UserModule {}