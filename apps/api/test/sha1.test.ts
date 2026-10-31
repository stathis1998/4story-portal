import { expect, it } from 'vitest';
import { sha1Hex } from '../src/auth/sha1.js';

it('matches the published vector for "abc"', () =>
  expect(sha1Hex('abc')).toBe('a9993e364706816aba3e25717850c26c9cd0d89d'));

it('hashes the empty string', () =>
  expect(sha1Hex('')).toBe('da39a3ee5e6b4b0d3255bfef95601890afd80709'));

it('returns lowercase hex', () => expect(sha1Hex('Secret!')).toMatch(/^[0-9a-f]{40}$/));
