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
