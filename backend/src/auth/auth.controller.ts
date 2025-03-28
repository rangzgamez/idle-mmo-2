// backend/src/auth/auth.controller.ts
import { Controller, Post, Body, UseGuards, Request, Get } from '@nestjs/common';
import { AuthService } from './auth.service';
import { UserService } from '../user/user.service';
import { CreateUserDto } from '../user/dto/create-user.dto';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from './jwt-auth.guard'; // We'll create this guard

@Controller('auth') // Base route for this controller
export class AuthController {
  constructor(
    private authService: AuthService,
    private userService: UserService, // Inject UserService for registration
    ) {}

  @Post('register')
  async register(@Body() createUserDto: CreateUserDto) {
    // We use the userService directly here for registration
    // AuthService could also have a register method that calls userService
    const user = await this.userService.createUser(createUserDto);
    // Avoid returning sensitive data like password hash
    // The service already strips the hash, but double-check if needed
    return { message: 'User registered successfully', userId: user.id };
  }

  @Post('login')
  async login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto);
    // Returns { access_token: '...' }
  }

  // Example protected route - requires a valid JWT
  @UseGuards(JwtAuthGuard) // Apply the guard
  @Get('profile')
  getProfile(@Request() req) {
    // req.user is populated by the JwtStrategy.validate() method
    return req.user;
  }
}