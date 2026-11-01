import { z } from 'zod';

// TControlSvr copies names into fixed buffers, so keep them short and plain.
export const characterNameSchema = z
  .string()
  .regex(/^[A-Za-z0-9]{1,16}$/, 'Use 1-16 letters or digits');

// X and Z must fit the one-byte cell index (value / 1024 < 256) the game packs into wUnitID.
// 0/0/0 is the game's "send to spawn" signal, so it is refused rather than sent by accident.
const coordinate = z.number().finite().min(0).lt(262144);

const positionShape = z.object({
  world: z.number().int().min(1).max(255),
  channel: z.number().int().min(1).max(255),
  mapId: z.number().int().min(0).max(65535),
  x: coordinate,
  y: z.number().min(-1e6).max(1e6),
  z: coordinate,
});

type PositionShape = z.infer<typeof positionShape>;

const notAllZero = (position: PositionShape, ctx: z.RefinementCtx) => {
  if (position.x === 0 && position.y === 0 && position.z === 0) {
    ctx.addIssue({ code: 'custom', path: ['x'], message: 'Coordinates cannot all be 0' });
  }
};

export const positionSchema = positionShape.superRefine(notAllZero);
export type PositionDestination = z.infer<typeof positionSchema>;

const destinationSchema = z.discriminatedUnion('kind', [
  positionShape.extend({ kind: z.literal('position') }).superRefine(notAllZero),
  z.object({
    kind: z.literal('character'),
    world: z.number().int().min(1).max(255),
    target: characterNameSchema,
  }),
]);

export const teleportRequestSchema = z
  .object({
    names: z.array(characterNameSchema).min(1).max(20),
    destination: destinationSchema,
  })
  .superRefine((request, ctx) => {
    const lower = request.names.map((name) => name.toLowerCase());
    if (new Set(lower).size !== lower.length) {
      ctx.addIssue({ code: 'custom', path: ['names'], message: 'Names must be unique' });
    }
    const { destination } = request;
    if (destination.kind === 'character' && lower.includes(destination.target.toLowerCase())) {
      ctx.addIssue({
        code: 'custom',
        path: ['destination', 'target'],
        message: 'Target cannot also be moved',
      });
    }
  });
export type TeleportRequest = z.infer<typeof teleportRequestSchema>;

export const gmLocationInputSchema = positionShape
  .extend({ name: z.string().min(1).max(40) })
  .superRefine(notAllZero);
export type GmLocationInput = z.infer<typeof gmLocationInputSchema>;

// Vendor prices are 32-bit on the server (dwMoney / dwPvPMoney).
export const MAX_PRICE = 4_294_967_295;

/**
 * The buy handler computes price * count in a DWORD and caps count at the stack, so a price whose
 * full stack passes MAX_PRICE wraps around and becomes cheap.
 */
export const fullStackOverflows = (price: number, stack: number): boolean =>
  price * Math.max(stack, 1) > MAX_PRICE;

/** Route param for a vendor or item id; the game stores these as 16-bit values. */
export const gmIdSchema = z.coerce.number().int().min(1).max(32767);

export const addVendorItemSchema = z.object({ itemId: z.number().int().min(1).max(32767) });
export type AddVendorItem = z.infer<typeof addVendorItemSchema>;

export const vendorShopSchema = z.enum(['money', 'pvp']);

export const itemPriceSchema = z.object({
  currency: vendorShopSchema,
  amount: z.number().int().min(0).max(MAX_PRICE),
});
export type ItemPriceInput = z.infer<typeof itemPriceSchema>;

export const itemSearchQuerySchema = z.string().trim().min(1).max(50);

/** What the server charges: float32 math, then +0.99 and truncation. */
export const chargedPrice = (base: number, multiplier: number) =>
  Math.trunc(Math.fround(Math.fround(base) * Math.fround(multiplier)) + 0.99);

const floatView = new Float32Array(1);
const bitView = new Uint32Array(floatView.buffer);

const nextFloat = (value: number, steps: number) => {
  floatView[0] = value;
  bitView[0] += steps;
  return floatView[0];
};

/**
 * The float32 multiplier whose charged price is closest to amount. Plain division can land one
 * float off, so this walks neighboring floats. Callers pass base > 0.
 */
export const multiplierForPrice = (base: number, amount: number) => {
  if (amount === 0) return 0;
  const start = Math.fround(amount / base);
  let best = start;
  let bestGap = Math.abs(chargedPrice(base, start) - amount);
  for (let step = 1; step <= 64 && bestGap > 0; step++) {
    for (const direction of [1, -1]) {
      const candidate = nextFloat(start, direction * step);
      const gap = Math.abs(chargedPrice(base, candidate) - amount);
      if (gap < bestGap) {
        best = candidate;
        bestGap = gap;
      }
    }
  }
  return best;
};

/** What a vendor pays a player who sells an item back: a quarter, rounded down. */
export const sellBackPrice = (price: number) => Math.floor(price / 4);

/** The game's coin sprites: Rune, Luna and Cron. */
export const COIN_SPRITES = { rune: 11137, luna: 11138, cron: 11136 } as const;

type Money = { rune: number; luna: number; cron: number };

export const splitMoney = (price: number): Money => ({
  rune: Math.floor(price / 1_000_000),
  luna: Math.floor(price / 1000) % 1000,
  cron: price % 1000,
});

export const joinMoney = ({ rune, luna, cron }: Money) => rune * 1_000_000 + luna * 1000 + cron;
