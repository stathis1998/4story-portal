import { SLOT_LINES } from './slot-rules.js';
import { SLOT_LETTERS, SLOT_REELS, SLOT_SCATTER, SLOT_WILD, type SlotCounts, type SlotMachine } from './slots.js';

type Countable = Pick<SlotMachine, 'reels' | 'pays' | 'twoLucky'>;

const SYMBOLS = SLOT_LETTERS.length;

/** The prize, in line stakes, of every tuple of five symbols; the index is the tuple read as a base-10 number. */
function prizeTable(machine: Countable): Uint32Array {
  const table = new Uint32Array(SYMBOLS ** SLOT_REELS);
  const t = new Array<number>(SLOT_REELS).fill(0);
  for (let n = 0; n < table.length; n++) {
    let rest = n;
    for (let r = SLOT_REELS - 1; r >= 0; r--) {
      t[r] = rest % SYMBOLS;
      rest = Math.floor(rest / SYMBOLS);
    }
    // The same reading as slotSpin: a wild or scatter on reel 1 starts nothing, a wild stands in for the symbol.
    if (t[0] >= SLOT_WILD) continue;
    let count = 1;
    while (count < SLOT_REELS && (t[count] === t[0] || t[count] === SLOT_WILD)) count++;
    if (count >= 3) table[n] = machine.pays[t[0]][count - 3];
    else if (count === 2 && t[0] === 0) table[n] = machine.twoLucky;
  }
  return table;
}

/** Each reel's symbol at [stop x 3 + row], wrapping by that strip's own length. */
function reelSymbols(reel: string): Uint8Array {
  const out = new Uint8Array(reel.length * 3);
  for (let stop = 0; stop < reel.length; stop++) {
    for (let row = 0; row < 3; row++) {
      out[stop * 3 + row] = SLOT_LETTERS.indexOf(reel[(stop + row - 1 + reel.length) % reel.length]);
    }
  }
  return out;
}

/** Counts every window (32^5 for a real machine; any strip lengths work). Takes seconds: tests and the strip search only. */
export function countSlotMachine(machine: Countable): SlotCounts {
  const table = prizeTable(machine);
  const lines = SLOT_LINES.length;
  const sym = machine.reels.map(reelSymbols);
  const lengths = machine.reels.map((reel) => reel.length);
  // Scatters showing on each reel at each stop.
  const scat = sym.map((s) => {
    const out = new Uint8Array(s.length / 3);
    for (let stop = 0; stop < out.length; stop++) {
      for (let row = 0; row < 3; row++) if (s[stop * 3 + row] === SLOT_SCATTER) out[stop]++;
    }
    return out;
  });
  const rows = [0, 1, 2, 3, 4].map((r) => Int32Array.from(SLOT_LINES, (line) => line[r]));
  // partial[r][line]: the tuple index so far, after reels 0..r.
  const partial = [0, 1, 2, 3].map(() => new Int32Array(lines));
  const [s0, s1, s2, s3, s4] = sym;
  const [row0, row1, row2, row3, row4] = rows;

  let linePaid = 0;
  let blank = 0;
  let best = 0;
  const scatters = [0, 0, 0, 0, 0, 0];
  const blankScatters = [0, 0, 0, 0, 0, 0];

  for (let a = 0; a < lengths[0]; a++) {
    for (let l = 0; l < lines; l++) partial[0][l] = s0[a * 3 + row0[l]];
    for (let b = 0; b < lengths[1]; b++) {
      for (let l = 0; l < lines; l++) partial[1][l] = partial[0][l] * SYMBOLS + s1[b * 3 + row1[l]];
      for (let c = 0; c < lengths[2]; c++) {
        for (let l = 0; l < lines; l++) partial[2][l] = partial[1][l] * SYMBOLS + s2[c * 3 + row2[l]];
        for (let d = 0; d < lengths[3]; d++) {
          for (let l = 0; l < lines; l++) partial[3][l] = partial[2][l] * SYMBOLS + s3[d * 3 + row3[l]];
          const p = partial[3];
          const seen4 = scat[0][a] + scat[1][b] + scat[2][c] + scat[3][d];
          for (let e = 0; e < lengths[4]; e++) {
            const base = e * 3;
            let sum = 0;
            for (let l = 0; l < lines; l++) sum += table[p[l] * SYMBOLS + s4[base + row4[l]]];
            linePaid += sum;
            if (sum > best) best = sum;
            const shown = seen4 + scat[4][e];
            if (sum === 0) blank++;
            if (shown >= 3 && shown <= 5) {
              scatters[shown]++;
              if (sum === 0) blankScatters[shown]++;
            }
          }
        }
      }
    }
  }
  return {
    linePaid,
    blank,
    scatters: [scatters[3], scatters[4], scatters[5]],
    blankScatters: [blankScatters[3], blankScatters[4], blankScatters[5]],
    best,
  };
}

/**
 * linePaid and scatters only, without visiting every window: for the strip search.
 * It assumes the real machines' rule that a reel's scatters are at least 3 stops apart, so each shows on 3 stops.
 */
export function quickSlotCounts(machine: Countable): Pick<SlotCounts, 'linePaid' | 'scatters'> {
  const table = prizeTable(machine);
  // How often each reel shows each symbol on one row; every line sees each reel's letters equally often.
  const per = machine.reels.map((reel) => {
    const n = new Array<number>(SYMBOLS).fill(0);
    for (const letter of reel) n[SLOT_LETTERS.indexOf(letter)]++;
    return n;
  });
  let sum = 0;
  for (let n = 0; n < table.length; n++) {
    if (table[n] === 0) continue;
    let rest = n;
    let ways = 1;
    for (let r = SLOT_REELS - 1; r >= 0; r--) {
      ways *= per[r][rest % SYMBOLS];
      rest = Math.floor(rest / SYMBOLS);
    }
    sum += table[n] * ways;
  }
  // Windows by scatters showing: multiply out, per reel, (stops with none) + (stops with one) x z.
  let poly = [1];
  for (let r = 0; r < SLOT_REELS; r++) {
    const own = per[r][SLOT_SCATTER];
    const next = new Array<number>(poly.length + 1).fill(0);
    poly.forEach((c, k) => {
      next[k] += c * (machine.reels[r].length - 3 * own);
      next[k + 1] += c * 3 * own;
    });
    poly = next;
  }
  return { linePaid: sum * SLOT_LINES.length, scatters: [poly[3], poly[4], poly[5]] };
}
