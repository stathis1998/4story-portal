import { describe, expect, it } from 'vitest';
import { loginRequestSchema, passwordSchema, registerFormSchema, usernameSchema } from './auth.js';

// Login must accept any account that already exists in the game, not just ones the portal's
// stricter registration rules would allow (e.g. the existing account "1").
describe('loginRequestSchema', () => {
  it.each([
    { username: '1', password: 'abc' },
    { username: 'old_name', password: 'x'.repeat(20) },
    { username: 'a'.repeat(50), password: 'p' },
  ])('accepts existing-style credentials %o', (input) =>
    expect(loginRequestSchema.safeParse(input).success).toBe(true));

  it.each([
    { username: '', password: 'secret1' },
    { username: 'moose', password: '' },
    { username: 'a'.repeat(51), password: 'secret1' },
    { username: 'moo se', password: 'secret1' },
    { username: 'moose', password: 'pässword' },
  ])('rejects %o', (input) => expect(loginRequestSchema.safeParse(input).success).toBe(false));
});

describe('usernameSchema', () => {
  it.each(['moose', 'Moose1', 'abcd', 'a'.repeat(16)])('accepts %s', (v) =>
    expect(usernameSchema.safeParse(v).success).toBe(true));

  it.each(['abc', 'a'.repeat(17), 'moo se', 'moose!', 'μoose', ' moose'])('rejects %s', (v) =>
    expect(usernameSchema.safeParse(v).success).toBe(false));
});

describe('passwordSchema', () => {
  it.each(['secret', 'a b c d', '!@#$%^', 'x'.repeat(16)])('accepts %s', (v) =>
    expect(passwordSchema.safeParse(v).success).toBe(true));

  it.each(['short', 'x'.repeat(17), 'pässword', 'tab\tpass'])('rejects %s', (v) =>
    expect(passwordSchema.safeParse(v).success).toBe(false));
});

describe('registerFormSchema', () => {
  it('rejects mismatched confirmation on confirmPassword', () => {
    const r = registerFormSchema.safeParse({ username: 'moose', password: 'secret1', confirmPassword: 'secret2' });
    expect(r.success).toBe(false);
    expect(r.error!.issues[0]).toMatchObject({ path: ['confirmPassword'], message: 'Passwords do not match' });
  });
});
