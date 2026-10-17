export type Difficulty = "easy" | "medium" | "hard";
export type Phase = "running" | "boss" | "over";

export interface Question {
  id: number;
  a: number;
  b: number;
  answer: number;
  options: number[];
}

export interface HudState {
  score: number;
  coins: number;
  hearts: number;
  maxHearts: number;
  level: number;
  combo: number;
  speed: number;
  timeLeft: number;
  timeTotal: number;
  question: Question | null;
  rocket: number;
  progress: number;
  paused: boolean;
  speedMult: 1 | 2 | 3;
  phase: Phase;
  bossHp: number;
  bossMaxHp: number;
  bossName: string;
  bossHitFlash: number;
  bossDying: boolean;
  shocked: number;
}

export interface GameResult {
  score: number;
  best: number;
  isNewBest: boolean;
  correct: number;
  wrong: number;
  bestCombo: number;
  coins: number;
  distance: number;
  accuracy: number;
  difficulty: Difficulty;
  maxNumber: number;
  bossesDefeated: number;
}
