# Configuration System

This directory contains centralized configuration and constants for the idle MMO backend.

## Files

### `config/game.config.ts`
Contains all game configuration values that were previously hardcoded as magic numbers:

- **Server settings**: Port, CORS origins
- **Character system**: Spawn positions, respawn times, health regen, combat stats
- **Experience system**: XP curves, level-up bonuses
- **Inventory system**: Size, pickup ranges
- **Security**: Bcrypt salt rounds, JWT secrets
- **Game loop**: Tick rates, movement precision

All values can be overridden via environment variables for different deployment environments.

### `constants/states.constants.ts`
Type-safe string constants for:
- Character states (`idle`, `moving`, `attacking`, etc.)
- Enemy AI states (`IDLE`, `CHASING`, `ATTACKING`, etc.)
- AI action types (`ATTACK`, `MOVE_TO`, `IDLE`, etc.)
- Command states for multi-step actions

### `constants/events.constants.ts` 
WebSocket event name constants to prevent typos:
- Client-to-server events (`selectParty`, `moveCommand`, etc.)
- Server-to-client events (`entityUpdate`, `combatAction`, etc.)
- Combat action types (`attack`, `heal`, `crit`, `miss`)
- Entity types (`character`, `enemy`)

### `constants/index.ts`
Barrel export file for easy importing

## Usage

```typescript
// Import config values
import { GameConfig } from '../common/config/game.config';

// Use instead of magic numbers
private readonly RESPAWN_TIME_MS = GameConfig.CHARACTER.RESPAWN_TIME_MS;

// Import constants
import { CharacterStates, SocketEvents } from '../common/constants';

// Use instead of string literals
if (character.state === CharacterStates.IDLE) {
  socket.emit(SocketEvents.SERVER_TO_CLIENT.ENTITY_UPDATE, data);
}
```

## Environment Variables

Override any config value in production:

```bash
# Server
PORT=3001
FRONTEND_URL=https://your-game.com

# Game balance
RESPAWN_TIME_MS=3000
INVENTORY_SIZE=300
BASE_XP=150

# Security (REQUIRED in production)
JWT_SECRET=your-secure-secret-key
BCRYPT_SALT_ROUNDS=12
```

## Benefits

1. **Centralized**: All config in one place instead of scattered magic numbers
2. **Type-safe**: TypeScript ensures correct usage
3. **Environment-aware**: Easy to adjust for dev/staging/production
4. **No typos**: Constants prevent string literal mistakes
5. **Discoverable**: Easy to find all configurable values
6. **Maintainable**: Change game balance without hunting through code