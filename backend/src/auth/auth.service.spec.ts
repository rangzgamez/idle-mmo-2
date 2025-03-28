// backend/src/auth/auth.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { UserService } from '../user/user.service';
import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException } from '@nestjs/common';
import { User } from '../user/user.entity';

// Mock the dependencies
const mockUserService = {
  findOneByUsername: jest.fn(),
  comparePassword: jest.fn(),
};

const mockJwtService = {
  sign: jest.fn(),
};

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(async () => {
    // Reset mocks before each test
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        // Provide the mock implementations
        { provide: UserService, useValue: mockUserService },
        { provide: JwtService, useValue: mockJwtService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('validateUser', () => {
    it('should return user data if validation is successful', async () => {
      const username = 'test';
      const password = 'password';
      const mockUser = { id: 'uuid', username, passwordHash: 'hashed' } as User;

      mockUserService.findOneByUsername.mockResolvedValue(mockUser);
      mockUserService.comparePassword.mockResolvedValue(true);

      const result = await service.validateUser(username, password);

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { passwordHash, ...expectedResult } = mockUser;
      expect(result).toEqual(expectedResult);
      expect(mockUserService.findOneByUsername).toHaveBeenCalledWith(username);
      expect(mockUserService.comparePassword).toHaveBeenCalledWith(password, mockUser.passwordHash);
    });

    it('should return null if user not found', async () => {
        mockUserService.findOneByUsername.mockResolvedValue(null);
        const result = await service.validateUser('test', 'pass');
        expect(result).toBeNull();
    });

    it('should return null if password does not match', async () => {
         const mockUser = { id: 'uuid', username: 'test', passwordHash: 'hashed' } as User;
         mockUserService.findOneByUsername.mockResolvedValue(mockUser);
         mockUserService.comparePassword.mockResolvedValue(false); // Password mismatch
         const result = await service.validateUser('test', 'wrongpass');
         expect(result).toBeNull();
    });
  });

  describe('login', () => {
    it('should return an access token on successful login', async () => {
        const username = 'test';
        const password = 'password';
        const mockUser = { id: 'uuid', username, passwordHash: 'hashed' } as User;
        const mockToken = 'mockAccessToken';

        // Mock validateUser to succeed by mocking its dependencies
         mockUserService.findOneByUsername.mockResolvedValue(mockUser);
         mockUserService.comparePassword.mockResolvedValue(true);
         // Mock JWT signing
         mockJwtService.sign.mockReturnValue(mockToken);


        const result = await service.login({ username, password });

        expect(result).toEqual({ access_token: mockToken });
        expect(mockJwtService.sign).toHaveBeenCalledWith({ username: mockUser.username, sub: mockUser.id });
    });

     it('should throw UnauthorizedException on failed login', async () => {
         const username = 'test';
         const password = 'wrongpassword';

         // Mock validateUser to fail
         mockUserService.findOneByUsername.mockResolvedValue(null); // Or password compare returns false

         await expect(service.login({ username, password })).rejects.toThrow(UnauthorizedException);
         expect(mockJwtService.sign).not.toHaveBeenCalled();
     });
  });
});