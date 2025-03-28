// frontend/vite.config.ts
/// <reference types="vitest" /> // Add this triple-slash directive
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react'; // Or your framework plugin

export default defineConfig({
  plugins: [react()], // Or your framework plugin
  // --- Vitest Configuration ---
  test: {
    globals: true, // Use Jest-compatible globals (describe, it, expect)
    environment: 'jsdom', // Simulate browser environment
    setupFiles: './src/setupTests.ts', // Optional setup file path
    // include: ['src/**/*.{test,spec}.{js,ts,jsx,tsx}'], // Default pattern
  },
  // --------------------------
});