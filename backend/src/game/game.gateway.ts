// backend/src/game/game.gateway.ts
import {
  WebSocketGateway,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt'; // Import JwtService
import { UserService } from '../user/user.service'; // Import UserService
import { User } from '../user/user.entity'; // Import User entity

@WebSocketGateway({
  cors: { /* ... */ },
})
export class GameGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;
  private logger: Logger = new Logger('GameGateway');

  constructor(
    private jwtService: JwtService, // Inject JwtService
    private userService: UserService, // Inject UserService
  ) {}

  afterInit(server: Server) {
    this.logger.log('WebSocket Gateway Initialized');

    // Socket.IO Middleware for Authentication
    server.use(async (socket: Socket, next) => {
      // Extract token from handshake - Standard way is via auth object
      const token = socket.handshake.auth?.token;
      // Alternative: Extract from query param (less secure)
      // const token = socket.handshake.query?.token as string;

      if (!token) {
        this.logger.error(`Authentication Error: No token provided by ${socket.id}`);
        return next(new UnauthorizedException('Authentication token not provided'));
      }

      try {
        this.logger.log(`Verifying token for ${socket.id}`);
        // Verify the token and decode payload
        const payload = await this.jwtService.verifyAsync(token, {
          // Use the same secret as in AuthModule/JwtStrategy
          secret: 'YOUR_VERY_SECRET_KEY_CHANGE_ME_LATER', // Replace with env var later!
        });

        // Token is valid, fetch user data
        const user = await this.userService.findOneById(payload.sub);

        if (!user) {
          this.logger.error(`Authentication Error: User not found for token sub ${payload.sub}`);
          return next(new UnauthorizedException('User not found'));
        }

        // Attach user to the socket object for later use
        // IMPORTANT: Use socket.data which is the official way in Socket.IO v3/v4
        // Avoid attaching directly like socket.user
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { passwordHash, ...userData } = user; // Exclude sensitive data
        socket.data.user = userData as User; // Store user data without hash

        this.logger.log(`Authentication Successful for ${socket.id}, User: ${user.username}`);
        next(); // Proceed with connection

      } catch (error) {
        this.logger.error(`Authentication Error for ${socket.id}: ${error.message}`);
        // Handle specific errors like TokenExpiredError if needed
        return next(new UnauthorizedException('Authentication failed: ' + error.message));
      }
    });
  }

  handleDisconnect(client: Socket) {
    const username = client.data.user?.username || 'Unknown';
    this.logger.log(`Client disconnected: ${client.id} (${username})`);
    // Clean up user state later (e.g., remove from zone)
    // delete client.data.user; // Clean up data if needed
  }

  // Connection is only established AFTER middleware 'next()' is called
  async handleConnection(client: Socket, ...args: any[]) {
    const username = client.data.user?.username; // Access authenticated user data
    this.logger.log(`Client connected: ${client.id} - User: ${username}`);
    // Proceed with game logic like adding to a lobby or requesting zone entry
  }

  // Example message handler accessing authenticated user
  @SubscribeMessage('messageToServer')
  handleMessage(
    @MessageBody() data: string,
    @ConnectedSocket() client: Socket,
  ): string {
    const user = client.data.user as User; // Get user attached by middleware
    if (!user) {
      // This shouldn't happen if auth middleware is working, but good practice to check
      return 'Error: Not Authenticated';
    }
    this.logger.log(`Message from ${user.username} (${client.id}): ${data}`);
    return `Message received from ${user.username}!`;
  }
}