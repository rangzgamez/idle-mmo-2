## **Idle Browser MMO - Project Documentation**

**Version:** 0.3 (Refined for Extensibility)
**Date:** 2023-10-28 (Adjust date)

**1. Overview**

This document outlines the architecture, database schema, and development plan for an Idle Browser MMO game. The game features real-time multiplayer interaction in a top-down view, RTS-style character control with formation movement, automated combat mechanics (planned), and social features like zone-based chat with bubbles.

**2. Core Features (Implemented - v0.2)**

*   **Authentication:** User registration and login (REST API with JWT).
*   **WebSocket Auth:** Secure WebSocket connections using JWT.
*   **Character Management:** Create multiple characters per account (API).
*   **Party Selection:** Select up to 3 active characters per session (Client UI + Server Validation).
*   **Top-Down World:** Players navigate a 2D world (currently basic colored background). Camera follows the player's party leader.
*   **RTS-Style Control:** Point-and-click movement commands.
*   **Formation Movement:** Clicking sends a target anchor; the backend calculates individual destinations for the party (up to 3) in a triangle formation. Characters move towards these points.
*   **Click Marker:** Visual indicator appears at the click location and fades out, disappearing early if the party arrives near the anchor point.
*   **Server-Side Movement:** Backend simulates character movement towards targets (`GameGateway` loop) and broadcasts updated positions.
*   **Client-Side Interpolation:** Frontend smoothly interpolates character sprites towards server-provided positions (`CharacterSprite`).
*   **Multiplayer Zones:** Multiple players can inhabit the same zone (`ZoneService` manages state).
*   **Real-time Sync:** Players see each other join (`playerJoined`), leave (`playerLeft`), and move (`entityUpdate`).
*   **Chat:**
    *   Zone-scoped real-time text chat.
    *   Input via UI or pressing Enter key globally.
    *   Messages broadcast only to players in the same zone.
    *   Chat Bubbles appear above the speaking character (leader of the party), stack vertically, follow the character, and fade out individually.

**3. Technology Stack (Unchanged)**

*   **Frontend:** Phaser 3 (TypeScript), Vite
*   **Backend:** NestJS (Node.js / TypeScript)
*   **Real-time Communication:** WebSockets (via Socket.IO library, integrated with NestJS)
*   **API:** RESTful API for Authentication and Character listing.
*   **Database:** PostgreSQL
*   **ORM:** TypeORM
*   **Authentication:** JSON Web Tokens (JWT)

**4. System Architecture Diagram (Conceptual - Unchanged)**

```
+-------------------+      (HTTPS/REST)       +----------------------+      +------------+
|                   | <---------------------> |                      | <--> |            |
|   Client Browser  |      (Auth, Char List)  |   NestJS Backend     |      | PostgreSQL |
|   (Phaser.js)     |                         |   (Node.js)          |      |  Database  |
|                   |      (WSS/WebSockets)   |                      | <--> |            |
|                   | <---------------------> |  - Auth Module       |      +------------+
|                   |      (Real-time Game   |  - User Module       |
|                   |       State, Actions,   |  - Character Module  |
|                   |       Chat)             |  - Game Module (WS)  |
|                   |                         |    - GameGateway     |
|                   |                         |    - ZoneService     |
|                   |                         |  - ... Other Modules |
+-------------------+                         +----------------------+
```

**5. Backend Module Breakdown (Refined)**

*   `AppModule`: Root module.
*   `AuthModule`: Handles user registration, login, JWT (global).
*   `UserModule`: Manages user entity (`UserService`). Exports service.
*   `CharacterModule`: Manages character entity (`CharacterService`, `CharacterController`), handles CRUD via REST. Exports service.
*   `GameModule`: Core real-time logic.
    *   `GameGateway`: Handles WebSocket connections, auth middleware, message routing (`enterZone`, `selectParty`, `moveCommand`, `sendMessage`), basic simulation loop (`tickGameLoop` for movement updates, AI ticks - TODO), state broadcasting (`entityUpdate`, `chatMessage`, etc.). Injects `ZoneService`, `CharacterService`. *(Note: Game loop logic may be refactored to a dedicated service later)*.
    *   `ZoneService`: Manages **runtime state** of *all dynamic entities* within zones (players, enemies-TODO, items-TODO) in memory. Handles adding/removing entities, tracking positions, targets, health (TODO), AI state (TODO). Provides state snapshots and update methods to `GameGateway`. *(Note: Separates runtime state from database persistence)*.
*   *(Chat logic currently resides within `GameGateway`)*

**6. Frontend Structure Breakdown (Refined)**

*   **`main.tsx`:** Entry point, Phaser config, scene list.
*   **`NetworkManager.ts`:** Singleton for WebSocket communication, event handling, local `EventBus` emission.
*   **`EventBus.ts`:** Simple custom event emitter for intra-client communication.
*   **Scenes:**
    *   `BootScene`, `PreloadScene`, `LoginScene`, `CharacterSelectScene`: Handle initial setup, auth, and party selection.
    *   `GameScene`: Main gameplay area. Manages display objects/sprites for **all entities** (players, enemies-TODO, items-TODO) using Maps keyed by entity ID. Handles network events (`playerJoined`, `playerLeft`, `entityUpdate`, `chatMessage`) to create/update/destroy sprites. Processes player input (movement, targeting-TODO). Launches/Stops `UIScene`. Contains the main Phaser `update` loop triggering sprite updates. Manages camera.
    *   `UIScene`: Runs parallel to `GameScene`. Handles overlay UI elements (Chatbox currently) using Phaser DOM elements. Listens for specific `EventBus` events.
*   **GameObjects:**
    *   `CharacterSprite.ts`: Represents player and other player characters. Extends `Phaser.GameObjects.Sprite`. Includes physics body (basic). Handles position interpolation, name label display, chat bubble management. *(Note: This serves as a template for other entity sprites like `EnemySprite`)*.

**7. WebSocket Communication Events (Updated)**

*   **Client -> Server:**
    *   `authenticate` (Implicit via `socket.handshake.auth.token` on connection)
    *   `selectParty` { characterIds: string[] } -> Ack: `{ success: boolean, characters?: CharacterDataWithUsername[] }`
    *   `enterZone` { zoneId: string } -> Ack: `{ success: boolean; zoneState?: ZoneCharacterState[]; message?: string }`
    *   `moveCommand` { target: { x: number, y: number } }
    *   `sendMessage` { message: string }
*   **Server -> Client:**
    *   `connect_error` (Auth failed or other connection issue)
    *   `playerJoined` { characters: ZoneCharacterState[] } // Characters of the player who joined
    *   `playerLeft` { playerId: string } // User ID of the player who left
    *   `entityUpdate` { updates: Array<{ id: string, x?: number, y?: number, /* health?, state? */ }> } // Batched updates
    *   `chatMessage` { senderName: string, senderCharacterId: string, message: string, timestamp: number }

**8. Database Schema (Updated)**

```typescript
// backend/src/character/character.entity.ts
// ... (id, user relation, userId, name, level, xp) ...
  @Column('float', { nullable: true, default: null })
  positionX: number | null; // Persisted position (updated periodically/on logout - TODO)

  @Column('float', { nullable: true, default: null })
  positionY: number | null; // Persisted position

  @Column({ length: 100, nullable: true, default: null })
  currentZoneId: string | null; // Persisted zone (updated periodically/on logout - TODO)
// ... (timestamps) ...
```
*(User, ItemTemplate, InventoryItem, Pet schemas remain the same for now)*

**⭐ 9. Key Concepts / Reusable Patterns (NEW SECTION) ⭐**

This section highlights established patterns intended for reuse across different features (like Enemies, Pets, etc.).

*   **Entity Runtime State Management (`ZoneService`):**
    *   `ZoneService` uses in-memory `Map` structures to hold the *current* state of dynamic entities within each active zone (e.g., `zone.players: Map<userId, PlayerInZone>`, `zone.enemies: Map<instanceId, EnemyInstance>`).
    *   This runtime state (position, target coordinates, current health, AI state) is distinct from the persisted database state (base stats, level, inventory). Runtime state is lost on server restart.
    *   Provides methods to add/remove entities, update specific properties (like target position), and retrieve state snapshots for broadcasting.
    *   *Extension:* Use similar Maps and interfaces in `ZoneService` to manage `EnemyInstance` or `DroppedItem` states.

*   **Server-Side Simulation Loop (`GameGateway.tickGameLoop` / Future Service):**
    *   A fixed-interval loop (`setInterval`) iterates through active zones and entities.
    *   Uses `deltaTime` for consistent calculations regardless of minor timing fluctuations.
    *   Reads the current state and target state from `ZoneService` (e.g., current position vs target position, current AI state).
    *   Performs simulation steps (e.g., calculate movement vector towards target based on speed, execute AI state transitions/actions).
    *   Updates the runtime state via `ZoneService` methods (e.g., update current position).
    *   Collects relevant state changes for broadcasting.
    *   *Extension:* Add Enemy AI logic (state checks, target acquisition, attack triggers) and combat resolution ticks within this loop.

*   **Client-Side State Synchronization (`NetworkManager` -> `EventBus` -> `GameScene`):**
    *   Server broadcasts batched state changes (`entityUpdate`) containing only necessary data (ID, changed properties like x, y, health).
    *   `NetworkManager` receives raw WebSocket events.
    *   `NetworkManager` emits specific, local `EventBus` events (e.g., `'entity-update'`).
    *   `GameScene` listens for `EventBus` events. On receive, it finds the corresponding sprite using the entity ID from its maps (`playerCharacters`, `otherCharacters`, `enemySprites`).
    *   `GameScene` **does not** directly set sprite properties like `x`, `y`. Instead, it calls methods on the sprite object (e.g., `sprite.updateTargetPosition(x, y)`, `sprite.updateHealth(h)`).
    *   *Extension:* Use the same `entityUpdate` event (or new specific events) for enemy state changes (position, health). `GameScene` handles these similarly, finding the `EnemySprite` and calling its update methods.

*   **Client-Side Interpolation (Entity Sprites - `CharacterSprite`, `EnemySprite`):**
    *   Sprite classes store both current rendered position (`this.x`, `this.y`) and target position (`this.targetX`, `this.targetY` - updated by `GameScene` based on network events).
    *   The sprite's `update(time, delta)` method (called by `GameScene.update`) uses `Phaser.Math.Linear` (lerp) or similar functions to smoothly move `this.x`, `this.y` towards `this.targetX`, `this.targetY` over time. This decouples rendering framerate from network update rate.
    *   *Extension:* Implement `EnemySprite` using the exact same interpolation pattern.

*   **Visual Components Attached to Sprites (Entity Sprites):**
    *   UI elements directly related to an entity (Name Labels, Health Bars-TODO, Chat Bubbles) are best managed *within* the entity's sprite class (`CharacterSprite`).
    *   These components are created/destroyed along with the sprite.
    *   Their positions are updated relative to the sprite's interpolated `x`, `y` within the sprite's `update` method.
    *   *Extension:* Add Health Bars to `CharacterSprite` and `EnemySprite`. `EnemySprite` might have different label styling.

**10. Core Real-time Update Flow (e.g., Movement - Refined)**

1.  **Input/Trigger:** `GameScene` detects player input OR `GameGateway` loop triggers AI decision.
2.  **Command/Intent:** `GameScene` sends command (`moveCommand`) OR `GameGateway` determines AI intent (e.g., move enemy X towards player Y).
3.  **State Update (Target/Action):** `GameGateway` receives command/determines intent. Calculates necessary state changes (e.g., new target coordinates for affected entities). Updates the **runtime target state** via `ZoneService` (e.g., `zoneService.setCharacterTargetPosition(...)`, `zoneService.setEnemyTarget(...)`).
4.  **Simulation Tick (`tickGameLoop`):** Loop reads current position and target position for entities from `ZoneService`. Calculates movement step based on speed/deltaTime. Updates the **runtime current position** via `ZoneService` (directly modifying the in-memory object or using an update method).
5.  **Broadcast:** Loop collects updated current positions (and other changes like health). `GameGateway` broadcasts batched `entityUpdate` { updates: [{ id, x, y, health? }, ...] } to the relevant zone room.
6.  **Client Reception:** `NetworkManager` receives `entityUpdate`. Emits local `EventBus` event `'entity-update'`.
7.  **Client State Update:** `GameScene` listener receives event data. Finds corresponding Sprite (Player, Enemy) by ID. Calls method on sprite (e.g., `sprite.updateTargetPosition(x, y)`, `sprite.setHealth(h)`).
8.  **Client Rendering (`update`):** Sprite's `update` method interpolates its visual `x, y` towards its `targetX, targetY`. Attached components (labels, health bars, bubbles) update their positions relative to the sprite's interpolated `x, y`.

**11. TODO List / Roadmap (Updated with Refinements)**

**Phase 0-3 (Complete)**

**➡️ Phase 4: Basic Combat & Enemies (Next Steps)**
1.  [ ] Backend: Define `EnemyTemplate` interface/object (stats, behavior flags, loot ref).
2.  [ ] Backend: Enhance `ZoneService` to manage `EnemyInstance` state *similarly to PlayerInZone* (Map keyed by instanceId, holding runtime data: templateId, health, pos, target, AI state).
3.  [ ] Backend: Implement basic enemy spawning logic (timed/location based) in `ZoneService` or `EnemyService`. Broadcast spawn (`enemySpawned` event or use `entityUpdate` with type field).
4.  [ ] Frontend: Create `EnemySprite` class *similar to CharacterSprite*, handling interpolation, maybe different visual style/label.
5.  [ ] Frontend: Handle enemy spawn/update events in `GameScene` to manage `EnemySprite` instances *like other entities*. Add an `enemySprites` Map.
6.  [ ] Backend: Implement basic `CombatService` (e.g., `calculateDamage(attackerStats, defenderStats)`).
7.  [ ] Backend: Enhance `AIService` or `tickGameLoop`:
    *   Enemy Aggro logic (distance check).
    *   Enemy Movement *using target updates via ZoneService*.
    *   Enemy Attack logic (trigger `CombatService` on timer/cooldown if in range). Define basic AI states (Idle, Chasing, Attacking).
8.  [ ] Backend: Handle `attackCommand` from client -> set player character's target/state via `ZoneService`.
9.  [ ] Backend: Implement Character Auto-Attack AI -> check state/target, trigger `CombatService`, update target/position via `ZoneService`.
10. [ ] Backend: Broadcast `combatAction` (attackerId, targetId, damage) & health updates (`entityUpdate`). Handle death via `entityDied` (entityId, type).
11. [ ] Frontend: Handle `attackCommand` input (click on enemy sprite).
12. [ ] Frontend: Implement/Add Health Bars to `CharacterSprite` and `EnemySprite`, updated via `entityUpdate`.
13. [ ] Frontend: Show basic attack visuals on `combatAction`.
14. [ ] Frontend: Handle `entityDied` (remove sprite, show effect).

**Phase 5: Inventory, Loot & Equipment (Was Phase 5)**
*   [...] Define Item entities, LootService, pickup command/logic, basic UI.

**Phase 6: Pets (Was Phase 6)**
*   [...] Define Pet entity, AI Service logic, feeding command.

**Refinement / Future TODOs:**
*   [ ] Refactor game loop out of `GameGateway` into a dedicated service.
*   [ ] Persist character position/zone periodically or on logout/zone change.
*   [ ] Implement proper Tilemaps and Collision on frontend & backend validation.
*   [ ] More sophisticated movement (Pathfinding using libraries like `easystarjs`).
*   [ ] Add character stats (HP, Attack, Defense, Speed etc.) to entities and combat calculations.
*   [ ] Add different character types/classes (Melee, Ranged, Healer AI).
*   [ ] Proper character/enemy sprites and animations.
*   [ ] Click-and-drag selection for controlling individual characters.
*   [ ] More robust error handling and user feedback.
*   [ ] Server-side validation of movement distance/speed to prevent cheating.
*   [ ] Scalability considerations (multiple zones, potentially multiple server instances with Redis).
*   [ ] Unit and End-to-End testing.

---

## **Continuing Development Guide (v0.2)**

This guide helps developers understand the current state and continue working on the Idle Browser MMO project. Reference Section 9: Key Concepts / Reusable Patterns in the main documentation when implementing new features like enemies

**1. Current Status:**
*   The project has functional user authentication (REST + WebSockets).
*   Players can create characters and select a party of up to 3.
*   Players enter a shared zone, see each other, and can move their party in formation by clicking.
*   Movement is simulated server-side and interpolated client-side.
*   Zone-based chat with chat bubbles above characters is implemented.
*   Refer to the main documentation (above) for detailed feature list, architecture, and updated TODO list.

**2. Core Development Loop:**
*   **Backend:** Run `npm run start:dev` in the `backend` directory. Uses NestJS CLI with watch mode. Changes should auto-reload.
*   **Frontend:** Run `npm run dev` in the `frontend` directory. Uses Vite dev server with HMR. Changes often reflect without full reload.
*   **Database:** Assumes PostgreSQL is running and accessible with credentials configured (currently hardcoded/env vars in `backend/src/app.module.ts` via `TypeOrmModule.forRoot`). `synchronize: true` is enabled for development (auto-updates schema based on entities).

**3. Key Modules/Files for Common Tasks:**

*   **Adding REST API Endpoints:** Look at `CharacterController` / `AuthController` and their corresponding Services/Modules. Use NestJS CLI (`nest generate controller/service/module`).
*   **Adding WebSocket Events:**
    *   Define `@SubscribeMessage('eventName')` handler in `GameGateway` (`backend/src/game/game.gateway.ts`).
    *   Inject necessary services (`ZoneService`, `CharacterService`, etc.) into `GameGateway`.
    *   Send messages from client using `NetworkManager.getInstance().sendMessage('eventName', payload)`.
    *   Listen for server broadcasts on client using `socket.on('eventName', handler)` within `NetworkManager.connect`, emitting local `EventBus` events.
    *   Handle `EventBus` events in relevant Phaser Scenes (usually `GameScene` or `UIScene`).
*   **Real-time State Management:** `ZoneService` (`backend/src/game/zone.service.ts`) holds the in-memory state of players/characters/enemies per zone. Modify this service to track new entities or properties.
*   **Game Loop / Simulation:** Basic loop is in `GameGateway.tickGameLoop`. Movement simulation happens here. Combat/AI ticks will likely go here too (consider refactoring to a dedicated service later).
*   **Client-side Visuals:**
    *   Sprites: `CharacterSprite` (`frontend/src/gameobjects/CharacterSprite.ts`). Add new sprite types here.
    *   Rendering/Scene Logic: `GameScene` (`frontend/src/scenes/GameScene.ts`). Handles creating/destroying sprites based on network events, input, camera.
    *   UI Elements: `UIScene` (`frontend/src/scenes/UIScene.ts`). Uses Phaser DOM elements for overlays like chat.
*   **Database Models:** Define entities in `.entity.ts` files (e.g., `Character`, `User`). Use TypeORM decorators. Ensure entities are registered in their respective module's `TypeOrmModule.forFeature([...])` and that the module is imported into `AppModule`.

**4. Core Gameplay Flow (Movement Example):**
1.  `GameScene`: User clicks (`pointerdown`).
2.  `GameScene`: Calculates `worldPoint`. Calls `showClickMarker`. Sends `moveCommand` with `{ target: worldPoint }` via `NetworkManager`.
3.  `GameGateway`: Receives `moveCommand`. Gets user's party from `ZoneService`. Calculates formation target coordinates for each character. Calls `ZoneService.setCharacterTargetPosition` for each character.
4.  `GameGateway.tickGameLoop`: Iterates characters. Checks `character.position` vs `character.target`. Calculates movement step based on `MOVEMENT_SPEED` and `deltaTime`. Updates `character.position` (in memory via `ZoneService` state). Collects updated positions.
5.  `GameGateway`: Broadcasts batched `entityUpdate` { updates: [{ id, x, y }, ...] } to the zone room.
6.  `NetworkManager`: Receives `entityUpdate`. Emits local `EventBus` event `'entity-update'`.
7.  `GameScene`: Listener for `'entity-update'` receives data. Iterates updates. Finds corresponding `CharacterSprite` (or `EnemySprite`). Calls `sprite.updateTargetPosition(x, y)`.
8.  `CharacterSprite.update`: Called by `GameScene.update`. Interpolates `this.x`, `this.y` towards `this.targetX`, `this.targetY` using `Phaser.Math.Linear`. Updates name label / chat bubble positions relative to interpolated `this.x`, `this.y`.

**5. Next Steps:**
*   Refer to the **Phase 4** section in the main TODO list above. Focus on implementing basic enemies and combat mechanics.
*   Consider tackling the "Refinement / Future TODOs" items as needed or after core features are in place.