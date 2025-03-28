import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { UserModule } from './user/user.module';
import { AuthModule } from './auth/auth.module';
import { GameGateway } from './game/game.gateway';
import { GameModule } from './game/game.module';
import { CharacterModule } from './character/character.module';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres', // Database type
      host: process.env.DB_HOST || 'localhost', // Your DB host
      port: 5432, // Your DB port
      username: process.env.DB_USERNAME || 'my_mmo_user', // Your DB username
      password: process.env.DB_PASSWORD || 'new_password', // Your DB password
      database: process.env.DB_NAME || 'idle_mmo_db', // Your DB name
      entities: [__dirname + '/**/*.entity{.ts,.js}'], // Auto-discover entities
      // synchronize: true is great for development as it auto-creates tables,
      // but DO NOT use it in production. Use migrations instead.
      synchronize: true, // Set to false in production!
      // logging: true, // Uncomment to see SQL queries
    }),
    UserModule,
    AuthModule,
    GameModule,
    CharacterModule,
    // Add other modules here as you create them
    // AuthModule, UserModule, CharacterModule, GameModule, etc.
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
