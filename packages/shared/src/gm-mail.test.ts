import { describe, expect, it } from 'vitest';
import { gmMailRequestSchema } from './gm-mail.js';

const base = { recipients: ['Moose'], title: 'Hi' };
const parse = (input: object) => gmMailRequestSchema.safeParse({ ...base, ...input });
const money = (m: Partial<{ gold: number; silver: number; copper: number }>) => ({
  money: { gold: 0, silver: 0, copper: 0, ...m },
});

describe('gmMailRequestSchema', () => {
  it('defaults sender, money and items', () =>
    expect(gmMailRequestSchema.parse(base)).toEqual({
      audience: 'names',
      recipients: ['Moose'],
      sender: '[GM]',
      title: 'Hi',
      message: '',
      money: { gold: 0, silver: 0, copper: 0 },
      items: [],
    }));

  it('dedupes recipients case-insensitively, keeping the first spelling', () =>
    expect(gmMailRequestSchema.parse({ ...base, recipients: ['Moose', 'moose', 'Kael'] }).recipients).toEqual([
      'Moose',
      'Kael',
    ]));

  it.each([[[]], [Array.from({ length: 21 }, (_, i) => `Name${i}`)]])('rejects %# recipients lists out of range', (recipients) =>
    expect(parse({ recipients }).success).toBe(false));

  it('rejects a name with a space', () => expect(parse({ recipients: ['Kae lith'] }).success).toBe(false));

  it.each(['online', 'all'] as const)('accepts audience %s with no recipients', (audience) =>
    expect(gmMailRequestSchema.parse({ audience, title: 'Hi' })).toMatchObject({ audience, recipients: [] }));

  it.each(['online', 'all'] as const)('rejects audience %s with named recipients', (audience) =>
    expect(parse({ audience }).success).toBe(false));

  it('rejects audience names with no recipients', () =>
    expect(gmMailRequestSchema.safeParse({ audience: 'names', title: 'Hi' }).success).toBe(false));

  it('rejects an unknown audience', () => expect(parse({ audience: 'everyone' }).success).toBe(false));

  it('accepts gold 10000 and rejects 10001', () => {
    expect(parse(money({ gold: 10_000 })).success).toBe(true);
    expect(parse(money({ gold: 10_001 })).success).toBe(false);
  });

  it.each([
    ['silver 1000', { silver: 1000 }],
    ['copper -1', { copper: -1 }],
    ['fractional gold 1.5', { gold: 1.5 }],
  ])('rejects %s', (_, m) => expect(parse(money(m)).success).toBe(false));

  it('rejects 4 items', () =>
    expect(parse({ items: [1, 2, 3, 4].map((itemId) => ({ itemId, count: 1 })) }).success).toBe(false));

  it.each([0, 256])('rejects count %i', (count) => expect(parse({ items: [{ itemId: 1, count }] }).success).toBe(false));

  it('rejects itemId 32768', () => expect(parse({ items: [{ itemId: 32768, count: 1 }] }).success).toBe(false));

  it.each([
    ['an empty title', { title: '' }],
    ['a 201-character title', { title: 'a'.repeat(201) }],
    ['a 2001-character message', { message: 'a'.repeat(2001) }],
    ['a 21-character sender', { sender: 'a'.repeat(21) }],
  ])('rejects %s', (_, input) => expect(parse(input).success).toBe(false));

  it('accepts the longest allowed title, message and sender', () =>
    expect(parse({ title: 'a'.repeat(200), message: 'a'.repeat(2000), sender: 'a'.repeat(20) }).success).toBe(true));

  it.each([
    ['title Café', { title: 'Café' }],
    ['a gift emoji in the message', { message: 'For you 🎁' }],
  ])('rejects non-ASCII: %s', (_, input) => expect(parse(input).success).toBe(false));

  it('normalises CRLF', () => expect(gmMailRequestSchema.parse({ ...base, message: 'a\r\nb' }).message).toBe('a\nb'));
});
