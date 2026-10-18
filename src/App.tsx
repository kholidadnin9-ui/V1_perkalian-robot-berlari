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
  const [showSettings, setShowSettings] = useState(false);
  const [paused, setPaused] = useState(false);
  const [speedMult, setSpeedMult] = useState<1 | 2 | 3>(1);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<GameEngine | null>(null);
  const toastId = useRef(0);

  const best = useMemo(() => readBest(difficulty, maxNumber), [difficulty, maxNumber]);

  const showToast = useCallback((kind: "good" | "bad" | "info", text: string) => {
    toastId.current += 1;
    setToast({ kind, text, id: toastId.current });
  }, []);

  // auto dismiss the feedback toast
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 2800);
    return () => window.clearTimeout(t);
  }, [toast]);

  const handleGameOver = useCallback((r: GameResult) => {
    const key = bestKey(r.difficulty, r.maxNumber);
    const prev = readBest(r.difficulty, r.maxNumber);
    const isNewBest = r.score > prev;
    if (isNewBest) window.localStorage.setItem(key, String(r.score));
    setResult({ ...r, best: Math.max(prev, r.score), isNewBest });
    setScreen("over");
  }, []);

  // create / destroy the engine whenever the game screen is active
  useEffect(() => {
    if (screen !== "playing" || !canvasRef.current) return;
    const engine = new GameEngine(canvasRef.current, {
      difficulty,
      maxNumber,
      playerSprite: robotSprite,
      onHud: (h) => setHud(h),
      onGameOver: handleGameOver,
      onFeedback: (kind, text) => showToast(kind, text),
    });
    engineRef.current = engine;
    engine.start();
    return () => {
      engine.stop();
      engineRef.current = null;
    };
  }, [screen, difficulty, maxNumber, handleGameOver, showToast]);

  const startGame = useCallback(() => {
    setHud(emptyHud(difficulty));
    setResult(null);
    setToast(null);
    setPaused(false);
    setScreen("playing");
  }, [difficulty]);

  const answer = useCallback((value: number) => {
    engineRef.current?.answer(value);
  }, []);

  const jump = useCallback(() => {
    engineRef.current?.jump();
  }, []);

  const togglePause = useCallback(() => {
    setPaused((p) => {
      const next = !p;
      engineRef.current?.setPaused(next);
      return next;
    });
  }, []);

  const changeSpeed = useCallback((m: 1 | 2 | 3) => {
    setSpeedMult(m);
    engineRef.current?.setSpeedMult(m);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      void document.documentElement.requestFullscreen?.().catch(() => {});
    } else {
      void document.exitFullscreen?.().catch(() => {});
    }
  }, []);

  useEffect(() => {
    const onFs = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  // keyboard controls
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (screen === "playing") {
        if (k === "p" || k === "escape") {
          e.preventDefault();
          togglePause();
          return;
        }
        if (k === " " || k === "arrowup" || k === "w") {
          e.preventDefault();
          jump();
          return;
        }
      } else if (k === "enter" || k === " ") {
        e.preventDefault();
        startGame();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [screen, hud.question, startGame, answer, jump, togglePause]);

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    sfx.setMuted(next);
  };

  return (
    <div className="min-h-screen w-full overflow-x-hidden bg-[#070b18] text-white">
      {/* background decor */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -left-32 -top-32 h-96 w-96 rounded-full bg-sky-500/20 blur-3xl" />
        <div className="absolute -bottom-40 right-0 h-[28rem] w-[28rem] rounded-full bg-fuchsia-600/20 blur-3xl" />
        <div className="absolute left-1/3 top-1/4 h-72 w-72 rounded-full bg-amber-500/10 blur-3xl" />
      </div>

      <div className="relative mx-auto flex min-h-screen w-full max-w-7xl min-w-0 flex-col px-2 py-3 sm:px-4 sm:py-4 lg:px-6 lg:py-5">
        {/* header */}
        <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-2xl bg-gradient-to-br from-sky-400 to-indigo-600 p-1 shadow-lg shadow-indigo-500/30 ring-2 ring-amber-300/50 sm:h-12 sm:w-12">
              <img src={robotSprite} alt="Robot emas" className="h-full w-full object-contain drop-shadow" />
            </div>
            <div className="min-w-0">
              <h1 className="text-xl font-black tracking-tight sm:text-2xl">RUN <span className="text-amber-300">&</span> HITUNG</h1>
              <p className="text-[10px] font-black uppercase leading-tight tracking-[0.1em] text-amber-300 sm:text-xs sm:tracking-[0.14em]">Created by: Widodo Guru SD</p>
              <p className="hidden text-xs text-slate-400 sm:block sm:text-sm">Belajar perkalian 1–10 sambil berlari tanpa henti!</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-1.5 sm:gap-2">
            <button onClick={() => setShowTable(true)} className="rounded-xl border border-white/15 bg-white/5 px-2 py-2 text-[11px] font-semibold text-slate-200 transition hover:bg-white/10 sm:px-3 sm:text-sm">📋 Tabel Perkalian</button>
            <button onClick={() => setShowSettings(true)} aria-label="Pengaturan" title="Pengaturan" className="rounded-xl border border-white/15 bg-white/5 px-2 py-2 text-[11px] font-semibold text-slate-200 transition hover:bg-white/10 sm:px-3 sm:text-sm">⚙️ Pengaturan</button>
            <button onClick={toggleMute} aria-label="Suara" className="rounded-xl border border-white/15 bg-white/5 px-2 py-2 text-xs font-semibold text-slate-200 transition hover:bg-white/10 sm:px-3 sm:text-sm">{muted ? "🔇" : "🔊"}</button>
          </div>
        </header>

        {screen === "menu" && (
          <MenuScreen
            difficulty={difficulty}
            setDifficulty={setDifficulty}
            maxNumber={maxNumber}
            setMaxNumber={setMaxNumber}
            best={best}
            onStart={startGame}
          />
        )}

        {screen === "playing" && (
          <GameScreen
            canvasRef={canvasRef}
            hud={hud}
            toast={toast}
            paused={paused}
            onAnswer={answer}
            onJump={jump}
            onTogglePause={togglePause}
            speedMult={speedMult}
            onChangeSpeed={changeSpeed}
            onToggleFullscreen={toggleFullscreen}
            isFullscreen={isFullscreen}
          />
        )}

        {screen === "over" && result && (
          <GameOverScreen
            result={result}
            onRetry={startGame}
            onMenu={() => {
              setScreen("menu");
              setResult(null);
            }}
          />
        )}
      </div>

      {showTable && <TableModal maxNumber={maxNumber} onClose={() => setShowTable(false)} />}
      {showSettings && <SettingsModal speedMult={speedMult} onChangeSpeed={changeSpeed} muted={muted} onToggleMute={toggleMute} isFullscreen={isFullscreen} onToggleFullscreen={toggleFullscreen} onClose={() => setShowSettings(false)} />}
    </div>
  );
}

/* ------------------------------------------------------------------ menu */
function MenuScreen({
  difficulty,
  setDifficulty,
  maxNumber,
  setMaxNumber,
  best,
  onStart,
}: {
  difficulty: Difficulty;
  setDifficulty: (d: Difficulty) => void;
  maxNumber: number;
  setMaxNumber: (n: number) => void;
  best: number;
  onStart: () => void;
}) {
  return (
    <div className="grid flex-1 gap-4 lg:grid-cols-[1.15fr_1fr]">
      <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-slate-950 shadow-2xl">
        {/* The same transparent robot sprites appear here and in the game. */}
        <div className="relative min-h-[20rem] overflow-hidden sm:min-h-[23rem]">
          <img
            src={arenaBackground}
            alt="Arena kota futuristik tempat robot bertarung"
            className="absolute inset-0 h-full w-full object-cover object-center"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-slate-950/30 via-transparent to-slate-950/60" />
          <img
            src={robotSprite}
            alt="Robot emas berlari menuju lawan"
            className="hero-robot absolute bottom-[20%] left-[2%] h-[58%] w-auto object-contain drop-shadow-[0_12px_25px_rgba(0,0,0,0.8)] sm:bottom-[19%] sm:left-[12%] sm:h-[70%]"
          />
          <img
            src={monsterSprite}
            alt="Robot monster berhadapan dengan robot pemain"
            className="hero-monster absolute bottom-[19%] right-[2%] h-[72%] w-auto object-contain drop-shadow-[0_12px_25px_rgba(0,0,0,0.8)] sm:bottom-[16%] sm:right-[10%] sm:h-[80%]"
          />
          {/* scrims: bottom title plate stays high-contrast over the art */}
          <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-slate-950 via-slate-950/90 to-transparent" />
          <div className="absolute inset-x-0 top-0 h-1/3 bg-gradient-to-b from-slate-950/80 to-transparent" />
          <div className="absolute left-4 top-4 sm:left-6 sm:top-5">
            <span className="inline-flex items-center gap-2 rounded-full border border-amber-300/50 bg-slate-950/85 px-3 py-1 text-xs font-black uppercase tracking-widest text-amber-300 ring-1 ring-white/10">
              ⭐ Game Edukasi SD
            </span>
          </div>

          <div className="absolute inset-x-0 bottom-0 p-5 sm:p-7">
            <h2 className="text-3xl font-black leading-[1.05] text-white drop-shadow-[0_4px_14px_rgba(0,0,0,1)] sm:text-5xl">
              Jawab Perkalian,
              <br />
              <span className="text-amber-300">Robot Menang!</span>
            </h2>
            <p className="mt-3 inline-block rounded-lg border border-amber-300/60 bg-slate-950/90 px-3 py-1.5 text-xs font-black uppercase tracking-[0.16em] text-amber-200 ring-1 ring-white/10 sm:text-sm">
              Created by: Widodo Guru SD
            </p>
          </div>
        </div>

        <div className="relative p-5 sm:p-7">
          <p className="max-w-lg text-sm text-slate-200/95 sm:text-base">
            Robot emas berlari tanpa henti. Setiap tembok besar membawa soal perkalian — jawab
            dengan benar sebelum waktunya habis dan tembak rintangan itu dengan laser! Di akhir
            level kamu akan beradu cepat menjawab dengan robot monster.
          </p>

          <ul className="mt-4 grid gap-2 text-sm text-slate-200/95 sm:text-base">
            <li className="flex items-center gap-2">
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-white/15 text-xs font-bold">
                1
              </span>
              Soal perkalian selalu muncul di layar.
            </li>
            <li className="flex items-center gap-2">
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-white/15 text-xs font-bold">
                2
              </span>
              Jawab benar sebelum waktu habis → laser menembak rintangan.
            </li>
            <li className="flex items-center gap-2">
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-white/15 text-xs font-bold">
                3
              </span>
              Lompat rintangan rendah dengan{" "}
              <kbd className="rounded bg-white/15 px-1.5 py-0.5 text-xs font-bold">Spasi</kbd> / tombol
              Lompat.
            </li>
            <li className="flex items-center gap-2">
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-white/15 text-xs font-bold">
                4
              </span>
              Setiap 3 level, adu cepat menjawab melawan robot monster.
            </li>
          </ul>

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <button
              onClick={onStart}
              className="group inline-flex items-center gap-2 rounded-2xl bg-gradient-to-r from-amber-400 to-orange-500 px-7 py-3.5 text-base font-black text-slate-900 shadow-xl shadow-orange-500/30 transition hover:scale-[1.03] active:scale-95 sm:text-lg"
            >
              ▶ Mulai Lari
            </button>
            <div className="rounded-2xl border border-white/15 bg-white/5 px-4 py-2.5 backdrop-blur">
              <p className="text-[11px] uppercase tracking-wider text-slate-400">Rekor terbaik</p>
              <p className="text-xl font-black text-amber-300">{best.toLocaleString("id-ID")}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <div className="rounded-3xl border border-white/10 bg-white/5 p-5 backdrop-blur sm:p-6">
          <h3 className="text-sm font-black uppercase tracking-widest text-slate-300">Pilih Level</h3>
          <div className="mt-3 grid gap-2.5">
            {(Object.keys(DIFF_META) as Difficulty[]).map((d) => {
              const meta = DIFF_META[d];
              const active = difficulty === d;
              return (
                <button
                  key={d}
                  onClick={() => setDifficulty(d)}
                  className={`flex items-center gap-3 rounded-2xl border px-4 py-3 text-left transition ${
                    active
                      ? `border-transparent bg-gradient-to-r ${meta.grad} text-slate-900 shadow-lg`
                      : "border-white/10 bg-white/5 text-white hover:bg-white/10"
                  }`}
                >
                  <span className="text-2xl">{meta.emoji}</span>
                  <span className="flex-1">
                    <span className="block font-black">{meta.label}</span>
                    <span
                      className={`block text-xs ${active ? "text-slate-800/80" : "text-slate-400"}`}
                    >
                      {meta.desc}
                    </span>
                  </span>
                  {active && <span className="text-lg">✔️</span>}
                </button>
              );
            })}
          </div>

          <h3 className="mt-5 text-sm font-black uppercase tracking-widest text-slate-300">
            Tabel yang Dipakai
          </h3>
          <div className="mt-2 grid grid-cols-2 gap-2.5">
            {[
              { n: 5, label: "1 – 5" },
              { n: 10, label: "1 – 10" },
            ].map((o) => (
              <button
                key={o.n}
                onClick={() => setMaxNumber(o.n)}
                className={`rounded-2xl border px-4 py-3 font-black transition ${
                  maxNumber === o.n
                    ? "border-sky-400 bg-sky-500/25 text-white"
                    : "border-white/10 bg-white/5 text-slate-300 hover:bg-white/10"
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-3xl border border-white/10 bg-white/5 p-5 text-sm text-slate-300 backdrop-blur">
          <h3 className="font-black uppercase tracking-widest text-slate-200">Cara Bermain</h3>
          <ul className="mt-2 space-y-1.5">
            <li>🖱️ Klik jawaban atau tekan tombol 1–4 / A S D F.</li>
            <li>␣ Tekan Spasi atau ↑ untuk melompat.</li>
            <li>🧱 Tembok hanya bisa dihancurkan dengan jawaban benar.</li>
            <li>❤️ Setiap kesalahan mengurangi 1 nyawa.</li>
            <li>🪙 Koin = +2 poin, jawaban benar = +10 poin & bonus beruntun.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ game */
function GameScreen({
  canvasRef,
  hud,
  toast,
  paused,
  onAnswer: _onAnswer,
  onJump,
  onTogglePause,
  speedMult,
  onChangeSpeed,
  onToggleFullscreen,
  isFullscreen,
}: {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  hud: HudState;
  toast: { kind: "good" | "bad" | "info"; text: string; id: number } | null;
  paused: boolean;
  onAnswer: (v: number) => void;
  onJump: () => void;
  onTogglePause: () => void;
  speedMult: 1 | 2 | 3;
  onChangeSpeed: (m: 1 | 2 | 3) => void;
  onToggleFullscreen: () => void;
  isFullscreen: boolean;
}) {
  const q = hud.question;
  const timerPct = Math.max(0, Math.min(1, hud.timeTotal ? hud.timeLeft / hud.timeTotal : 0));
  const [stageWidth, setStageWidth] = useState(() => {
    if (typeof window === "undefined") return 960;
    const availableWidth = window.innerWidth - 24;
    const availableHeight = window.innerHeight - 245;
    return window.innerWidth > window.innerHeight
      ? Math.max(320, Math.min(availableWidth, availableHeight * (16 / 9)))
      : Math.max(280, Math.min(availableWidth, 960));
  });

  useEffect(() => {
    const updateStageSize = () => {
      const availableWidth = window.innerWidth - 24;
      const availableHeight = window.innerHeight - 245;
      const nextWidth = window.innerWidth > window.innerHeight
        ? Math.max(320, Math.min(availableWidth, availableHeight * (16 / 9)))
        : Math.max(280, Math.min(availableWidth, 960));
      setStageWidth(nextWidth);
    };
    window.addEventListener("resize", updateStageSize);
    window.addEventListener("orientationchange", updateStageSize);
    return () => {
      window.removeEventListener("resize", updateStageSize);
      window.removeEventListener("orientationchange", updateStageSize);
    };
  }, []);

  return (
    <div className="flex flex-1 flex-col gap-3">
      {/* HUD */}
      <div className="grid grid-cols-2 items-stretch gap-2 sm:grid-cols-4 sm:gap-3">
        <StatCard label="Skor" value={hud.score.toLocaleString("id-ID")} icon="🏆" accent="text-amber-300" />
        <StatCard
          label="Nyawa"
          value={
            <span className="flex items-center justify-center gap-0.5">
              {Array.from({ length: hud.maxHearts }).map((_, i) => (
                <span key={i} className={i < hud.hearts ? "" : "opacity-25 grayscale"}>
                  ❤️
                </span>
              ))}
            </span>
          }
        />
        <StatCard
          label="Level"
          value={
            <span className="flex items-center justify-center gap-2">
              Lv.{hud.level}
              <span className="hidden h-1.5 w-14 overflow-hidden rounded-full bg-white/15 sm:inline-block">
                <span
                  className="block h-full rounded-full bg-gradient-to-r from-sky-400 to-indigo-400"
                  style={{ width: `${Math.round(hud.progress * 100)}%` }}
                />
              </span>
            </span>
          }
          icon="🚀"
        />
        <StatCard
          label="Kecepatan"
          value={`${hud.speed}`}
          icon="⚡"
          extra={
            hud.rocket > 0 ? (
              <span className="ml-1 rounded-full bg-orange-500/30 px-2 py-0.5 text-[10px] font-black text-orange-200">
                ROKET {hud.rocket.toFixed(1)}s
              </span>
            ) : null
          }
        />
      </div>

      {/* stage */}
      <div
        className="game-stage relative mx-auto overflow-hidden rounded-2xl border border-white/10 bg-slate-900 shadow-2xl sm:rounded-3xl"
        style={{ width: `${stageWidth}px`, maxWidth: "100%" }}
      >
        <div className="relative w-full" style={{ aspectRatio: "16 / 9" }}>
          <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full" />
        </div>

        {/* pause overlay */}
        {paused && (
          <div className="absolute inset-0 z-10 grid place-items-center bg-slate-950/70 backdrop-blur-sm">
            <div className="rounded-3xl border border-white/15 bg-slate-900/90 px-8 py-6 text-center shadow-2xl">
              <p className="text-4xl">⏸️</p>
              <p className="mt-2 text-xl font-black">Permainan Dijeda</p>
              <p className="mt-1 text-sm text-slate-400">Tekan P atau tombol Lanjut</p>
              <button
                onClick={onTogglePause}
                className="mt-4 rounded-2xl bg-gradient-to-r from-emerald-400 to-teal-500 px-6 py-2.5 font-black text-slate-900 shadow-lg transition hover:scale-105 active:scale-95"
              >
                ▶ Lanjutkan
              </button>
            </div>
          </div>
        )}

        {/* boss HP bar */}
        {hud.phase === "boss" && hud.bossMaxHp > 0 && !hud.bossDying && (
          <div className="pointer-events-none absolute left-1/2 top-[58%] z-20 w-[82%] max-w-md -translate-x-1/2">
            <div className="flex items-center justify-between text-[11px] font-black tracking-widest">
              <span className="rounded bg-rose-600/90 px-2 py-0.5 text-white shadow-lg">
                🤖 {hud.bossName.toUpperCase()}
              </span>
              <span className="rounded bg-rose-600/90 px-2 py-0.5 text-white shadow-lg">
                {hud.bossHp}/{hud.bossMaxHp}
              </span>
            </div>
            <div className="mt-1 h-3 overflow-hidden rounded-full border-2 border-rose-900 bg-slate-900/80 shadow-inner">
              <div
                className="h-full rounded-full bg-gradient-to-r from-rose-500 via-red-500 to-amber-400 transition-[width] duration-200"
                style={{
                  width: `${Math.max(0, (hud.bossHp / hud.bossMaxHp) * 100)}%`,
                  filter: hud.bossHitFlash > 0 ? "brightness(2)" : undefined,
                }}
              />
            </div>
          </div>
        )}

        {/* shocked vignette (player hit by lightning) */}
        {hud.shocked > 0 && (
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              boxShadow: "inset 0 0 120px rgba(96,165,250,0.75)",
            }}
          />
        )}

        {/* question card */}
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex justify-center p-1.5 sm:p-2">
          <div
            className={`game-question-card pointer-events-auto w-[88%] max-w-sm rounded-xl border px-2 py-1.5 shadow-xl backdrop-blur-md transition sm:px-3 sm:py-2 ${
              q
                ? hud.phase === "boss"
                  ? "border-rose-400/60 bg-rose-950/85"
                  : "border-amber-300/60 bg-slate-900/85"
                : "border-white/10 bg-slate-900/60"
            }`}
          >
            {q ? (
              <>
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={`rounded-lg px-2 py-0.5 text-[10px] font-black uppercase tracking-wider ${
                      hud.phase === "boss"
                        ? "bg-rose-500/30 text-rose-200"
                        : "bg-amber-400/20 text-amber-300"
                    }`}
                  >
                    {hud.phase === "boss" ? "⚡ Duel Boss" : "Soal Perkalian"}
                  </span>
                  {hud.combo > 1 && (
                    <span className="rounded-lg bg-fuchsia-500/25 px-2 py-0.5 text-[10px] font-black text-fuchsia-200">
                      🔥 {hud.combo}x beruntun
                    </span>
                  )}
                </div>
                <div className="mt-0.5 flex items-baseline justify-center gap-1.5 sm:gap-2">
                  <span className="text-xl font-black tabular-nums text-white min-[380px]:text-2xl sm:text-3xl lg:text-4xl">
                    {q.a} × {q.b}
                  </span>
                  <span className="text-lg font-black text-amber-300 min-[380px]:text-xl sm:text-2xl lg:text-3xl">=</span>
                  <span className="text-xl font-black text-amber-300 min-[380px]:text-2xl sm:text-3xl lg:text-4xl">?</span>
                </div>
                <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-white/15">
                  <div
                    className={`h-full rounded-full transition-[width] duration-75 ${
                      timerPct > 0.5
                        ? "bg-gradient-to-r from-emerald-400 to-lime-300"
                        : timerPct > 0.22
                          ? "bg-gradient-to-r from-amber-400 to-yellow-300"
                          : "bg-gradient-to-r from-rose-500 to-red-400"
                    }`}
                    style={{ width: `${Math.round(timerPct * 100)}%` }}
                  />
                </div>
              </>
            ) : (
              <p className="py-1 text-center text-sm font-semibold text-slate-300">
                {hud.phase === "boss"
                  ? hud.bossDying
                    ? "💥 Bos hancur!"
                    : "⚡ Siap tembak lagi…"
                  : "🌟 Lari terus! Soal berikutnya segera muncul…"}
              </p>
            )}
          </div>
        </div>

        {/* feedback toast */}
        {toast && (
          <div
            key={toast.id}
            className={`pointer-events-none absolute bottom-3 left-1/2 max-w-[92%] -translate-x-1/2 rounded-xl px-4 py-2 text-center text-xs font-bold shadow-xl sm:text-sm ${
              toast.kind === "good"
                ? "bg-emerald-500/95 text-emerald-950"
                : toast.kind === "bad"
                  ? "bg-rose-500/95 text-white"
                  : "bg-slate-700/95 text-slate-100"
            }`}
          >
            {toast.text}
          </div>
        )}
        <div className="absolute inset-x-0 bottom-0 z-30 flex items-end justify-between gap-2 bg-gradient-to-t from-slate-950/95 via-slate-950/65 to-transparent px-2 pb-2 pt-8 sm:px-4 sm:pb-4">
          <button onPointerDown={(e) => { e.preventDefault(); onJump(); }} onContextMenu={(e) => e.preventDefault()} aria-label="Lompat atau sundul" className="min-h-11 flex-1 select-none touch-manipulation rounded-xl bg-gradient-to-r from-amber-400 to-orange-500 px-3 py-2.5 text-sm font-black text-slate-950 shadow-lg active:scale-95 sm:min-h-14 sm:max-w-xs sm:rounded-2xl sm:px-5 sm:text-lg">⬆️ LOMPAT / SUNDUL</button>
          <div className="flex shrink-0 gap-2">
            <button onClick={onTogglePause} title="Jeda (P)" aria-label={paused ? "Lanjutkan permainan" : "Jeda permainan"} className="grid min-h-11 min-w-11 place-items-center rounded-xl border border-white/20 bg-slate-800/90 px-3 text-lg font-black text-white shadow-lg backdrop-blur sm:min-h-14 sm:min-w-14 sm:rounded-2xl sm:text-2xl">{paused ? "▶" : "⏸"}</button>
            <button onClick={onToggleFullscreen} aria-label={isFullscreen ? "Keluar dari layar penuh" : "Layar penuh"} title="Layar penuh" className={`grid min-h-11 min-w-11 place-items-center rounded-xl border px-3 text-lg font-black shadow-lg backdrop-blur sm:min-h-14 sm:min-w-14 sm:rounded-2xl sm:text-2xl ${isFullscreen ? "border-sky-300/60 bg-sky-500/30 text-sky-100" : "border-white/20 bg-slate-800/90 text-white"}`}>⛶</button>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-center gap-2 rounded-xl border border-amber-300/25 bg-amber-400/10 px-2 py-1.5 text-center text-[11px] font-bold text-amber-100 sm:text-sm">
        🤖⬆️ Lompat tepat di bawah jawaban yang benar untuk <span className="text-amber-300">menyundulnya!</span>
        <span className="ml-2 shrink-0 text-amber-300">🪙 {hud.coins} koin</span>
      </div>
    </div>
  );
}

/* --------------------------------------------------------- settings modal */
function SettingsModal({ speedMult, onChangeSpeed, muted, onToggleMute, isFullscreen, onToggleFullscreen, onClose }: {
  speedMult: 1 | 2 | 3; onChangeSpeed: (m: 1 | 2 | 3) => void; muted: boolean; onToggleMute: () => void;
  isFullscreen: boolean; onToggleFullscreen: () => void; onClose: () => void;
}) {
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm" onClick={onClose}>
    <div className="w-full max-w-md rounded-3xl border border-white/10 bg-slate-900 p-5 shadow-2xl sm:p-6" onClick={(e) => e.stopPropagation()}>
      <div className="mb-5 flex items-center justify-between"><h3 className="text-xl font-black sm:text-2xl">⚙️ Pengaturan Game</h3><button onClick={onClose} className="rounded-xl border border-white/15 bg-white/5 px-3 py-2 font-bold">✕</button></div>
      <p className="mb-3 text-sm font-bold text-slate-300">Kecepatan permainan</p>
      <div className="grid grid-cols-3 gap-2">{([1,2,3] as const).map(m => <button key={m} onClick={() => onChangeSpeed(m)} aria-pressed={speedMult === m} className={`rounded-xl border px-3 py-3 font-black ${speedMult === m ? "border-sky-300 bg-gradient-to-r from-sky-400 to-indigo-500 text-white" : "border-white/10 bg-white/5 text-slate-300"}`}>{m}×<span className="mt-1 block text-xs">{m === 1 ? "Santai" : m === 2 ? "Sedang" : "Cepat"}</span></button>)}</div>
      <div className="mt-4 grid grid-cols-2 gap-2"><button onClick={onToggleMute} className="rounded-xl border border-white/10 bg-white/5 px-3 py-3 text-sm font-bold">{muted ? "🔇 Suara Mati" : "🔊 Suara Aktif"}</button><button onClick={onToggleFullscreen} className="rounded-xl border border-white/10 bg-white/5 px-3 py-3 text-sm font-bold">{isFullscreen ? "⛶ Keluar Penuh" : "⛶ Layar Penuh"}</button></div>
      <button onClick={onClose} className="mt-5 w-full rounded-xl bg-emerald-400 px-4 py-3 font-black text-slate-950">Selesai</button>
    </div></div>;
}


function StatCard({
  label,
  value,
  icon,
  accent = "text-white",
  extra,
}: {
  label: string;
  value: React.ReactNode;
  icon?: string;
  accent?: string;
  extra?: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 backdrop-blur">
      <p className="flex items-center gap-1 text-[10px] font-black uppercase tracking-wider text-slate-400">
        {icon && <span>{icon}</span>}
        {label}
        {extra}
      </p>
      <p className={`text-lg font-black leading-tight sm:text-2xl ${accent}`}>{value}</p>
    </div>
  );
}

/* ------------------------------------------------------------- game over */
function GameOverScreen({
  result,
  onRetry,
  onMenu,
}: {
  result: GameResult;
  onRetry: () => void;
  onMenu: () => void;
}) {
  return (
    <div className="grid flex-1 place-items-center">
      <div className="w-full max-w-2xl rounded-3xl border border-white/10 bg-gradient-to-br from-slate-900/90 to-indigo-950/80 p-6 text-center shadow-2xl backdrop-blur sm:p-9">
        <p className="text-5xl">🏁</p>
        <h2 className="mt-2 text-2xl font-black sm:text-4xl">Permainan Selesai!</h2>
        {result.isNewBest && (
          <p className="mt-2 inline-block rounded-full bg-amber-400/20 px-4 py-1 text-sm font-black text-amber-300">
            🎉 Rekor baru!
          </p>
        )}

        <div className="mt-5 flex flex-col items-center">
          <p className="text-xs font-black uppercase tracking-widest text-slate-400">Skor akhir</p>
          <p className="text-5xl font-black tabular-nums text-white sm:text-7xl">
            {result.score.toLocaleString("id-ID")}
          </p>
          <p className="mt-1 text-sm text-slate-400">
            Rekor: <span className="font-bold text-amber-300">{result.best.toLocaleString("id-ID")}</span> ·
            Jarak <span className="font-bold text-sky-300">{result.distance} m</span>
          </p>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          <MiniStat label="Benar" value={result.correct} tone="text-emerald-300" />
          <MiniStat label="Salah" value={result.wrong} tone="text-rose-300" />
          <MiniStat label="Akurasi" value={`${result.accuracy}%`} tone="text-sky-300" />
          <MiniStat label="Bos" value={`${result.bossesDefeated}`} tone="text-fuchsia-300" />
        </div>

        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <button
            onClick={onRetry}
            className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-r from-amber-400 to-orange-500 px-7 py-3.5 text-base font-black text-slate-900 shadow-xl shadow-orange-500/30 transition hover:scale-[1.03] active:scale-95"
          >
            🔄 Coba Lagi
          </button>
          <button
            onClick={onMenu}
            className="rounded-2xl border border-white/20 bg-white/10 px-7 py-3.5 text-base font-black text-white transition hover:bg-white/20 active:scale-95"
          >
            🏠 Menu
          </button>
        </div>
        <p className="mt-3 text-xs text-slate-500">Tekan Enter untuk bermain lagi</p>
      </div>
    </div>
  );
}

function MiniStat({ label, value, tone }: { label: string; value: React.ReactNode; tone: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2.5">
      <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">{label}</p>
      <p className={`text-xl font-black ${tone}`}>{value}</p>
    </div>
  );
}

/* --------------------------------------------------------- table modal */
function TableModal({ maxNumber, onClose }: { maxNumber: number; onClose: () => void }) {
  const n = maxNumber;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm">
      <div className="w-full max-w-3xl rounded-3xl border border-white/10 bg-slate-900 p-4 shadow-2xl sm:p-6">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-lg font-black sm:text-xl">📋 Tabel Perkalian 1–{n}</h3>
          <button
            onClick={onClose}
            className="rounded-xl border border-white/15 bg-white/5 px-3 py-1.5 text-sm font-bold text-slate-200 hover:bg-white/10"
          >
            ✕ Tutup
          </button>
        </div>
        <div className="max-h-[65vh] overflow-auto rounded-2xl border border-white/10">
          <table className="w-full border-collapse text-center text-xs sm:text-sm">
            <thead className="sticky top-0 bg-slate-800/95 backdrop-blur">
              <tr>
                <th className="p-2 font-black text-amber-300">×</th>
                {Array.from({ length: n }, (_, i) => (
                  <th key={i} className="p-2 font-black">
                    {i + 1}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: n }, (_, r) => (
                <tr key={r} className={r % 2 ? "bg-white/[0.04]" : ""}>
                  <th className="p-2 font-black text-amber-300">{r + 1}</th>
                  {Array.from({ length: n }, (_, c) => (
                    <td key={c} className="p-2 font-semibold text-slate-200">
                      {(r + 1) * (c + 1)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
