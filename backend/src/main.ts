// backend/src/main.ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe, Logger } from '@nestjs/common';
import { GameConfig } from './common/config/game.config';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  
  logger.log('Starting backend server...');
  const app = await NestFactory.create(AppModule);

  // Enable CORS if your frontend is on a different origin (likely)
  app.enableCors({
    origin: GameConfig.SERVER.FRONTEND_URL,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
  });

  // Use global pipes for input validation
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true, // Strip properties that do not have any decorators
    forbidNonWhitelisted: true, // Throw errors if non-whitelisted values are provided
    transform: true, // Automatically transform payloads to DTO instances
  }));
  app.enableShutdownHooks()

  await app.listen(GameConfig.SERVER.PORT);
  const url = await app.getUrl();
  logger.log(`Application is running on: ${url}`);
}
bootstrap();