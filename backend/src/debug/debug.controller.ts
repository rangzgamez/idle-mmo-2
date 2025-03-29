// backend/src/debug/debug.controller.ts
import { Controller, Get } from '@nestjs/common';
import { ZoneService } from '../game/zone.service';

@Controller('debug')
export class DebugController {
  constructor(private readonly zoneService: ZoneService) {}

  @Get('zones')
  async getZones() {
      const allZones = {};
    for (const [zoneId, zone] of (this.zoneService as any).zones.entries()){
        let enemyInstanceIds = new Array();

        if (zone.enemies){
            for (const [key, val] of zone.enemies){
                enemyInstanceIds.push(val);
            }
        }
        let playerCharacterIds = new Array();
        if(zone.players){
            for(const [key, val] of zone.players){
                for (const character of val.characters){
                    playerCharacterIds.push(character);
                }
            }
        }

          allZones[zoneId] = {"enemies" : enemyInstanceIds, "playerCharacters": playerCharacterIds}
    }

    return allZones;
  }
}