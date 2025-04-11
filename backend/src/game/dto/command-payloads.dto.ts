import { IsEnum } from 'class-validator';

export enum SortType {
  NAME = 'name',
  TYPE = 'type',
  NEWEST = 'newest',
}

export class SortInventoryCommandPayload {
  @IsEnum(SortType)
  sortType: SortType;
} 