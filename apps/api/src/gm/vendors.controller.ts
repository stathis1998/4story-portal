import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import {
  addVendorItemSchema,
  type AddVendorItem,
  type GmItemPriceResult,
  type GmItemSearchResult,
  gmIdSchema,
  type GmVendorItem,
  type GmVendorList,
  itemPriceSchema,
  type ItemPriceInput,
  itemSearchQuerySchema,
  type SessionUser,
  type VendorShop,
  vendorShopSchema,
} from '@4story-portal/shared';
import type { Request } from 'express';
import { GmGuard } from '../auth/gm-access.js';
import { CurrentUser, SessionGuard } from '../auth/session.guard.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { VendorsService } from './vendors.service.js';

const idPipe = new ZodValidationPipe(gmIdSchema);

@Controller('gm')
@UseGuards(SessionGuard, GmGuard)
export class VendorsController {
  constructor(private readonly vendors: VendorsService) {}

  @Get('vendors')
  list(): Promise<GmVendorList> {
    return this.vendors.list();
  }

  @Get('vendors/:id/items')
  stock(@Param('id', idPipe) id: number): Promise<GmVendorItem[]> {
    return this.vendors.stock(id);
  }

  @Post('vendors/:id/items')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  addItem(
    @Param('id', idPipe) id: number,
    @Body(new ZodValidationPipe(addVendorItemSchema)) body: AddVendorItem,
    @CurrentUser() user: SessionUser,
    @Req() req: Request,
  ): Promise<GmVendorItem> {
    return this.vendors.addItem(id, body.itemId, { username: user.username, ip: req.ip ?? '' });
  }

  @Delete('vendors/:id/items/:itemId')
  @HttpCode(204)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  removeItem(
    @Param('id', idPipe) id: number,
    @Param('itemId', idPipe) itemId: number,
    @CurrentUser() user: SessionUser,
    @Req() req: Request,
  ): Promise<void> {
    return this.vendors.removeItem(id, itemId, { username: user.username, ip: req.ip ?? '' });
  }

  @Put('items/:itemId/price')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  setPrice(
    @Param('itemId', idPipe) itemId: number,
    @Body(new ZodValidationPipe(itemPriceSchema)) body: ItemPriceInput,
    @CurrentUser() user: SessionUser,
    @Req() req: Request,
  ): Promise<GmItemPriceResult> {
    return this.vendors.setPrice(itemId, body, { username: user.username, ip: req.ip ?? '' });
  }

  @Get('items')
  search(
    @Query('q', new ZodValidationPipe(itemSearchQuerySchema)) q: string,
    @Query('shop', new ZodValidationPipe(vendorShopSchema)) shop: VendorShop,
  ): Promise<GmItemSearchResult[]> {
    return this.vendors.searchItems(q, shop);
  }
}
