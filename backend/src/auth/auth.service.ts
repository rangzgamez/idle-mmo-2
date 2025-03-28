// backend/src/auth/auth.service.ts
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UserService } from '../user/user.service';
import { LoginDto } from './dto/login.dto'; // Create this DTO

@Injectable()
export class AuthService {
  constructor(
    private userService: UserService,
    private jwtService: JwtService,
  ) {}

  async validateUser(username: string, pass: string): Promise<any> {
    const user = await this.userService.findOneByUsername(username);
    if (user && (await this.userService.comparePassword(pass, user.passwordHash))) {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { passwordHash, ...result } = user; // Don't include hash in result
      return result;
    }
    return null;
  }

  async login(loginDto: LoginDto) {
    const user = await this.validateUser(loginDto.username, loginDto.password);
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Payload contains the data encoded in the JWT
    // Keep it minimal - just enough to identify the user later
    const payload = { username: user.username, sub: user.id }; // 'sub' (subject) is standard JWT claim for user ID

    return {
      access_token: this.jwtService.sign(payload),
      // You might also include user info here if needed by the frontend immediately after login
      // user: { id: user.id, username: user.username }
    };
  }

  // Registration logic can also live here, or you can keep it separate
  // For separation of concerns, let's call UserService from AuthController for register
}