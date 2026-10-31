import { z } from 'zod';

// Same limits the game can handle: usernames are plain letters and digits, and passwords stay
// printable ASCII because the game client hashes the raw ANSI bytes.
export const usernameSchema = z
  .string()
  .regex(/^[A-Za-z0-9]{4,16}$/, 'Use 4-16 letters or digits');

export const passwordSchema = z
  .string()
  .regex(/^[\x20-\x7E]{6,16}$/, 'Use 6-16 characters (letters, digits, symbols or spaces)');

export const loginRequestSchema = z.object({
  username: usernameSchema,
  password: passwordSchema,
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const registerRequestSchema = z.object({
  username: usernameSchema,
  password: passwordSchema,
});
export type RegisterRequest = z.infer<typeof registerRequestSchema>;

export const registerFormSchema = registerRequestSchema
  .extend({ confirmPassword: z.string() })
  .refine((form) => form.confirmPassword === form.password, {
    path: ['confirmPassword'],
    message: 'Passwords do not match',
  });
export type RegisterForm = z.infer<typeof registerFormSchema>;
