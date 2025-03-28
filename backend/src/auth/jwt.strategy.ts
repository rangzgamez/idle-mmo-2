// backend/src/auth/jwt.strategy.ts
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { UserService } from '../user/user.service'; // Make sure UserService is exported from UserModule

// Load environment variables (optional but recommended)
// import { ConfigService } from '@nestjs/config';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private userService: UserService,
    // configService: ConfigService // Inject if using ConfigModule for secret
    ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(), // Extracts token from Authorization header
      ignoreExpiration: false, // Ensure expired tokens are rejected
      // secretOrKey: configService.get<string>('JWT_SECRET'), // Use ConfigService if loading from .env
      secretOrKey: 'YOUR_VERY_SECRET_KEY_CHANGE_ME_LATER', // MUST match the secret in AuthModule! Change later.
    });
  }

  // This method is called by Passport after the token is verified (signature, expiration)
  // The payload is the object we signed in AuthService.login
  async validate(payload: { sub: string; username: string }) {
    // You can add more validation here, e.g., check if user is banned, etc.
    const user = await this.userService.findOneById(payload.sub);
    if (!user) {
      // This should ideally not happen if the JWT was valid unless the user was deleted after token issuance
      throw new UnauthorizedException();
    }
    // The object returned here will be attached to the Request object as `request.user`
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { passwordHash, ...result } = user;
    return result; // Attach user object (without hash) to request
  }
}