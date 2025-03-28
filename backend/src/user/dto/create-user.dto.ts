// backend/src/user/dto/create-user.dto.ts
import { IsString, MinLength, MaxLength } from 'class-validator'; // Need to install class-validator and class-transformer

export class CreateUserDto {
  @IsString()
  @MinLength(3)
  @MaxLength(50)
  username: string;

  @IsString()
  @MinLength(6) // Enforce a minimum password length
  password: string;
}