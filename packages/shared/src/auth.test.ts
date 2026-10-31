import { describe, expect, it } from 'vitest';
import { passwordSchema, registerFormSchema, usernameSchema } from './auth.js';

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
