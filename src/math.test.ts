import { describe, expect, it } from 'vitest';
import { ALL_OPS, levelFor, makeChoices, makeProblem, type Level, type Op, type Rng } from './math';

function seeded(seed: number): Rng {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function compute(a: number, b: number, op: Op): number {
  return op === '+' ? a + b : op === '-' ? a - b : op === '*' ? a * b : a / b;
}

describe('levelFor', () => {
  it('moves up after 5 and after 15 correct answers', () => {
    expect([0, 4, 5, 14, 15, 99].map(levelFor)).toEqual([1, 1, 2, 2, 3, 3]);
  });
});

describe('makeProblem', () => {
  for (const level of [1, 2, 3] as Level[]) {
    it(`level ${level}: every number stays within ${10 ** level}, the answer is right`, () => {
      const rng = seeded(level * 1000);
      const max = 10 ** level;
      let largest = 0;
      for (let i = 0; i < 4000; i++) {
        const p = makeProblem(level, ALL_OPS, rng);
        expect(p.answer).toBe(compute(p.a, p.b, p.op));
        expect(Number.isInteger(p.answer)).toBe(true);
        for (const v of [p.a, p.b, p.answer]) {
          expect(v).toBeGreaterThanOrEqual(1);
          expect(v).toBeLessThanOrEqual(max);
        }
        largest = Math.max(largest, p.answer);
      }
      // the level really reaches its own range
      expect(largest).toBeGreaterThan(max / 2);
    });
  }

  it('higher levels still bring easy problems', () => {
    const rng = seeded(7);
    let easy = 0;
    for (let i = 0; i < 2000; i++) if (makeProblem(3, ALL_OPS, rng).answer <= 10) easy++;
    expect(easy).toBeGreaterThan(100);
  });

  it('uses only the allowed operations', () => {
    const rng = seeded(11);
    for (let i = 0; i < 500; i++) expect(['+', '-']).toContain(makeProblem(2, ['+', '-'], rng).op);
  });

  it('does not repeat the previous problem', () => {
    const rng = seeded(3);
    let last = '';
    for (let i = 0; i < 500; i++) {
      const p = makeProblem(1, ['*'], rng, last);
      expect(p.text).not.toBe(last);
      last = p.text;
    }
  });
});

describe('makeChoices', () => {
  it('gives five different numbers, none negative, exactly one of them the answer', () => {
    const rng = seeded(42);
    for (const level of [1, 2, 3] as Level[]) {
      for (let i = 0; i < 3000; i++) {
        const p = makeProblem(level, ALL_OPS, rng);
        const choices = makeChoices(p, 5, rng);
        expect(choices).toHaveLength(5);
        expect(new Set(choices).size).toBe(5);
        expect(choices.filter((c) => c === p.answer)).toHaveLength(1);
        for (const c of choices) {
          expect(Number.isInteger(c)).toBe(true);
          expect(c).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  it('puts the answer in every position over time', () => {
    const rng = seeded(5);
    const seen = new Set<number>();
    for (let i = 0; i < 200; i++) {
      const p = makeProblem(1, ALL_OPS, rng);
      seen.add(makeChoices(p, 5, rng).indexOf(p.answer));
    }
    expect(seen.size).toBe(5);
  });
});
