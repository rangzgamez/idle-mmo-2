## **Idle Browser MMO - Project Documentation**

**Version:** 0.1 (Initial Draft)
**Date:** 2023-10-27

**1. Overview**

This document outlines the architecture, database schema, and initial development plan for an Idle Browser MMO game. The game features real-time multiplayer interaction in a top-down view, RTS-style character control, automated combat mechanics, and social features like chat.

**2. Core Features (Initial Scope)**

*   **Authentication:** User registration and login.
*   **Character Management:** Create multiple characters per account, select up to 3 active characters for gameplay.
*   **Top-Down World:** Players navigate a 2D world with a top-down camera.
*   **RTS-Style Control:** Point-and-click movement for selected characters. Click on enemies to initiate attacks.
*   **Idle/Automated Combat:**
    *   Characters auto-attack nearby enemies once engaged.
    *   Melee characters move to engage, returning to an anchor point if pulled too far (leashing).
    *   Healer characters auto-heal nearby allies.
    *   Enemies aggro players within range.
*   **Multiplayer Zones:** Multiple players can inhabit the same zone, see each other, and fight enemies together.
*   **Enemy Spawning & Loot:** Enemies automatically spawn in zones and drop items upon defeat.
*   **Item Pickup:** Players click on dropped items to pick them up.
*   **Shared Player Inventory:** A single inventory shared across all characters of a player.
*   **Basic Equipment:** Characters can equip a Weapon and Armor item from the shared inventory.
*   **Pets:** Players can acquire pets that automatically pick up loot (slowly) and require feeding.
*   **Chat:** Real-time chat functionality within game zones.

**3. Technology Stack**

*   **Frontend:** Phaser 3 (JavaScript/TypeScript)
*   **Backend:** NestJS (Node.js / TypeScript)
*   **Real-time Communication:** WebSockets (via Socket.IO library, integrated with NestJS)
*   **API:** RESTful API for Authentication and non-real-time data fetching (via NestJS).
*   **Database:** PostgreSQL (Relational Database)
*   **ORM:** TypeORM (or Prisma - TBD, TypeORM is a common NestJS choice)
*   **Authentication:** JSON Web Tokens (JWT)

**4. System Architecture Diagram (Conceptual Text)**

```
+-------------------+      (HTTPS/REST)       +----------------------+      +------------+
|                   | <---------------------> |                      | <--> |            |
|   Client Browser  |      (Auth, Initial    |   NestJS Backend     |      | PostgreSQL |
|   (Phaser.js)     |       Data Load)        |   (Node.js)          |      |  Database  |
|                   |                         |                      | <--> |            |
|                   |      (WSS/WebSockets)   |  - Auth Module       |      +------------+
|                   | <---------------------> |  - User Module       |
|                   |      (Real-time Game   |  - Character Module  |
|                   |       State, Actions,   |  - Game Module (WS)  |
|                   |       Chat)             |  - Chat Module (WS)  |
|                   |                         |  - Inventory Module  |
|                   |                         |  - Pet Module        |
+-------------------+                         +----------------------+
       /|\                                             |
        |                                              | (Load Balancer - Optional)
        |                                             \|/
      User                                       Server Infrastructure
```

**Explanation:**

1.  **Client (Phaser.js):** Renders the game, handles user input, displays UI. Communicates with the backend.
2.  **Backend (NestJS):** The **Authoritative Server**. Manages all game logic, state, persistence, and communication.
    *   **REST API:** Used for stateless operations like Login, Register, fetching initial character lists. Secured by JWT where necessary.
    *   **WebSockets:** Used for persistent, real-time communication (movement, combat, chat, state synchronization). Connections are authenticated using JWT. Clients join specific 'rooms' corresponding to game zones.
3.  **Database (PostgreSQL):** Persists all user data, character data, inventory, item definitions, etc. Accessed by the backend via an ORM.
4.  **Communication Flow:**
    *   User Logs in/Registers via REST. Receives JWT.
    *   Client connects to WebSocket server, sending JWT for authentication.
    *   Client requests to enter a zone.
    *   Server validates, adds client to zone room, runs AI/game logic, and broadcasts state updates via WebSockets.
    *   Client sends commands (move, attack, pickup, chat) via WebSockets.
    *   Server validates commands, updates state, runs logic, and broadcasts results.

**5. Backend Module Breakdown (NestJS)**

*   **`AppModule`:** Root module.
*   **`AuthModule`:** Handles user registration, login, JWT generation/validation. Uses `Passport.js`.
*   **`UserModule`:** Manages user-specific data (links to characters, inventory, pets).
*   **`CharacterModule`:** CRUD for characters, manages stats, equipment, linking to `User`.
*   **`InventoryModule`:** Manages the shared player inventory, item instances, equipping/unequipping logic (interacts with `CharacterModule`). Defines `ItemTemplate`.
*   **`GameModule`:** Core real-time logic.
    *   `GameGateway`: Handles WebSocket connections, routing messages, managing rooms (zones).
    *   `ZoneService`: Manages state of individual game zones (players, enemies, dropped items).
    *   `CombatService`: Calculates combat outcomes, damage, healing.
    *   `MovementService`: Handles position updates, validation, pathfinding (basic initially).
    *   `AIService`: Manages enemy AI (spawning, aggro, attacking) and character automation (auto-attack targeting, healer targeting, pet actions).
    *   `LootService`: Handles loot table processing and item drop generation.
*   **`ChatModule`:**
    *   `ChatGateway`: Handles chat message broadcasting within zones.
*   **`PetModule`:** Manages pet creation, data, feeding, and auto-pickup AI (via `AIService`).
*   **`DatabaseModule`:** Configures database connection (e.g., TypeORM).

**6. Frontend Scene Breakdown (Phaser.js)**

*   **`BootScene`:** Loads minimal assets for the loading screen/bar.
*   **`PreloadScene`:** Loads all game assets (images, spritesheets, tilemaps, audio).
*   **`LoginScene`:** UI for Login/Register. Communicates with backend REST API. Stores JWT on success.
*   **`CharacterSelectScene`:** Fetches characters via REST. Allows creation and selection (up to 3). Transitions to `GameScene`.
*   **`GameScene`:** Main gameplay area.
    *   Connects to WebSocket server.
    *   Loads/renders tilemap and entities (player characters, other players, enemies, items, pets).
    *   Handles player input (movement clicks, target clicks, item clicks). Sends commands via WebSocket.
    *   Receives state updates via WebSocket and updates sprite positions (with interpolation), health, animations.
    *   Manages camera.
*   **`UIScene`:** Runs parallel to `GameScene`.
    *   Displays HUD (character info, health bars).
    *   Displays Chatbox (input/output). Sends/receives chat messages via WebSocket.
    *   Displays Inventory/Equipment UI (future).
    *   Displays Pet UI (future).

**7. WebSocket Communication Events (Preliminary)**

*   **Client -> Server:**
    *   `authenticate` (Implicitly on connection with JWT)
    *   `enterZone` { zoneId: string }
    *   `selectParty` { characterIds: string[] }
    *   `moveCommand` { characterId?: string; target: { x: number, y: number } } // characterId optional for multi-select
    *   `attackCommand` { characterId?: string; targetEnemyId: string }
    *   `pickupItemCommand` { characterId: string; itemId: string } // characterId = who is picking up
    *   `sendMessage` { message: string }
    *   `equipItem` { characterId: string; inventoryItemId: string; slot: 'weapon' | 'armor' }
    *   `unequipItem` { characterId: string; slot: 'weapon' | 'armor' }
    *   `feedPet` { petId: string; foodItemId: string }
*   **Server -> Client:**
    *   `connect_error` (Authentication failed)
    *   `zoneState` { players: object[], enemies: object[], items: object[] } // Initial state on joining
    *   `playerJoined` { player: object }
    *   `playerLeft` { playerId: string }
    *   `partySelected` { success: boolean, characters: object[] }
    *   `entityUpdate` { updates: Array<{ id: string, x?: number, y?: number, health?: number, state?: string, targetId?: string }> } // Batch updates
    *   `combatAction` { attackerId: string, targetId: string, damage?: number, heal?: number, type: 'attack' | 'heal' }
    *   `entityDied` { id: string, type: 'player' | 'enemy' }
    *   `itemDropped` { item: { id: string, baseItemId: string, x: number, y: number, icon: string } }
    *   `itemPickedUp` { pickerId: string, itemId: string }
    *   `inventoryUpdate` { items: object[] } // Full or partial update
    *   `equipmentUpdate` { characterId: string, equipment: object }
    *   `chatMessage` { senderName: string, message: string }
    *   `petUpdate` { pet: object }

**8. Database Schema (PostgreSQL - Conceptual using TypeORM Entities)**

```typescript
// --- User ---
@Entity()
export class User {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ unique: true }) username: string;
  @Column() passwordHash: string;
  @OneToMany(() => Character, character => character.user) characters: Character[];
  @OneToMany(() => InventoryItem, item => item.owner) inventory: InventoryItem[];
  @OneToMany(() => Pet, pet => pet.owner) pets: Pet[];
  @CreateDateColumn() createdAt: Date;
  @UpdateDateColumn() updatedAt: Date;
}

// --- Character ---
@Entity()
export class Character {
  @PrimaryGeneratedColumn('uuid') id: string;
  @ManyToOne(() => User, user => user.characters) user: User;
  @Column() name: string;
  @Column({ default: 1 }) level: number;
  @Column({ default: 0 }) xp: number;
  // Define stats (e.g., hp, mp, str, int, def, speed, attackRange, healRange etc)
  @Column('jsonb', { default: {} }) stats: Record<string, any>;
  @Column('float', { nullable: true }) positionX: number;
  @Column('float', { nullable: true }) positionY: number;
  @Column({ nullable: true }) currentZoneId: string; // Or reference a Zone entity

  // Equipment - References specific InventoryItem instances
  @OneToOne(() => InventoryItem, { nullable: true, eager: true }) // Eager load equipped items? TBD
  @JoinColumn() equippedWeapon: InventoryItem | null;
  @Column({ nullable: true }) equippedWeaponId: string | null;

  @OneToOne(() => InventoryItem, { nullable: true, eager: true })
  @JoinColumn() equippedArmor: InventoryItem | null;
  @Column({ nullable: true }) equippedArmorId: string | null;

  @CreateDateColumn() createdAt: Date;
  @UpdateDateColumn() updatedAt: Date;
}

// --- Item Template (Definition) ---
@Entity()
export class ItemTemplate {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() name: string;
  @Column({ default: '' }) description: string;
  @Column() type: 'Weapon' | 'Armor' | 'Consumable' | 'PetFood' | 'Material';
  @Column() slot: 'Weapon' | 'Armor' | 'None';
  @Column('jsonb', { default: {} }) statsModifier: Record<string, any>; // { "str": 5, "attack": 10 }
  @Column({ default: 'default_icon' }) icon: string;
  @Column({ default: 1 }) maxStack: number; // 1 for non-stackable
}

// --- Inventory Item (Instance) ---
@Entity()
export class InventoryItem {
  @PrimaryGeneratedColumn('uuid') id: string; // Unique instance ID
  @ManyToOne(() => User, user => user.inventory) owner: User;
  @Column() ownerUserId: string;
  @ManyToOne(() => ItemTemplate, { eager: true }) template: ItemTemplate; // Eager load base item info
  @Column() templateId: string;
  @Column({ default: 1 }) quantity: number;
  // Optional: For items with unique stats like durability, enchantments
  @Column('jsonb', { nullable: true }) instanceData: Record<string, any>;
  @CreateDateColumn() createdAt: Date;
}

// --- Pet ---
@Entity()
export class Pet {
  @PrimaryGeneratedColumn('uuid') id: string;
  @ManyToOne(() => User, user => user.pets) owner: User;
  @Column() ownerUserId: string;
  @Column() name: string;
  @Column({ default: 1 }) level: number;
  @Column({ default: 100 }) hunger: number; // Example: 0-100
  @Column('jsonb', { default: {} }) stats: Record<string, any>; // e.g., pickupSpeed, pickupRange
  @CreateDateColumn() createdAt: Date;
  @UpdateDateColumn() updatedAt: Date;
}

// --- Potentially Needed Later ---
// Zone Entity
// EnemyTemplate Entity
// DroppedItem Entity (maybe managed in memory/cache primarily for performance)
```

**9. Initial TODO List / Roadmap**

**Phase 0: Setup & Foundations**

1.  [ ] Initialize NestJS Backend Project (`nestjs new backend`)
2.  [ ] Initialize Phaser Frontend Project (using a template or `npm init phaser`)
3.  [ ] Setup PostgreSQL Database & Connect NestJS (TypeORM)
4.  [ ] Define basic `User` Entity & Migration.
5.  [ ] Implement `AuthModule` (Register, Login REST endpoints, JWT generation/validation).
6.  [ ] Implement basic password hashing (`bcrypt`).
7.  [ ] Implement `UserService` (create, find user).
8.  [ ] Setup basic WebSocket Gateway (`GameGateway`) in NestJS (`@nestjs/websockets`, Socket.IO adapter).
9.  [ ] Implement WebSocket connection authentication using JWT.

**Phase 1: Character & Basic World Entry**

10. [ ] Define `Character` Entity & Migration (basic fields: name, link to user).
11. [ ] Implement `CharacterModule` (Create, List characters for a user - REST endpoints).
12. [ ] Implement `CharacterService`.
13. [ ] Frontend: Create `LoginScene` (UI, calls backend Auth API). Store JWT.
14. [ ] Frontend: Create `CharacterSelectScene` (UI, calls backend Character API, allows creation).
15. [ ] Frontend: Create basic `GameScene` and `UIScene`.
16. [ ] Frontend: Implement `NetworkingManager` to handle WebSocket connection.
17. [ ] Backend: Implement `selectParty` WebSocket handler (link selected characters to player's connection state).
18. [ ] Backend: Implement `enterZone` WebSocket handler (add player to zone, maybe load basic zone data).
19. [ ] Frontend: On entering `GameScene`, connect WebSocket, send `selectParty`, send `enterZone`.
20. [ ] Frontend: Load a basic Tilemap in `GameScene`.
21. [ ] Backend: Send basic `zoneState` (initially just the player's characters) on `enterZone` success.
22. [ ] Frontend: Render player characters based on `zoneState`.

**Phase 2: Movement & Basic Sync**

23. [ ] Backend: Update `Character` entity with `positionX`, `positionY`, `currentZoneId`.
24. [ ] Backend: Implement basic `ZoneService` to track entities in zones.
25. [ ] Backend: Implement `moveCommand` WebSocket handler. Validate, update character position *in server memory* (ZoneService).
26. [ ] Backend: Implement basic game loop to tick updates.
27. [ ] Backend: Broadcast `entityUpdate` messages with new positions from game loop.
28. [ ] Frontend: Handle `moveCommand` input (click on ground). Send command.
29. [ ] Frontend: Handle `entityUpdate` messages. Update sprite positions (implement simple interpolation).
30. [ ] Frontend: Make camera follow one of the player's characters.
31. [ ] Backend: Handle `playerJoined` / `playerLeft` broadcasts.
32. [ ] Frontend: Handle `playerJoined` / `playerLeft` (create/destroy other player sprites).

**Phase 3: Basic Combat & Enemies**

33. [ ] Backend: Define `EnemyTemplate` (stats, name, etc. - maybe just in code initially).
34. [ ] Backend: Define basic `CombatService`.
35. [ ] Backend: Define basic `AIService` (enemy spawning, basic aggro).
36. [ ] Backend: Spawn dummy enemies in `ZoneService`.
37. [ ] Backend: Implement `attackCommand` WebSocket handler.
38. [ ] Backend: Implement basic auto-attack logic (target nearest enemy if in 'attack' state) in `AIService`.
39. [ ] Backend: Calculate damage in `CombatService`. Update health (in `ZoneService` state).
40. [ ] Backend: Broadcast `combatAction` and `entityUpdate` (for health changes).
41. [ ] Backend: Handle entity death (health <= 0). Broadcast `entityDied`.
42. [ ] Frontend: Handle `attackCommand` input (click on enemy). Send command.
43. [ ] Frontend: Display enemies based on `zoneState` / `entityUpdate`.
44. [ ] Frontend: Display health bars (update via `entityUpdate`).
45. [ ] Frontend: Play basic attack animations/effects on `combatAction`.
46. [ ] Frontend: Remove sprites on `entityDied`.

**Phase 4: Inventory, Loot & Equipment**

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

**Phase 5: Chat & Pets (Lower Priority)**

58. [ ] Backend: Implement `ChatModule` (`ChatGateway`, `sendMessage` handler). Broadcast `chatMessage` to zone room.
59. [ ] Frontend: Implement Chat UI (input/display) in `UIScene`. Send/receive messages.
60. [ ] Backend: Define `Pet` entity & migration.
61. [ ] Backend: Implement `PetModule`/`PetService`.
62. [ ] Backend: Implement basic Pet AI (find nearby item, move, trigger pickup) in `AIService`. Rate limit this.
63. [ ] Backend: Implement `feedPet` command/logic.
64. [ ] Frontend: Render Pet sprite.
65. [ ] Frontend: Pet UI (hunger status, feed button).

---

This provides a solid foundation. We can refine the database schema, WebSocket events, and TODO list as we progress through development. Does this structure and level of detail work for you? Ready to start tackling Phase 0?