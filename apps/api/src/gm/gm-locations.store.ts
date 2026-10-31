import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { gmLocationInputSchema } from '@4story-portal/shared';
import type { GmLocation, GmLocationInput } from '@4story-portal/shared';
import { z } from 'zod';

export const GM_LOCATIONS_STORE = Symbol('GM_LOCATIONS_STORE');

export class InvalidPresetFileError extends Error {
  constructor(file: string, cause?: unknown) {
    super(`GM location preset file is invalid: ${file}`, { cause });
    this.name = 'InvalidPresetFileError';
  }
}

// The input schema is refined, so combine it with the id instead of extending it.
const presetFileSchema = z.array(z.intersection(gmLocationInputSchema, z.object({ id: z.string() })));

/** Presets shared by all GMs, kept in one JSON file. */
export class GmLocationsStore {
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private readonly file: string) {}

  list(): Promise<GmLocation[]> {
    return this.read();
  }

  add(input: GmLocationInput): Promise<GmLocation> {
    return this.serialise(async () => {
      const presets = await this.read();
      const created: GmLocation = { ...input, id: randomUUID() };
      await this.write([...presets, created]);
      return created;
    });
  }

  remove(id: string): Promise<boolean> {
    return this.serialise(async () => {
      const presets = await this.read();
      const kept = presets.filter((preset) => preset.id !== id);
      if (kept.length === presets.length) return false;
      await this.write(kept);
      return true;
    });
  }

  // Run operations one at a time; a failure must not poison later calls.
  private serialise<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.chain.then(operation);
    this.chain = result.catch(() => undefined);
    return result;
  }

  private async read(): Promise<GmLocation[]> {
    let text: string;
    try {
      text = await readFile(this.file, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    try {
      return presetFileSchema.parse(JSON.parse(text));
    } catch (error) {
      throw new InvalidPresetFileError(this.file, error);
    }
  }

  private async write(presets: GmLocation[]): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true });
    const temp = `${this.file}.tmp`;
    await writeFile(temp, `${JSON.stringify(presets, null, 2)}\n`);
    await rename(temp, this.file);
  }
}
