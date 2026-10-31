import { describe, expect, it } from 'vitest';
import {
  characterNameSchema,
  gmLocationInputSchema,
  positionSchema,
  teleportRequestSchema,
} from './gm.js';

const position = { world: 1, channel: 1, mapId: 0, x: 2800, y: 50, z: 5000 };

describe('characterNameSchema', () => {
  it('accepts a plain name', () => expect(characterNameSchema.safeParse('Kaelith').success).toBe(true));

  it.each(['', 'a'.repeat(17), 'Kae lith'])('rejects %j', (name) =>
    expect(characterNameSchema.safeParse(name).success).toBe(false));
});

describe('positionSchema', () => {
  it('accepts a valid position', () => expect(positionSchema.safeParse(position).success).toBe(true));

  it.each([262144, -1])('rejects x = %d', (x) =>
    expect(positionSchema.safeParse({ ...position, x }).success).toBe(false));

  it.each([1e6 + 1, -1e6 - 1, 1e300])('rejects y = %d', (y) =>
    expect(positionSchema.safeParse({ ...position, y }).success).toBe(false));

  it('rejects 0/0/0 on the x path', () => {
    const result = positionSchema.safeParse({ ...position, x: 0, y: 0, z: 0 });
    expect(result.success).toBe(false);
    expect(result.error?.issues).toContainEqual(
      expect.objectContaining({ path: ['x'], message: 'Coordinates cannot all be 0' }),
    );
  });
});

describe('teleportRequestSchema', () => {
  const toPosition = { names: ['Kaelith'], destination: { kind: 'position', ...position } };
  const toCharacter = {
    names: ['Kaelith'],
    destination: { kind: 'character', world: 1, target: 'Moosey' },
  };

  it('accepts both destination kinds', () => {
    expect(teleportRequestSchema.safeParse(toPosition).success).toBe(true);
    expect(teleportRequestSchema.safeParse(toCharacter).success).toBe(true);
  });

  it('rejects 21 names', () => {
    const names = Array.from({ length: 21 }, (_, i) => `Char${i}`);
    expect(teleportRequestSchema.safeParse({ ...toPosition, names }).success).toBe(false);
  });

  it('rejects duplicate names on the names path', () => {
    const result = teleportRequestSchema.safeParse({ ...toPosition, names: ['Kaelith', 'Kaelith'] });
    expect(result.error?.issues).toContainEqual(
      expect.objectContaining({ path: ['names'], message: 'Names must be unique' }),
    );
  });

  it('rejects a target that is also moved', () => {
    const result = teleportRequestSchema.safeParse({
      names: ['Kaelith', 'Moosey'],
      destination: { kind: 'character', world: 1, target: 'Moosey' },
    });
    expect(result.error?.issues).toContainEqual(
      expect.objectContaining({
        path: ['destination', 'target'],
        message: 'Target cannot also be moved',
      }),
    );
  });
});

describe('gmLocationInputSchema', () => {
  it('accepts a named position', () =>
    expect(gmLocationInputSchema.safeParse({ ...position, name: 'Town' }).success).toBe(true));

  it('rejects a name longer than 40 characters', () =>
    expect(gmLocationInputSchema.safeParse({ ...position, name: 'a'.repeat(41) }).success).toBe(false));
});
