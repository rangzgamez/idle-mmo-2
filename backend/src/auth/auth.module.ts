// backend/src/auth/auth.module.ts
import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { UserModule } from '../user/user.module'; // Import UserModule
import { PassportModule } from '@nestjs/passport';
import { JwtModule } from '@nestjs/jwt';
import { JwtStrategy } from './jwt.strategy'; // We will create this next

// Load environment variables (optional but recommended)
// import { ConfigModule, ConfigService } from '@nestjs/config';

@Module({
  imports: [
    UserModule, // Make UserService available
    PassportModule,
    JwtModule.register({
      // --- Using environment variables (recommended) ---
      // secret: process.env.JWT_SECRET, // Load from .env file
      // signOptions: { expiresIn: process.env.JWT_EXPIRES_IN || '1h' }, // e.g., '60s', '1h', '7d'

      // --- Hardcoded (okay for now, but change later) ---
        global: true,
        secret: 'YOUR_VERY_SECRET_KEY_CHANGE_ME_LATER', // Replace with a strong, secret key! Store in env var.
        signOptions: { expiresIn: '1h' }, // Token expiry time
    }),

    // Optional: If using .env file for secrets
    // ConfigModule.forRoot(), // If not already imported globally
    // JwtModule.registerAsync({
    //   imports: [ConfigModule],
    //   useFactory: async (configService: ConfigService) => ({
    //     secret: configService.get<string>('JWT_SECRET'),
    //     signOptions: { expiresIn: configService.get<string>('JWT_EXPIRES_IN', '1h') },
    //   }),
    //   inject: [ConfigService],
    // }),
  ],
  providers: [AuthService, JwtStrategy], // Add JwtStrategy here
  controllers: [AuthController],
  exports: [AuthService, JwtModule], // Export if other modules need login/validation logic
})
export class AuthModule {}