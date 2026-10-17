import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import { GameEngine } from "./game/engine";
import { sfx } from "./game/audio";
import arenaBackground from "./assets/arena-background.png";
import robotSprite from "./assets/robot-runner-key.png";
import monsterSprite from "./assets/robot-monster-key.png";
import type { Difficulty, GameResult, HudState } from "./game/types";

type Screen = "menu" | "playing" | "over";

const DIFF_META: Record<
  Difficulty,
  { label: string; desc: string; emoji: string; grad: string; hearts: number }
> = {
  easy: {
    label: "Mudah",
    desc: "Perkalian 1–5, waktu jawab lebih lama",
    emoji: "🌱",
    grad: "from-emerald-400 to-teal-500",
    hearts: 5,
  },
  medium: {
    label: "Sedang",
    desc: "Perkalian 1–10, kecepatan sedang",
    emoji: "⚡",
    grad: "from-amber-400 to-orange-500",
    hearts: 4,
  },
  hard: {
    label: "Sulit",
    desc: "Perkalian 1–10, cepat & rintangan padat",
    emoji: "🔥",
    grad: "from-rose-500 to-red-600",
    hearts: 3,
  },
};



function emptyHud(difficulty: Difficulty): HudState {
  const hearts = DIFF_META[difficulty].hearts;
  return {
    score: 0,
    coins: 0,
    hearts,
    maxHearts: hearts,
    level: 1,
    combo: 0,
    speed: 0,
    timeLeft: 0,
    timeTotal: 1,
    question: null,
    rocket: 0,
    progress: 0,
    paused: false,
    speedMult: 1,
    phase: "running",
    bossHp: 0,
    bossMaxHp: 0,
    bossName: "",
    bossHitFlash: 0,
    bossDying: false,
    shocked: 0,
  };
}

function bestKey(d: Difficulty, n: number) {
  return `run-hitung-best-${d}-${n}`;
}

function readBest(d: Difficulty, n: number) {
  if (typeof window === "undefined") return 0;
  const v = Number(window.localStorage.getItem(bestKey(d, n)));
  return Number.isFinite(v) ? v : 0;
}

export default function App() {
  const [screen, setScreen] = useState<Screen>("menu");
  const [difficulty, setDifficulty] = useState<Difficulty>("medium");
  const [maxNumber, setMaxNumber] = useState(10);
  const [hud, setHud] = useState<HudState>(() => emptyHud("medium"));
  const [result, setResult] = useState<GameResult | null>(null);
  const [toast, setToast] = useState<{ kind: "good" | "bad" | "info"; text: string; id: number } | null>(
    null,
  );
  const [muted, setMuted] = useState(false);
  const [showTable, setShowTable] = useState(false);
  const [paused, setPaused] = useState(false);
  const [speedMult, setSpeedMult] = useState<1 | 2 | 3>(1);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<GameEngine | null>(null);
  const toastId = useRef(0);
