import { Inject, Injectable, Logger, UnprocessableEntityException } from '@nestjs/common';
import type { GmMailRequest, GmMailResponse, GmMailResult } from '@4story-portal/shared';
import { itemIcons } from './game-icons.generated.js';
import { GM_REPOSITORY, type GmRepository } from './gm.repository.js';
import { MAIL_REPOSITORY, type MailRecipientRow, type MailRepository } from './mail.repository.js';

type Actor = { username: string; ip: string };

const AUDIT_COMMAND = 'POST';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(
    @Inject(MAIL_REPOSITORY) private readonly repo: MailRepository,
    @Inject(GM_REPOSITORY) private readonly gm: GmRepository,
  ) {}

  async send(req: GmMailRequest, actor: Actor): Promise<GmMailResponse> {
    const recipients = await this.resolveRecipients(req, actor);
    await this.checkItems(req, actor);

    const results: GmMailResult[] = [];
    for (const recipient of recipients) {
      results.push(await this.sendOne(recipient, req, actor));
    }
    return { results };
  }

  /** The recipients in request order, with their stored spelling. Refuses the whole send on any unknown name. */
  private async resolveRecipients(req: GmMailRequest, actor: Actor): Promise<MailRecipientRow[]> {
    const rows = await this.repo.findCharacters(req.recipients);
    const byName = new Map(rows.map((row) => [row.name.toLowerCase(), row]));
    const unknown = req.recipients.filter((name) => !byName.has(name.toLowerCase()));
    if (unknown.length > 0) await this.reject('unknown-characters', `Unknown characters: ${unknown.join(', ')}`, req, actor);
    return req.recipients.map((name) => byName.get(name.toLowerCase())!);
  }

  private async checkItems(req: GmMailRequest, actor: Actor): Promise<void> {
    if (req.items.length === 0) return;
    const ids = [...new Set(req.items.map((item) => item.itemId))];
    const found = new Map((await this.repo.findItems(ids)).map((row) => [row.itemId, row]));

    const unknown = ids.filter((id) => !found.has(id));
    if (unknown.length > 0) await this.reject('unknown-items', `Unknown items: ${unknown.join(', ')}`, req, actor);

    // The client crashes drawing an item it has no entry for.
    const missing = ids.find((id) => !Object.hasOwn(itemIcons, id));
    if (missing !== undefined) await this.reject('not-in-client', `Not in the game client: ${missing}`, req, actor);

    for (const { itemId, count } of req.items) {
      const item = found.get(itemId)!;
      const stack = Math.max(item.stack, 1);
      if (count > stack) await this.reject('over-stack', `${item.name || `Item ${itemId}`} stacks to ${stack}`, req, actor);
    }
  }

  private async sendOne(recipient: MailRecipientRow, req: GmMailRequest, actor: Actor): Promise<GmMailResult> {
    let postId: number;
    try {
      postId = await this.repo.sendLetter({
        charId: recipient.charId,
        sender: req.sender,
        title: req.title,
        message: req.message,
        gold: req.money.gold,
        silver: req.money.silver,
        copper: req.money.copper,
        items: req.items,
      });
    } catch (error) {
      this.logger.warn(`Mail to ${recipient.name} failed: ${error instanceof Error ? error.message : error}`);
      // The letter may still have committed if the connection dropped after COMMIT.
      return this.failed(recipient, 'Send failed, check the mailbox before resending', actor);
    }
    if (postId === 0) return this.failed(recipient, 'Character not found', actor);

    await this.audit(`${recipient.name}(${recipient.charId}) post ${postId} "${req.title}" ${contents(req)}`, actor);
    return { name: recipient.name, postId };
  }

  private async failed(recipient: MailRecipientRow, error: string, actor: Actor): Promise<GmMailResult> {
    await this.audit(`FAILED ${recipient.name}: ${error}`, actor);
    return { name: recipient.name, postId: null, error };
  }

  private async reject(reason: string, message: string, req: GmMailRequest, actor: Actor): Promise<never> {
    await this.audit(`REJECTED ${reason}: ${message} | to ${req.recipients.join(',')} "${req.title}" ${contents(req)}`, actor);
    throw new UnprocessableEntityException(message);
  }

  private async audit(log: string, actor: Actor): Promise<void> {
    try {
      await this.gm.writeAudit({ ip: actor.ip, gmId: actor.username, command: AUDIT_COMMAND, log });
    } catch (error) {
      this.logger.warn(`Could not write the mail audit row: ${error instanceof Error ? error.message : error}`);
    }
  }
}

function contents({ items, money }: GmMailRequest): string {
  const list = items.length ? items.map((item) => `${item.itemId}x${item.count}`).join(',') : 'none';
  return `items: ${list} money: ${money.gold}/${money.silver}/${money.copper}`;
}
