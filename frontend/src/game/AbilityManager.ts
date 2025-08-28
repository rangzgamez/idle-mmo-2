import { NetworkManager } from '../network/NetworkManager';
import { EventBus } from '../EventBus';

export interface Ability {
  id: string;
  name: string;
  type: 'DAMAGE' | 'HEAL' | 'BUFF' | 'DEBUFF';
  targetType: 'SINGLE' | 'AOE' | 'SELF' | 'LINE';
  radius?: number;
  damage?: number;
  healing?: number;
  cooldown: number;
  manaCost: number;
  castTime: number;
  icon: string;
}

export class AbilityManager {
  private abilities: Map<string, Ability> = new Map();
  private cooldowns: Map<string, number> = new Map();
  private networkManager: NetworkManager;

  constructor(networkManager: NetworkManager) {
    this.networkManager = networkManager;
  }

  loadAbilities(): void {
    console.log('🎯 AbilityManager: Requesting abilities via WebSocket...');
    
    // Listen for abilities response via EventBus
    EventBus.on('abilities-loaded', (data: { abilities: Ability[] }) => {
      console.log('🎯 AbilityManager: Received abilities data:', data);
      
      data.abilities.forEach(ability => {
        this.abilities.set(ability.id, ability);
        console.log(`🎯 AbilityManager: Loaded ability: ${ability.name} (ID: ${ability.id})`);
      });
      
      console.log(`🎯 AbilityManager: Successfully loaded ${data.abilities.length} abilities`);
    });

    // Request abilities from server
    this.networkManager.sendMessage('requestAbilities');
  }

  getAbility(abilityId: string): Ability | undefined {
    return this.abilities.get(abilityId);
  }

  getAllAbilities(): Ability[] {
    return Array.from(this.abilities.values());
  }

  canCastAbility(abilityId: string): boolean {
    const ability = this.getAbility(abilityId);
    if (!ability) return false;

    const lastUsed = this.cooldowns.get(abilityId) || 0;
    const now = Date.now();
    
    return (now - lastUsed) >= ability.cooldown;
  }

  castAbility(abilityId: string, targetX: number, targetY: number): boolean {
    if (!this.canCastAbility(abilityId)) {
      console.log('Ability is on cooldown');
      return false;
    }

    const ability = this.getAbility(abilityId);
    if (!ability) {
      console.error('Ability not found:', abilityId);
      return false;
    }

    this.networkManager.sendMessage('castSpell', {
      abilityId,
      targetX,
      targetY
    });

    this.cooldowns.set(abilityId, Date.now());
    console.log(`Cast ${ability.name} at (${targetX}, ${targetY})`);
    return true;
  }

  getRemainingCooldown(abilityId: string): number {
    const ability = this.getAbility(abilityId);
    if (!ability) return 0;

    const lastUsed = this.cooldowns.get(abilityId) || 0;
    const elapsed = Date.now() - lastUsed;
    const remaining = Math.max(0, ability.cooldown - elapsed);
    
    return remaining;
  }
}