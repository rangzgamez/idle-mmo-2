## **Idle Browser MMO - Project Documentation**

**Version:** 0.5 (Combat Basics & AI Refactor Plan)
**Date:** 2023-10-29 (Adjust date)

**1. Overview**

This document outlines the architecture, database schema, and development plan for an Idle Browser MMO game. The game features real-time multiplayer interaction in a top-down view, RTS-style character control with formation movement, automated combat mechanics, and social features like zone-based chat with bubbles.

**2. Core Features (Implemented - v0.4)**

*   **Authentication:** User registration and login (REST API with JWT).
*   **WebSocket Auth:** Secure WebSocket connections using JWT.
*   **Character Management:** Create multiple characters per account (API). Define basic stats (placeholder).
*   **Party Selection:** Select up to 3 active characters per session (Client UI + Server Validation).
*   **Top-Down World:** Players navigate a 2D world. Camera follows the player's party leader. Basic enemy sprites loaded.
*   **RTS-Style Control:** Point-and-click movement commands.
*   **Formation Movement:** Backend calculates triangle formation targets; characters move towards them.
*   **Click Marker:** Visual indicator for movement clicks.
*   **Server-Side Simulation:** Backend simulates character and enemy movement (`GameGateway` loop) and broadcasts updates.
*   **Client-Side Interpolation:** Frontend smoothly interpolates sprites (`CharacterSprite`, `EnemySprite`).
*   **Multiplayer Zones:** Multiple players and enemies inhabit shared zones (`ZoneService`).
*   **Real-time Sync:** Players see others join (`playerJoined`), leave (`playerLeft`), and move/update (`entityUpdate`). New players receive existing enemy state on join.
*   **Chat:** Zone-scoped real-time text chat with chat bubbles.
*   **Enemy Templates:** Defined in database (`Enemy` entity, `EnemyModule`, `EnemyService`).
*   **Enemy Spawning:** Basic timed spawning within zones (`ZoneService`).
*   **Basic Enemy AI (In `GameGateway`, Slated for immediate refactor):**
    *   Aggro: Enemies detect nearby players (`findClosestPlayer`).
    *   Chase: Enemies move towards their target (`MOVE_TO` state implied).
    *   Attack: Enemies trigger combat when in range (`ATTACKING` state).
*   **Basic Combat Resolution (Server-side):**
    *   `CombatService` handles attack logic (`handleAttack`), calculating damage based on basic stats (`calculateDamage`).
    *   Damage applied via `ZoneService` (`updateEnemyHealth`, `updateCharacterHealth`).
    *   Death check and basic handling (`entityDied` event broadcast).
*   **Client Combat Interaction:**
    *   Clicking enemy sprites sends `attackCommand`.
    *   Health bars display on characters and enemies, updated via `entityUpdate`.
    *   Basic attack visuals (tint flash) shown via `combatAction` event.
    *   Sprites are removed on `entityDied` event.

**3. Technology Stack (Unchanged)**

*   **Frontend:** Phaser 3 (TypeScript), Vite
*   **Backend:** NestJS (Node.js / TypeScript)
*   **Real-time Communication:** WebSockets (via Socket.IO library, integrated with NestJS)
*   **API:** RESTful API for Authentication, Character listing, Enemy Template management (Optional).
*   **Database:** PostgreSQL
*   **ORM:** TypeORM
*   **Authentication:** JSON Web Tokens (JWT)

**4. System Architecture Diagram (Conceptual - Refined)**

```
+-------------------+      (HTTPS/REST)       +-------------------------+      +------------+
|                   | <---------------------> |                         | <--> |            |
|   Client Browser  |      (Auth, Char List,  |    NestJS Backend       |      | PostgreSQL |
|   (Phaser.js)     |       Enemy Templates?) |    (Node.js)            |      |  Database  |
|                   |                         |                         | <--> |            |
|                   |      (WSS/WebSockets)   |   - Auth Module         |      +------------+
|                   | <---------------------> |   - User Module         |
|                   |      (Real-time Game   |   - Character Module    |
|                   |       State, Actions,   |   - Enemy Module        |
|                   |       Chat)             |   - Game Module (WS)    |
|                   |                         |     - GameGateway       |
|                   |                         |     - ZoneService       |
|                   |                         |     - CombatService     |
|                   |                         |     - AIService (NEW)   |
|                   |                         |   - Debug Module        |
+-------------------+                         +-------------------------+
```

**5. Backend Module Breakdown (Refined)**

*   `AppModule`: Root module, imports all other modules.
*   `AuthModule`: Handles user registration, login, JWT (global).
*   `UserModule`: Manages user entity (`UserService`). Exports service.
*   `CharacterModule`: Manages character entity (`CharacterService`, `CharacterController`). Exports service.
*   `EnemyModule`: Manages enemy template entity (`EnemyService`, `EnemyController` (optional), `Enemy` entity). Exports service.
*   `GameModule`: Core real-time logic.
    *   `GameGateway`: Handles WebSocket connections, auth middleware, message routing (`enterZone`, `selectParty`, `moveCommand`, `sendMessage`, `attackCommand`). **Orchestrates** the main game loop (`tickGameLoop`), calling `AIService` and `CombatService`. Handles state broadcasting (`entityUpdate`, `chatMessage`, `playerJoined`, `playerLeft`, `combatAction`, `entityDied`). Injects `ZoneService`, `CharacterService`, `EnemyService`, `CombatService`, `AIService`.
    *   `ZoneService`: Manages **runtime state** of *all dynamic entities* (players, enemies, items-TODO) within zones in memory (Maps). Handles adding/removing entities, tracking positions, targets, health, etc. Provides state snapshots and update methods. Contains enemy spawning logic. Injects `EnemyService`.
    *   `CombatService`: Handles combat resolution logic (`handleAttack`, `calculateDamage`). Injects `ZoneService`, `EnemyService`.
    *   `AIService` **(NEW - To be implemented)**: Handles AI decision-making logic (`updateEnemyAI`). Returns AI actions. Injects `ZoneService`, potentially `EnemyService`.
*   `DebugModule` **(NEW)**: Provides endpoints for inspecting runtime state (`/debug/zones`). Injects `ZoneService` (via `GameModule` import).

**6. Frontend Structure Breakdown (Refined)**

*   **`main.tsx`:** Entry point, Phaser config, scene list.
*   **`NetworkManager.ts`:** Singleton for WebSocket communication, event handling, local `EventBus` emission.
*   **`EventBus.ts`:** Simple custom event emitter for intra-client communication.
*   **Scenes:**
    *   `BootScene`, `PreloadScene`, `LoginScene`, `CharacterSelectScene`: Handle setup, asset loading (incl. enemy sprites), auth, party selection.
    *   `GameScene`: Main gameplay area. Manages sprites for all entities (`playerCharacters`, `otherCharacters`, `enemySprites` Maps). Handles network events (`playerJoined`, `playerLeft`, `entityUpdate`, `chatMessage`, `combatAction`, `entityDied`, initial `enemyState` on `enterZone`) to manage sprites. Processes player input (movement, attack clicks). Manages camera. Launches `UIScene`.
    *   `UIScene`: Handles overlay UI elements (Chatbox, potentially health bars if using DOM).
*   **GameObjects:**
    *   `CharacterSprite.ts`: Represents player characters. Handles interpolation, name label, health bar, chat bubbles.
    *   `EnemySprite.ts`: Represents enemies. Handles interpolation, name label, health bar. Set interactive for clicks.
    *   `HealthBar.ts`: Reusable graphics-based health bar component used by sprites.

**7. WebSocket Communication Events (Updated)**

*   **Client -> Server:**
    *   `authenticate` (Implicit via `socket.handshake.auth.token`)
    *   `selectParty` { characterIds: string[] } -> Ack: `{ success: boolean, characters?: CharacterDataWithUsername[] }`
    *   `enterZone` { zoneId: string } -> Ack: `{ success: boolean; zoneState?: ZoneCharacterState[]; enemyState?: EnemyInstance[]; message?: string }` **(Added enemyState)**
    *   `moveCommand` { target: { x: number, y: number } }
    *   `sendMessage` { message: string }
    *   `attackCommand` { targetId: string } **(NEW)**
    *   `teleportPlayer` { x: number, y: number } **(NEW - Debug only)**
*   **Server -> Client:**
    *   `connect_error` (Auth failed or other issue)
    *   `playerJoined` { characters: ZoneCharacterState[] }
    *   `playerLeft` { playerId: string }
    *   `entityUpdate` { updates: Array<{ id: string, x?: number, y?: number, health?: number }> } **(Added health)**
    *   `chatMessage` { senderName: string, senderCharacterId: string, message: string, timestamp: number }
    *   `combatAction` { attackerId: string, targetId: string, damage: number, type: string } **(NEW)**
    *   `entityDied` { entityId: string, type: 'character' | 'enemy' /* | other */ } **(NEW)**

**8. Database Schema (Updated)**

```typescript
// backend/src/character/character.entity.ts
// ... (id, user relation, userId, name, level, xp) ...
  @Column('float', { nullable: true, default: null })
  positionX: number | null; // Persisted last known position

  @Column('float', { nullable: true, default: null })
  positionY: number | null; // Persisted last known position

  @Column({ length: 100, nullable: true, default: null })
  currentZoneId: string | null; // Persisted last known zone

  // --- ADD BASIC STATS (Placeholders for now) ---
  @Column({ type: 'integer', default: 100 })
  baseHealth: number;

  @Column({ type: 'integer', default: 15 })
  baseAttack: number;

  @Column({ type: 'integer', default: 5 })
  baseDefense: number;
// ... (timestamps) ...

// backend/src/enemy/enemy.entity.ts
@Entity()
export class Enemy {
  @PrimaryGeneratedColumn('uuid')
  id: string; // Template ID

  @Column({ length: 100 })
  name: string;

  @Column({ type: 'integer', default: 1 })
  level: number;

  @Column({ type: 'integer', default: 50 })
  baseHealth: number;

  @Column({ type: 'integer', default: 10 })
  baseAttack: number;

  @Column({ type: 'integer', default: 2 })
  baseDefense: number;

  @Column({ type: 'integer', default: 75 }) // Example speed
  baseSpeed: number;

  @Column({ type: 'integer', default: 30 }) // Example range
  attackRange: number;

  @Column({ type: 'integer', default: 10 })
  xpReward: number;

  @Column({ type: 'jsonb', default: { isAggressive: true, isStationary: false, canFlee: false } })
  behaviorFlags: { /* ... flags ... */ };

  @Column({ length: 50, nullable: true })
  lootTableId?: string;

  @Column({ length: 50 })
  spriteKey: string;

  @CreateDateColumn() createdAt: Date;
  @UpdateDateColumn() updatedAt: Date;
}

// backend/src/game/interfaces/enemy-instance.interface.ts
export interface EnemyInstance {
  instanceId: string;
  templateId: string;
  zoneId: string;
  currentHealth: number;
  position: { x: number; y: number };
  target?: { x: number; y: number } | null; // Can be null
  aiState: string; // e.g., "IDLE", "CHASING", "ATTACKING", "COOLDOWN"
  // lastAttackTime?: number; // Needed for cooldowns
}

// backend/src/game/zone.service.ts -> RuntimeCharacterData interface
interface RuntimeCharacterData extends Character {
    targetX: number | null;
    targetY: number | null;
    currentHealth?: number; // Added for runtime tracking
    ownerId?: string; // Added for easier lookup
    // baseDefense?: number; // Add if not inheriting
}
```
*(User, ItemTemplate, InventoryItem, Pet schemas remain unchanged)*

**9. Key Concepts / Reusable Patterns (Updated)**

*   **Entity Runtime State Management (`ZoneService`):** Core responsibility. Holds in-memory `Map`s for players and enemies within zones. State includes position, target, current health, AI state. Distinct from DB persistence.
*   **Service-Based Logic:** Core game mechanics are encapsulated in services:
    *   `CombatService`: Handles attack rules and outcomes.
    *   `AIService` (NEW): Handles entity decision-making based on state and rules.
    *   `ZoneService`: Manages runtime state and zone transitions.
*   **Orchestration (`GameGateway`/`GameLoopService`):** The gateway (or a future dedicated loop service) coordinates the game tick, calling AI and Combat services, and broadcasting state changes based on their results.
*   **Authoritative Server:** The backend dictates all game state (positions, health, AI state). The client only renders this state and sends input commands.
*   **Client-Side Interpolation:** Sprites smoothly move towards `targetX`/`targetY` received from the server (`entityUpdate`).
*   **Event-Driven Updates:** Frontend reacts to specific server events (`entityUpdate`, `combatAction`, `entityDied`, etc.) to update the visual representation.
*   **Component-Based Sprites:** Sprites (`CharacterSprite`, `EnemySprite`) manage their own related visual components (labels, health bars).

**10. Testing Strategy (Unchanged - Paused)**

*   Remains multi-layered (Unit, Integration, E2E) primarily focused on backend (Jest).
*   Frontend unit testing (Vitest/Jest) for utilities. Manual testing for scenes.
*   **Status:** Unit/Integration test implementation is currently paused to prioritize feature development, but the strategy remains defined for later implementation.

**11. Core Real-time Update Flow (Example: Enemy Attack)**

1.  **AI Tick (`AIService` called by `GameGateway.tickGameLoop`):** Checks enemy state, range to players. Determines enemy should attack closest player. Returns `{ type: 'ATTACK', targetEntityId: 'char-uuid-123' }`.
2.  **Loop Execution (`GameGateway.tickGameLoop`):** Receives 'ATTACK' action. Calls `this.combatService.handleAttack('enemy-uuid-456', 'enemy', 'char-uuid-123', 'character', 'zone-id')`.
3.  **Combat Resolution (`CombatService.handleAttack`):**
    *   Fetches attacker (enemy) stats from `EnemyService`/`ZoneService`.
    *   Fetches defender (character) stats/state from `ZoneService`.
    *   Calls `calculateDamage`.
    *   Calls `zoneService.updateCharacterHealth('owner-uuid-abc', 'char-uuid-123', -damage)`.
    *   Checks if character health <= 0.
    *   Returns `CombatResult { damageDealt: 8, targetDied: false, targetCurrentHealth: 92 }`.
4.  **Loop Broadcasting (`GameGateway.tickGameLoop`):**
    *   Receives `CombatResult`.
    *   Emits `combatAction` { attackerId: 'enemy-uuid-456', targetId: 'char-uuid-123', damage: 8, type: 'attack' }.
    *   Adds `{ id: 'char-uuid-123', health: 92 }` to the `updates` array for `entityUpdate`.
    *   (If targetDied was true, would also emit `entityDied`).
5.  **Broadcast:** Gateway sends batched `entityUpdate` and the `combatAction` event to the zone room.
6.  **Client Reception (`NetworkManager`):** Receives events, emits to local `EventBus`.
7.  **Client State Update (`GameScene`):**
    *   `entityUpdate` listener finds character sprite 'char-uuid-123', calls `sprite.setHealth(92)`.
    *   `combatAction` listener finds target sprite 'char-uuid-123', calls visual effect (e.g., `setTintFill`).
8.  **Client Rendering (`update`):** Health bar redraws based on new value. Tint effect plays and clears.

**12. TODO List / Roadmap (Updated)**

**Phase 0-4 (Partially Complete)**
*   Auth, Character Mgmt, Party Select, Movement, Chat: Complete.
*   Basic Enemies & Combat Backend: Implemented (`EnemyEntity`, spawn, `CombatService`).
*   Basic Combat Frontend: Implemented (`EnemySprite`, health bars, attack input/visuals, death handling).

**➡️ Phase 4 Refinement / Immediate Next Steps (AI Refactor):**
1.  [ ] Backend: Create `AIService` within `GameModule` (or new `AIModule`).
2.  [ ] Backend: Define `AIAction` interface (`IDLE`, `MOVE_TO`, `ATTACK`).
3.  [ ] Backend: Move AI decision logic (aggro check, range checks, state determination) from `GameGateway.tickGameLoop` into `AIService.updateEnemyAI`. This method should return an `AIAction`.
4.  [ ] Backend: Refactor `GameGateway.tickGameLoop` within the enemy loop:
    *   Call `aiService.updateEnemyAI`.
    *   Use a `switch` on the returned `AIAction.type` to execute the action:
        *   `IDLE`: Update state via `ZoneService`.
        *   `MOVE_TO`: Update target via `ZoneService`, calculate movement step, update position via `ZoneService`.
        *   `ATTACK`: Call `CombatService.handleAttack`, process result (broadcast `combatAction`, `entityUpdate` health, `entityDied`).
5.  [ ] Backend: Add attack cooldown logic (e.g., add `lastAttackTime` to `EnemyInstance`, check in `AIService` before returning `ATTACK` action).
6.  Testing: (Low priority) Add basic unit tests for `AIService`.

**Phase 5: Inventory, Loot & Equipment (Was Phase 5)**
47. [ ] Backend: Define `ItemTemplate` and `InventoryItem` entities & migrations.
48. [ ] Backend: Implement `InventoryModule` and `InventoryService` (add/remove items).
49. [ ] Backend: Implement `LootService` and configure basic loot tables.
50. [ ] Backend: Trigger loot drops on enemy death (`LootService`). Add `DroppedItem` state to `ZoneService`. Broadcast `itemDropped`.
51. [ ] Backend: Implement `pickupItemCommand` handler (validate range, add to inventory via `InventoryService`, remove from zone). Broadcast `itemPickedUp` and `inventoryUpdate`.
52. [ ] Frontend: Display dropped item sprites based on `itemDropped`.
53. [ ] Frontend: Handle clicking items -> send `pickupItemCommand`. Remove sprite on `itemPickedUp`.
54. [ ] Frontend: Basic Inventory UI (in `UIScene`) to display items from `inventoryUpdate`.
55. [ ] Backend: Add `equippedWeapon`, `equippedArmor` to `Character` entity.
56. [ ] Backend: Implement `equipItem` / `unequipItem` logic in `InventoryService`/`CharacterService`. Broadcast `equipmentUpdate`.
57. [ ] Frontend: Basic Equipment UI (in `UIScene`). Allow equipping/unequipping via drag/drop or buttons. Send commands. Update UI on `equipmentUpdate`.

**Phase 6: Pets**
*   [...] Define Pet entity, AI Service logic, feeding command.

**Refinement / Future TODOs:**
*   [ ] Refactor game loop out of `GameGateway` into a dedicated `GameLoopService`.
*   [ ] Implement Player Character Auto-Attack AI (similar pattern using `AIService`).
*   [ ] Integrate real Character Stats (from DB/`CharacterService`) into `CombatService`.
*   [ ] Persist character position/zone periodically or on logout.
*   [ ] Implement proper Tilemaps and Collision (Frontend & Backend).
*   [ ] More sophisticated movement (Pathfinding).
*   [ ] Different character types/classes (Melee, Ranged, Healer AI).
*   [ ] Proper character/enemy sprites and animations.
*   [ ] Server-side validation (movement, actions).
*   [ ] Scalability considerations (Redis, multiple instances).
*   [ ] Comprehensive Unit and E2E Testing.

**13. Continuing Development Guide (Updated)**

*   **Focus:** Immediately address the "Phase 4 Refinement / Immediate Next Steps" to refactor AI logic into the `AIService`.
*   **Backend:** Run `npm run start:dev`. Create `AIService`. Modify `GameGateway` and potentially `CombatService`/`ZoneService` as needed for the refactor.
*   **Frontend:** Run `npm run dev`. No immediate frontend changes expected during the AI refactor, but keep it running to test the backend changes once complete.
*   **Testing:** Manual testing is primary for now. Use `/debug/zones` and console logs to verify AI behavior changes after refactoring.
*   **Key Files for AI Refactor:**
    *   `backend/src/game/ai.service.ts` (New)
    *   `backend/src/game/interfaces/ai-action.interface.ts` (New)
    *   `backend/src/game/game.gateway.ts` (Modify `tickGameLoop`)
    *   `backend/src/game/combat.service.ts` (Ensure `handleAttack` is robust)
    *   `backend/src/game/zone.service.ts` (Ensure necessary getters/setters exist)
    *   `backend/src/game/game.module.ts` (Add `AIService` to providers/exports)
