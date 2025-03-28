// Example: frontend/src/network/NetworkManager.spec.ts
import { NetworkManager } from './NetworkManager';
import { EventBus } from '../EventBus';
import { io } from 'socket.io-client';

// Mock dependencies
jest.mock('socket.io-client'); // Auto-mocks the library
jest.mock('../EventBus');     // Auto-mocks EventBus

describe('NetworkManager', () => {
    let manager: NetworkManager;
    let mockSocket: any; // Type more strictly if needed
    const mockToken = 'test-token';

    beforeEach(() => {
        // Reset mocks
        jest.clearAllMocks();

        // Setup mock socket instance behavior
        mockSocket = {
            on: jest.fn(),
            emit: jest.fn(),
            disconnect: jest.fn(),
            connected: false, // Initial state
            // Mock other methods/properties if needed by NetworkManager
        };
        (io as jest.Mock).mockReturnValue(mockSocket); // Make io() return our mock

        manager = NetworkManager.getInstance(); // Get singleton instance
    });

     // Ensure singleton resets between tests if needed, or test differently
     afterEach(() => {
         // Reset singleton instance state if necessary for isolation
         (NetworkManager as any).instance = null;
         if(mockSocket.connected) manager.disconnect(); // Clean up connection state
     });


    it('should create a socket connection with auth', () => {
        manager.connect(mockToken);
        expect(io).toHaveBeenCalledWith('ws://localhost:3000', {
            auth: { token: mockToken },
            // ... other options if specified
        });
        expect(mockSocket.on).toHaveBeenCalledWith('connect', expect.any(Function));
        expect(mockSocket.on).toHaveBeenCalledWith('disconnect', expect.any(Function));
        // ... check other listeners are attached
    });

     it('should emit message if connected', () => {
         manager.connect(mockToken);
         mockSocket.connected = true; // Simulate connection for this test
         const eventName = 'testEvent';
         const data = { foo: 'bar' };

         manager.sendMessage(eventName, data);

         expect(mockSocket.emit).toHaveBeenCalledWith(eventName, data);
     });

     it('should NOT emit message if not connected', () => {
         mockSocket.connected = false;
         manager.sendMessage('testEvent', {});
         expect(mockSocket.emit).not.toHaveBeenCalled();
     });

     // Test event emission via EventBus when socket receives message
     it('should emit EventBus event when socket receives chatMessage', () => {
         manager.connect(mockToken);
         // Find the callback passed to socket.on('chatMessage')
         const chatCallback = mockSocket.on.mock.calls.find((call: any) => call[0] === 'chatMessage')[1];
         const chatData = { senderName: 'test', message: 'hi' };

         chatCallback(chatData); // Manually trigger the callback

         expect(EventBus.emit).toHaveBeenCalledWith('chat-message-received', chatData);
     });

     // ... more tests for connect_error, disconnect, isConnected ...
});