import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  chargedPrice,
  MAX_PRICE,
  multiplierForPrice,
  type GmItemPriceResult,
  type GmItemSearchResult,
  type GmVendorItem,
  type GmVendorList,
  type ItemPriceInput,
} from '@4story-portal/shared';
import { className, countryName } from '../characters/character-codes.js';
import { type AppConfig, CONFIG } from '../config/config.js';
import { GM_REPOSITORY, type GmRepository } from './gm.repository.js';
import { itemIcons, npcFaces } from './game-icons.generated.js';
import { MAP_NAMES } from './game-places.generated.js';
import {
  type ItemRow,
  type PriceColumn,
  type StockRow,
  VENDOR_TYPES,
  VENDORS_REPOSITORY,
  type VendorRow,
  type VendorsRepository,
} from './vendors.repository.js';

type Actor = { username: string; ip: string };

const SHOP_LIMIT = 255;
const CLASS_COUNT = 6;
const COUNTRY_ALL = 3; // TCONTRY_N
const CONDITION_ALL_COUNTRY = 4; // DCC_ALLCOUNTRY

/** The first class and country whose shop view exceeds 255 items, or null. Mirrors SendCS_NPCITEMLIST_ACK. */
export function shopOverflow(
  condition: number,
  stock: { classMask: number; itemCountry: number }[],
): { classId: number; country: number } | null {
  for (let classId = 0; classId < CLASS_COUNT; classId++) {
    for (const country of [0, 1]) {
      const count = stock.filter(
        (item) =>
          (item.classMask & (1 << classId)) !== 0 &&
          (item.itemCountry === COUNTRY_ALL || item.itemCountry === country || condition === CONDITION_ALL_COUNTRY),
      ).length;
      if (count > SHOP_LIMIT) return { classId, country };
    }
  }
  return null;
}

const isPvp = (vendor: VendorRow) => vendor.type === VENDOR_TYPES.pvp;
const vendorLabel = (vendor: VendorRow) => `${vendor.name || 'NPC'} (${vendor.id})`;

@Injectable()
export class VendorsService {
  private readonly logger = new Logger(VendorsService.name);

  constructor(
    @Inject(VENDORS_REPOSITORY) private readonly repo: VendorsRepository,
    @Inject(GM_REPOSITORY) private readonly gm: GmRepository,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  async list(): Promise<GmVendorList> {
    const rows = await this.repo.listVendors();
    return {
      database: this.config.db.gameName,
      vendors: rows.map((row) => ({
        id: row.id,
        name: row.name,
        title: row.title,
        shop: isPvp(row) ? 'pvp' : 'money',
        country: countryName(row.country),
        mapId: row.mapId,
        mapName: MAP_NAMES[row.mapId] ?? null,
        itemCount: row.itemCount,
        faceIcon: npcFaces[row.id] ?? null,
      })),
    };
  }

  async stock(vendorId: number): Promise<GmVendorItem[]> {
    const vendor = await this.requireVendor(vendorId);
    const rows = await this.repo.listStock(vendorId);
    return rows.map((row) => this.stockItem(row, isPvp(vendor)));
  }

  async addItem(vendorId: number, itemId: number, actor: Actor): Promise<GmVendorItem> {
    const vendor = await this.requireVendor(vendorId);
    if (!Object.hasOwn(itemIcons, itemId)) {
      throw new UnprocessableEntityException('Not in the game client, adding it would crash players opening this shop');
    }
    const item = await this.repo.findItem(itemId);
    if (!item) throw new UnprocessableEntityException('Not in the game database, the server would ignore it');

    const current = await this.repo.listStock(vendorId);
    if (current.some((row) => row.itemId === itemId)) throw new ConflictException('Already sold by this vendor');
    const overflow = shopOverflow(vendor.condition, [...current, item]);
    if (overflow) {
      throw new UnprocessableEntityException(
        `Would exceed the ${SHOP_LIMIT} item shop limit for ${className(overflow.classId)} in ${countryName(overflow.country)}`,
      );
    }

    // False means another GM added it after the check above.
    if (!(await this.repo.addStock(vendorId, itemId))) throw new ConflictException('Already sold by this vendor');
    await this.audit('VENDORADD', `${vendorLabel(vendor)}: +${itemId} ${item.name}`, actor);
    return this.stockItem({ ...item, soldBy: item.soldBy + 1 }, isPvp(vendor));
  }

  async removeItem(vendorId: number, itemId: number, actor: Actor): Promise<void> {
    const vendor = await this.requireVendor(vendorId);
    const item = await this.repo.findItem(itemId);
    if (!(await this.repo.removeStock(vendorId, itemId))) throw new NotFoundException('Not sold by this vendor');
    await this.audit('VENDORDEL', `${vendorLabel(vendor)}: -${itemId} ${item?.name ?? `Unknown item #${itemId}`}`, actor);
  }

  async setPrice(itemId: number, input: ItemPriceInput, actor: Actor): Promise<GmItemPriceResult> {
    const item = await this.repo.findItem(itemId);
    if (!item) throw new NotFoundException('Item not found');

    const pvp = input.currency === 'pvp';
    const base = pvp ? item.pvpMoney : item.money;
    if (base === 0) throw new UnprocessableEntityException("This item's level has no price, so it can't be set");

    const multiplier = multiplierForPrice(base, input.amount);
    const price = chargedPrice(base, multiplier);
    // The game multiplies price by count in a DWORD, so a full stack must not wrap around.
    if (Math.max(input.amount, price) * Math.max(item.stack, 1) > MAX_PRICE) {
      throw new UnprocessableEntityException('Price too high, buying a full stack would overflow');
    }

    const column: PriceColumn = pvp ? 'fPvPrice' : 'fPrice';
    const oldMultiplier = pvp ? item.fPvPrice : item.fPrice;
    await this.repo.setPrice(itemId, column, multiplier);
    await this.audit(
      'ITEMPRICE',
      `${itemId} ${item.name}: ${column} ${oldMultiplier} -> ${multiplier}, ${chargedPrice(base, oldMultiplier)} -> ${price} ${pvp ? 'points' : 'cron'}`,
      actor,
    );
    return { itemId, name: item.name, price, multiplier, soldBy: item.soldBy };
  }

  async searchItems(q: string): Promise<GmItemSearchResult[]> {
    const rows = await this.repo.searchItems(q);
    return rows.map((row) => ({
      itemId: row.itemId,
      name: row.name,
      level: row.level,
      icon: itemIcons[row.itemId] ?? null,
      price: chargedPrice(row.money, row.fPrice),
      pvpPrice: chargedPrice(row.pvpMoney, row.fPvPrice),
      inClient: Object.hasOwn(itemIcons, row.itemId),
    }));
  }

  private async requireVendor(id: number): Promise<VendorRow> {
    const vendor = await this.repo.findVendor(id);
    if (!vendor) throw new NotFoundException('That NPC is not a vendor');
    return vendor;
  }

  private stockItem(row: StockRow | ItemRow, pvp: boolean): GmVendorItem {
    const base = pvp ? row.pvpMoney : row.money;
    const multiplier = pvp ? row.fPvPrice : row.fPrice;
    return {
      itemId: row.itemId,
      name: row.name,
      level: row.level,
      icon: itemIcons[row.itemId] ?? null,
      base,
      multiplier,
      price: chargedPrice(base, multiplier),
      soldBy: row.soldBy,
    };
  }

  private async audit(command: string, log: string, actor: Actor): Promise<void> {
    try {
      await this.gm.writeAudit({ ip: actor.ip, gmId: actor.username, command, log });
    } catch (error) {
      this.logger.warn(`Could not write the ${command} audit row: ${error instanceof Error ? error.message : error}`);
    }
  }
}
