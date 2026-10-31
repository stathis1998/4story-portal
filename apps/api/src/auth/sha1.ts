import { createHash } from 'node:crypto';

// The game client stores and sends passwords as lowercase hex SHA-1 of the raw single-byte text.
export function sha1Hex(input: string): string {
  return createHash('sha1').update(input, 'latin1').digest('hex');
}
