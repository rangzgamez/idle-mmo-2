## **Idle Browser MMO - Project Documentation**

**Version:** 0.7 (Game Loop Refactoring)
**Date:** 2025-04-03 (Adjust date as needed)

**1. Overview**

This document outlines the architecture, database schema, and development plan for an Idle Browser MMO game. The game features real-time multiplayer interaction in a top-down view, RTS-style character control with formation movement, **player and enemy combat with auto-attack**, basic death/respawn mechanics, and social features like zone-based chat with bubbles.

**2. Core Features (Implemented - v0.7)**

*   **Authentication:** User registration and login (REST API with JWT).
*   **WebSocket Auth:** Secure WebSocket connections using JWT.
*   **Character Management:** Create multiple characters per account (API). Define base stats (`baseHealth`, `baseAttack`, `baseDefense`) and **combat stats (`attackSpeed`, `attackRange`, `aggroRange`, `leashDistance`)** in DB.
*   **Party Selection:** Select up to 3 active characters per session (Client UI + Server Validation).
*   **Top-Down World:** Players navigate a 2D world. Camera follows the player's party leader. Basic enemy sprites loaded.
*   **RTS-Style Control:**
    *   Point-and-click movement commands.
    *   **Clicking enemies issues an attack command.**
    *   **Anchor Point:** Last commanded move position (or spawn) acts as an anchor.
*   **Formation Movement:** Backend calculates triangle formation targets; characters move towards them when commanded.
*   **Click Marker:** Visual indicator for movement clicks.
*   **Server-Side Simulation (`GameGateway` loop):**
    *   Simulates character and enemy movement.
    *   **Character State Machine:** Handles `idle`, `moving`, `attacking`, `dead` states.
    *   **Leashing:** Characters return to anchor if they move too far (`leashDistance`).
    *   **Auto-Aggro:** Idle characters scan for enemies within `aggroRange` and automatically engage.
    *   **Return to Anchor:** Idle characters with no targets return to their anchor point.
    *   **Attack Cooldown:** Characters respect `attackSpeed` between attacks.
    *   **Enemy AI (`AIService`):** Enemies find nearest living character, move within range, and attack based on their stats.
    *   Broadcasts updates (`entityUpdate`).
*   **Client-Side Interpolation:** Frontend smoothly interpolates sprites (`CharacterSprite`, `EnemySprite`).
*   **Multiplayer Zones:** Multiple players and enemies inhabit shared zones (`ZoneService`).
    *   **Runtime State:** `ZoneService` tracks character state (including combat state like `state`, `attackTargetId`, `anchorX/Y`, `lastAttackTime`, `timeOfDeath`) and enemy state.
*   **Real-time Sync:** Players see others join (`playerJoined`), leave (`playerLeft`), move/update (`entityUpdate`), and die (`entityDied`). New players receive existing enemy state on join.
*   **Chat:** Zone-scoped real-time text chat with chat bubbles.
*   **Enemy Templates:** Defined in database (`Enemy` entity, `EnemyModule`, `EnemyService`).
*   **Enemy Spawning:** Basic timed spawning within zones (`ZoneService`).
*   **Combat Resolution (Server-side `CombatService`):**
    *   `handleAttack` calculates damage based on attacker/defender stats.
    *   Damage applied via `ZoneService`.
    *   Returns combat results including `targetDied` flag.
*   **Death Handling:**
    *   **Enemies:** Removed from `ZoneService` on death. `entityDied` event sent. Client destroys sprite.
    *   **Characters:** Enter `dead` state, stop actions. `entityDied` event sent. Client shows basic death visual (alpha). **Simple 5-second respawn at anchor point with full health.**
*   **Client Combat Interaction:**
    *   Clicking enemy sprites sends `attackCommand`.
    *   Health bars display on characters and enemies, updated via `entityUpdate`.
    *   Attack visuals (tint flash) shown via `combatAction` event.
    *   Enemy sprites are removed on `entityDied` event.
    *   Character sprites fade slightly on `entityDied` event.
*   **Refactored Game Loop:** Server-side simulation logic previously in `GameGateway` has been split into multiple dedicated services (`GameLoopService`, `CharacterStateService`, `EnemyStateService`, `MovementService`, `SpawningService`, `BroadcastService`) for better modularity and maintainability.

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
|                   |                         |     - AIService         |
|                   |                         |     - GameLoopService   |
|                   |                         |     - CharacterStateService |
|                   |                         |     - EnemyStateService |
|                   |                         |     - MovementService   |
|                   |                         |     - SpawningService   |
|                   |                         |     - BroadcastService  |
|                   |                         |   - Debug Module        |
+-------------------+                         +-------------------------+
```

**4.5 Backend Interaction Diagram (Game Tick)**

```mermaid
graph TD
    subgraph GameModule
        GLS[GameLoopService] -->|1. Process Chars| CSS[CharacterStateService];
        GLS -->|2. Process Enemies| ESS[EnemyStateService];
        GLS -->|3. Process Movement| MS[MovementService];
        GLS -->|4. Process Spawns| SpS[SpawningService];
        GLS -->|5. Flush Events| BS[BroadcastService];
        
        CSS -->|Calls| CS[CombatService];
        CSS -->|Reads| ZS[ZoneService];
        
        ESS -->|Calls| AIS[AIService];
        ESS -->|Calls| CS;
        ESS -->|Reads/Updates| ZS;
        
        AIS -->|Reads| ZS;
        
        MS;  // MovementService is mostly self-contained logic
        
        SpS -->|Calls| ZS;
        SpS -->|Calls| ES[EnemyService];
        
        CS -->|Updates| ZS;
        CS -->|Reads| ES;
        
        BS -->|Emits via| SIOServer(Socket.IO Server);

        ZS -->|Reads/Updates| DB[(Database - Implicit)];
        ES -->|Reads| DB;
        
    end
    
    GameGateway -->|Starts| GLS;
    GameGateway -->|Sets Server| BS;
    
    style GLS fill:#f9f,stroke:#333,stroke-width:2px
    style CSS fill:#ccf,stroke:#333,stroke-width:1px
    style ESS fill:#ccf,stroke:#333,stroke-width:1px
    style MS fill:#cfc,stroke:#333,stroke-width:1px
    style SpS fill:#ffc,stroke:#333,stroke-width:1px
    style BS fill:#fcc,stroke:#333,stroke-width:1px
    style CS fill:#eef,stroke:#333,stroke-width:1px
    style AIS fill:#eef,stroke:#333,stroke-width:1px
    style ZS fill:#ddf,stroke:#333,stroke-width:1px
    style ES fill:#ddf,stroke:#333,stroke-width:1px
```
*(Note: This diagram focuses on the backend game loop interactions. Frontend interaction remains primarily via WebSocket events managed by `GameGateway` and `BroadcastService`)*

**5. Backend Module Breakdown (Updated)**

*   `AppModule`: Root module, imports all other modules.
*   `AuthModule`: Handles user registration, login, JWT (global).
*   `UserModule`: Manages user entity (`UserService`). Exports service.
*   `CharacterModule`: Manages character entity (`CharacterService`, `CharacterController`). Exports service. **Injects `InventoryService`.**
*   `EnemyModule`: Manages enemy template entity (`EnemyService`, `EnemyController` (optional), `Enemy` entity). Exports service.
*   `GameModule`: Core real-time logic.
    *   `GameGateway`: **Reduced Role.** Handles WebSocket connections, auth middleware, routing client commands (`enterZone`, `selectParty`, `moveCommand`, `sendMessage`, `attackCommand`, **`moveInventoryItem`, `dropInventoryItem`, `pickupItemCommand`, `equipItemCommand`, `unequipItem`, `requestEquipment`**) to update `ZoneService` / `CharacterService` / `InventoryService` state. Initializes the `GameLoopService`. Injects `ZoneService`, `GameLoopService`, `BroadcastService`, `CharacterService` (for party validation), `UserService`, `JwtService`, **`InventoryService`**.
    *   `GameLoopService`: **Orchestrator.** Runs the main game tick loop (`tickGameLoop`). Iterates through zones, players, enemies. Calls specialized services for character state, enemy state, movement, and spawning. Calls `BroadcastService` to flush events at the end of each zone tick. Injects `ZoneService`, `CharacterStateService`, `EnemyStateService`, `MovementService`, `SpawningService`, `BroadcastService`.
    *   `CharacterStateService`: **NEW.** Handles processing a single character's state per tick (death, respawn, regen, leashing, state machine logic, aggro, initiating attacks). Injects `ZoneService`, `CombatService`.
    *   `EnemyStateService`: **NEW.** Handles processing a single enemy's state per tick (getting AI action, executing attacks). Injects `ZoneService`, `CombatService`, `AIService`.
    *   `MovementService`: **NEW.** Calculates new entity positions based on current position, target, speed, and delta time. Used by `GameLoopService` for both characters and enemies.
    *   `SpawningService`: **NEW.** Handles logic for checking spawn nest timers and triggering new enemy spawns via `ZoneService`. Injects `ZoneService`.
    *   `BroadcastService`: **NEW.** Queues game events (entity updates, deaths, spawns, combat actions) per zone during a tick. Flushes queued events by emitting formatted WebSocket messages via the Socket.IO server instance at the end of each zone tick. 
    *   `ZoneService`: Manages **runtime state** of all dynamic entities (players, enemies, items-TODO) within zones in memory (Maps). Handles adding/removing entities, tracking positions, targets, health, combat state, etc. Provides state snapshots and update methods. Used by many other services. Injects `EnemyService`.
    *   `CombatService`: Handles combat resolution logic (`handleAttack`, `calculateDamage`). Injects `ZoneService`, `EnemyService`.
    *   `AIService`: Handles AI decision-making logic (`updateEnemyAI` for enemies). Returns AI actions. Injects `ZoneService`.
*   **`InventoryModule`:** Manages item instances (`InventoryItem` entity) and related logic (`InventoryService`). Exports service. **Injects `ItemModule`**. **Provides `inventorySlot` management.**
*   **`ItemModule`:** Manages item templates (`ItemTemplate` entity). Exports service.
*   `DebugModule`: Provides endpoints for inspecting runtime state (`/debug/zones`). Injects `ZoneService` (via `GameModule` import).

**6. Frontend Structure Breakdown (Refined)**

*   **`main.tsx`:** Entry point, Phaser config, scene list.
*   **`NetworkManager.ts`:** Singleton for WebSocket communication, event handling, local `EventBus` emission.
*   **`EventBus.ts`:** Simple custom event emitter for intra-client communication.
*   **Scenes:**
    *   `BootScene`, `PreloadScene`, `LoginScene`, `CharacterSelectScene`: Handle setup, asset loading (incl. enemy sprites), auth, party selection.
    *   `GameScene`: Main gameplay area. Manages sprites for all entities (`playerCharacters`, `otherCharacters`, `enemySprites` Maps). Handles network events (`playerJoined`, `playerLeft`, `entityUpdate`, `chatMessage`, `combatAction`, `entityDied`, initial `enemyState` on `enterZone`, **`inventoryUpdate`, `equipmentUpdate`, `itemDropped`, `itemPickedUp`**) to manage sprites and UI updates. Processes player input (movement, attack clicks). Manages camera. Launches `UIScene`.
    *   `UIScene`: Handles overlay UI elements (Chatbox, **Inventory Window**, **Equipment Window**, Tooltips). Manages DOM elements for UI interaction (drag/drop, right-click menus). Sends commands like `equipItemCommand`, `unequipItem`, `moveInventoryItem`, `dropInventoryItem`.
*   **GameObjects:**
    *   `CharacterSprite.ts`: Represents player characters. Handles interpolation, name label, health bar, chat bubbles, **basic death visuals (alpha)**.
    *   `EnemySprite.ts`: Represents enemies. Handles interpolation, name label, health bar. Set interactive for clicks. **Destroyed on death.**
    *   `HealthBar.ts`: Reusable graphics-based health bar component used by sprites.

**7. WebSocket Communication Events (Updated)**

*   **Client -> Server:**
    *   `authenticate` (Implicit via `socket.handshake.auth.token`)
    *   `selectParty` { characterIds: string[] } -> Ack: `{ success: boolean, characters?: CharacterDataWithUsername[] }`
    *   `enterZone` { zoneId: string } -> Ack: `{ success: boolean; zoneState?: ZoneCharacterState[]; enemyState?: EnemyInstance[]; inventory?: (InventoryItem | null)[]; equipment?: Record<string, Partial<Record<EquipmentSlot, InventoryItem>>>; message?: string }` **(Added inventory & equipment)**
    *   `moveCommand` { target: { x: number, y: number } }
    *   `sendMessage` { message: string }
    *   `attackCommand` { targetId: string }
    *   `teleportPlayer` { x: number, y: number } (Debug only)
    *   **`moveInventoryItem` { fromIndex: number, toIndex: number } -> Triggers `inventoryUpdate` (NEW)**
    *   **`dropInventoryItem` { inventoryIndex: number } -> Triggers `inventoryUpdate`, maybe `itemDropped` (NEW - Drop logic TBD)**
    *   **`pickupItemCommand` { droppedItemId: string } -> Triggers `inventoryUpdate`, `itemPickedUp` (NEW - Loot Phase)**
    *   **`equipItemCommand` { inventoryItemId: string, characterId: string } -> Triggers `inventoryUpdate`, `equipmentUpdate` (NEW)**
    *   **`unequipItem` { characterId: string, slot: EquipmentSlot } OR { inventoryItemId: string } -> Triggers `inventoryUpdate`, `equipmentUpdate` (NEW)**
    *   **`requestEquipment` { characterId: string } -> Triggers `equipmentUpdate` (NEW)**
*   **Server -> Client:**
    *   `connect_error` (Auth failed or other issue)
    *   `playerJoined` { characters: ZoneCharacterState[] }
    *   `playerLeft` { playerId: string }
    *   `entityUpdate` { updates: Array<{ id: string, x?: number, y?: number, health?: number }> }
    *   `chatMessage` { senderName: string, senderCharacterId: string, message: string, timestamp: number }
    *   `combatAction` { attackerId: string, targetId: string, damage: number, type: string }
    *   `entityDied` { entityId: string, type: 'character' | 'enemy' /* | other */ }
    *   **`inventoryUpdate` { inventory: (InventoryItem | null)[] } (NEW - Sparse array representing all potential slots)**
    *   **`equipmentUpdate` { characterId: string, equipment: Partial<Record<EquipmentSlot, InventoryItem>> } (NEW)**
    *   **`itemDropped` { itemId: string, templateId: string, x: number, y: number } (NEW - Loot Phase)**
    *   **`itemPickedUp` { pickerCharacterId: string, itemId: string } (NEW - Loot Phase)**

**7.5 Frontend/Backend Interaction Diagram (Inventory/Equipment)**

```mermaid
graph TD
    subgraph Frontend (UIScene.ts)
        UI_DragDrop[Drag & Drop Item] -->|Sends 'moveInventoryItem'| NetworkMgr;
        UI_RightClickEquip[Right-Click Equippable Item] -->|Sends 'equipItemCommand'| NetworkMgr;
        UI_RightClickEquipSlot[Right-Click Equipped Slot] -->|Sends 'unequipItem'| NetworkMgr;
        UI_DragDropOutside[Drag Item Outside Window] -->|Sends 'dropInventoryItem'| NetworkMgr;
        NetworkMgr -->|Receives 'inventoryUpdate'| UI_InvUpdate[Update Inventory Grid];
        NetworkMgr -->|Receives 'equipmentUpdate'| UI_EquipUpdate[Update Equipment Slots];
    end

    subgraph Backend (NestJS)
        NetworkMgr -- WSS --> GG[GameGateway];

        GG -- moveInventoryItem --> IS[InventoryService];
        IS -- moveInventoryItem --> DB_UpdateInvSlot[DB: Update Item.inventorySlot];
        IS -- moveInventoryItem --> BS[BroadcastService];

        GG -- equipItemCommand --> CS[CharacterService];
        CS -- equipItem --> DB_UpdateEquip[DB: Set Item.equippedBy/Slot, Item.inventorySlot = NULL];
        CS -- equipItem --> IS_Save[InventoryService: Save Item];
        CS -- equipItem --> BS;

        GG -- unequipItem --> CS;
        CS -- unequipItem --> IS_FindEmpty[InventoryService: Find Empty Slot];
        CS -- unequipItem --> DB_UpdateUnequip[DB: Clear Item.equippedBy/Slot, Item.inventorySlot = emptySlot];
        CS -- unequipItem --> IS_Save;
        CS -- unequipItem --> BS;

        GG -- dropInventoryItem --> IS;
        IS -- dropInventoryItem --> DB_UpdateInvSlotDrop[DB: Update Item state (e.g., remove inventorySlot)]; // Exact logic TBD
        IS -- dropInventoryItem --> BS; // May trigger itemDropped event later

        BS -- inventoryUpdate -->|Emits| NetworkMgr;
        BS -- equipmentUpdate -->|Emits| NetworkMgr;

        style IS fill:#aaffaa,stroke:#333,stroke-width:1px
        style CS fill:#aaaaff,stroke:#333,stroke-width:1px
        style GG fill:#ffaaaa,stroke:#333,stroke-width:1px
        style BS fill:#fcc,stroke:#333,stroke-width:1px
        style DB_UpdateInvSlot fill:#ddd,stroke:#333,stroke-width:1px
        style DB_UpdateEquip fill:#ddd,stroke:#333,stroke-width:1px
        style DB_UpdateUnequip fill:#ddd,stroke:#333,stroke-width:1px
        style DB_UpdateInvSlotDrop fill:#ddd,stroke:#333,stroke-width:1px

    end

    subgraph Database (PostgreSQL - InventoryItem Table)
        DB_UpdateInvSlot;
        DB_UpdateEquip;
        DB_UpdateUnequip;
        DB_UpdateInvSlotDrop;
    end
```
*(Note: Drop Item logic backend implementation details are still pending in Phase 6 TODOs)*

**8. Database Schema (Updated)**

```typescript
// backend/src/character/character.entity.ts
// ... (id, user relation, userId, name, level, xp, positions, zoneId) ...
  // --- ADD BASIC STATS ---
  @Column({ type: 'integer', default: 100 })
  baseHealth: number;

  @Column({ type: 'integer', default: 15 })
  baseAttack: number;

  @Column({ type: 'integer', default: 5 })
  baseDefense: number;

  // --- ADDED COMBAT/AI STATS ---
  @Column({ type: 'integer', default: 1500, comment: 'Milliseconds between attacks' })
  attackSpeed: number;

  @Column({ type: 'integer', default: 50, comment: 'Pixel distance for attacks' })
  attackRange: number;

  @Column({ type: 'integer', default: 150, comment: 'Pixel distance for auto-aggro' })
  aggroRange: number;

  @Column({ type: 'integer', default: 400, comment: 'Pixel distance from anchor before returning' })
  leashDistance: number;
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
  id: string;
  templateId: string;
  zoneId: string;
  currentHealth: number;
  baseAttack: number; // Required for combat
  baseDefense: number; // Required for combat
  position: { x: number; y: number };
  target?: { x: number; y: number } | null; // Can be null
  aiState: string; // e.g., "IDLE", "CHASING", "ATTACKING", "COOLDOWN", "DEAD"
  lastAttackTime?: number; // Timestamp of the last attack
}

// backend/src/game/zone.service.ts -> RuntimeCharacterData interface
export interface RuntimeCharacterData extends Character {
    targetX: number | null;
    targetY: number | null;
    currentHealth: number;
    ownerId: string; // Should always be present after addPlayerToZone
    // Inherited base stats like baseHealth, baseAttack, baseDefense are used
    // Inherited combat stats like attackSpeed, attackRange, aggroRange, leashDistance are used
    // --- RTS Combat State ---
    state: 'idle' | 'moving' | 'attacking' | 'dead'; // Added 'dead' state
    attackTargetId: string | null;
    anchorX: number | null; // Last commanded position or spawn point
    anchorY: number | null;
    // attackRange: number; // Inherited from Character
    // aggroRange: number; // Inherited from Character
    // leashDistance: number; // Inherited from Character
    // --- Attack Timing ---
    // attackSpeed: number; // Inherited from Character
    lastAttackTime: number; // Timestamp of the last attack (Date.now())
    // --- Death State ---
    timeOfDeath: number | null; // Timestamp when health reached 0
}

// backend/src/inventory/inventory.entity.ts (Conceptual - Details added)
@Entity()
export class InventoryItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => ItemTemplate, { eager: true })
  itemTemplate: ItemTemplate;
  @Column()
  itemTemplateId: string;

  @Column()
  userId: string; // Owner

  @Column({ nullable: true })
  equippedByCharacterId?: string | null; // Which character has it equipped

  @Column({ type: 'enum', enum: EquipmentSlot, nullable: true })
  equippedSlotId?: EquipmentSlot | null; // Which specific slot

  @Column({ type: 'integer', default: 1 })
  quantity: number; // For stackable items

  // --- NEW Inventory Slot Tracking ---
  @Column({ type: 'integer', nullable: true, comment: 'The numerical slot index in the player\'s main inventory grid. NULL if equipped or not in main inv.' })
  inventorySlot: number | null;

  @CreateDateColumn() createdAt: Date;
  @UpdateDateColumn() updatedAt: Date;
}
```
*(User, Character, Enemy, ItemTemplate schemas shown previously or implied)*

**9. Key Concepts / Reusable Patterns (Updated)**

*   **Entity Runtime State Management (`ZoneService`):** Core responsibility. Holds in-memory `Map`s for players and enemies within zones. State includes position, target, current health, combat state (`state`, `attackTargetId`, `anchorX/Y`, `lastAttackTime`, `timeOfDeath`), AI state. **Inventory/Equipment state is primarily managed via DB persistence (`InventoryItem` entity with `inventorySlot`, `equippedByCharacterId`, `equippedSlotId`) and broadcast events (`inventoryUpdate`, `equipmentUpdate`), not directly tracked in `ZoneService`.**
*   **Service-Based Logic:** Core game mechanics are encapsulated in highly granular services:
    *   `CharacterStateService`, `EnemyStateService`: Handle entity-specific state logic.
    *   `MovementService`: Handles position calculation.
    *   `SpawningService`: Handles enemy spawning.
    *   `CombatService`: Handles attack rules and outcomes.
    *   `AIService`: Handles entity decision-making.
    *   `ZoneService`: Manages runtime state and zone transitions.
    *   `BroadcastService`: Handles WebSocket event emission.
    *   **`InventoryService`:** Manages inventory item persistence and slot allocation.
    *   **`CharacterService`:** Handles character logic, including equipping/unequipping items by coordinating with `InventoryService`.
*   **Orchestration (`GameLoopService`):** The `GameLoopService` coordinates the game tick, calling the specialized services in sequence to simulate one frame of the game world.
*   **Authoritative Server:** The backend dictates all game state (positions, health, AI state, combat state).
*   **Client-Side Interpolation:** Sprites smoothly move towards `targetX`/`targetY`.
*   **Event-Driven Updates:** Frontend reacts to specific server events (`entityUpdate`, `combatAction`, `entityDied`, etc.) emitted by the `BroadcastService`.
*   **Component-Based Sprites:** Sprites manage their own visual components (labels, health bars, chat bubbles, death visuals).
*   **State Machine (Server):** `CharacterStateService` uses a state machine (`idle`, `moving`, `attacking`, `dead`) for characters to manage behavior (movement, combat, leashing, respawn).

**10. Testing Strategy (Updated)**

*   Remains multi-layered (Unit, Integration, E2E) primarily focused on backend (Jest).
*   Frontend unit testing (Vitest/Jest) for utilities. Manual testing for scenes.
*   **Status:** Unit/Integration test implementation is **active**. Tests have been added for the refactored game loop services (`MovementService`, `SpawningService`, `BroadcastService`, `CharacterStateService`, `EnemyStateService`) and related refactored services (`ZoneService`, `CombatService`).
*   **Policy:** Moving forward, new features or significant refactors **must** include corresponding unit and/or integration tests to ensure correctness and prevent regressions.

**11. Core Real-time Update Flow (Example: Character Auto-Attack - Updated with Services)**

1.  **Loop Start (`GameLoopService.tickGameLoop`):** Iterates through players/characters.
2.  **State Check (`CharacterStateService.processCharacterTick`):** Character is in `idle` state, not at anchor point.
3.  **Aggro Scan (`CharacterStateService.processCharacterTick` - idle state):** Scans `enemiesInZone`. Finds living `EnemyInstance` within `aggroRange`.
4.  **State Transition (`CharacterStateService.processCharacterTick`):** Sets `character.state` to `attacking`, sets `character.attackTargetId` to enemy's ID. Returns results.
5.  **Movement (`GameLoopService.tickGameLoop`):** Calls `MovementService.simulateMovement`. Since character is attacking and likely out of range, target is set by `CharacterStateService`, movement occurs.
6.  **Aggregation (`GameLoopService.tickGameLoop`):** Queues position update via `BroadcastService.queueEntityUpdate`.

**(Next Tick)**
7.  **State Check (`CharacterStateService.processCharacterTick`):** Character is in `attacking` state.
8.  **Target Validation (`CharacterStateService.processCharacterTick`):** Confirms target enemy exists and is alive via `ZoneService`.
9.  **Range Check (`CharacterStateService.processCharacterTick`):** Calculates distance. Assume still outside `attackRange`. Target position remains set.
10. **Movement (`GameLoopService.tickGameLoop`):** Calls `MovementService.simulateMovement`. Character moves closer.
11. **Aggregation (`GameLoopService.tickGameLoop`):** Queues position update via `BroadcastService.queueEntityUpdate`.

**(Later Tick)**
12. **State Check (`CharacterStateService.processCharacterTick`):** Character is in `attacking` state.
13. **Target Validation (`CharacterStateService.processCharacterTick`):** Confirms target enemy exists and is alive.
14. **Range Check (`CharacterStateService.processCharacterTick`):** Character is now within `attackRange`.
15. **Cooldown Check (`CharacterStateService.processCharacterTick`):** Checks if `now >= character.lastAttackTime + character.attackSpeed`.
16. **Attack Execution (`CharacterStateService.processCharacterTick`):** If cooldown allows, calls `this.combatService.handleAttack(character, enemy, zoneId)`. Sets `character.lastAttackTime = now`.
17. **Combat Resolution (`CombatService.handleAttack`):** Calculates damage, updates enemy health via `ZoneService`. Returns `CombatResult { damageDealt: 12, targetDied: false, targetCurrentHealth: 38 }`.
18. **Result Processing (`CharacterStateService.processCharacterTick`):** Receives `CombatResult`. Prepares `CharacterTickResult` including combat action and enemy health update.
19. **Aggregation (`GameLoopService.tickGameLoop`):** Processes `CharacterTickResult`:
    *   Queues combat action via `BroadcastService.queueCombatAction`.
    *   Queues enemy health update via `BroadcastService.queueEntityUpdate`.
20. **Movement (`GameLoopService.tickGameLoop`):** Calls `MovementService.simulateMovement`. Character is in range, no target set, no movement.
21. **Flush Events (`GameLoopService.tickGameLoop`):** At end of zone processing, calls `BroadcastService.flushZoneEvents(zoneId)`.
22. **Broadcast (`BroadcastService.flushZoneEvents`):** Emits batched `entityUpdate` and `combatAction` events.
23. **Client Reception/Update (`NetworkManager`, `GameScene`):** Updates enemy health bar, shows attack visual.

**(Example: Enemy Death - Updated)**
17. **Combat Resolution (`CombatService.handleAttack`):** Calculates damage, updates enemy health to 0. Returns `CombatResult { damageDealt: 15, targetDied: true, targetCurrentHealth: 0 }`.
18. **Result Processing (`CharacterStateService.processCharacterTick`):** Receives `CombatResult` with `targetDied: true`. Sets `character.attackTargetId = null`, `character.state = 'idle'`. Prepares `CharacterTickResult` indicating `targetDied = true`, including combat action and final enemy health update.
19. **Aggregation (`GameLoopService.tickGameLoop`):** Processes `CharacterTickResult`:
    *   Queues combat action via `BroadcastService.queueCombatAction`.
    *   Queues enemy health update (health: 0) via `BroadcastService.queueEntityUpdate`.
    *   Detects `targetDied: true`, queues death event via `BroadcastService.queueDeath({ entityId: enemy.id, type: 'enemy' })`.
    *   Calls `this.zoneService.removeEnemy(zoneId, enemy.id)`.
20. **Movement/Aggregation (`GameLoopService.tickGameLoop`):** Character is idle, may queue position update if returning to anchor.
21. **Flush Events (`GameLoopService.tickGameLoop`):** Calls `BroadcastService.flushZoneEvents(zoneId)`.
22. **Broadcast (`BroadcastService.flushZoneEvents`):** Emits `entityUpdate`, `combatAction`, and `entityDied` events.
23. **Client Reception/Update (`NetworkManager`, `GameScene`):
    *   `entityDied` handler finds enemy sprite by ID, calls `sprite.destroy()`, removes from map.

**12. TODO List / Roadmap (Updated)**

**Phase 0-5 (Partially Complete - Combat Core Implemented)**
*   Auth, Character Mgmt, Party Select, Movement, Chat: Complete.
*   Basic Enemies & Combat Backend: Implemented (`EnemyEntity`, spawn, `CombatService`).
*   Basic Combat Frontend: Implemented (`EnemySprite`, health bars, attack input/visuals).
*   **RTS Character Combat Backend:** Implemented (State machine, aggro, attack, cooldown, leashing).
*   **Enemy AI (`AIService`):** Implemented (Aggro, chase, attack, cooldown).
*   **Death Handling:** Implemented (Enemy removal, Character dead state, `entityDied` event).
*   **Basic Respawn:** Implemented (Character 5s timer, respawn at anchor).
*   **Stat Configuration:** Implemented (Combat stats moved to `Character` entity).
*   **Frontend Death Handling:** Implemented (Enemy sprite destruction, basic character visuals).

**➡️ Phase 6: Inventory, Loot & Equipment (Partially Complete)**
1.  [X] Backend: Define `ItemTemplate` and `InventoryItem` entities & migrations. (**Added `inventorySlot`**)
2.  [X] Backend: Implement `InventoryModule` and `InventoryService` (add/remove items, **manage slots**).
3.  [ ] Backend: Implement `LootService` and configure basic loot tables.
4.  [ ] Backend: Trigger loot drops on enemy death (`LootService`). Add `DroppedItem` state to `ZoneService`. Broadcast `itemDropped`.
5.  [ ] Backend: Implement `pickupItemCommand` handler (validate range, add to inventory via `InventoryService`, remove from zone). Broadcast `itemPickedUp` and `inventoryUpdate`.
6.  [ ] Frontend: Display dropped item sprites based on `itemDropped`.
7.  [ ] Frontend: Handle clicking items -> send `pickupItemCommand`. Remove sprite on `itemPickedUp`.
8.  [X] Frontend: Basic Inventory UI (in `UIScene`) to display items from `inventoryUpdate` (**Grid, Slots, Drag/Drop Move**).
9.  [X] Backend: Add `equippedSlotId` and `inventorySlot` to `InventoryItem` entity.
10. [X] Backend: Implement `equipItem` / `unequipItem` logic in `InventoryService`/`CharacterService`. Broadcast `equipmentUpdate` & `inventoryUpdate`. (**Handles `inventorySlot` clearing/assignment**)
11. [X] Frontend: Basic Equipment UI (in `UIScene`). Allow equipping/unequipping via **right-click**. Send commands. Update UI on `equipmentUpdate`.

**Phase 7: Experience & Leveling (NEW)**
1.  [ ] Backend: Add `xpReward` to `Enemy` entity (Already done!).
2.  [ ] Backend: Grant XP to player characters involved in killing an enemy (`CombatService` or `GameGateway`).
3.  [ ] Backend: Implement leveling logic (check XP thresholds, increase level, maybe stats?) in `CharacterService` or `GameGateway`.
4.  [ ] Backend: Broadcast level up event (`characterLevelUp`?) and update `entityUpdate` with new level/stats.
5.  [ ] Frontend: Display level changes visually (e.g., on character sprite label, UI).
6.  [ ] Frontend: Show level up visual effect.

**Phase 8: Pets (Was Phase 6)**
*   [...] Define Pet entity, AI Service logic, feeding command.

**Refinement / Future TODOs:**
*   **NEW:** Add `baseSpeed` to `Character` entity and use it in `MovementService`.
*   **NEW:** Ensure `EnemyInstance.baseSpeed` is correctly populated in `ZoneService` (check `addEnemy` if it exists, besides `addEnemyFromNest`).
*   Integrate real Character Stats (from DB/`CharacterService`) into `CombatService` (Partially done, base stats used). Define impact of other stats (Str, Agi etc.).
*   Persist character position/zone periodically or on logout.
*   Implement proper Tilemaps and Collision (Frontend & Backend).
*   More sophisticated movement (Pathfinding).
*   Different character types/classes (Melee, Ranged, Healer AI).
*   Proper character/enemy sprites and animations.
*   Server-side validation (movement, actions).
*   More robust character death handling (prevent interaction fully, different visuals, maybe resurrection item/skill).
*   Enemy respawning logic (currently just despawn on death).
*   Scalability considerations (Redis, multiple instances).
*   Comprehensive Unit and E2E Testing.

**13. Continuing Development Guide (Updated)**

*   **Focus:** Next steps are the remaining items in Phase 6: Loot Drops and Pickup.
*   **Backend:** Run `npm run start:dev`. Implement features based on the chosen phase.
*   **Frontend:** Run `npm run dev`. Implement corresponding UI and event handling.
*   **Testing:** Manual testing is primary. Use `/debug/zones` and console logs.
*   **Key Files for Recent Refactoring (Game Loop):**
    *   `backend/src/game/game.gateway.ts` (Handles connections, commands)
    *   `backend/src/game/game-loop.service.ts` (Orchestrates the tick)
    *   `backend/src/game/character-state.service.ts` (Character logic)
    *   `backend/src/game/enemy-state.service.ts` (Enemy logic)
    *   `backend/src/game/movement.service.ts` (Movement calculation)
    *   `backend/src/game/spawning.service.ts` (Nest spawning logic)
    *   `backend/src/game/broadcast.service.ts` (WebSocket event emission)
    *   `backend/src/game/zone.service.ts` (Runtime state management)
    *   `backend/src/game/ai.service.ts` (AI decisions)
    *   `backend/src/game/combat.service.ts` (Combat calculations)
    *   `backend/src/game/game.module.ts` (Service registration)
    *   **`backend/src/inventory/inventory.service.ts` (Item management, slot finding)**
    *   **`backend/src/character/character.service.ts` (Equip/Unequip coordination)**
    *   **`frontend/src/scenes/UIScene.ts` (Inventory/Equipment UI, event handling)**
