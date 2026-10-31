import { z } from 'zod';

// Same limits the game can handle: usernames are plain letters and digits, and passwords stay
// printable ASCII because the game client hashes the raw ANSI bytes.
export const usernameSchema = z
  .string()
  .regex(/^[A-Za-z0-9]{4,16}$/, 'Use 4-16 letters or digits');

export const passwordSchema = z
  .string()
  .regex(/^[\x20-\x7E]{6,16}$/, 'Use 6-16 characters (letters, digits, symbols or spaces)');

// Login accepts any account that already exists in the game (the stricter rules above apply only to
// new registrations): szUserID is varchar(50), and the password only has to hash like the client's.
export const loginRequestSchema = z.object({
  username: z
    .string()
    .min(1, 'Enter your username')
    .max(50, 'Usernames are at most 50 characters')
    .regex(/^[\x21-\x7E]*$/, 'Usernames cannot contain spaces or special characters'),
  password: z
    .string()
    .min(1, 'Enter your password')
    .max(255, 'Passwords are at most 255 characters')
    .regex(/^[\x20-\x7E]*$/, 'Use letters, digits, symbols or spaces'),
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
