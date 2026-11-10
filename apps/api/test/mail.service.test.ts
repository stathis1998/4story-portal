import { UnprocessableEntityException } from '@nestjs/common';
import { type GmMailRequest, gmMailRequestSchema } from '@4story-portal/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { itemIcons } from '../src/gm/game-icons.generated.js';
import { MailService } from '../src/gm/mail.service.js';
import { FakeGmRepository, FakeMailRepository } from './fakes.js';

const actor = { username: 'moose', ip: '10.0.0.1' };

const [potion, sword] = Object.keys(itemIcons).map(Number);
const notInClient = Array.from({ length: 32767 }, (_, i) => i + 1).find((id) => !Object.hasOwn(itemIcons, id))!;

const request = (input: Partial<Parameters<typeof gmMailRequestSchema.parse>[0]> = {}): GmMailRequest =>
  gmMailRequestSchema.parse({ recipients: ['Moose'], title: 'Hi', ...input });

let mail: FakeMailRepository;
let gm: FakeGmRepository;
let service: MailService;

beforeEach(() => {
  mail = new FakeMailRepository();
  mail.characters = [
    { charId: 1, name: 'Moose' },
    { charId: 2, name: 'Kael' },
    { charId: 3, name: 'Ria' },
  ];
  mail.items = [
    { itemId: potion, name: 'Potion', stack: 20 },
    { itemId: sword, name: 'Sword', stack: 0 },
    { itemId: notInClient, name: 'Ghost Item', stack: 1 },
  ];
  gm = new FakeGmRepository();
  service = new MailService(mail, gm);
});

async function rejection(req: GmMailRequest): Promise<string> {
  const error = await service.send(req, actor).catch((e: unknown) => e);
  expect(error).toBeInstanceOf(UnprocessableEntityException);
  return (error as Error).message;
}

describe('MailService', () => {
  it('sends one letter per recipient in order, using stored names', async () => {
    const res = await service.send(request({ recipients: ['moose', 'Kael'] }), actor);
    expect(mail.sent.map((l) => l.charId)).toEqual([1, 2]);
    expect(res.results).toEqual([
      { name: 'Moose', postId: 1000 },
      { name: 'Kael', postId: 1001 },
    ]);
  });

  it('passes money and items through', async () => {
    await service.send(
      request({
        sender: 'Admin',
        message: 'Well done',
        money: { gold: 1, silver: 2, copper: 3 },
        items: [{ itemId: potion, count: 5 }],
      }),
      actor,
    );
    expect(mail.sent[0]).toEqual({
      charId: 1,
      sender: 'Admin',
      title: 'Hi',
      message: 'Well done',
      gold: 1,
      silver: 2,
      copper: 3,
      items: [{ itemId: potion, count: 5 }],
    });
  });

  it('rejects unknown names before sending anything', async () => {
    expect(await rejection(request({ recipients: ['Moose', 'Ghost'] }))).toBe('Unknown characters: Ghost');
    expect(mail.sent).toEqual([]);
    expect(gm.audits).toHaveLength(1);
    expect(gm.audits[0].command).toBe('POST');
    expect(gm.audits[0].log).toMatch(/^REJECTED unknown-characters:/);
  });

  it('rejects unknown items', async () => {
    expect(await rejection(request({ items: [{ itemId: 31000, count: 1 }] }))).toBe('Unknown items: 31000');
    expect(mail.sent).toEqual([]);
  });

  it('rejects an item missing from the client', async () => {
    expect(await rejection(request({ items: [{ itemId: notInClient, count: 1 }] }))).toBe(
      `Not in the game client: ${notInClient}`,
    );
    expect(mail.sent).toEqual([]);
  });

  it('caps count at max(stack, 1)', async () => {
    expect(await rejection(request({ items: [{ itemId: sword, count: 2 }] }))).toBe('Sword stacks to 1');
    expect(await rejection(request({ items: [{ itemId: potion, count: 21 }] }))).toBe('Potion stacks to 20');
    expect(mail.sent).toEqual([]);
    await service.send(request({ items: [{ itemId: potion, count: 20 }] }), actor);
    expect(mail.sent).toHaveLength(1);
  });

  it('allows the same item in two rows', async () => {
    await service.send(
      request({
        items: [
          { itemId: potion, count: 20 },
          { itemId: potion, count: 20 },
        ],
      }),
      actor,
    );
    expect(mail.sent[0].items).toHaveLength(2);
  });

  it('continues after a recipient fails', async () => {
    mail.missingOnSend.add(1);
    mail.failOnSend.add(2);
    const res = await service.send(request({ recipients: ['Moose', 'Kael', 'Ria'] }), actor);
    expect(res.results).toEqual([
      { name: 'Moose', postId: null, error: 'Character not found' },
      { name: 'Kael', postId: null, error: 'Send failed' },
      { name: 'Ria', postId: 1000 },
    ]);
    const logs = gm.audits.map((a) => a.log);
    expect(logs).toContain('FAILED Moose: Character not found');
    expect(logs).toContain('FAILED Kael: Send failed');
  });

  it('audits each sent letter', async () => {
    await service.send(
      request({ items: [{ itemId: potion, count: 5 }], money: { gold: 1, silver: 2, copper: 3 } }),
      actor,
    );
    await service.send(request(), actor);
    expect(gm.audits.map((a) => [a.command, a.gmId, a.ip, a.log])).toEqual([
      ['POST', 'moose', '10.0.0.1', `Moose(1) post 1000 "Hi" items: ${potion}x5 money: 1/2/3`],
      ['POST', 'moose', '10.0.0.1', 'Moose(1) post 1001 "Hi" items: none money: 0/0/0'],
    ]);
  });

  it('does not fail the send when the audit write fails', async () => {
    gm.failAudit = true;
    const res = await service.send(request(), actor);
    expect(res.results).toEqual([{ name: 'Moose', postId: 1000 }]);
  });
});
