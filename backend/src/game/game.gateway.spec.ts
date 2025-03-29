import { Test, TestingModule } from '@nestjs/testing';
import { GameGateway } from './game.gateway';
import { JwtService } from '@nestjs/jwt';
import { UserService } from '../user/user.service';
import { CharacterService } from '../character/character.service';
import { ZoneService } from './zone.service';
import { io as Client, Socket as ClientSocket } from 'socket.io-client'; // Import client
import { INestApplication } from '@nestjs/common';
import { User } from '../user/user.entity';
import { Character } from '../character/character.entity';
import { CombatService } from '../game/combat.service';
import { EnemyService } from '../enemy/enemy.service';

// Mocks for services (can be more detailed)
const mockJwtService = { verifyAsync: jest.fn(), sign: jest.fn() };
const mockUserService = { findOneById: jest.fn() };
const mockCharService = { findCharacterByIdAndUserId: jest.fn() };
const mockZoneService = {
    addPlayerToZone: jest.fn(), removePlayerFromZone: jest.fn(),
    getPlayersInZone: jest.fn(), setCharacterTargetPosition: jest.fn(),
    getPlayerCharacters: jest.fn(), getZoneCharacterStates: jest.fn(),
    getEnemy: jest.fn(),
    setEnemyAiState: jest.fn(),
    updateEnemyPosition: jest.fn(),
    updateEnemyHealth: jest.fn(),
};
const mockCombatService = { calculateDamage: jest.fn() };
const mockEnemyService = { findOne: jest.fn(), findAll: jest.fn() };

describe('GameGateway', () => {
    let app: INestApplication;
    let gateway: GameGateway;
    let clientSocket: ClientSocket;
    let testingModule: TestingModule;
    const mockUser = { id: 'user-uuid', username: 'testsock' } as User;
    const mockCharacter = { id: 'char-uuid' } as Character
    const mockToken = 'valid-token';

    beforeAll(async () => {
        // Mock JWT verification to succeed for our test token
        mockJwtService.verifyAsync.mockImplementation(async (token) => {
            if (token === mockToken) return { sub: mockUser.id, username: mockUser.username };
            throw new Error('Invalid token');
        });
        // Mock user service lookup
        mockUserService.findOneById.mockResolvedValue(mockUser);

        testingModule = await Test.createTestingModule({
            providers: [
                GameGateway, // Include the real gateway
                // Provide mocks for its dependencies
                { provide: JwtService, useValue: mockJwtService },
                { provide: UserService, useValue: mockUserService },
                { provide: CharacterService, useValue: mockCharService },
                { provide: ZoneService, useValue: mockZoneService },
                { provide: CombatService, useValue: mockCombatService },
                { provide: EnemyService, useValue: mockEnemyService },
            ],
        }).compile();

        // Create a mini Nest app instance hosting the gateway for the test
        app = testingModule.createNestApplication();
        await app.init();
        await app.listen(3001); // Listen on a different port for tests

        gateway = testingModule.get<GameGateway>(GameGateway); // Get gateway instance if needed
    });

    beforeEach(async () => {
        // Connect a client before each test requiring connection
        const address = app.getHttpServer().address();
        const port = typeof address === 'string' ? parseInt(address.split(':').pop() || '3001', 10) : address?.port || 3001;

        // Connect client with auth token
        clientSocket = Client(`http://localhost:${port}`, {
            auth: { token: mockToken },
            transports: ['websocket'], // Force websocket for tests
            reconnection: false,
        });

        // Wait for connection or error
        await new Promise<void>((resolve, reject) => {
            clientSocket.on('connect', resolve);
            clientSocket.on('connect_error', (err) => {
                console.error("Test client connection error:", err.message);
                reject(err);
            });
            // Timeout if connection takes too long
            setTimeout(() => reject(new Error('Connection timeout')), 3000);
        });

        // Reset mocks that might be called during connection/setup
        jest.clearAllMocks();
        // Re-mock necessary things after clearAllMocks if needed
        mockUserService.findOneById.mockResolvedValue(mockUser); // Ensure user lookup works after clear
    });

    afterEach(() => {
        // Disconnect client after each test
        if (clientSocket?.connected) {
            clientSocket.disconnect();
        }
    });

    afterAll(async () => {
        await app?.close(); // Close the Nest app instance
    });

    it('should allow authenticated client to connect', () => {
        expect(clientSocket.connected).toBe(true);
        // Check if handleConnection was implicitly called (mock it or check logs if needed)
    });

    it('should handle "sendMessage" and broadcast "chatMessage"', (done) => {
        const testMessage = { message: 'Hello test' };
        const expectedPayload = {
            senderName: mockUser.username,
            senderCharacterId: undefined, // Character selection hasn't happened in this simple test
            message: testMessage.message,
            timestamp: expect.any(Number),
        };
        // Mock necessary data on the socket (usually set during enterZone)
        (clientSocket as any).data = { user: mockUser, currentZoneId: 'testZone', selectedCharacters: [] }; // Manually set data for test scope

        // Mock the server broadcast (important!)
        const mockEmit = jest.fn();
        const mockTo = jest.fn().mockReturnValue({ emit: mockEmit });
        (gateway.server as any) = { to: mockTo }; // Replace gateway's server instance with mock

        // Listen for the broadcast on the test client
        clientSocket.on('chatMessage', (payload) => {
            try {
                expect(payload).toMatchObject(expectedPayload);
                expect(mockTo).toHaveBeenCalledWith('testZone');
                expect(mockEmit).toHaveBeenCalledWith('chatMessage', expect.objectContaining(expectedPayload));
                done(); // Signal async test completion
            } catch (error) {
                done(error); // Signal error
            }
        });

        // Emit the message from the client
        clientSocket.emit('sendMessage', testMessage);

        // Add timeout in case broadcast never happens
        setTimeout(() => done(new Error('Timeout waiting for chatMessage broadcast')), 2000);
    });
    // --- New Tests For Added Functionality ----
    it('should handle "attackCommand"', (done) => {
        const targetId = 'target-enemy-id';

        mockZoneService.getEnemy.mockReturnValueOnce({ instanceId: targetId, position: { x: 100, y: 100 } });
        mockZoneService.getPlayerCharacters.mockReturnValue([mockCharacter]);

        clientSocket.on('entityUpdate', (payload) => {
            try {
              done();
            } catch (error) {
                done(error);
            }
        });
        clientSocket.emit('attackCommand', { targetId: targetId });

        setTimeout(() => done(new Error('Timeout waiting for handleAttackCommand')), 2000);

    });
});