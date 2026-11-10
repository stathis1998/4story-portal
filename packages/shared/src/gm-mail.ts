import { z } from 'zod';
import { characterNameSchema } from './gm.js';

export const MAIL_MAX_RECIPIENTS = 20;
export const MAIL_MAX_ITEMS = 3; // the client shows three attachment slots (TMAIL_ITEM_MAX)
export const MAIL_MAX_GOLD = 10_000;

// The game's mail columns are VARCHAR, so only printable ASCII and line breaks go through.
const mailText = (min: number, max: number) =>
  z
    .string()
    .transform((s) => s.replace(/\r\n?/g, '\n'))
    .pipe(
      z
        .string()
        .min(min)
        .max(max)
        .regex(/^[\x20-\x7E\n]*$/, 'Use plain letters, digits and punctuation only'),
    );

// Silver and copper (Luna and Cron) roll over at 1000 in game.
const coin = z.number().int().min(0).max(999);

const moneySchema = z.object({
  gold: z.number().int().min(0).max(MAIL_MAX_GOLD),
  silver: coin,
  copper: coin,
});

const mailItemSchema = z.object({
  itemId: z.number().int().min(1).max(32767),
  count: z.number().int().min(1).max(255),
});

/** names: the listed recipients. online / all: the server picks every logged-in / live character at send time. */
export const gmMailAudienceSchema = z.enum(['names', 'online', 'all']);
export type GmMailAudience = z.infer<typeof gmMailAudienceSchema>;

export const gmMailRequestSchema = z
  .object({
    audience: gmMailAudienceSchema.default('names'),
    recipients: z
      .array(characterNameSchema)
      .max(MAIL_MAX_RECIPIENTS)
      .default([])
      .transform((names) => {
        const seen = new Set<string>();
        return names.filter((name) => {
          const key = name.toLowerCase();
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      }),
    sender: mailText(1, 20).default('[GM]'),
    title: mailText(1, 200),
    message: mailText(0, 2000).default(''),
    money: moneySchema.default({ gold: 0, silver: 0, copper: 0 }),
    items: z.array(mailItemSchema).max(MAIL_MAX_ITEMS).default([]),
  })
  .superRefine((req, ctx) => {
    if (req.audience === 'names' && req.recipients.length === 0) {
      ctx.addIssue({ code: 'custom', path: ['recipients'], message: 'Add at least one recipient' });
    }
    if (req.audience !== 'names' && req.recipients.length > 0) {
      ctx.addIssue({ code: 'custom', path: ['recipients'], message: `Leave recipients empty when sending to ${req.audience}` });
    }
  });
export type GmMailRequest = z.output<typeof gmMailRequestSchema>;
export type GmMailRequestInput = z.input<typeof gmMailRequestSchema>;

/** A live character for the mail page's picker. */
export type GmMailCharacter = { charId: number; name: string; level: number; className: string; online: boolean };

export type GmMailResult = { name: string; postId: number | null; error?: string };
export type GmMailResponse = { results: GmMailResult[] };
