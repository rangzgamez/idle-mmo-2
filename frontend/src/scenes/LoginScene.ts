// frontend/src/scenes/LoginScene.ts
import Phaser from 'phaser';
import { NetworkManager } from '../network/NetworkManager'; // Import NetworkManager
import { EventBus } from '../EventBus'; // Import EventBus if needed for listening

export default class LoginScene extends Phaser.Scene {
    private usernameInput!: Phaser.GameObjects.DOMElement;
    private passwordInput!: Phaser.GameObjects.DOMElement;
    private loginButton!: Phaser.GameObjects.DOMElement;
    private registerButton!: Phaser.GameObjects.DOMElement;
    private statusText!: Phaser.GameObjects.Text;

    constructor() {
        super('LoginScene');
    }

    create() {
        console.log('LoginScene create');
        this.cameras.main.setBackgroundColor('#2d2d2d'); // Dark grey background

        const { width, height } = this.sys.game.config;
        const centerW = Number(width) / 2;
        const centerH = Number(height) / 2;

        // --- Create DOM Elements for Input Fields ---
        // Style the inputs using CSS if desired (see explanation below)
        this.usernameInput = this.add.dom(centerW, centerH - 100).createFromHTML(`
            <input type="text" name="username" placeholder="Username" style="width: 250px; padding: 10px; font-size: 16px;">
        `);

        this.passwordInput = this.add.dom(centerW, centerH - 50).createFromHTML(`
            <input type="password" name="password" placeholder="Password" style="width: 250px; padding: 10px; font-size: 16px;">
        `);

        // --- Create DOM Elements for Buttons ---
        this.loginButton = this.add.dom(centerW, centerH + 0).createFromHTML(`
            <button name="login" style="width: 272px; padding: 10px; font-size: 16px;">Login</button>
        `);

        this.registerButton = this.add.dom(centerW, centerH + 50).createFromHTML(`
            <button name="register" style="width: 272px; padding: 10px; font-size: 16px; background-color: #555;">Register</button>
        `);

        // --- Status Text ---
        this.statusText = this.add.text(centerW, centerH + 100, '', { fontSize: '16px', color: '#ff0000', align: 'center' })
            .setOrigin(0.5);

        // --- Add Event Listeners to Buttons ---
        this.loginButton.addListener('click');
        this.loginButton.on('click', () => {
            this.handleLogin();
        });

        this.registerButton.addListener('click');
        this.registerButton.on('click', () => {
            this.handleRegister();
        });

        // Allow pressing Enter in password field to trigger login
        this.passwordInput.addListener('keydown');
        this.passwordInput.on('keydown', (event: KeyboardEvent) => {
            if (event.key === 'Enter') {
                this.handleLogin();
            }
        });

        // Listen for network connection errors (optional, good feedback)
        EventBus.on('network-auth-error', this.handleNetworkError);
    }

    // Cleanup listener on scene shutdown
    shutdown() {
        EventBus.off('network-auth-error', this.handleNetworkError);
    }


    async handleLogin() {
        // Get the container nodes created by Phaser
        const usernameContainer = this.usernameInput.node as HTMLElement;
        const passwordContainer = this.passwordInput.node as HTMLElement;

        // Find the actual <input> elements *within* their containers
        const usernameElement = usernameContainer.querySelector('input[name="username"]') as HTMLInputElement | null;
        const passwordElement = passwordContainer.querySelector('input[name="password"]') as HTMLInputElement | null;

        // --- Add Checks ---
        if (!usernameElement || !passwordElement) {
            console.error('Could not find input elements within DOM containers.');
            this.setStatus('Internal error retrieving input fields.', true);
            this.enableInputs(); // Re-enable inputs on error
            return;
        }
        const username = usernameElement.value.trim();
        const password = passwordElement.value.trim();

        if (!username || !password) {
            this.setStatus('Please enter username and password.', true);
            return;
        }

        this.setStatus('Logging in...', false);
        this.disableInputs();

        try {
            const response = await fetch('http://localhost:3000/auth/login', //'http://141.155.171.22:3000/auth/login', 
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password }),
            });

            const data = await response.json(); // Always parse JSON response

            if (!response.ok) {
                // Use error message from backend if available
                throw new Error(data.message || `Login failed (Status: ${response.status})`);
            }

            const token = data.access_token;

            if (token) {
                console.log('Login successful, received token.');
                localStorage.setItem('jwtToken', token); // Store the token

                // Attempt WebSocket connection
                this.setStatus('Connecting...', false);
                NetworkManager.getInstance().connect(token);
                console.log('LoginScene: NetworkManager.connect() called. Registering listeners...'); // Add this
                // Listen for successful connection before changing scene
                // Add a listener for generic network errors too
                EventBus.once('network-error', (errorMessage: string) => {
                    console.error('LoginScene: Received "network-error" event:', errorMessage);
                    this.setStatus(errorMessage, true);
                    this.enableInputs();
                    localStorage.removeItem('jwtToken'); // Clear token on connection failure
                });

                EventBus.once('network-auth-error', (errorMessage: string) => {
                    // This listener already exists, just double-check console log
                    console.error('LoginScene: Received "network-auth-error" event:', errorMessage);
                    this.setStatus(`Connection failed: ${errorMessage}`, true);
                    this.enableInputs();
                    localStorage.removeItem('jwtToken');
                });

                EventBus.once('network-connect', () => {
                    // This is the success path
                    console.log('>>> LoginScene: Received "network-connect" event via EventBus. Starting CharacterSelectScene.'); // Make this obvious
                    this.setStatus('');
                    this.scene.start('CharacterSelectScene');
                });
                // Handle connection error specifically (handled by 'network-auth-error' listener)

            } else {
                throw new Error('Token not received from server.');
            }

        } catch (error: any) {
            console.error('Login Error:', error);
            this.setStatus(error.message || 'An error occurred during login.', true);
            this.enableInputs();
        }
    }

    async handleRegister() {
        // Get the container nodes created by Phaser
        const usernameContainer = this.usernameInput.node as HTMLElement;
        const passwordContainer = this.passwordInput.node as HTMLElement;

        // Find the actual <input> elements *within* their containers
        const usernameElement = usernameContainer.querySelector('input[name="username"]') as HTMLInputElement | null;
        const passwordElement = passwordContainer.querySelector('input[name="password"]') as HTMLInputElement | null;

        // --- Add Checks ---
        if (!usernameElement || !passwordElement) {
            console.error('Could not find input elements within DOM containers.');
            this.setStatus('Internal error retrieving input fields.', true);
            this.enableInputs(); // Re-enable inputs on error
            return;
        }
        const username = usernameElement.value.trim();
        const password = passwordElement.value.trim();

        if (!username || !password) {
            this.setStatus('Please enter username and password to register.', true);
            return;
        }
         if (password.length < 6) {
             this.setStatus('Password must be at least 6 characters long.', true);
             return;
         }

        this.setStatus('Registering...', false);
        this.disableInputs();

        try {
            const response = await fetch('http://localhost:3000/auth/register', //'http://141.155.171.22:3000/auth/login', 
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password }),
            });

            const data = await response.json(); // Always parse JSON response

            if (!response.ok) {
                 // Use error message from backend if available (e.g., username exists)
                throw new Error(data.message || `Registration failed (Status: ${response.status})`);
            }

            this.setStatus('Registration successful! Please log in.', false);
            this.enableInputs();
            // Optionally clear fields or focus username
            // usernameElement.value = '';
            passwordElement.value = '';


        } catch (error: any) {
            console.error('Registration Error:', error);
            this.setStatus(error.message || 'An error occurred during registration.', true);
            this.enableInputs();
        }
    }

    handleNetworkError(errorMessage: string) {
        // Received if WebSocket connection fails due to auth
        console.error('Network Auth Error:', errorMessage);
        this.setStatus(`Connection failed: ${errorMessage}`, true);
        this.enableInputs();
        localStorage.removeItem('jwtToken'); // Clear potentially bad token
    }

    setStatus(message: string, isError: boolean = false) {
        this.statusText.setText(message);
        this.statusText.setColor(isError ? '#ff0000' : '#00ff00'); // Red for error, green for success/info
    }

    disableInputs() {
        (this.usernameInput.node as HTMLInputElement).disabled = true;
        (this.passwordInput.node as HTMLInputElement).disabled = true;
        (this.loginButton.node as HTMLButtonElement).disabled = true;
        (this.registerButton.node as HTMLButtonElement).disabled = true;
    }

    enableInputs() {
        (this.usernameInput.node as HTMLInputElement).disabled = false;
        (this.passwordInput.node as HTMLInputElement).disabled = false;
        (this.loginButton.node as HTMLButtonElement).disabled = false;
        (this.registerButton.node as HTMLButtonElement).disabled = false;
    }
}