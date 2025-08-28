// Database seeding script for Idle MMO
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../app.module';
import { UserService } from '../../user/user.service';
import { EnemyService } from '../../enemy/enemy.service';
import { ItemService } from '../../item/item.service';
import { AbilityService } from '../../abilities/ability.service';
import { Repository } from 'typeorm';
import { ItemTemplate } from '../../item/item.entity';
import { Enemy } from '../../enemy/enemy.entity';
import { LootTable } from '../../loot/loot-table.entity';
import { LootTableEntry } from '../../loot/loot-table-entry.entity';
import { ItemType, EquipmentSlot } from '../../item/item.types';
import { AbilityType, TargetType } from '../../abilities/ability.entity';
import { getRepositoryToken } from '@nestjs/typeorm';

async function seed() {
  const app = await NestFactory.createApplicationContext(AppModule);
  
  const userService = app.get(UserService);
  const enemyService = app.get(EnemyService);
  const itemService = app.get(ItemService);
  const abilityService = app.get(AbilityService);
  
  // Get repositories directly for create operations
  const itemRepository = app.get<Repository<ItemTemplate>>(getRepositoryToken(ItemTemplate));
  const enemyRepository = app.get<Repository<Enemy>>(getRepositoryToken(Enemy));
  const lootTableRepository = app.get<Repository<LootTable>>(getRepositoryToken(LootTable));
  const lootEntryRepository = app.get<Repository<LootTableEntry>>(getRepositoryToken(LootTableEntry));

  console.log('🌱 Starting database seeding...');

  try {
    // =========================
    // 1. CREATE TEST USERS
    // =========================
    console.log('👤 Creating test users...');
    
    const testUsers = [
      { username: 'player1', password: 'password123' },
      { username: 'player2', password: 'password123' },
      { username: 'testuser', password: 'test123' },
    ];

    for (const userData of testUsers) {
      try {
        await userService.createUser(userData);
        console.log(`✅ Created user: ${userData.username}`);
      } catch (error) {
        console.log(`⚠️  User ${userData.username} already exists, skipping...`);
      }
    }

    // =========================
    // 2. CHARACTER CLASSES ARE AUTO-SEEDED
    // =========================
    console.log('⚔️  Character classes are auto-seeded by CharacterClassService...');

    // =========================
    // 3. CREATE ITEM TEMPLATES
    // =========================
    console.log('🗡️  Creating item templates...');

    const itemTemplates = [
      // WEAPONS
      { 
        name: 'Bronze Sword', 
        description: 'A basic bronze sword', 
        itemType: ItemType.WEAPON, 
        equipSlot: EquipmentSlot.MAINHAND, 
        attackBonus: 5, 
        spriteKey: 'bronze_sword' 
      },
      { 
        name: 'Iron Blade', 
        description: 'A sharp iron blade', 
        itemType: ItemType.WEAPON, 
        equipSlot: EquipmentSlot.MAINHAND, 
        attackBonus: 8, 
        spriteKey: 'iron_blade' 
      },
      { 
        name: 'Steel Longsword', 
        description: 'A fine steel longsword', 
        itemType: ItemType.WEAPON, 
        equipSlot: EquipmentSlot.MAINHAND, 
        attackBonus: 12, 
        spriteKey: 'steel_longsword' 
      },
      { 
        name: 'Wooden Staff', 
        description: 'A simple wooden staff', 
        itemType: ItemType.WEAPON, 
        equipSlot: EquipmentSlot.MAINHAND, 
        attackBonus: 3, 
        spriteKey: 'wooden_staff' 
      },
      { 
        name: 'Crystal Wand', 
        description: 'A magical crystal wand', 
        itemType: ItemType.WEAPON, 
        equipSlot: EquipmentSlot.MAINHAND, 
        attackBonus: 15, 
        spriteKey: 'crystal_wand' 
      },
      
      // ARMOR
      { 
        name: 'Leather Vest', 
        description: 'Basic leather protection', 
        itemType: ItemType.ARMOR, 
        equipSlot: EquipmentSlot.ARMOR, 
        defenseBonus: 3, 
        spriteKey: 'leather_vest' 
      },
      { 
        name: 'Chain Mail', 
        description: 'Sturdy chain mail armor', 
        itemType: ItemType.ARMOR, 
        equipSlot: EquipmentSlot.ARMOR, 
        defenseBonus: 6, 
        spriteKey: 'chain_mail' 
      },
      { 
        name: 'Plate Armor', 
        description: 'Heavy plate armor', 
        itemType: ItemType.ARMOR, 
        equipSlot: EquipmentSlot.ARMOR, 
        defenseBonus: 10, 
        spriteKey: 'plate_armor' 
      },
      
      // HELMS
      { 
        name: 'Leather Cap', 
        description: 'A simple leather cap', 
        itemType: ItemType.HELM, 
        equipSlot: EquipmentSlot.HELM, 
        defenseBonus: 1, 
        spriteKey: 'leather_cap' 
      },
      { 
        name: 'Iron Helmet', 
        description: 'A protective iron helmet', 
        itemType: ItemType.HELM, 
        equipSlot: EquipmentSlot.HELM, 
        defenseBonus: 3, 
        spriteKey: 'iron_helmet' 
      },
      
      // ACCESSORIES
      { 
        name: 'Bronze Ring', 
        description: 'A simple bronze ring', 
        itemType: ItemType.RING, 
        equipSlot: EquipmentSlot.RING1, 
        attackBonus: 1, 
        spriteKey: 'bronze_ring' 
      },
      { 
        name: 'Silver Ring', 
        description: 'A shining silver ring', 
        itemType: ItemType.RING, 
        equipSlot: EquipmentSlot.RING2, 
        attackBonus: 2, 
        defenseBonus: 1, 
        spriteKey: 'silver_ring' 
      },
      { 
        name: 'Gold Necklace', 
        description: 'An ornate gold necklace', 
        itemType: ItemType.NECKLACE, 
        equipSlot: EquipmentSlot.NECKLACE, 
        healthBonus: 10, 
        spriteKey: 'gold_necklace' 
      },
      
      // GEMS/MATERIALS
      { 
        name: 'Ruby Gem', 
        description: 'A precious ruby gem', 
        itemType: ItemType.MATERIAL, 
        spriteKey: 'ruby_gem' 
      },
      { 
        name: 'Emerald Gem', 
        description: 'A beautiful emerald gem', 
        itemType: ItemType.MATERIAL, 
        spriteKey: 'emerald_gem' 
      },
      { 
        name: 'Sapphire Gem', 
        description: 'A brilliant sapphire gem', 
        itemType: ItemType.MATERIAL, 
        spriteKey: 'sapphire_gem' 
      },
    ];

    for (const itemData of itemTemplates) {
      try {
        // Check if item already exists
        const existingItem = await itemRepository.findOne({ 
          where: { name: itemData.name } 
        });
        
        if (existingItem) {
          console.log(`⚠️  Item ${itemData.name} already exists, skipping...`);
          continue;
        }

        const item = itemRepository.create(itemData);
        await itemRepository.save(item);
        console.log(`✅ Created item: ${itemData.name}`);
      } catch (error) {
        console.log(`❌ Failed to create item ${itemData.name}:`, error.message);
      }
    }

    // =========================
    // 4. CREATE ENEMIES
    // =========================
    console.log('👹 Creating enemies...');

    const enemies = [
      {
        name: 'Goblin',
        level: 1,
        baseHealth: 30,
        baseAttack: 8,
        baseDefense: 2,
        baseSpeed: 50,
        attackRange: 25,
        xpReward: 10,
        behaviorFlags: { isAggressive: true, isStationary: false, canFlee: false },
        spriteKey: 'goblin',
      },
      {
        name: 'Orc Warrior',
        level: 3,
        baseHealth: 80,
        baseAttack: 15,
        baseDefense: 5,
        baseSpeed: 40,
        attackRange: 30,
        xpReward: 25,
        behaviorFlags: { isAggressive: true, isStationary: false, canFlee: false },
        spriteKey: 'orc_warrior',
      },
      {
        name: 'Giant Spider',
        level: 2,
        baseHealth: 45,
        baseAttack: 12,
        baseDefense: 3,
        baseSpeed: 60,
        attackRange: 35,
        xpReward: 18,
        behaviorFlags: { isAggressive: true, isStationary: false, canFlee: true },
        spriteKey: 'spider',
      },
      {
        name: 'Skeleton',
        level: 4,
        baseHealth: 60,
        baseAttack: 18,
        baseDefense: 4,
        baseSpeed: 35,
        attackRange: 40,
        xpReward: 30,
        behaviorFlags: { isAggressive: true, isStationary: false, canFlee: false },
        spriteKey: 'skeleton',
      },
      {
        name: 'Fire Elemental',
        level: 5,
        baseHealth: 100,
        baseAttack: 22,
        baseDefense: 6,
        baseSpeed: 45,
        attackRange: 50,
        xpReward: 50,
        behaviorFlags: { isAggressive: true, isStationary: true, canFlee: false },
        spriteKey: 'fire_elemental',
      },
    ];

    for (const enemyData of enemies) {
      try {
        // Check if enemy already exists
        const existingEnemy = await enemyRepository.findOne({ 
          where: { name: enemyData.name } 
        });
        
        if (existingEnemy) {
          console.log(`⚠️  Enemy ${enemyData.name} already exists, skipping...`);
          continue;
        }

        await enemyService.create(enemyData);
        console.log(`✅ Created enemy: ${enemyData.name}`);
      } catch (error) {
        console.log(`❌ Failed to create enemy ${enemyData.name}:`, error.message);
      }
    }

    // =========================
    // 6. CREATE ABILITIES
    // =========================
    console.log('⚡ Creating abilities...');

    const abilities = [
      {
        name: 'Rain of Arrows',
        type: AbilityType.DAMAGE,
        targetType: TargetType.AOE,
        radius: 100,
        damage: 50,
        cooldown: 5000, // 5 seconds in milliseconds
        manaCost: 20,
        castTime: 1000, // 1 second cast time
        icon: 'rain_of_arrows',
      },
    ];

    for (const abilityData of abilities) {
      try {
        // Check if ability already exists
        const existingAbility = await abilityService.findByName(abilityData.name);
        
        if (existingAbility) {
          console.log(`⚠️  Ability ${abilityData.name} already exists, skipping...`);
          continue;
        }

        await abilityService.create(abilityData);
        console.log(`✅ Created ability: ${abilityData.name}`);
      } catch (error) {
        console.log(`❌ Failed to create ability ${abilityData.name}:`, error.message);
      }
    }

    console.log('🎉 Database seeding completed successfully!');
    console.log('');
    console.log('📊 Summary:');
    console.log(`👤 Users: ${testUsers.length}`);
    console.log(`⚔️  Character Classes: Auto-seeded by service`);
    console.log(`🗡️  Items: ${itemTemplates.length}`);
    console.log(`👹 Enemies: ${enemies.length}`);
    console.log(`⚡ Abilities: ${abilities.length}`);
    console.log('');
    console.log('🎮 You can now:');
    console.log('• Login with any test user (player1/password123, etc.)');
    console.log('• Create characters of different classes');
    console.log('• Fight enemies and collect loot');
    console.log('• Test the complete game loop!');
    console.log('');
    // =========================
    // 5. CREATE LOOT TABLES
    // =========================
    console.log('💰 Creating loot tables...');

    // Get created enemies and items for loot tables
    const allEnemies = await enemyService.findAll();
    const allItems = await itemRepository.find();

    // Helper to find items by name
    const findItem = (name: string) => allItems.find(item => item.name === name);
    const findEnemy = (name: string) => allEnemies.find(enemy => enemy.name === name);

    console.log(`Found ${allEnemies.length} enemies and ${allItems.length} items for loot tables`);

    // Define loot table data
    const lootTableData = [
      {
        name: 'GOBLIN_LOOT',
        description: 'Basic loot for goblins',
        enemyName: 'Goblin',
        entries: [
          { itemName: 'Bronze Ring', dropChance: 15.0, minQuantity: 1, maxQuantity: 1 },
          { itemName: 'Leather Cap', dropChance: 10.0, minQuantity: 1, maxQuantity: 1 },
          { itemName: 'Ruby Gem', dropChance: 5.0, minQuantity: 1, maxQuantity: 1 },
        ]
      },
      {
        name: 'ORC_LOOT',
        description: 'Warrior loot for orcs',
        enemyName: 'Orc Warrior',
        entries: [
          { itemName: 'Bronze Sword', dropChance: 20.0, minQuantity: 1, maxQuantity: 1 },
          { itemName: 'Leather Vest', dropChance: 25.0, minQuantity: 1, maxQuantity: 1 },
          { itemName: 'Iron Helmet', dropChance: 15.0, minQuantity: 1, maxQuantity: 1 },
          { itemName: 'Emerald Gem', dropChance: 8.0, minQuantity: 1, maxQuantity: 1 },
        ]
      },
      {
        name: 'SPIDER_LOOT',
        description: 'Arachnid treasure',
        enemyName: 'Giant Spider',
        entries: [
          { itemName: 'Silver Ring', dropChance: 12.0, minQuantity: 1, maxQuantity: 1 },
          { itemName: 'Sapphire Gem', dropChance: 6.0, minQuantity: 1, maxQuantity: 1 },
        ]
      }
    ];

    // Create loot tables and assign to enemies
    for (const lootData of lootTableData) {
      try {
        const enemy = findEnemy(lootData.enemyName);
        if (!enemy) {
          console.log(`⚠️  Enemy ${lootData.enemyName} not found, skipping loot table`);
          continue;
        }

        // Check if loot table already exists
        const existingTable = await lootTableRepository.findOne({ 
          where: { name: lootData.name } 
        });
        
        if (existingTable) {
          console.log(`⚠️  Loot table ${lootData.name} already exists, skipping...`);
          continue;
        }

        // Create loot table
        const lootTable = lootTableRepository.create({
          name: lootData.name,
          description: lootData.description
        });
        const savedTable = await lootTableRepository.save(lootTable);

        // Create loot table entries
        let entriesCreated = 0;
        for (const entryData of lootData.entries) {
          const item = findItem(entryData.itemName);
          if (!item) {
            console.log(`⚠️  Item ${entryData.itemName} not found for loot table entry`);
            continue;
          }

          const entry = lootEntryRepository.create({
            lootTableId: savedTable.id,
            itemTemplateId: item.id,
            dropChance: entryData.dropChance,
            minQuantity: entryData.minQuantity,
            maxQuantity: entryData.maxQuantity
          });
          await lootEntryRepository.save(entry);
          entriesCreated++;
        }

        // Assign loot table to enemy
        enemy.lootTableId = savedTable.id;
        await enemyRepository.save(enemy);

        console.log(`✅ Created loot table ${lootData.name} with ${entriesCreated} entries for ${enemy.name}`);
      } catch (error) {
        console.log(`❌ Failed to create loot table ${lootData.name}:`, error.message);
      }
    }

  } catch (error) {
    console.error('❌ Seeding failed:', error);
    throw error;
  } finally {
    await app.close();
  }
}

// Run the seeding
seed()
  .then(() => {
    console.log('✅ Seeding process completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Seeding process failed:', error);
    process.exit(1);
  });