// backend/src/auth/auth.controller.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { UserService } from '../user/user.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { User } from '../user/user.entity';

// Mock services
const mockAuthService = {
  login: jest.fn(),
};
const mockUserService = {
  createUser: jest.fn(),
};

describe('AuthController', () => {
  let controller: AuthController;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        // Provide mocks for injected services
        { provide: AuthService, useValue: mockAuthService },
        { provide: UserService, useValue: mockUserService },
      ],
    })
    // Mock the Guard if needed, or test with it applied
    .overrideGuard(JwtAuthGuard)
    .useValue({ canActivate: jest.fn(() => true) }) // Simple mock allowing access
    .compile();

    controller = module.get<AuthController>(AuthController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('register', () => {
    it('should call UserService.createUser and return user info', async () => {
      const createUserDto = { username: 'newuser', password: 'password' };
      const createdUser = { id: 'uuid2', username: 'newuser' } as User;
      mockUserService.createUser.mockResolvedValue(createdUser);

      const result = await controller.register(createUserDto);

      expect(mockUserService.createUser).toHaveBeenCalledWith(createUserDto);
      expect(result).toEqual({ message: 'User registered successfully', userId: createdUser.id });
    });
  });

  describe('login', () => {
    it('should call AuthService.login and return the token object', async () => {
      const loginDto = { username: 'test', password: 'password' };
      const tokenObject = { access_token: 'mockToken' };
      mockAuthService.login.mockResolvedValue(tokenObject);

      const result = await controller.login(loginDto);

      expect(mockAuthService.login).toHaveBeenCalledWith(loginDto);
      expect(result).toEqual(tokenObject);
    });
  });

   describe('getProfile', () => {
       it('should return the user object from the request (mocked guard)', async () => {
           const mockUser = { id: 'uuid', username: 'test' }; // User attached by mock guard/strategy
           const mockRequest = { user: mockUser };

           const result = await controller.getProfile(mockRequest); // Pass mock request

           expect(result).toEqual(mockUser);
       });
   });
});