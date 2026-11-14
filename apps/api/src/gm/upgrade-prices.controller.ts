import { Controller, Get, UseGuards } from '@nestjs/common';
import type { UpgradePrices } from '@4story-portal/shared';
import { SessionGuard } from '../auth/session.guard.js';
import { VendorsService } from './vendors.service.js';

/** Open to every player, unlike the GM vendor routes: the upgrade simulator starts from these prices. */
@Controller()
@UseGuards(SessionGuard)
export class UpgradePricesController {
  constructor(private readonly vendors: VendorsService) {}

  @Get('upgrade-prices')
  prices(): Promise<UpgradePrices> {
    return this.vendors.upgradePrices();
  }
}
