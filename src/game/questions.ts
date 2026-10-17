import type { Question } from "./types";

let nextId = 1;

function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function pick(a: number, b: number) {
  return a + Math.floor(Math.random() * (b - a + 1));
}

/**
 * Creates a multiplication question with 4 shuffled options.
 * `maxNumber` limits the tables used (1..maxNumber).
 */
export function makeQuestion(maxNumber: number, previous?: Question | null): Question {
  const max = Math.max(2, Math.min(10, maxNumber));
  let a = pick(1, max);
  let b = pick(1, max);
  // avoid repeating the exact same pair twice in a row
  if (previous && a === previous.a && b === previous.b) {
    b = b === max ? 1 : b + 1;
  }
  const answer = a * b;

  const candidates = new Set<number>();
  const offsets = [1, -1, 2, -2, 3, -3, 10, -10, a, -a, b, -b, 4, -4, 5, -5];
  for (const o of offsets) {
    const v = answer + o;
    if (v > 0 && v !== answer) candidates.add(v);
  }
  const pool = shuffle([...candidates]);
  const options: number[] = [answer];
  for (const v of pool) {
    if (options.length >= 4) break;
    if (!options.includes(v)) options.push(v);
  }
  // Fallback: fill up with any nearby number if not enough distractors.
  let filler = 1;
  while (options.length < 4) {
    if (!options.includes(answer + filler)) options.push(answer + filler);
    filler++;
  }

  return { id: nextId++, a, b, answer, options: shuffle(options) };
}
