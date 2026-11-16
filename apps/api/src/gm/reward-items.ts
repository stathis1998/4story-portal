import { UnprocessableEntityException } from '@nestjs/common';
import { itemIcons } from './game-icons.generated.js';

/**
 * The same checks GM mail makes, for any reward that is sent as a letter: every item exists in the chart, the
 * game client has an entry for it (it crashes drawing one it has not) and the count fits one stack.
 */
export async function checkRewardItems(
  items: { itemId: number; count: number }[],
  findItems: (ids: number[]) => Promise<{ itemId: number; name: string; stack: number }[]>,
): Promise<void> {
  if (items.length === 0) return;
  const ids = [...new Set(items.map((item) => item.itemId))];
  const found = new Map((await findItems(ids)).map((row) => [row.itemId, row]));

  const unknown = ids.filter((id) => !found.has(id));
  if (unknown.length > 0) throw new UnprocessableEntityException(`Unknown items: ${unknown.join(', ')}`);

  // The client crashes drawing an item it has no entry for.
  const missing = ids.find((id) => !Object.hasOwn(itemIcons, id));
  if (missing !== undefined) throw new UnprocessableEntityException(`Not in the game client: ${missing}`);

  for (const { itemId, count } of items) {
    const item = found.get(itemId)!;
    const stack = Math.max(item.stack, 1);
    if (count > stack) throw new UnprocessableEntityException(`${item.name || `Item ${itemId}`} stacks to ${stack}`);
  }
}
