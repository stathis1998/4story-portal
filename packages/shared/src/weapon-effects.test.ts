import { describe, expect, it } from 'vitest';
import { GRADE_EFFECTS, gradeSkin, layerKey, WEAPON_KINDS, weaponSearchSchema } from './weapon-effects.js';

describe('gradeSkin', () => {
  it('has no layer at +0', () => {
    expect(gradeSkin(0, 5)).toBeNull();
  });

  it('picks the tier below +17 from the level alone', () => {
    expect(gradeSkin(3, 0)).toBe(0);
    expect(gradeSkin(6, 0)).toBe(1);
    expect(gradeSkin(15, 9)).toBe(2);
    expect(gradeSkin(16, 0)).toBe(3);
  });

  it('picks the skin from the effect from +17 to +24', () => {
    expect(gradeSkin(17, 2)).toBe(5);
    expect(gradeSkin(24, 15)).toBe(3);
    expect(gradeSkin(20, 16)).toBe(35);
    expect(gradeSkin(17, 18)).toBe(37);
    expect(gradeSkin(17, 20)).toBe(39);
    expect(gradeSkin(17, 39)).toBe(58);
  });

  it('gives skin 0 to the effects the client has no case for', () => {
    expect(gradeSkin(17, 19)).toBe(0);
    expect(gradeSkin(17, 30)).toBe(0);
    expect(gradeSkin(17, 0)).toBe(0);
  });
});

describe('effect names', () => {
  it('lists the 39 effects with their game names', () => {
    expect(GRADE_EFFECTS).toHaveLength(39);
    const name = (id: number) => GRADE_EFFECTS.find((effect) => effect.id === id)?.name;
    expect(name(7)).toBe('Storm Blue');
    expect(name(26)).toBe('Effect 26');
    expect(name(33)).toBe('Galactic');
    expect(name(39)).toBe('Storm Red');
  });

  it('notes the effects that look wrong in game', () => {
    const note = (id: number) => GRADE_EFFECTS.find((effect) => effect.id === id)?.note;
    expect(note(19)).toBe('No visible effect on weapons in game.');
    expect(note(30)).toBe('No visible effect on weapons in game.');
    expect(note(18)).toBe('Shows the same look as effect 20 in game.');
    expect(note(25)).toBe('Shows the same look as effect 26 in game.');
    expect(note(2)).toBeNull();
  });
});

describe('weapon kinds and search', () => {
  it('names the 12 weapon kinds', () => {
    expect(WEAPON_KINDS.map((kind) => kind.kind)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(WEAPON_KINDS[5].name).toBe('Bow');
  });

  it('keys layers by kind and skin', () => {
    expect(layerKey(6, 37)).toBe('6:37');
  });

  it('trims the search text and checks the kind', () => {
    expect(weaponSearchSchema.parse({ q: ' bow ' })).toEqual({ q: 'bow' });
    expect(weaponSearchSchema.parse({ kind: '6' })).toEqual({ kind: 6 });
    expect(weaponSearchSchema.safeParse({ kind: 13 }).success).toBe(false);
  });
});
