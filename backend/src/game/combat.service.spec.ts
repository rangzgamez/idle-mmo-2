// backend/src/game/combat.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { CombatService } from './combat.service';

describe('CombatService', () => {
  let combatService: CombatService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CombatService],
    }).compile();

    combatService = module.get<CombatService>(CombatService);
  });

  it('should be defined', () => {
    expect(combatService).toBeDefined();
  });

  describe('calculateDamage', () => {
    it('should calculate damage when attackerAttack is greater than defenderDefense', () => {
      const attackerAttack = 10;
      const defenderDefense = 5;
      const expectedDamage = 5;
      const actualDamage = combatService.calculateDamage(attackerAttack, defenderDefense);
      expect(actualDamage).toBe(expectedDamage);
    });

    it('should return 0 damage when attackerAttack is less than defenderDefense', () => {
      const attackerAttack = 5;
      const defenderDefense = 10;
      const expectedDamage = 0;
      const actualDamage = combatService.calculateDamage(attackerAttack, defenderDefense);
      expect(actualDamage).toBe(expectedDamage);
    });

    it('should return 0 damage when attackerAttack is equal to defenderDefense', () => {
      const attackerAttack = 10;
      const defenderDefense = 10;
      const expectedDamage = 0;
      const actualDamage = combatService.calculateDamage(attackerAttack, defenderDefense);
      expect(actualDamage).toBe(expectedDamage);
    });
  });
});