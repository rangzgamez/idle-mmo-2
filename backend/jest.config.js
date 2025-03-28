// backend/jest.config.js
module.exports = {
    moduleFileExtensions: ['js', 'json', 'ts'], // Files Jest will look for
    rootDir: 'src', // Where your source code lives (relative to this config file)
    testRegex: '.*\\.spec\\.ts$', // Pattern to find test files (files ending in .spec.ts)
    transform: {
      '^.+\\.(t|j)s$': 'ts-jest', // Use ts-jest to transpile TypeScript
    },
    collectCoverageFrom: [ // Define which files to include in coverage reports
      '**/*.(t|j)s',
      // Exclude common non-testable files
      '!main.ts',
      '!**/*.module.ts',
      '!**/*.entity.ts',
      '!**/*.dto.ts',
      '!**/node_modules/**',
      '!**/dist/**',
    ],
    coverageDirectory: '../coverage', // Where to output coverage reports (relative to this config file)
    testEnvironment: 'node', // Environment tests will run in
    moduleNameMapper: { // If using path aliases like @/src/* in tsconfig.json
      '^src/(.*)$': '<rootDir>/$1',
      // Add other aliases if you use them
    },
    // Optional: Setup file for global mocks or setup before tests run
    // setupFilesAfterEnv: ['<rootDir>/../test/setup.ts'], // Example path
    // Optional: Increase timeout for slow tests (e.g., DB interactions)
    // testTimeout: 30000, // 30 seconds
  };