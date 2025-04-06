## **Idle Browser MMO - Project Documentation**

**Version:** 0.8 (XP and Leveling)
**Date:** 2025-04-04 (Adjust date as needed)

**1. Overview**

This document outlines the architecture, database schema, and development plan for an Idle Browser MMO game. The game features real-time multiplayer interaction in a top-down view, RTS-style character control with formation movement, **player and enemy combat with auto-attack**, basic death/respawn mechanics, and social features like zone-based chat with bubbles, **and experience/leveling systems.**

**2. Core Features (Implemented - v0.8)**

*   **Authentication:** User registration and login (REST API with JWT).
*   **WebSocket Auth:** Secure WebSocket connections using JWT.
*   **Character Management:** Create multiple characters per account (API). Define base stats (`baseHealth`, `baseAttack`, `baseDefense`) and **combat stats (`attackSpeed`, `attackRange`, `aggroRange`, `leashDistance`)** in DB. **Includes `level` and `xp` (bigint).**
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
    *   **Character State Machine:** Handles `idle`, `moving`, `attacking`, `dead`, **`moving_to_loot`**, **`looting_area`** states. Uses **`commandState`** to manage multi-step commands like Loot All.
    *   **Leashing:** Characters return to anchor if they move too far (`leashDistance`).
    *   **Auto-Aggro:** Idle characters scan for enemies within `aggroRange` and automatically engage.
    *   **Return to Anchor:** Idle characters with no targets return to their anchor point.
    *   **Attack Cooldown:** Characters respect `attackSpeed` between attacks.
    *   **Enemy AI (`AIService`):** Enemies find nearest living character, move within range, and attack based on their stats.
    *   Broadcasts updates (`entityUpdate`).
*   **Client-Side Interpolation:** Frontend smoothly interpolates sprites (`CharacterSprite`, `EnemySprite`).
*   **Multiplayer Zones:** Multiple players and enemies inhabit shared zones (`ZoneService`).
    *   **Runtime State:** `ZoneService` tracks character state (including combat state like `state`, **`commandState`**, `attackTargetId`, `targetItemId`, `anchorX/Y`, `lastAttackTime`, `timeOfDeath`) and enemy state.
*   **Real-time Sync:** Players see others join (`playerJoined`), leave (`playerLeft`), move/update (`entityUpdate`), and die (`entityDied`). New players receive existing enemy state on join. **Includes XP and Level updates.**
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
*   `CharacterModule`: Manages character entity (`CharacterService`, `CharacterController`). Exports service. Injects `InventoryService`, **`ZoneService`, `BroadcastService`**. `CharacterService` now handles **XP addition, level-up calculations, stat gains, and broadcasting XP/level events.**
*   `EnemyModule`: Manages enemy template entity (`EnemyService`, `EnemyController` (optional), `Enemy` entity). Exports service.
*   `GameModule`: Core real-time logic.
    *   `GameGateway`: **Reduced Role.** Handles WebSocket connections, auth middleware, routing client commands (`enterZone`, `selectParty`, `moveCommand`, `sendMessage`, `attackCommand`, **`moveInventoryItem`, `dropInventoryItem`, `pickupItemCommand`, `equipItemCommand`, `unequipItem`, `requestEquipment`**) to update `ZoneService` / `CharacterService` / `InventoryService` state. Initializes the `GameLoopService`. Injects `ZoneService`, `GameLoopService`, `BroadcastService`, `CharacterService` (for party validation), `UserService`, `JwtService`, **`InventoryService`**.
    *   `GameLoopService`: **Orchestrator.** Runs the main game tick loop (`tickGameLoop`). Iterates through zones, players, enemies. Calls specialized services for character state, enemy state, movement, and spawning. Calls `BroadcastService` to flush events at the end of each zone tick. Injects `ZoneService`, `CharacterStateService`, `EnemyStateService`, `MovementService`, `SpawningService`, `BroadcastService`.
    *   `CharacterStateService`: **NEW.** Handles processing a single character's state per tick (death, respawn, regen, leashing, state machine logic, aggro, initiating attacks, **item looting logic**). Injects `ZoneService`, `CombatService`, **`InventoryService`, `BroadcastService`**.
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
    *   `UIScene`: Handles overlay UI elements (Chatbox, **Inventory Window**, **Equipment Window**, Tooltips, **Party Panel**). Manages DOM elements for UI interaction (drag/drop, right-click menus). Sends commands like `equipItemCommand`, `unequipItem`, `moveInventoryItem`, `dropInventoryItem`.
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
    *   **`pickup_item` { itemId: string } (NEW - Click-to-Loot)**
    *   **`loot_all_command` {} (NEW - Loot All)**
    *   **`sortInventoryCommand` { sortType: 'name' | 'type' } -> Triggers `inventoryUpdate` (NEW - Sorting)**
*   **Server -> Client:**
    *   `connect_error` (Auth failed or other issue)
    *   `playerJoined` { characters: ZoneCharacterState[] }
    *   `playerLeft` { playerId: string }
    *   `entityUpdate` { updates: Array<{ id: string, x?: number, y?: number, health?: number, state?: string }> }
    *   `chatMessage` { senderName: string, senderCharacterId: string, message: string, timestamp: number }
    *   `combatAction` { attackerId: string, targetId: string, damage: number, type: string }
    *   `entityDied` { entityId: string, type: 'character' | 'enemy' }
    *   **`inventoryUpdate` { inventory: (InventoryItem | null)[] } (NEW - Sparse array representing all potential slots)**
    *   **`equipmentUpdate` { characterId: string, equipment: Partial<Record<EquipmentSlot, InventoryItem>> } (NEW)**
    *   **`itemDropped` { itemId: string, templateId: string, x: number, y: number } (NEW - Loot Phase)**
    *   **`itemPickedUp` { pickerCharacterId: string, itemId: string } (NEW - Loot Phase)**
    *   **`itemsDropped` { items: DroppedItemData[] } (NEW - Loot Phase: Provides full item data for rendering)**
    *   **`levelUpNotification` { characterId: string, newLevel: number, newBaseStats: {...}, xp: number, xpToNextLevel: number } (NEW - Direct to User)**
    *   **`xpUpdate` { characterId: string, level: number, xp: number, xpToNextLevel: number } (NEW - Direct to User)**

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
        // Added for Sorting
        UI_SortButton[Click Sort Button] -->|Sends 'sortInventoryCommand'| NetworkMgr; // NEW
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

        // Added for Sorting
        GG -- sortInventoryCommand --> IS; // NEW
        IS -- sortInventory --> DB_UpdateInvSlotsSorted[DB: Reassign Item.inventorySlot based on sort]; // NEW
        IS -- sortInventory --> BS; // NEW

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
        style DB_UpdateInvSlotsSorted fill:#ddd,stroke:#333,stroke-width:1px // NEW

    end

    subgraph Database (PostgreSQL - InventoryItem Table)
        DB_UpdateInvSlot;
        DB_UpdateEquip;
        DB_UpdateUnequip;
        DB_UpdateInvSlotDrop;
        DB_UpdateInvSlotsSorted; // NEW
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

  @Column({ default: 1 })
  level: number;

  @Column({ type: 'bigint', default: 0 }) // Use bigint for potentially large XP numbers
  xp: number; // **NOTE: TypeORM loads bigint as string, requires conversion (e.g., parseInt) for math**
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
    state: 'idle' | 'moving' | 'attacking' | 'dead' | 'moving_to_loot' | 'looting_area'; // Added loot states
    attackTargetId: string | null;
    targetItemId: string | null; // For moving_to_loot state
    commandState: 'loot_area' | null; // For multi-step commands like loot all
    anchorX: number | null;
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
*   **State Machine (Server):** `CharacterStateService` uses a state machine (`idle`, `moving`, `attacking`, `dead`, **`moving_to_loot`, `looting_area`**) for characters to manage behavior (movement, combat, leashing, respawn, **looting**).
*   **Event-Driven Updates:** Frontend reacts to server events. **Includes specific user events (`levelUpNotification`, `xpUpdate`) and curated UI events (`update-party-hp`, etc.) emitted locally via EventBus between `GameScene` and `UIScene`.**
*   **Bigint Handling:** `Character.xp` is `bigint` in DB, loaded as `string` by TypeORM. Backend service layer (`CharacterService`) explicitly converts to number (`parseInt`) before calculations.
*   **XP Curve:** Backend (`CharacterService`) uses a formula (`baseXP * (L-1)^exponent`) to determine total cumulative XP needed for level milestones.
*   **Level Up Logic:** Backend (`CharacterService`) compares total XP to threshold, applies level/stat gains, handles multi-level gains in a loop, and triggers necessary updates (runtime stats, broadcasts).
*   **UI Decoupling:** `GameScene` handles raw backend events and sprite updates, emitting simplified, specific events for `UIScene` to consume for UI panel updates, reducing direct dependency.

**10. Testing Strategy (Updated)**

*   Remains multi-layered (Unit, Integration, E2E) primarily focused on backend (Jest).
*   Frontend unit testing (Vitest/Jest) for utilities. Manual testing for scenes.
*   **Status:** Unit/Integration test implementation is **active**. Tests have been added for the refactored game loop services (`MovementService`, `SpawningService`, `BroadcastService`, `CharacterStateService`, `EnemyStateService`) and related refactored services (`ZoneService`, `CombatService`).
*   **Policy:** Moving forward, new features or significant refactors **must** include corresponding unit and/or integration tests to ensure correctness and prevent regressions.

**11. Core Real-time Update Flow (Example: XP Gain & Level Up)**

1.  **Enemy Death (`CharacterStateService.processCharacterTick`):** When `combatResult.targetDied` is true for an enemy:
2.  **Fetch Template (`CharacterStateService`):** Gets `Enemy` template via `EnemyService` to find `xpReward`.
3.  **Get Party Members (`CharacterStateService`):** Calls `ZoneService.getPlayerCharactersInZone` to get characters owned by the killer's player.
4.  **Grant XP Loop (`CharacterStateService`):** Iterates through alive party members, calls `CharacterService.addXp(member.id, xpReward)` for each.
5.  **Add XP Logic (`CharacterService.addXp`):**
    *   Converts current `character.xp` (string from bigint) to number using `parseInt`.
    *   Adds `xpToAdd` numerically.
    *   Stores new total XP back to `character.xp`.
6.  **Level Up Check Loop (`CharacterService.addXp`):**
    *   Calculates `xpNeededForNextLevel = calculateXpForLevel(character.level + 1)`.
    *   `while (character.xp >= xpNeededForNextLevel)`:
        *   Increments `character.level`.
        *   Applies base stat gains (`baseHealth`, `baseAttack`, `baseDefense`).
        *   Recalculates `xpNeededForNextLevel` for the *new* next level.
7.  **Post-Level Up Actions (`CharacterService.addXp`):**
    *   If `leveledUp` is true:
        *   Saves updated `Character` entity (new level, stats, total XP).
        *   Calls `calculateEffectiveStats`.
        *   Calls `ZoneService.updateCharacterEffectiveStats`.
        *   Calls `ZoneService.setCharacterHealth` to apply full heal.
        *   Broadcasts `levelUpNotification` via `BroadcastService.sendEventToUser`.
    *   If `leveledUp` is false, saves `Character` with only updated `xp`.
8.  **Broadcast XP Update (`CharacterService.addXp`):**
    *   *Always* (after saving) broadcasts `xpUpdate` via `BroadcastService.sendEventToUser` with final character ID, level, total XP, and total XP needed for next level.
9.  **Client Reception (`NetworkManager`):**
    *   Receives `levelUpNotification` -> Emits to `EventBus`.
    *   Receives `xpUpdate` -> Emits to `EventBus`.
10. **GameScene Handling:**
    *   `handleLevelUpNotification`:
        *   Updates `CharacterSprite` level label and health bar.
        *   Calculates relative XP values (`currentXP`, `neededSpan`).
        *   Emits `party-member-level-up` to `EventBus` for UI.
    *   `handleXpUpdate`:
        *   If character is a party member:
            *   Calculates relative XP values.
            *   Emits `update-party-xp` to `EventBus` for UI.
11. **UIScene Handling:**
    *   `handlePartyMemberLevelUp`:
        *   Updates stored values (`maxHp`, `currentHp`, `currentXp`, `xpToNextLevel`).
        *   Updates HP/XP bars and text overlays.
        *   Applies visual flash.
    *   `handleUpdatePartyXp`:
        *   Updates stored values (`currentXp`, `xpToNextLevel`).
        *   Updates XP bar and text overlay.
    *   **`handleInventoryUpdate`:** (Implicitly handles sorted updates from server)
        *   Receives full inventory array.
        *   Clears and re-renders the inventory grid based on the received array order.

**12. TODO List / Roadmap (Updated)**

**Phase 0-6 (Complete)**
*   Auth, Character Mgmt, Party Select, Movement, Chat: Complete.
*   Basic Enemies & Combat Backend/Frontend: Complete.
*   RTS Character Combat Backend/AI: Complete.
*   Death Handling & Basic Respawn: Complete.
*   Inventory, Loot & Equipment: Complete.
    *   **Note:** Visual ground items and click-to-pickup are implemented. Loot allocation rules (who gets the drop initially) are basic (first come, first served implicitly by pickup command); complex allocation rules are deferred.

**➡️ Phase 7: Experience & Leveling (**Complete**)**
1.  [X] Backend: Add `xpReward` to `Enemy` entity.
2.  [X] Backend: Grant XP to **all alive party members** involved in killing an enemy (`CharacterStateService` -> `CharacterService.addXp`).
3.  [X] Backend: Handle `bigint` `xp` type conversion in `CharacterService`.
4.  [X] Backend: Implement XP curve calculation (`CharacterService.calculateXpForLevel`).
5.  [X] Backend: Implement level-up logic in `CharacterService.addXp` (check threshold based on total XP, increment level, handle multi-level gains).
6.  [X] Backend: Apply base stat gains on level up (`CharacterService.addXp`).
7.  [X] Backend: Update runtime stats (`effectiveStats`) and current health (full heal) via `ZoneService` on level up.
8.  [X] Backend: Broadcast `levelUpNotification` and `xpUpdate` events directly to the user via `BroadcastService`.
9.  [X] Frontend: Add listeners in `NetworkManager` for `levelUpNotification` and `xpUpdate`.
10. [X] Frontend: Centralize backend event handling in `GameScene` (update sprites, emit curated UI events).
11. [X] Frontend: Add Party UI panel (`UIScene`) displaying Name, Level, HP Bar, XP Bar.
12. [X] Frontend: Implement logic in `UIScene` to listen for curated events from `GameScene` and update party panel bars/text.
13. [X] Frontend: Add visual flash effect on level up (`UIScene`).

**➡️ Phase 7 Refinements (Current Focus)**

1.  **Inventory Sorting (High Priority - IN PROGRESS):**
    *   [ ] Frontend (`UIScene`): Add "Sort by Name" / "Sort by Type" buttons to the inventory window HTML, next to pagination controls.
    *   [ ] Frontend (`UIScene`): Add event listeners to the sort buttons.
    *   [X] Shared: Define new WebSocket event `sortInventoryCommand { sortType: 'name' | 'type' }`. **(DONE)**
    *   [X] Frontend (`UIScene`): When a sort button is clicked, send the `sortInventoryCommand` via `NetworkManager`. **(DONE)**
    *   [ ] Backend (`GameGateway`): Add handler for `sortInventoryCommand`.
    *   [ ] Backend (`InventoryService`): Implement `sortInventory(userId, sortType)` method.
        *   Fetch all `InventoryItem`s for the user with non-null `inventorySlot`.
        *   Sort the items based on `sortType` (e.g., `itemTemplate.name` or `itemTemplate.itemType`).
        *   Iterate through the sorted items and assign sequential `inventorySlot` values starting from 0. Handle gaps appropriately (items might not fill slots 0 to N contiguously if the inventory isn't full). Save updated items.
    *   [ ] Backend (`InventoryService` / `GameGateway`): After sorting and saving, fetch the complete (potentially sparse) inventory array for the user (including equipped items and items without slots if necessary for the standard format) and broadcast the standard `inventoryUpdate` event.
    *   [ ] Frontend (`UIScene`): The existing `handleInventoryUpdate` will receive the sorted data and re-render the grid automatically.

2.  **Tooltip Enhancements (Medium Priority):**
    *   [ ] Frontend (`UIScene`): Modify `showItemTooltip` to check if the item is equippable.
    *   [ ] Frontend (`UIScene`): If equippable, get the currently equipped item (if any) in the corresponding slot for the character shown in the Equipment window. Fetch this data from `this.allCharacterEquipment`.
    *   [ ] Frontend (`UIScene`): Display a comparison section in the tooltip showing the current item's stats alongside the equipped item's stats.
    *   [ ] Frontend (`UIScene`/Global): Review tooltip positioning and styling across different UI elements (inventory, equipment slots) for better consistency.

3.  **Combat Refinements (Lower Priority):**
    *   [ ] Shared: Define critical hit chance/multiplier logic (possibly based on stats later).
    *   [ ] Shared: Define miss chance logic (possibly based on stats/levels later).
    *   [ ] Backend (`CombatService`): Modify `handleAttack` to incorporate critical hit and miss checks.
    *   [ ] Shared: Update `combatAction` event payload to include flags/data for crits/misses.
    *   [ ] Frontend (`GameScene`): Modify floating combat text generation to display "CRIT!", "MISS!", and different styling/color for critical damage numbers.
    *   [ ] Frontend (`GameScene`): Add a visual targeting indicator (e.g., circle under sprite) when an enemy is targeted via `attackCommand`. Update the indicator when the target changes or dies.

4.  **Loot Allocation Rules (Future):**
    *   [ ] Backend: Design system to track damage contribution per enemy per user party.
    *   [ ] Backend: When an enemy dies (`EnemyStateService`), determine the eligible user (killer or top damage dealer).
    *   [ ] Backend (`DroppedItem` entity?): Add `claimedByUserId` and potentially `claimExpiresAt` fields to dropped items.
    *   [ ] Backend (`CharacterStateService` - looting): Check `claimedByUserId` before allowing pickup via `pickupItemCommand` or `loot_all_command`.
    *   [ ] Backend: Implement claim expiration logic (e.g., a separate cleanup task or check during pickup).
    *   [ ] Frontend: Potentially add visual cues to ground loot indicating if it's claimed by the player or someone else.

**Phase 8: Stat Allocation & Skills (Planned)**
1.  [ ] Backend: Define `SkillTemplate` entity (ID, name, description, effects, cost, cooldown, requirements).
2.  [ ] Backend: Add relation for learned skills to `Character` entity.
3.  [ ] Backend: Define stat point allocation system (e.g., points per level). Add `unallocatedStatPoints` to `Character`.
4.  [ ] Backend: Add endpoints/WebSocket commands for allocating stat points (`/character/:id/allocate-stats` or `allocateStatPoint` command).
5.  [ ] Backend: Add endpoints/WebSocket commands for learning skills (`learnSkill` command).
6.  [ ] Backend: Implement skill activation command (`activateSkill` { targetId?, skillId }).
7.  [ ] Backend: Integrate skill effects into `CombatService` (damage modifiers, status effects, healing).
8.  [ ] Backend: Add skill cooldown tracking to `ZoneService` runtime character data.
9.  [ ] Frontend: Create Character Sheet UI (`UIScene` or separate scene) displaying stats, allocated points, learned skills.
10. [ ] Frontend: Allow stat point allocation via Character Sheet UI.
11. [ ] Frontend: Display Skill Tree/List UI. Allow learning skills.
12. [ ] Frontend: Add Skill Bar UI (`UIScene`) to assign and activate skills (keybinds/clicks).
13. [ ] Frontend: Add visual effects for skill activation (`GameScene`).
14. [ ] Frontend: Display skill cooldowns on Skill Bar.

// ... (Potentially add Phase 9: Status Effects, Phase 10: Basic Quests, etc.) ...