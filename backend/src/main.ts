// backend/src/main.ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common'; // Import ValidationPipe

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Enable CORS if your frontend is on a different origin (likely)
  app.enableCors({
    origin: 'http://localhost:5173', // Your frontend URL (adjust if different)
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
  });

  // Use global pipes for input validation
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true, // Strip properties that do not have any decorators
    forbidNonWhitelisted: true, // Throw errors if non-whitelisted values are provided
    transform: true, // Automatically transform payloads to DTO instances
  }));


  await app.listen(3000); // Backend runs on port 3000 by default
  console.log(`Application is running on: ${await app.getUrl()}`);
}
bootstrap();