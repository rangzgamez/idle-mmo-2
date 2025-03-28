// backend/test/auth.e2e-spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from './../src/app.module';
// Import TypeORM utilities if cleaning DB
// import { getRepositoryToken } from '@nestjs/typeorm';
// import { User } from './../src/user/user.entity';
// import { Repository } from 'typeorm';


describe('AuthController (e2e)', () => {
  let app: INestApplication;
  // let userRepository: Repository<User>; // If cleaning DB

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();

    // Get repository instance if cleaning DB
    // userRepository = moduleFixture.get<Repository<User>>(getRepositoryToken(User));
  });

   // Optional: Clean user table before each auth test
   beforeEach(async () => {
       // await userRepository.query(`TRUNCATE TABLE "users" RESTART IDENTITY CASCADE;`); // Example for clearing
   });


  afterAll(async () => {
    await app.close();
  });

  const username = `testuser_${Date.now()}`; // Unique username per run
  const password = 'password123';
  let authToken = '';

  it('/auth/register (POST) - should register a new user', () => {
    return request(app.getHttpServer())
      .post('/auth/register')
      .send({ username, password })
      .expect(201) // Expect HTTP Status 201 Created
      .expect(res => {
        expect(res.body).toHaveProperty('message', 'User registered successfully');
        expect(res.body).toHaveProperty('userId');
      });
  });

   it('/auth/register (POST) - should fail if username exists', async () => {
       // First registration (already tested above, but repeat for clarity if needed)
       await request(app.getHttpServer())
         .post('/auth/register')
         .send({ username, password })
         .expect(201);

       // Attempt second registration with same username
       return request(app.getHttpServer())
         .post('/auth/register')
         .send({ username, password })
         .expect(409); // Expect HTTP Status 409 Conflict
   });

    it('/auth/login (POST) - should login the user and return token', () => {
      return request(app.getHttpServer())
        .post('/auth/login')
        .send({ username, password })
        .expect(201) // Login returns 201 in default NestJS setup
        .expect(res => {
          expect(res.body).toHaveProperty('access_token');
          expect(res.body.access_token).toEqual(expect.any(String));
          authToken = res.body.access_token; // Save token for next test
        });
    });

     it('/auth/login (POST) - should fail with wrong password', () => {
       return request(app.getHttpServer())
         .post('/auth/login')
         .send({ username, password: 'wrongpassword' })
         .expect(401); // Expect HTTP Status 401 Unauthorized
     });

      it('/auth/profile (GET) - should access profile with valid token', () => {
          expect(authToken).not.toBe(''); // Ensure token was acquired
          return request(app.getHttpServer())
              .get('/auth/profile')
              .set('Authorization', `Bearer ${authToken}`) // Set auth header
              .expect(200)
              .expect(res => {
                  expect(res.body).toHaveProperty('id');
                  expect(res.body).toHaveProperty('username', username);
                  expect(res.body).not.toHaveProperty('passwordHash');
              });
      });

       it('/auth/profile (GET) - should fail without token', () => {
           return request(app.getHttpServer())
               .get('/auth/profile')
               .expect(401);
       });
});