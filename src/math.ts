/**
 * The arithmetic of the game: which problem comes next, and which wrong answers fly up beside
 * the right one. Pure functions – everything random comes in through `rng`, so it can be tested.
 */

export type Op = '+' | '-' | '*' | '/';
export const ALL_OPS: Op[] = ['+', '-', '*', '/'];
/** How an operation is written on the cloud (Hungarian schoolbooks divide with a colon). */
export const OP_SIGN: Record<Op, string> = { '+': '+', '-': '−', '*': '×', '/': ':' };

export type Level = 1 | 2 | 3;
export type Rng = () => number;

export interface Problem {
  a: number;
  b: number;
  op: Op;
  answer: number;
  /** "3 + 2" */
  text: string;
}

/** Correct answers needed to leave level 1 (5) and level 2 (5 + 10). */
export const LEVEL_AFTER = [5, 15];

export function levelFor(correct: number): Level {
  return correct < LEVEL_AFTER[0] ? 1 : correct < LEVEL_AFTER[1] ? 2 : 3;
}

/**
 * A level only says how large the numbers may get: level 2 still throws in "3 + 2" now and then.
 * Chance of each number range (up to 10, up to 100, up to 1000) per level.
 */
const RANGE_CHANCE: Record<Level, number[]> = {
  1: [1],
  2: [0.25, 0.75],
  3: [0.15, 0.3, 0.55],
};

function int(rng: Rng, lo: number, hi: number): number {
  return lo + Math.floor(rng() * (hi - lo + 1));
}

function pickRange(level: Level, rng: Rng): Level {
  let r = rng();
  const chances = RANGE_CHANCE[level];
  for (let i = 0; i < chances.length; i++) {
    r -= chances[i];
    if (r < 0) return (i + 1) as Level;
  }
  return level;
}

/** Two factors whose product stays inside the range: 2·3, then the times table, then one digit × two digits. */
function factors(range: Level, rng: Rng): [number, number] {
  if (range === 1) {
    const a = int(rng, 2, 5);
    return [a, int(rng, 2, Math.floor(10 / a))];
  }
  if (range === 2) return [int(rng, 2, 10), int(rng, 2, 10)];
  return [int(rng, 2, 9), int(rng, 11, 99)];
}

function problemIn(range: Level, op: Op, rng: Rng): Problem {
  const max = 10 ** range;
  let a: number;
  let b: number;
  let answer: number;
  if (op === '+') {
    a = int(rng, 1, max - 1);
    b = int(rng, 1, max - a);
    answer = a + b;
  } else if (op === '-') {
    a = int(rng, 2, max);
    b = int(rng, 1, a - 1);
    answer = a - b;
  } else {
    const [small, big] = factors(range, rng);
    const swap = rng() < 0.5;
    if (op === '*') {
      a = swap ? big : small;
      b = swap ? small : big;
      answer = a * b;
    } else {
      // in the largest range the divisor stays the one-digit factor
      const divisor = range === 3 || !swap ? small : big;
      a = small * big;
      b = divisor;
      answer = a / divisor;
    }
  }
  return { a, b, op, answer, text: `${a} ${OP_SIGN[op]} ${b}` };
}

/** The next problem for a level, using only the allowed operations and not repeating `avoid`. */
export function makeProblem(level: Level, ops: Op[], rng: Rng = Math.random, avoid = ''): Problem {
  const allowed = ops.length ? ops : ALL_OPS;
  let problem = problemIn(1, allowed[0], rng);
  for (let attempt = 0; attempt < 8; attempt++) {
    problem = problemIn(pickRange(level, rng), allowed[int(rng, 0, allowed.length - 1)], rng);
    if (problem.text !== avoid) break;
  }
  return problem;
}

function shuffle<T>(items: T[], rng: Rng): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = int(rng, 0, i);
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

/**
 * The numbers on the boxes: the answer and `count - 1` different wrong ones, shuffled.
 * The wrong ones are the mistakes a child really makes: off by one or two, off by ten (same last
 * digit), the digits swapped, or the result of another operation on the same two numbers.
 */
export function makeChoices(problem: Problem, count = 5, rng: Rng = Math.random): number[] {
  const { answer: n, a, b } = problem;
  const near = [n - 1, n + 1, n - 2, n + 2];
  const other: number[] = [];
  if (n >= 10) other.push(n - 10, n + 10);
  if (n >= 100) other.push(n - 100, n + 100);
  if (n >= 10) {
    const tens = Math.floor(n / 10) % 10;
    const ones = n % 10;
    other.push(n - tens * 10 - ones + ones * 10 + tens);
  }
  // another operation on the same numbers, as long as it is not absurdly far off
  for (const v of [a + b, Math.abs(a - b), a * b]) if (v <= Math.max(20, n * 3)) other.push(v);

  // 0 is only a believable answer next to very small numbers
  const valid = (v: number) => Number.isInteger(v) && v >= (n <= 3 ? 0 : 1) && v !== n;
  const wrong: number[] = [];
  const take = (pool: number[], howMany: number) => {
    for (const v of shuffle(pool.filter(valid), rng)) {
      if (howMany <= 0 || wrong.length >= count - 1) return;
      if (wrong.includes(v)) continue;
      wrong.push(v);
      howMany--;
    }
  };
  take(near, 2);
  take(other, 2);
  take(near, count);
  for (let step = 3; wrong.length < count - 1; step++) take([n + step, n - step], count);
  return shuffle([n, ...wrong], rng);
}
