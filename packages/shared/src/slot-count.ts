import { SLOT_LINES } from './slot-rules.js';
import {
  SLOT_CHAIN_MAX,
  SLOT_FREE_SPINS,
  SLOT_LETTERS,
  SLOT_REELS,
  SLOT_ROWS,
  SLOT_SCATTER,
  SLOT_STEP_MULTIPLIER_MAX,
  SLOT_WILD,
  type SlotCounts,
  type SlotMachine,
} from './slots.js';

type Countable = Pick<SlotMachine, 'reels' | 'pays' | 'twoLucky'>;

const SYMBOLS = SLOT_LETTERS.length;
const CELLS = SLOT_REELS * SLOT_ROWS;
/** A prize table entry is prize x COUNT_SPAN + the line's paying count (2 to 5), so one lookup gives both. */
const COUNT_SPAN = 8;
/** Scatter counts of 5 or more share the last slot of `last` and `blankLast`. */
const MOST_SCATTERS = 5;
/** The fewest scatters in a last window that win or retrigger free spins: r = 1 in the buckets. */
const RETRIGGER = Math.min(...Object.keys(SLOT_FREE_SPINS).map(Number));
/** Tiles lost from one reel, by its 3-bit burst mask. */
const LOST = [0, 1, 1, 2, 1, 2, 2, 3];

/**
 * Every tuple of five symbols, read as a base-10 number: prize x COUNT_SPAN + paying count, 0 when the line wins
 * nothing. The same reading as slotLinesOn: a wild or scatter on reel 1 starts nothing, a wild stands in.
 */
function prizeTable(machine: Countable): Uint32Array {
  const table = new Uint32Array(SYMBOLS ** SLOT_REELS);
  const t = new Array<number>(SLOT_REELS).fill(0);
  for (let n = 0; n < table.length; n++) {
    let rest = n;
    for (let r = SLOT_REELS - 1; r >= 0; r--) {
      t[r] = rest % SYMBOLS;
      rest = Math.floor(rest / SYMBOLS);
    }
    if (t[0] >= SLOT_WILD) continue;
    let count = 1;
    while (count < SLOT_REELS && (t[count] === t[0] || t[count] === SLOT_WILD)) count++;
    if (count >= 3) table[n] = machine.pays[t[0]][count - 3] * COUNT_SPAN + count;
    else if (count === 2 && t[0] === 0) table[n] = machine.twoLucky * COUNT_SPAN + 2;
  }
  return table;
}

/** Each reel's symbol at [stop x 3 + row], wrapping by that strip's own length. */
function reelSymbols(strip: Uint8Array): Uint8Array {
  const n = strip.length;
  const out = new Uint8Array(n * SLOT_ROWS);
  for (let stop = 0; stop < n; stop++) {
    for (let row = 0; row < SLOT_ROWS; row++) out[stop * SLOT_ROWS + row] = strip[(stop + row - 1 + n) % n];
  }
  return out;
}

/**
 * Plays every window through its chain (32^5 for a real machine; any strip lengths work) and sorts what it pays
 * into buckets. Takes tens of seconds: tests and the strip search only. Most windows win nothing at step 1, so
 * step 1 is read from the prize table and only a window that wins plays its chain, on reused typed arrays.
 */
export function countSlotMachine(machine: Countable): SlotCounts {
  const table = prizeTable(machine);
  const lines = SLOT_LINES.length;
  const strips = machine.reels.map((reel) => Uint8Array.from(reel, (letter) => SLOT_LETTERS.indexOf(letter)));
  const lengths = strips.map((s) => s.length);
  const sym = strips.map(reelSymbols);
  // Scatters showing on each reel at each stop.
  const scat = sym.map((s) => {
    const out = new Uint8Array(s.length / SLOT_ROWS);
    for (let stop = 0; stop < out.length; stop++) {
      for (let row = 0; row < SLOT_ROWS; row++) if (s[stop * SLOT_ROWS + row] === SLOT_SCATTER) out[stop]++;
    }
    return out;
  });
  const rows = [0, 1, 2, 3, 4].map((r) => Int32Array.from(SLOT_LINES, (line) => line[r]));

  // The chain player's tables: each line's cells (reel x 3 + row), and the cells a line of each count bursts.
  const cell = new Int32Array(lines * SLOT_REELS);
  const burstMask = new Int32Array(lines * (SLOT_REELS + 1));
  SLOT_LINES.forEach((line, l) => {
    let mask = 0;
    for (let r = 0; r < SLOT_REELS; r++) {
      cell[l * SLOT_REELS + r] = r * SLOT_ROWS + line[r];
      mask |= 1 << (r * SLOT_ROWS + line[r]);
      burstMask[l * (SLOT_REELS + 1) + r + 1] = mask;
    }
  });
  // Reused by every chain: no allocation per window or step.
  const grid = new Uint8Array(CELLS);
  const top = new Int32Array(SLOT_REELS);
  const pay = new Float64Array(SLOT_CHAIN_MAX);
  const kept = new Uint8Array(SLOT_ROWS);
  let stepsPlayed = 0;

  /** Plays the chain from these stops into `pay` and `grid` as slotChain does; returns the winning steps. */
  function play(stops: number[]): number {
    for (let r = 0; r < SLOT_REELS; r++) {
      const n = lengths[r];
      const t = (stops[r] - 1 + n) % n;
      top[r] = t;
      for (let row = 0; row < SLOT_ROWS; row++) grid[r * SLOT_ROWS + row] = strips[r][(t + row) % n];
    }
    let won = 0;
    for (stepsPlayed = 1; ; stepsPlayed++) {
      let multiple = 0;
      let mask = 0;
      for (let l = 0; l < lines; l++) {
        const c = l * SLOT_REELS;
        const idx = (((grid[cell[c]] * SYMBOLS + grid[cell[c + 1]]) * SYMBOLS + grid[cell[c + 2]]) * SYMBOLS + grid[cell[c + 3]]) * SYMBOLS + grid[cell[c + 4]];
        const e = table[idx];
        if (e !== 0) {
          multiple += Math.floor(e / COUNT_SPAN);
          mask |= burstMask[l * (SLOT_REELS + 1) + (e % COUNT_SPAN)];
        }
      }
      if (mask === 0) return won;
      pay[won++] = multiple;
      if (stepsPlayed === SLOT_CHAIN_MAX) return won;
      // Each reel's survivors slide to the bottom in their order; the strip above its top row fills the gaps.
      for (let r = 0; r < SLOT_REELS; r++) {
        const bits = (mask >>> (r * SLOT_ROWS)) & 7;
        if (bits === 0) continue;
        const base = r * SLOT_ROWS;
        let survivors = 0;
        for (let row = 0; row < SLOT_ROWS; row++) if ((bits & (1 << row)) === 0) kept[survivors++] = grid[base + row];
        const k = LOST[bits];
        const n = lengths[r];
        const t = (((top[r] - k) % n) + n) % n;
        top[r] = t;
        for (let i = 0; i < k; i++) grid[base + i] = strips[r][(t + i) % n];
        for (let i = 0; i < survivors; i++) grid[base + k + i] = kept[i];
      }
    }
  }

  const last = new Float64Array(MOST_SCATTERS + 1);
  const blankLast = new Float64Array(MOST_SCATTERS + 1);
  const free = new Float64Array((SLOT_CHAIN_MAX + 1) * 2);
  const steps = new Float64Array(free.length * SLOT_CHAIN_MAX);
  let best = 0;
  let longest = 0;
  let capped = 0;

  // partial[r][line]: the tuple index so far, after reels 0..r.
  const partial = [0, 1, 2, 3].map(() => new Int32Array(lines));
  const [s0, s1, s2, s3, s4] = sym;
  const [row0, row1, row2, row3, row4] = rows;
  const stops = [0, 0, 0, 0, 0];
  for (let a = 0; a < lengths[0]; a++) {
    stops[0] = a;
    for (let l = 0; l < lines; l++) partial[0][l] = s0[a * 3 + row0[l]];
    for (let b = 0; b < lengths[1]; b++) {
      stops[1] = b;
      for (let l = 0; l < lines; l++) partial[1][l] = partial[0][l] * SYMBOLS + s1[b * 3 + row1[l]];
      for (let c = 0; c < lengths[2]; c++) {
        stops[2] = c;
        for (let l = 0; l < lines; l++) partial[2][l] = partial[1][l] * SYMBOLS + s2[c * 3 + row2[l]];
        for (let d = 0; d < lengths[3]; d++) {
          stops[3] = d;
          for (let l = 0; l < lines; l++) partial[3][l] = partial[2][l] * SYMBOLS + s3[d * 3 + row3[l]];
          const p = partial[3];
          const seen4 = scat[0][a] + scat[1][b] + scat[2][c] + scat[3][d];
          for (let e = 0; e < lengths[4]; e++) {
            const base = e * 3;
            let any = 0;
            for (let l = 0; l < lines; l++) any |= table[p[l] * SYMBOLS + s4[base + row4[l]]];
            if (any === 0) {
              // Step 1 wins nothing, so the chain is this one window and pays nothing.
              const shown = seen4 + scat[4][e];
              const s = Math.min(shown, MOST_SCATTERS);
              last[s]++;
              blankLast[s]++;
              free[shown >= RETRIGGER ? 1 : 0]++;
              if (longest < 1) longest = 1;
              continue;
            }
            stops[4] = e;
            const won = play(stops);
            let shown = 0;
            for (let i = 0; i < CELLS; i++) if (grid[i] === SLOT_SCATTER) shown++;
            const s = Math.min(shown, MOST_SCATTERS);
            const at = won * 2 + (shown >= RETRIGGER ? 1 : 0);
            let paid = 0;
            for (let j = 0; j < won; j++) {
              steps[at * SLOT_CHAIN_MAX + j] += pay[j];
              paid += pay[j] * Math.min(j + 1, SLOT_STEP_MULTIPLIER_MAX);
            }
            last[s]++;
            // A winning line whose prize is 0 would still chain, so blank means nothing paid, not nothing won.
            if (paid === 0) blankLast[s]++;
            free[at]++;
            if (paid > best) best = paid;
            if (stepsPlayed > longest) longest = stepsPlayed;
            if (won === SLOT_CHAIN_MAX) capped++;
          }
        }
      }
    }
  }
  return {
    last: Array.from(last) as SlotCounts['last'],
    blankLast: Array.from(blankLast) as SlotCounts['blankLast'],
    free: Array.from(free),
    steps: Array.from(steps),
    best,
    longest,
    capped,
  };
}
