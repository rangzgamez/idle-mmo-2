# Database Seeding

This directory contains scripts to populate your development database with sample game data.

## What Gets Seeded

### 👤 Test Users
- `player1` / `password123`
- `player2` / `password123` 
- `testuser` / `test123`

### ⚔️ Character Classes
- **Fighter**: High health & attack, melee range
- **Wizard**: High attack, low health, long range
- **Priest**: Healing abilities, medium stats
- **Archer**: Balanced ranged fighter

### 🗡️ Items & Equipment
- **Weapons**: Swords, staffs, wands (Bronze → Steel progression)
- **Armor**: Vests, mail, plate armor 
- **Helms**: Caps and helmets
- **Accessories**: Rings and necklaces with stat bonuses
- **Gems**: Valuable collectibles

### 👹 Enemies
- **Goblin** (Level 1): Weak starter enemy
- **Giant Spider** (Level 2): Fast, can flee
- **Orc Warrior** (Level 3): Tough melee fighter  
- **Skeleton** (Level 4): Undead warrior
- **Fire Elemental** (Level 5): Stationary but powerful

### 💰 Loot Tables
Each enemy has realistic drop chances for appropriate items:
- Goblins drop basic gear and gems
- Orcs drop weapons and armor
- Spiders drop accessories

## Running the Seeder

```bash
# Make sure your backend is built first
npm run build

# Run the seeding script
npm run seed

# Or run directly with ts-node
npx ts-node src/database/seeds/seed.ts
```

## Notes

- Safe to run multiple times (skips existing data)
- Requires running PostgreSQL database
- Creates realistic game progression from level 1-5
- All passwords are `password123` or `test123`
- Items have proper stat bonuses and equipment slots