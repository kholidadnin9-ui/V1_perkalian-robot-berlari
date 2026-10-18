import { sfx } from "./audio";
import { makeQuestion } from "./questions";
import { BOSSES, type BossDef } from "./bosses";
import type { Difficulty, GameResult, HudState, Phase, Question } from "./types";
import monsterSpriteUrl from "../assets/robot-monster-key.png";

export const VIEW_W = 960;
export const VIEW_H = 540;

const GROUND_Y = 432;
const PLAYER_X = 246;
const GRAVITY = 2400;
const JUMP_V = 830;
const PLAYER_W = 56;
const PLAYER_H = 100;
const PLAYER_DRAW_HEIGHT = 120;

interface DiffConfig {
  hearts: number;
  baseSpeed: number;
  maxSpeed: number;
  reaction: number; // seconds available to answer before the wall arrives
  wallGap: number; // seconds between wall spawns
  hurdleGap: number; // seconds between hurdle spawns
}

const DIFF: Record<Difficulty, DiffConfig> = {
  easy: { hearts: 5, baseSpeed: 320, maxSpeed: 540, reaction: 6.0, wallGap: 2.8, hurdleGap: 2.0 },
  medium: { hearts: 4, baseSpeed: 370, maxSpeed: 630, reaction: 5.2, wallGap: 2.3, hurdleGap: 1.8 },
  hard: { hearts: 3, baseSpeed: 420, maxSpeed: 720, reaction: 4.2, wallGap: 1.9, hurdleGap: 1.6 },
};

export interface EngineOptions {
  difficulty: Difficulty;
  maxNumber: number;
  playerSprite?: string;
  onHud: (hud: HudState) => void;
  onGameOver: (result: GameResult) => void;
  onFeedback: (kind: "good" | "bad" | "info", text: string) => void;
}

interface Obstacle {
  id: number;
  x: number;
  w: number;
  h: number;
  kind: "hurdle" | "wall";
  alive: boolean;
  tied: boolean; // wall currently linked to an unanswered question
  broken: boolean;
}

interface Coin {
  x: number;
  y: number;
  taken: boolean;
  phase: number;
}

type ParticleKind =
  | "dot"
  | "smoke"
  | "spark"
  | "debris"
  | "fire"
  | "sparkle"
  | "ash";

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  color: string;
  size: number;
  g: number;
  kind?: ParticleKind;
  rot?: number;
  vrot?: number;
  shrink?: number;
  drag?: number;
}

interface FloatText {
  x: number;
  y: number;
  text: string;
  life: number;
  max: number;
  color: string;
  size: number;
}

interface Laser {
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  life: number;
  max: number;
  width: number;
  color: string;
  coreColor: string;
  onHit?: () => void;
  fired: boolean;
}

interface Bolt {
  x: number;
  y: number;
  life: number;
  max: number;
  segments: { x: number; y: number }[];
}

type BossPhase = "intro" | "fight" | "hit" | "dying" | "gone";
interface Boss {
  def: BossDef;
  hp: number;
  phase: BossPhase;
  phaseT: number;
  x: number;
  y: number;
  bob: number;
  hitFlash: number;
  charred: number; // 0..1
  scale: number;
  dyingT: number;
  shockT: number;
}

interface AnswerBlock {
  x: number; // screen x (center)
  y: number; // top
  value: number;
  alive: boolean;
  bump: number;
  fade: number;
  vx?: number; // fixed velocity (boss duel); otherwise scrolls with world
  hit: "good" | "bad" | null;
  qid: number;
}

const BLOCK_W = 74;
const BLOCK_H = 54;
const BLOCK_BOTTOM = 172; // gap between ground and block bottom (above standing head)

const BOSS_FIGHT_REACTION_EASY = 5.2;
const BOSS_FIGHT_REACTION_MED = 4.4;
const BOSS_FIGHT_REACTION_HARD = 3.6;

const SKIES = [
  { top: "#22d3ee", bottom: "#c9f2ff", sun: "#fef08a", sunGlow: "#fde68a" },
  { top: "#fb923c", bottom: "#fecdd3", sun: "#fff1b8", sunGlow: "#fdba74" },
  { top: "#312e81", bottom: "#a5b4fc", sun: "#f8fafc", sunGlow: "#c7d2fe" },
];

export class GameEngine {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private opts: EngineOptions;
  private cfg: DiffConfig;
  private playerSprite: HTMLImageElement | null = null;
  private monsterSprite: HTMLImageElement | null = null;

  private running = false;
  private raf = 0;
  private last = 0;
  private hudTimer = 0;
  private scale = 1;
  private offsetX = 0;
  private offsetY = 0;
  private resizeObserver: ResizeObserver | null = null;

  // world state
  private time = 0;
  private px = 0;
  private speed = 0;
  private speedMul = 1;
  private level = 1;
  private bonus = 0;
  private coins = 0;
  private correct = 0;
  private wrong = 0;
  private combo = 0;
  private bestCombo = 0;
  private hearts: number;
  private status: "playing" | "over" = "playing";
  private paused = false;

  private player = { y: GROUND_Y, vy: 0, onGround: true, run: 0, rocket: 0, squash: 0 };
  private speedMult: 1 | 2 | 3 = 1;
  private obstacles: Obstacle[] = [];
  private coinsList: Coin[] = [];
  private particles: Particle[] = [];
  private texts: FloatText[] = [];
  private nextId = 1;

  private wallTimer = 0;
  private hurdleTimer = 0;
  private coinTimer = 0;
  private question: Question | null = null;
  private questionWallId: number | null = null;
  private qTimeLeft = 0;
  private qTimeTotal = 1;
  private questionsAsked = 0;
  private shake = 0;
  private flash: { color: string; a: number } | null = null;

  // lasers, lightning, boss
  private lasers: Laser[] = [];
  private bolts: Bolt[] = [];
  private phase: Phase = "running";
  private boss: Boss | null = null;
  private bossesDefeated = 0;
  private bossShockT = 0;
  private bossQuestionDeadline: number | null = null;
  private blocks: AnswerBlock[] = [];

  constructor(canvas: HTMLCanvasElement, opts: EngineOptions) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D tidak didukung");
    this.ctx = ctx;
    this.opts = opts;
    this.cfg = DIFF[opts.difficulty];
    this.hearts = this.cfg.hearts;
    this.speed = this.cfg.baseSpeed;
    this.wallTimer = 1.2;

    if (opts.playerSprite && typeof Image !== "undefined") {
      const sprite = new Image();
      sprite.onload = () => {
        this.playerSprite = sprite;
      };
      sprite.src = opts.playerSprite;
    }

    if (typeof Image !== "undefined") {
      const monster = new Image();
      monster.onload = () => {
        this.monsterSprite = monster;
      };
      monster.src = monsterSpriteUrl;
    }

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.resize();
  }

  // ---------------------------------------------------------------- lifecycle
  start() {
    this.running = true;
    this.last = performance.now();
    this.pushHud(true);
    this.raf = requestAnimationFrame(this.loop);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.resizeObserver?.disconnect();
  }

  private resize() {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width < 10) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(rect.width * dpr));
    const h = Math.max(1, Math.round(rect.height * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }

    // Keep the 960×540 game world proportional on every screen. If the
    // canvas container is not exactly 16:9, letterbox instead of cropping.
    this.scale = Math.min(this.canvas.width / VIEW_W, this.canvas.height / VIEW_H);
    this.offsetX = (this.canvas.width - VIEW_W * this.scale) / 2;
    this.offsetY = (this.canvas.height - VIEW_H * this.scale) / 2;
  }

  private loop = (ts: number) => {
    if (!this.running) return;
    const dt = Math.min(0.05, Math.max(0, (ts - this.last) / 1000));
    this.last = ts;
    // speed multiplier only affects game-world time, not physics stability
    const scaled = dt * this.speedMult;
    this.update(scaled);
    this.render();
    this.raf = requestAnimationFrame(this.loop);
  };

  // ------------------------------------------------------------------ inputs
  jump() {
    if (this.status !== "playing" || this.paused) return;
    if (!this.player.onGround) return;
    this.player.vy = -JUMP_V;
    this.player.onGround = false;
    this.player.squash = -0.22;
    sfx.jump();
    for (let i = 0; i < 6; i++) {
      this.particles.push({
        x: PLAYER_X + (Math.random() - 0.5) * 16,
        y: GROUND_Y - 2,
        vx: (Math.random() - 0.5) * 90,
        vy: -Math.random() * 60,
        life: 0.45,
        max: 0.45,
        color: "rgba(255,255,255,0.85)",
        size: 3 + Math.random() * 3,
        g: 240,
      });
    }
  }

  answer(value: number) {
    if (this.status !== "playing" || this.paused || !this.question) return;
    const q = this.question;
    const wallId = this.questionWallId;
    this.clearQuestion();

    if (value === q.answer) {
      this.correct += 1;
      this.combo += 1;
      this.bestCombo = Math.max(this.bestCombo, this.combo);
      const pts = 10 + this.combo * 2;
      this.bonus += pts;
      this.player.rocket = 2.4;
      sfx.correct();
      sfx.rocket();
      this.pushText(PLAYER_X, this.player.y - 90, `Benar! +${pts}`, "#22c55e", 26);
      this.confetti(PLAYER_X, this.player.y - 70, 14);
      this.opts.onFeedback(
        "good",
        this.combo > 1
          ? `Keren! ${q.a} × ${q.b} = ${q.answer} (${this.combo}x beruntun!)`
          : `Tepat! ${q.a} × ${q.b} = ${q.answer}`,
      );

      if (this.phase === "boss" && this.boss) {
        const tx = this.boss.x - 30;
        const ty = this.boss.y - 130 + this.bossBobOffset();
        this.fireLaser(tx, ty, () => {
          this.damageBoss(1);
        });
      } else if (wallId !== null) {
        const wall = this.obstacles.find((o) => o.id === wallId && o.alive);
        if (wall) {
          const sx = wall.x - this.px + PLAYER_X;
          this.fireLaser(sx + wall.w / 2, GROUND_Y - wall.h / 2, () => {
            this.smashObstacle(wall, true, sx, GROUND_Y - wall.h / 2);
          });
        }
      }
    } else {
      this.wrong += 1;
      this.combo = 0;
      this.hearts -= 1;
      sfx.wrong();
      this.flash = { color: "#ef4444", a: 0.45 };
      this.shake = 14;
      this.pushText(PLAYER_X, this.player.y - 90, "Belum tepat!", "#f87171", 24);
      this.opts.onFeedback(
        "bad",
        `Kurang tepat. ${q.a} × ${q.b} = ${q.answer} (${q.a} dijumlahkan ${q.b} kali)`,
      );
      if (this.phase === "boss" && this.boss) {
        this.spawnLightning(PLAYER_X + 6, this.player.y - 50);
        this.bossShockT = 0.4;
        this.shake = Math.max(this.shake, 16);
        this.flash = { color: "#a5f3fc", a: 0.35 };
      }
      if (this.hearts <= 0) {
        this.gameOver();
        return;
      }
    }
    this.pushHud(true);
  }

  // ------------------------------------------------------------------ update
  private update(dt: number) {
    if (this.paused) return;
    this.time += dt;

    if (this.status === "playing") {
      if (this.phase === "running") {
        const newLevel = 1 + Math.floor(this.time / 28);
        if (newLevel > this.level) {
          this.level = newLevel;
          sfx.levelUp();
          this.opts.onFeedback("info", `Level ${this.level}! Lari makin cepat 🏃`);
          this.confetti(PLAYER_X, this.player.y - 60, 14);
        }
        const target = Math.min(this.cfg.maxSpeed, this.cfg.baseSpeed + (this.level - 1) * 20);
        this.speedMul += (1 - this.speedMul) * Math.min(1, dt * 1.1);
        this.speed = target * this.speedMul;
        this.px += this.speed * dt;

        this.updatePlayer(dt);
        this.spawn(dt);

        if (this.question && this.questionWallId !== null) {
          const wall = this.obstacles.find((o) => o.id === this.questionWallId);
          if (!wall) {
            this.clearQuestion();
          } else if (!wall.alive) {
            this.clearQuestion();
          } else {
            const eta = (wall.x - this.px) / Math.max(1, this.speed);
            this.qTimeTotal = Math.max(this.qTimeTotal, eta);
            this.qTimeLeft = Math.max(0, Math.min(this.qTimeTotal, eta));
            if (eta <= 0) {
              this.clearQuestion();
              this.wrong += 1;
              this.combo = 0;
              this.hearts -= 1;
              sfx.wrong();
              this.flash = { color: "#ef4444", a: 0.5 };
              this.shake = 16;
              this.pushText(PLAYER_X, this.player.y - 100, "Waktu habis!", "#f87171", 22);
              this.opts.onFeedback("bad", "Waktu habis! Jawab lebih cepat ya.");
              if (this.hearts <= 0) {
                this.gameOver();
                return;
              }
            }
          }
        }
        this.updateBlocks(dt);
        this.collisions();

        // Trigger boss duel every 3 levels (once per milestone).
        if (
          this.level >= 3 &&
          this.bossesDefeated < Math.floor(this.level / 3) &&
          !this.question &&
          this.wallTimer > 0.6
        ) {
          this.enterBoss();
        }
      } else if (this.phase === "boss" && this.boss) {
        this.speedMul += (0 - this.speedMul) * Math.min(1, dt * 2.5);
        this.speed = 0;
        this.updatePlayer(dt);
        this.updateBoss(dt);
        this.updateBlocks(dt);
        // updateBoss may call exitBoss which nulls out this.boss
        const b = this.boss;
        if (
          b &&
          !this.question &&
          b.phase !== "dying" &&
          b.phase !== "gone" &&
          b.phase !== "intro"
        ) {
          this.askBossQuestion();
        }
      }
    } else {
      this.player.run += dt * 6;
    }

    this.updateParticles(dt);
    this.updateLasers(dt);
    this.updateBolts(dt);

    // fade flash / shake
    if (this.flash) {
      this.flash.a -= dt * 1.6;
      if (this.flash.a <= 0) this.flash = null;
    }
    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 40);

    this.hudTimer += dt;
    if (this.hudTimer > 0.07) {
      this.hudTimer = 0;
      this.pushHud();
    }
  }

  private updatePlayer(dt: number) {
    const p = this.player;
    p.vy += GRAVITY * dt;
    p.y += p.vy * dt;
    if (p.y >= GROUND_Y) {
      if (!p.onGround && p.vy > 200) {
        for (let i = 0; i < 5; i++) {
          this.particles.push({
            x: PLAYER_X + (Math.random() - 0.5) * 20,
            y: GROUND_Y - 2,
            vx: (Math.random() - 0.5) * 120,
            vy: -Math.random() * 40,
            life: 0.4,
            max: 0.4,
            color: "rgba(255,255,255,0.6)",
            size: 3 + Math.random() * 3,
            g: 300,
          });
        }
      }
      p.y = GROUND_Y;
      p.vy = 0;
      p.onGround = true;
    } else {
      p.onGround = false;
    }
    p.run += (this.speed / 34) * dt;
    if (p.rocket > 0) p.rocket = Math.max(0, p.rocket - dt);
    p.squash += (0 - p.squash) * Math.min(1, dt * 8);

    if (p.rocket > 0 && Math.random() < 0.7) {
      this.particles.push({
        x: PLAYER_X - 12 + (Math.random() - 0.5) * 8,
        y: this.player.y - 26 + (Math.random() - 0.5) * 26,
        vx: -120 - Math.random() * 90,
        vy: (Math.random() - 0.5) * 40,
        life: 0.35,
        max: 0.35,
        color: Math.random() < 0.5 ? "#fb923c" : "#facc15",
        size: 3 + Math.random() * 4,
        g: -60,
      });
    }
  }

  private spawn(dt: number) {
    // ---- walls (carry a math question) ----
    this.wallTimer -= dt;
    if (this.wallTimer <= 0) {
      // next wall appears only after the current one has been reached
      this.wallTimer = this.cfg.reaction + this.cfg.wallGap;
      const id = this.nextId++;
      const x = this.px + this.speed * this.cfg.reaction;
      const wall: Obstacle = { id, x, w: 62, h: 150, kind: "wall", alive: true, tied: true, broken: false };
      this.obstacles.push(wall);
      if (!this.question) {
        const q = makeQuestion(this.opts.maxNumber, null);
        this.question = q;
        this.questionWallId = id;
        this.qTimeTotal = this.cfg.reaction;
        this.qTimeLeft = this.cfg.reaction;
        this.questionsAsked += 1;
        this.spawnAnswerBlocks(q, VIEW_W + 60, Math.max(190, this.speed * 0.62));
        if (this.questionsAsked === 1) {
          this.opts.onFeedback("info", "Lompat & sundul kotak jawaban yang benar! 🤖⬆️");
        }
      } else {
        // attach the pending question to this wall
        wall.tied = true;
        this.questionWallId = id;
        if (!this.blocks.some((b) => b.alive)) this.spawnAnswerBlocks(this.question, VIEW_W + 60, Math.max(190, this.speed * 0.62));
        this.qTimeTotal = Math.max(this.qTimeTotal, this.cfg.reaction);
        this.qTimeLeft = Math.max(this.qTimeLeft, this.cfg.reaction);
      }
      this.pushHud(true);
    }

    // ---- hurdles (jump over them) ----
    // no hurdles while answer blocks are on screen (avoid forced wrong jumps)
    if (this.blocks.some((b) => b.alive)) this.hurdleTimer = Math.max(this.hurdleTimer, 1.0);
    this.hurdleTimer -= dt;
    if (this.hurdleTimer <= 0) {
      this.hurdleTimer = this.cfg.hurdleGap + Math.random() * 0.8;
      let x = this.px + 760 + Math.random() * 160;
      const wall = this.obstacles.find((o) => o.kind === "wall" && o.alive);
      if (wall) {
        // keep clear of the wall landing zone
        if (x > wall.x - 520 && x < wall.x + 120) x = wall.x + 260;
      }
      this.obstacles.push({
        id: this.nextId++,
        x,
        w: 46,
        h: 50,
        kind: "hurdle",
        alive: true,
        tied: false,
        broken: false,
      });
    }

    // ---- coins ----
    this.coinTimer -= dt;
    if (this.coinTimer <= 0) {
      this.coinTimer = 1.1 + Math.random() * 0.9;
      const x = this.px + 820;
      const arc = Math.random() < 0.6;
      const n = 5;
      for (let i = 0; i < n; i++) {
        const t = i / (n - 1);
        this.coinsList.push({
          x: x + i * 52,
          y: arc ? GROUND_Y - 40 - Math.sin(t * Math.PI) * 78 : GROUND_Y - 52,
          taken: false,
          phase: Math.random() * Math.PI * 2,
        });
      }
    }

    // cleanup
    this.obstacles = this.obstacles.filter((o) => o.x > this.px - 400);
    this.coinsList = this.coinsList.filter((c) => c.x > this.px - 200);
  }

  private smashObstacle(
    o: Obstacle,
    bonus: boolean,
    sx?: number,
    sy?: number,
  ) {
    o.alive = false;
    o.broken = true;
    sfx.smash();
    this.shake = Math.max(this.shake, 10);
    const hitX = sx ?? o.x - this.px + PLAYER_X + o.w / 2;
    const hitY = sy ?? GROUND_Y - o.h / 2;
    this.explode(hitX, hitY, o.kind === "wall" ? "#94a3b8" : "#fbbf24", o.kind === "wall" ? 28 : 22, 1.0);
    // add ground dust / smoke
    for (let i = 0; i < 12; i++) {
      this.particles.push({
        x: hitX + (Math.random() - 0.5) * 30,
        y: GROUND_Y - 4 - Math.random() * 6,
        vx: (Math.random() - 0.5) * 150,
        vy: -30 - Math.random() * 110,
        life: 0.9 + Math.random() * 0.5,
        max: 1.2,
        color: "rgba(180,190,200,0.55)",
        size: 8 + Math.random() * 10,
        g: -20,
        kind: "smoke",
        drag: 0.8,
        shrink: 1.02,
      });
    }
    if (bonus) {
      this.bonus += 30;
      this.pushText(hitX, GROUND_Y - o.h - 20, "Rintangan hancur! +30", "#38bdf8", 22);
    }
  }

  private explode(x: number, y: number, baseColor: string, n: number, scale = 1) {
    const sparks = ["#fde047", "#fb923c", baseColor, "#fef3c7", "#fef08a"];
    for (let i = 0; i < n; i++) {
      const ang = Math.random() * Math.PI * 2;
      const spd = (120 + Math.random() * 360) * scale;
      this.particles.push({
        x,
        y,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd - 60 * scale,
        life: 0.5 + Math.random() * 0.5,
        max: 1.0,
        color: sparks[Math.floor(Math.random() * sparks.length)],
        size: 2 + Math.random() * 4,
        g: 600,
        kind: "spark",
        drag: 0.96,
      });
    }
    // fire balls
    for (let i = 0; i < Math.round(10 * scale); i++) {
      const ang = Math.random() * Math.PI * 2;
      const spd = 60 + Math.random() * 220 * scale;
      this.particles.push({
        x,
        y,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd - 20,
        life: 0.4 + Math.random() * 0.35,
        max: 0.7,
        color: Math.random() < 0.5 ? "#fb923c" : "#fde047",
        size: 6 + Math.random() * 8,
        g: -60,
        kind: "fire",
        shrink: 1.06,
        drag: 0.9,
      });
    }
    // smoke
    for (let i = 0; i < Math.round(14 * scale); i++) {
      const ang = Math.random() * Math.PI * 2;
      const spd = 20 + Math.random() * 120 * scale;
      this.particles.push({
        x,
        y,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd - 40,
        life: 0.9 + Math.random() * 0.7,
        max: 1.5,
        color:
          Math.random() < 0.4
            ? "rgba(40,40,40,0.75)"
            : "rgba(170,170,170,0.55)",
        size: 10 + Math.random() * 14,
        g: -30,
        kind: "smoke",
        drag: 0.85,
        shrink: 1.025,
      });
    }
  }

  private fireLaser(targetX: number, targetY: number, onHit?: () => void) {
    const muzzleX = PLAYER_X + 30;
    const muzzleY = this.player.y - 76 + (this.player.onGround ? Math.sin(this.player.run * 2) * 2 : 0);
    this.lasers.push({
      x: muzzleX,
      y: muzzleY,
      targetX,
      targetY,
      life: 0.32,
      max: 0.32,
      width: 10,
      color: "rgba(251,191,36,0.65)",
      coreColor: "rgba(255,255,255,0.95)",
      onHit,
      fired: false,
    });
    // muzzle sparks
    for (let i = 0; i < 10; i++) {
      const ang = Math.random() * Math.PI * 2;
      const spd = 60 + Math.random() * 160;
      this.particles.push({
        x: muzzleX,
        y: muzzleY,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd,
        life: 0.2 + Math.random() * 0.2,
        max: 0.4,
        color: Math.random() < 0.5 ? "#fde047" : "#fb923c",
        size: 2 + Math.random() * 3,
        g: 80,
        kind: "spark",
        drag: 0.9,
      });
    }
  }

  private bossBobOffset() {
    return this.boss ? Math.sin(this.boss.bob * 2.6) * 5 : 0;
  }

  private spawnLightning(targetX: number, targetY: number) {
    // bolt from top-right sky to target
    const segments: { x: number; y: number }[] = [];
    let cx = targetX + (Math.random() - 0.5) * 40;
    let cy = -20;
    segments.push({ x: cx, y: cy });
    while (cy < targetY) {
      const ny = Math.min(targetY, cy + 18 + Math.random() * 20);
      cx = targetX + (Math.random() - 0.5) * 80;
      cy = ny;
      segments.push({ x: cx, y: cy });
    }
    segments.push({ x: targetX, y: targetY });
    this.bolts.push({
      x: targetX,
      y: targetY,
      life: 0.35,
      max: 0.35,
      segments,
    });
    this.flash = { color: "#60a5fa", a: 0.25 };
    sfx.hit();
    this.shake = Math.max(this.shake, 18);
    for (let i = 0; i < 14; i++) {
      this.particles.push({
        x: targetX + (Math.random() - 0.5) * 30,
        y: targetY + (Math.random() - 0.5) * 30,
        vx: (Math.random() - 0.5) * 260,
        vy: (Math.random() - 0.5) * 260,
        life: 0.25 + Math.random() * 0.25,
        max: 0.5,
        color: "#bfdbfe",
        size: 2 + Math.random() * 3,
        g: -40,
        kind: "spark",
        drag: 0.9,
      });
    }
  }

  private damageBoss(dmg: number) {
    if (!this.boss || this.boss.phase === "dying" || this.boss.phase === "gone") return;
    this.boss.hp -= dmg;
    this.boss.hitFlash = 0.25;
    this.boss.phase = "hit";
    this.boss.phaseT = 0;
    this.boss.scale = 1.06;
    sfx.hit();
    this.shake = Math.max(this.shake, 10);
    // explosion + smoke at boss chest
    const cx = this.boss.x - 28;
    const cy = this.boss.y - 130 + this.bossBobOffset();
    this.explode(cx, cy, this.boss.def.color, 22, 0.9);
    if (this.boss.hp <= 0) {
      this.boss.hp = 0;
      this.boss.phase = "dying";
      this.boss.phaseT = 0;
      this.boss.dyingT = 0;
      sfx.levelUp();
      this.bigBossExplosion();
      this.bonus += 250;
      this.bossesDefeated += 1;
      this.opts.onFeedback("good", `${this.boss.def.name} kalah! +250 bonus 🎉`);
      this.pushText(this.boss.x - 30, this.boss.y - 260, "BOS KALAH!", "#22c55e", 28);
    }
  }

  private bigBossExplosion() {
    if (!this.boss) return;
    const cx = this.boss.x - 30;
    const cy = this.boss.y - 130 + this.bossBobOffset();
    const schedule = (typeof window !== "undefined" ? window.setTimeout : null) ??
      ((fn: () => void) => {
        try {
          fn();
        } catch {
          /* ignore */
        }
      });
    for (let i = 0; i < 5; i++) {
      schedule(() => {
        if (!this.boss) return;
        const ox = cx + (Math.random() - 0.5) * 90;
        const oy = cy + (Math.random() - 0.5) * 70;
        this.explode(ox, oy, this.boss!.def.color, 32, 1.3);
        this.shake = Math.max(this.shake, 20);
      }, i * 140);
    }
    this.explode(cx, cy, "#fbbf24", 40, 1.4);
    this.flash = { color: "#fde68a", a: 0.55 };
    this.confetti(cx, cy, 28);
  }

  private enterBoss() {
    const defIdx = Math.min(BOSSES.length - 1, this.bossesDefeated);
    const def = BOSSES[defIdx];
    this.phase = "boss";
    this.boss = {
      def,
      hp: def.hp,
      phase: "intro",
      phaseT: 0,
      x: VIEW_W - 90,
      y: GROUND_Y,
      bob: 0,
      hitFlash: 0,
      charred: 0,
      scale: 1,
      dyingT: 0,
      shockT: 0,
    };
    // freeze the scrolling world; keep player grounded
    this.speedMul = 0;
    this.px += 0;
    this.speed = 0;
    // clear obstacles & coins that are still on-screen so duel arena is clean
    this.obstacles = this.obstacles.filter(
      (o) => o.x - this.px + PLAYER_X > VIEW_W + 40 || !o.alive,
    );
    this.coinsList = [];
    this.clearQuestion();
    // ask a new question timed against the boss
    this.askBossQuestion();
    this.opts.onFeedback("info", def.intro);
    this.shake = 22;
    this.pushHud(true);
  }

  private askBossQuestion() {
    if (!this.boss) return;
    const q = makeQuestion(this.opts.maxNumber, this.question);
    this.question = q;
    this.questionWallId = null;
    let reaction: number;
    switch (this.opts.difficulty) {
      case "easy":
        reaction = BOSS_FIGHT_REACTION_EASY;
        break;
      case "hard":
        reaction = BOSS_FIGHT_REACTION_HARD;
        break;
      default:
        reaction = BOSS_FIGHT_REACTION_MED;
    }
    reaction = Math.max(2.6, reaction - this.bossesDefeated * 0.2);
    this.qTimeTotal = reaction;
    this.qTimeLeft = reaction;
    this.bossQuestionDeadline = this.time + reaction;
    // the boss "throws" the answer blocks toward the player
    const startX = 470;
    const gap = 140;
    const lastX = startX + gap * 3;
    const v = -(lastX - PLAYER_X + 50) / (reaction * 0.92);
    this.spawnAnswerBlocks(q, startX, gap, v);
    this.pushHud(true);
  }

  private exitBoss(victory: boolean) {
    void victory;
    this.phase = "running";
    this.boss = null;
    this.bossQuestionDeadline = null;
    // restore speed gradually
    this.speedMul = 0.5;
    // add a big clear margin so the next wall doesn't immediately crush the player
    this.wallTimer = 2.2;
    this.hurdleTimer = 1.2;
    this.coinTimer = 1.0;
    this.clearQuestion();
    this.pushHud(true);
  }

  private updateBoss(dt: number) {
    const b = this.boss;
    if (!b) return;
    b.phaseT += dt;
    b.bob += dt;
    if (b.hitFlash > 0) b.hitFlash = Math.max(0, b.hitFlash - dt);
    if (b.shockT > 0) b.shockT = Math.max(0, b.shockT - dt);
    b.scale += (1 - b.scale) * Math.min(1, dt * 6);

    // question countdown
    if (this.question) {
      const remain = Math.max(0, (this.bossQuestionDeadline ?? this.time) - this.time);
      this.qTimeLeft = remain;
      if (remain <= 0 && b.phase !== "dying") {
        this.clearQuestion();
        this.wrong += 1;
        this.combo = 0;
        this.hearts -= 1;
        sfx.wrong();
        this.spawnLightning(PLAYER_X + 6, this.player.y - 50);
        this.shake = 18;
        this.flash = { color: "#60a5fa", a: 0.3 };
        this.opts.onFeedback("bad", "Waktu habis! Robot lawan menembak balik!");
        if (this.hearts <= 0) {
          this.gameOver();
          return;
        }
        this.askBossQuestion();
      }
    }

    switch (b.phase) {
      case "intro": {
        // stomp in from the right
        const prog = Math.min(1, b.phaseT / 0.9);
        b.x = VIEW_W + 80 - prog * 170;
        if (prog >= 1) {
          b.phase = "fight";
          b.phaseT = 0;
        }
        break;
      }
      case "hit":
        if (b.phaseT > 0.22) {
          b.phase = "fight";
          b.phaseT = 0;
        }
        break;
      case "fight":
        // small idle bob
        break;
      case "dying": {
        b.dyingT += dt;
        b.charred = Math.min(1, b.charred + dt * 0.6);
        b.scale = 1 + b.dyingT * 0.2;
        if (b.dyingT > 0.8 && b.dyingT < 1.6) {
          if (Math.random() < 0.35) {
            const cx = b.x - 30 + (Math.random() - 0.5) * 70;
            const cy = b.y - 130 + this.bossBobOffset() + (Math.random() - 0.5) * 90;
            this.explode(cx, cy, "#111827", 8, 0.55);
          }
        }
        if (b.dyingT > 2.2) {
          // final fade: big puff of smoke
          for (let i = 0; i < 30; i++) {
            this.particles.push({
              x: b.x - 30 + (Math.random() - 0.5) * 100,
              y: b.y - 120 + (Math.random() - 0.5) * 140,
              vx: (Math.random() - 0.5) * 120,
              vy: -40 - Math.random() * 120,
              life: 1.4 + Math.random() * 1.0,
              max: 2.2,
              color: "rgba(35,35,35,0.75)",
              size: 18 + Math.random() * 22,
              g: -20,
              kind: "smoke",
              drag: 0.88,
              shrink: 1.02,
            });
          }
          for (let i = 0; i < 20; i++) {
            this.particles.push({
              x: b.x - 30 + (Math.random() - 0.5) * 80,
              y: b.y - 120 + (Math.random() - 0.5) * 80,
              vx: (Math.random() - 0.5) * 240,
              vy: (Math.random() - 0.5) * 240,
              life: 0.8 + Math.random() * 0.6,
              max: 1.2,
              color: i % 2 === 0 ? "#1f2937" : "#4b5563",
              size: 5 + Math.random() * 8,
              g: 280,
              kind: "debris",
              rot: Math.random() * Math.PI,
              vrot: (Math.random() - 0.5) * 10,
            });
          }
          b.phase = "gone";
          b.phaseT = 0;
        }
        break;
      }
      case "gone":
        if (b.phaseT > 1.0) {
          this.exitBoss(true);
        }
        break;
    }
  }

  private updateLasers(dt: number) {
    const kept: Laser[] = [];
    for (const l of this.lasers) {
      l.life -= dt;
      if (!l.fired && l.life <= l.max - 0.05) {
        l.fired = true;
        if (l.onHit) l.onHit();
        // impact sparks / smoke
        for (let i = 0; i < 10; i++) {
          const a = Math.random() * Math.PI * 2;
          const s = 60 + Math.random() * 220;
          this.particles.push({
            x: l.targetX,
            y: l.targetY,
            vx: Math.cos(a) * s,
            vy: Math.sin(a) * s - 20,
            life: 0.3 + Math.random() * 0.25,
            max: 0.55,
            color: Math.random() < 0.5 ? "#fde047" : "#fb923c",
            size: 2 + Math.random() * 3,
            g: 200,
            kind: "spark",
            drag: 0.9,
          });
        }
        for (let i = 0; i < 6; i++) {
          this.particles.push({
            x: l.targetX,
            y: l.targetY,
            vx: (Math.random() - 0.5) * 120,
            vy: -40 - Math.random() * 110,
            life: 0.8 + Math.random() * 0.4,
            max: 1.2,
            color: "rgba(200,200,210,0.55)",
            size: 8 + Math.random() * 10,
            g: -20,
            kind: "smoke",
            drag: 0.85,
            shrink: 1.02,
          });
        }
      }
      if (l.life > 0) kept.push(l);
    }
    this.lasers = kept;
  }

  private updateBolts(dt: number) {
    for (const b of this.bolts) b.life -= dt;
    this.bolts = this.bolts.filter((b) => b.life > 0);
    if (this.bossShockT > 0) this.bossShockT = Math.max(0, this.bossShockT - dt);
  }

  private updateParticles(dt: number) {
    for (const p of this.particles) {
      p.life -= dt;
      const drag = p.drag ?? 1.0;
      const dragFactor = Math.pow(drag, dt * 60);
      p.vx *= dragFactor;
      p.vy *= dragFactor;
      p.vy += p.g * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.kind === "smoke") {
        p.size *= Math.pow(p.shrink ?? 1.02, dt * 60);
      }
      if (p.vrot !== undefined) {
        p.rot = (p.rot ?? 0) + p.vrot * dt;
      }
    }
    this.particles = this.particles.filter((p) => p.life > 0);
    for (const t of this.texts) {
      t.life -= dt;
      t.y -= 34 * dt;
    }
    this.texts = this.texts.filter((t) => t.life > 0);
  }

  private pushText(x: number, y: number, text: string, color: string, size: number) {
    this.texts.push({ x, y, text, life: 1.1, max: 1.1, color, size });
  }

  private clearQuestion() {
    if (this.questionWallId !== null) {
      const wall = this.obstacles.find((o) => o.id === this.questionWallId);
      if (wall) wall.tied = false;
    }
    this.question = null;
    this.questionWallId = null;
    // remaining answer blocks fade away
    for (const b of this.blocks) if (b.alive) { b.alive = false; b.fade = 0.35; }
  }

  // ---------------------------------------------------------- answer blocks
  private spawnAnswerBlocks(q: Question, startX: number, gap: number, vx?: number) {
    this.blocks = this.blocks.filter((b) => b.fade > 0);
    // keep the answer zone free of hurdles so the jump is only about the answer
    this.obstacles = this.obstacles.filter(
      (o) => o.kind !== "hurdle" || o.x - this.px + PLAYER_X < PLAYER_X + 160,
    );
    q.options.forEach((value, i) => {
      this.blocks.push({
        x: startX + i * gap,
        y: GROUND_Y - BLOCK_BOTTOM - BLOCK_H,
        value,
        alive: true,
        bump: 0,
        fade: 1,
        vx,
        hit: null,
        qid: q.id,
      });
    });
  }

  private updateBlocks(dt: number) {
    const p = this.player;
    const headY = p.y - PLAYER_H;
    for (const b of this.blocks) {
      const v = b.vx ?? -this.speed;
      b.x += v * dt;
      if (b.bump > 0) b.bump = Math.max(0, b.bump - dt * 4);
      if (!b.alive) {
        b.fade -= dt;
        continue;
      }
      if (!this.question || b.qid !== this.question.id) {
        b.alive = false;
        b.fade = 0.35;
        continue;
      }
      const overlapX = b.x - BLOCK_W / 2 < PLAYER_X + PLAYER_W / 2 && b.x + BLOCK_W / 2 > PLAYER_X - PLAYER_W / 2;
      const blockBottom = b.y + BLOCK_H;
      if (overlapX && !p.onGround && headY < blockBottom && headY > b.y - 30) {
        // headbutt!
        p.vy = Math.max(p.vy, 120);
        p.y = Math.max(p.y, blockBottom + PLAYER_H);
        b.bump = 1;
        const correct = b.value === this.question.answer;
        b.hit = correct ? "good" : "bad";
        b.alive = false;
        b.fade = 0.7;
        for (let i = 0; i < 12; i++) {
          this.particles.push({
            x: b.x + (Math.random() - 0.5) * BLOCK_W,
            y: blockBottom,
            vx: (Math.random() - 0.5) * 260,
            vy: -Math.random() * 260,
            life: 0.5,
            max: 0.5,
            color: correct ? "#fde047" : "#93c5fd",
            size: 2 + Math.random() * 3,
            g: 700,
            kind: "spark",
          });
        }
        this.answer(b.value);
        break;
      }
    }
    // blocks fully behind the player with no hit: just let them scroll off
    this.blocks = this.blocks.filter((b) => (b.alive || b.fade > 0) && b.x > -100);
  }

  private drawBlocks(ctx: CanvasRenderingContext2D) {
    for (const b of this.blocks) {
      if (b.x < -100 || b.x > VIEW_W + 100) continue;
      const alpha = b.alive ? 1 : Math.max(0, Math.min(1, b.fade / 0.35));
      const lift = Math.sin(b.bump * Math.PI) * 14;
      const float = b.alive ? Math.sin(this.time * 4 + b.x * 0.02) * 3 : 0;
      const x = b.x - BLOCK_W / 2;
      const y = b.y - lift + float;
      ctx.save();
      ctx.globalAlpha = alpha;
      const base = b.hit === "good" ? "#22c55e" : b.hit === "bad" ? "#ef4444" : "#f59e0b";
      const dark = b.hit === "good" ? "#15803d" : b.hit === "bad" ? "#991b1b" : "#b45309";
      ctx.shadowColor = "rgba(0,0,0,0.35)";
      ctx.shadowBlur = 10;
      ctx.shadowOffsetY = 4;
      ctx.fillStyle = dark;
      this.roundRectFill(ctx, x, y + 5, BLOCK_W, BLOCK_H, 10);
      ctx.shadowColor = "transparent";
      ctx.fillStyle = base;
      this.roundRectFill(ctx, x, y, BLOCK_W, BLOCK_H, 10);
      ctx.fillStyle = "rgba(255,255,255,0.28)";
      this.roundRectFill(ctx, x + 5, y + 4, BLOCK_W - 10, 10, 5);
      // rivets
      ctx.fillStyle = "rgba(0,0,0,0.25)";
      for (const [rx, ry] of [[7, 7], [BLOCK_W - 7, 7], [7, BLOCK_H - 7], [BLOCK_W - 7, BLOCK_H - 7]]) {
        ctx.beginPath();
        ctx.arc(x + rx, y + ry, 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.font = "900 30px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineWidth = 5;
      ctx.strokeStyle = "rgba(0,0,0,0.55)";
      ctx.strokeText(String(b.value), b.x, y + BLOCK_H / 2 + 2);
      ctx.fillStyle = "#ffffff";
      ctx.fillText(String(b.value), b.x, y + BLOCK_H / 2 + 2);
      ctx.restore();
    }
  }

  private confetti(x: number, y: number, n: number) {
    const colors = ["#f43f5e", "#facc15", "#38bdf8", "#22c55e", "#a855f7"];
    for (let i = 0; i < n; i++) {
      this.particles.push({
        x: x + (Math.random() - 0.5) * 60,
        y: y + (Math.random() - 0.5) * 20,
        vx: (Math.random() - 0.5) * 420,
        vy: -120 - Math.random() * 320,
        life: 1.1,
        max: 1.1,
        color: colors[Math.floor(Math.random() * colors.length)],
        size: 4 + Math.random() * 4,
        g: 900,
      });
    }
  }

  // ------------------------------------------------------------- collisions
  private collisions() {
    if (this.status !== "playing") return;
    const p = this.player;
    const pTop = p.y - PLAYER_H;
    const pBottom = p.y;

    for (const o of this.obstacles) {
      if (!o.alive) continue;
      const sx = o.x - this.px + PLAYER_X;
      if (sx > VIEW_W + 120 || sx + o.w < -120) continue;
      const oTop = GROUND_Y - o.h;
      const overlapX = sx < PLAYER_X + PLAYER_W / 2 && sx + o.w > PLAYER_X - PLAYER_W / 2;
      const overlapY = pBottom > oTop && pTop < GROUND_Y;
      if (!overlapX || !overlapY) continue;

      if (p.rocket > 0) {
        this.smashObstacle(o, true);
        continue;
      }
      if (o.kind === "wall") {
        // breaking a wall only slows you down
        o.alive = false;
        o.broken = true;
        this.speedMul = 0.42;
        this.combo = 0;
        this.shake = 18;
        sfx.hit();
        this.flash = { color: "#f97316", a: 0.4 };
        this.pushText(PLAYER_X, p.y - 100, "Kasar!", "#fb923c", 22);
        for (let i = 0; i < 18; i++) {
          this.particles.push({
            x: sx + Math.random() * o.w,
            y: GROUND_Y - Math.random() * o.h,
            vx: (Math.random() - 0.5) * 300,
            vy: -Math.random() * 300,
            life: 0.7,
            max: 0.7,
            color: "#94a3b8",
            size: 3 + Math.random() * 5,
            g: 1200,
          });
        }
      } else {
        o.alive = false;
        o.broken = true;
        this.hearts -= 1;
        this.combo = 0;
        this.speedMul = 0.5;
        this.shake = 20;
        sfx.hit();
        this.flash = { color: "#ef4444", a: 0.5 };
        this.pushText(PLAYER_X, p.y - 100, "-1 nyawa", "#f87171", 22);
        this.opts.onFeedback("bad", "Awas! Lompat untuk melewati rintangan.");
        if (this.hearts <= 0) {
          this.gameOver();
        }
      }
    }

    // coins
    for (const c of this.coinsList) {
      if (c.taken) continue;
      const sx = c.x - this.px + PLAYER_X;
      if (sx < -40 || sx > VIEW_W + 40) continue;
      if (Math.abs(sx - PLAYER_X) < 30 && Math.abs(c.y - (p.y - PLAYER_H / 2)) < 34) {
        c.taken = true;
        this.coins += 1;
        this.bonus += 2;
        sfx.coin();
        for (let i = 0; i < 8; i++) {
          this.particles.push({
            x: sx,
            y: c.y,
            vx: (Math.random() - 0.5) * 200,
            vy: (Math.random() - 0.5) * 200,
            life: 0.5,
            max: 0.5,
            color: "#fde047",
            size: 2 + Math.random() * 3,
            g: 500,
          });
        }
      }
    }
  }

  private gameOver() {
    if (this.status === "over") return;
    this.status = "over";
    sfx.gameOver();
    const total = this.correct + this.wrong;
    const result: GameResult = {
      score: this.getScore(),
      best: 0,
      isNewBest: false,
      correct: this.correct,
      wrong: this.wrong,
      bestCombo: this.bestCombo,
      coins: this.coins,
      distance: Math.round(this.px / 10),
      accuracy: total === 0 ? 0 : Math.round((this.correct / total) * 100),
      difficulty: this.opts.difficulty,
      maxNumber: this.opts.maxNumber,
      bossesDefeated: this.bossesDefeated,
    };
    this.opts.onGameOver(result);
  }

  private getScore() {
    return Math.floor(this.px / 30) + this.bonus;
  }

  private pushHud(force = false) {
    if (!force && this.hudTimer < 0) return;
    const boss = this.boss;
    this.opts.onHud({
      score: this.getScore(),
      coins: this.coins,
      hearts: Math.max(0, this.hearts),
      maxHearts: this.cfg.hearts,
      level: this.level,
      combo: this.combo,
      speed: Math.round(this.speed),
      timeLeft: this.qTimeLeft,
      timeTotal: this.qTimeTotal,
      question: this.question,
      rocket: this.player.rocket,
      progress: (this.time % 28) / 28,
      paused: this.paused,
      speedMult: this.speedMult,
      phase: this.phase,
      bossHp: boss ? Math.max(0, boss.hp) : 0,
      bossMaxHp: boss ? boss.def.hp : 0,
      bossName: boss?.def.name ?? "",
      bossHitFlash: boss ? boss.hitFlash : 0,
      bossDying: boss ? boss.phase === "dying" || boss.phase === "gone" : false,
      shocked: this.bossShockT,
    });
  }

  setPaused(p: boolean) {
    this.paused = p;
    this.pushHud(true);
  }

  setSpeedMult(m: 1 | 2 | 3) {
    this.speedMult = m;
    this.pushHud(true);
  }

  // ------------------------------------------------------------------ render
  private hash(n: number) {
    const s = Math.sin(n * 127.1) * 43758.5453;
    return s - Math.floor(s);
  }

  private render() {
    const ctx = this.ctx;
    // Clear the complete physical canvas first, then draw the fixed game
    // world centered with a uniform scale (no stretching or clipped edges).
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(this.scale, 0, 0, this.scale, this.offsetX, this.offsetY);
    ctx.save();
    if (this.shake > 0) {
      ctx.translate((Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake);
    }
    this.drawSky(ctx);
    this.drawHills(ctx);
    this.drawCity(ctx);
    this.drawGround(ctx);
    if (this.phase === "boss") this.drawBossArena(ctx);
    this.drawCoins(ctx);
    this.drawObstacles(ctx);
    this.drawBoss(ctx);
    this.drawBlocks(ctx);
    this.drawLasers(ctx);
    this.drawBolts(ctx);
    this.drawPlayer(ctx);
    this.drawParticles(ctx);
    this.drawTexts(ctx);
    ctx.restore();
    if (this.flash) {
      ctx.fillStyle = this.flash.color;
      ctx.globalAlpha = Math.max(0, this.flash.a);
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
      ctx.globalAlpha = 1;
    }
    if (this.status === "playing" && this.player.rocket > 0 && this.phase !== "boss") {
      const g = ctx.createRadialGradient(PLAYER_X, this.player.y - 30, 4, PLAYER_X, this.player.y - 30, 90);
      g.addColorStop(0, "rgba(251,146,60,0.35)");
      g.addColorStop(1, "rgba(251,146,60,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    }
  }

  private drawSky(ctx: CanvasRenderingContext2D) {
    const sky = SKIES[Math.min(SKIES.length - 1, Math.floor((this.level - 1) / 2))];
    const g = ctx.createLinearGradient(0, 0, 0, GROUND_Y);
    g.addColorStop(0, sky.top);
    g.addColorStop(1, sky.bottom);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, VIEW_W, GROUND_Y);

    if (this.level >= 5) {
      // stars for the night sky
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      for (let i = 0; i < 40; i++) {
        const x = (this.hash(i * 3.1) * VIEW_W + this.px * 0.02) % VIEW_W;
        const y = this.hash(i * 7.7) * 240;
        const tw = 0.4 + 0.6 * Math.abs(Math.sin(this.time * 2 + i));
        ctx.globalAlpha = tw * 0.8;
        ctx.fillRect(x, y, 2, 2);
      }
      ctx.globalAlpha = 1;
    }

    // sun / moon
    const sunX = 760 - ((this.px * 0.04) % (VIEW_W + 400));
    const sunY = 96;
    const glow = ctx.createRadialGradient(sunX, sunY, 6, sunX, sunY, 90);
    glow.addColorStop(0, sky.sunGlow);
    glow.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(sunX, sunY, 90, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = sky.sun;
    ctx.beginPath();
    ctx.arc(sunX, sunY, 34, 0, Math.PI * 2);
    ctx.fill();

    // clouds
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    for (let i = 0; i < 5; i++) {
      const w = 90 + this.hash(i * 4.3) * 90;
      const x = ((this.hash(i * 2.7) * (VIEW_W + 400) - this.px * 0.07) % (VIEW_W + 400) + VIEW_W + 400) % (VIEW_W + 400) - 200;
      const y = 50 + this.hash(i * 9.1) * 90;
      ctx.beginPath();
      ctx.ellipse(x, y, w * 0.5, 18, 0, 0, Math.PI * 2);
      ctx.ellipse(x + w * 0.22, y - 12, w * 0.32, 15, 0, 0, Math.PI * 2);
      ctx.ellipse(x - w * 0.25, y - 6, w * 0.26, 13, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawHills(ctx: CanvasRenderingContext2D) {
    const layers = [
      { color: "rgba(59,130,246,0.35)", factor: 0.12, base: GROUND_Y - 26, amp: 70, step: 320 },
      { color: "rgba(16,185,129,0.4)", factor: 0.22, base: GROUND_Y - 10, amp: 54, step: 240 },
    ];
    for (const l of layers) {
      ctx.fillStyle = l.color;
      const off = (this.px * l.factor) % l.step;
      ctx.beginPath();
      ctx.moveTo(-10, GROUND_Y);
      for (let i = -1; i < VIEW_W / l.step + 2; i++) {
        const idx = i + Math.floor((this.px * l.factor) / l.step);
        const h = l.base - l.amp * (0.35 + this.hash(idx * 1.7) * 0.65);
        const x = i * l.step - off;
        ctx.lineTo(x, h);
        ctx.lineTo(x + l.step * 0.55, h - 22 * this.hash(idx * 5.3));
      }
      ctx.lineTo(VIEW_W + 10, GROUND_Y);
      ctx.closePath();
      ctx.fill();
    }
  }

  private drawCity(ctx: CanvasRenderingContext2D) {
    const factor = 0.4;
    const step = 130;
    const off = (this.px * factor) % step;
    const base = Math.floor((this.px * factor) / step);
    for (let i = -1; i < VIEW_W / step + 2; i++) {
      const idx = i + base;
      const h = 70 + this.hash(idx * 2.3) * 130;
      const x = i * step - off;
      const w = 84 + this.hash(idx * 3.9) * 36;
      ctx.fillStyle = "rgba(30,41,59,0.75)";
      ctx.fillRect(x, GROUND_Y - h, w, h);
      ctx.fillStyle = "rgba(251,191,36,0.75)";
      const cols = Math.max(1, Math.floor(w / 26));
      const rows = Math.max(1, Math.floor(h / 30));
      for (let c = 0; c < cols; c++) {
        for (let r = 0; r < rows; r++) {
          if (this.hash(idx * 13 + c * 7 + r * 3) > 0.45) {
            ctx.fillRect(x + 10 + c * 26, GROUND_Y - h + 14 + r * 30, 12, 16);
          }
        }
      }
    }
  }

  private drawGround(ctx: CanvasRenderingContext2D) {
    const g = ctx.createLinearGradient(0, GROUND_Y, 0, VIEW_H);
    g.addColorStop(0, "#3f4a5a");
    g.addColorStop(0.25, "#333c4a");
    g.addColorStop(1, "#1f2937");
    ctx.fillStyle = g;
    ctx.fillRect(0, GROUND_Y, VIEW_W, VIEW_H - GROUND_Y);

    // top edge line
    ctx.fillStyle = "#60a5fa";
    ctx.fillRect(0, GROUND_Y - 4, VIEW_W, 5);

    // moving tiles
    const tile = 64;
    const off = this.px % tile;
    ctx.strokeStyle = "rgba(148,163,184,0.25)";
    ctx.lineWidth = 2;
    for (let x = -tile; x < VIEW_W + tile; x += tile) {
      const px2 = x - off;
      ctx.beginPath();
      ctx.moveTo(px2, GROUND_Y + 6);
      ctx.lineTo(px2 - 26, VIEW_H);
      ctx.stroke();
    }
    // rail
    ctx.fillStyle = "rgba(226,232,240,0.5)";
    ctx.fillRect(0, GROUND_Y + 34, VIEW_W, 4);
    ctx.fillStyle = "rgba(226,232,240,0.22)";
    ctx.fillRect(0, GROUND_Y + 62, VIEW_W, 3);
  }

  private drawCoins(ctx: CanvasRenderingContext2D) {
    for (const c of this.coinsList) {
      if (c.taken) continue;
      const sx = c.x - this.px + PLAYER_X;
      if (sx < -40 || sx > VIEW_W + 40) continue;
      const spin = Math.abs(Math.cos(c.phase + this.time * 4));
      const w = 11 * (0.25 + 0.75 * spin);
      const g = ctx.createRadialGradient(sx - w * 0.3, c.y - 3, 1, sx, c.y, 14);
      g.addColorStop(0, "#fff7ae");
      g.addColorStop(0.5, "#facc15");
      g.addColorStop(1, "#ca8a04");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(sx, c.y, w, 12, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.75)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(sx, c.y, w * 0.55, 7, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  private drawObstacles(ctx: CanvasRenderingContext2D) {
    for (const o of this.obstacles) {
      if (!o.alive) continue;
      const sx = o.x - this.px + PLAYER_X;
      if (sx > VIEW_W + 140 || sx + o.w < -140) continue;
      if (o.kind === "hurdle") {
        // striped barrier
        ctx.fillStyle = "#78350f";
        ctx.fillRect(sx + 5, GROUND_Y - 8, 8, 8);
        ctx.fillRect(sx + o.w - 13, GROUND_Y - 8, 8, 8);
        ctx.save();
        ctx.beginPath();
        ctx.rect(sx, GROUND_Y - o.h, o.w, o.h - 6);
        ctx.clip();
        ctx.fillStyle = "#facc15";
        ctx.fillRect(sx, GROUND_Y - o.h, o.w, o.h);
        ctx.fillStyle = "#1f2937";
        for (let i = -o.h; i < o.w + o.h; i += 26) {
          ctx.save();
          ctx.translate(sx + i, GROUND_Y - o.h);
          ctx.rotate(-0.5);
          ctx.fillRect(0, 0, 12, o.h * 2);
          ctx.restore();
        }
        ctx.restore();
        ctx.strokeStyle = "#0f172a";
        ctx.lineWidth = 3;
        ctx.strokeRect(sx, GROUND_Y - o.h, o.w, o.h - 6);
      } else {
        // tall wall with a question mark
        const pulse = 0.5 + 0.5 * Math.sin(this.time * 6);
        ctx.fillStyle = "#64748b";
        ctx.fillRect(sx, GROUND_Y - o.h, o.w, o.h);
        ctx.fillStyle = "rgba(15,23,42,0.35)";
        for (let r = 0; r < 6; r++) {
          for (let c = 0; c < 3; c++) {
            const off = r % 2 === 0 ? 0 : 10;
            ctx.fillRect(sx + c * 21 + off, GROUND_Y - o.h + r * 25, 19, 23);
          }
        }
        ctx.strokeStyle = "#334155";
        ctx.lineWidth = 3;
        ctx.strokeRect(sx, GROUND_Y - o.h, o.w, o.h);
        if (o.tied) {
          ctx.save();
          ctx.shadowColor = `rgba(250,204,21,${0.5 + pulse * 0.5})`;
          ctx.shadowBlur = 18;
          ctx.fillStyle = "#fde047";
          ctx.beginPath();
          ctx.arc(sx + o.w / 2, GROUND_Y - o.h * 0.55, 26, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
          ctx.fillStyle = "#78350f";
          ctx.font = "bold 38px system-ui, sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText("?", sx + o.w / 2, GROUND_Y - o.h * 0.54);
        }
      }
    }
  }

  private drawPlayer(ctx: CanvasRenderingContext2D) {
    const p = this.player;
    const x = PLAYER_X;
    const y = p.y;
    const bob = p.onGround ? Math.sin(p.run * 2) * 2 : 0;

    // Ground shadow keeps the sprite anchored as it jumps.
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.3)";
    const shadowScale = Math.max(0.4, 1 - (GROUND_Y - y) / 200);
    ctx.beginPath();
    ctx.ellipse(x, GROUND_Y + 4, 27 * shadowScale, 6 * shadowScale, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    if (p.rocket > 0) {
      const flameLength = 22 + Math.random() * 16;
      const flame = ctx.createLinearGradient(x - 38, 0, x - 38 - flameLength, 0);
      flame.addColorStop(0, "#fde047");
      flame.addColorStop(0.5, "#fb923c");
      flame.addColorStop(1, "rgba(239,68,68,0)");
      ctx.fillStyle = flame;
      ctx.beginPath();
      ctx.moveTo(x - 34, y - 82 + bob);
      ctx.quadraticCurveTo(x - 34 - flameLength, y - 62 + bob, x - 34, y - 42 + bob);
      ctx.quadraticCurveTo(x - 34 - flameLength * 0.4, y - 62 + bob, x - 34, y - 82 + bob);
      ctx.fill();
    }

    const sprite = this.playerSprite;
    if (!sprite || !sprite.complete || sprite.naturalWidth === 0) {
      // Keep a small gold robot visible while the sprite is loading.
      ctx.fillStyle = "#facc15";
      ctx.fillRect(x - 13, y - 38 + bob, 26, 27);
      ctx.fillRect(x - 11, y - 60 + bob, 22, 20);
      ctx.fillStyle = "#1e293b";
      ctx.fillRect(x - 7, y - 52 + bob, 4, 3);
      ctx.fillRect(x + 3, y - 52 + bob, 4, 3);
      ctx.fillRect(x - 10, y - 12 + bob, 7, 12);
      ctx.fillRect(x + 3, y - 12 + bob, 7, 12);
      return;
    }

    const drawHeight = PLAYER_DRAW_HEIGHT;
    const drawWidth = drawHeight * (sprite.naturalWidth / sprite.naturalHeight);
    const lean = p.onGround ? Math.sin(p.run) * 0.025 : p.vy < 0 ? -0.035 : 0.035;

    ctx.save();
    ctx.translate(x, y - drawHeight / 2 + bob);
    ctx.rotate(lean);
    ctx.scale(1 + p.squash * 0.35, 1 - p.squash * 0.35);
    ctx.drawImage(sprite, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
    ctx.restore();
  }

  private drawParticles(ctx: CanvasRenderingContext2D) {
    for (const p of this.particles) {
      const t = Math.max(0, p.life / p.max);
      ctx.globalAlpha = p.kind === "smoke" || p.kind === "ash" ? 0.55 * t : t;
      if (p.kind === "smoke" || p.kind === "fire" || p.kind === "ash") {
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      } else if (p.kind === "debris") {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot ?? 0);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
        ctx.restore();
      } else {
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  private drawLasers(ctx: CanvasRenderingContext2D) {
    for (const l of this.lasers) {
      const t = l.life / l.max;
      const alpha = Math.min(1, t * 3);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = l.color;
      ctx.lineWidth = l.width * (0.7 + t * 0.6);
      ctx.lineCap = "round";
      ctx.shadowColor = "#facc15";
      ctx.shadowBlur = 18;
      ctx.beginPath();
      ctx.moveTo(l.x, l.y);
      ctx.lineTo(l.targetX, l.targetY);
      ctx.stroke();
      ctx.strokeStyle = l.coreColor;
      ctx.lineWidth = Math.max(2, l.width * 0.35);
      ctx.shadowBlur = 0;
      ctx.beginPath();
      ctx.moveTo(l.x, l.y);
      ctx.lineTo(l.targetX, l.targetY);
      ctx.stroke();
      // impact flash
      if (l.fired) {
        const r = 18 * (1 - Math.max(0, (l.life - (l.max - 0.08)) / 0.08));
        if (r > 0) {
          ctx.fillStyle = "rgba(253, 224, 71, 0.9)";
          ctx.beginPath();
          ctx.arc(l.targetX, l.targetY, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.restore();
    }
  }

  private drawBolts(ctx: CanvasRenderingContext2D) {
    for (const b of this.bolts) {
      const t = b.life / b.max;
      ctx.save();
      ctx.globalAlpha = t;
      ctx.strokeStyle = "rgba(147, 197, 253, 0.95)";
      ctx.lineWidth = 6;
      ctx.lineCap = "round";
      ctx.shadowColor = "#60a5fa";
      ctx.shadowBlur = 18;
      ctx.beginPath();
      for (let i = 0; i < b.segments.length; i++) {
        const s = b.segments[i];
        if (i === 0) ctx.moveTo(s.x, s.y);
        else ctx.lineTo(s.x, s.y);
      }
      ctx.stroke();
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      ctx.shadowBlur = 0;
      ctx.beginPath();
      for (let i = 0; i < b.segments.length; i++) {
        const s = b.segments[i];
        if (i === 0) ctx.moveTo(s.x, s.y);
        else ctx.lineTo(s.x, s.y);
      }
      ctx.stroke();
      // ground spark
      ctx.fillStyle = "rgba(255,255,255,0.8)";
      ctx.beginPath();
      ctx.arc(b.x, b.y, 14 * t, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  private drawBossArena(ctx: CanvasRenderingContext2D) {
    // dark energy dome backdrop
    const gx = ctx.createLinearGradient(0, GROUND_Y - 220, 0, GROUND_Y + 20);
    gx.addColorStop(0, "rgba(124,58,237,0.25)");
    gx.addColorStop(1, "rgba(124,58,237,0)");
    ctx.fillStyle = gx;
    ctx.fillRect(0, GROUND_Y - 220, VIEW_W, 240);
    // danger lines on ground
    ctx.strokeStyle = "rgba(244,114,182,0.5)";
    ctx.lineWidth = 2;
    const off = (this.time * 140) % 40;
    for (let x = -40 + off; x < VIEW_W + 40; x += 40) {
      ctx.beginPath();
      ctx.moveTo(x, GROUND_Y + 18);
      ctx.lineTo(x - 20, VIEW_H - 4);
      ctx.stroke();
    }
    // arena floor pulse
    ctx.fillStyle = "rgba(244,114,182,0.12)";
    ctx.fillRect(0, GROUND_Y + 4, VIEW_W, 10);
  }

  private drawBoss(ctx: CanvasRenderingContext2D) {
    const b = this.boss;
    if (!b) return;
    const bob = this.bossBobOffset();
    const cx = b.x - 30;
    const cy = b.y - 150 + bob;

    let alpha = 1;
    if (b.phase === "intro") alpha = Math.min(1, b.phaseT / 0.6);
    if (b.phase === "gone") alpha = Math.max(0, 1 - b.phaseT / 0.85);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(cx, cy);
    ctx.scale(b.scale * (b.phase === "intro" ? 1 + (1 - Math.min(1, b.phaseT / 0.9)) * 0.4 : 1), b.scale);
    if (b.phase === "hit") {
      ctx.translate((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6);
    }
    // This transparent PNG shares the same glossy 3D mech language as the player.
    ctx.fillStyle = "rgba(0,0,0,0.4)";
    ctx.beginPath();
    ctx.ellipse(0, 157, 70, 10, 0, 0, Math.PI * 2);
    ctx.fill();
    const sprite = this.monsterSprite;
    if (sprite?.complete && sprite.naturalWidth > 0) {
      const height = 250;
      const width = height * sprite.naturalWidth / sprite.naturalHeight;
      ctx.shadowColor = b.charred > 0.5 ? "#111827" : b.def.accent;
      ctx.shadowBlur = b.charred > 0.5 ? 8 : 18;
      ctx.filter = b.charred > 0
        ? `grayscale(${Math.round(b.charred * 100)}%) brightness(${1 - b.charred * 0.68})`
        : "none";
      ctx.drawImage(sprite, -width / 2, 150 - height, width, height);
      ctx.filter = "none";
      ctx.shadowBlur = 0;
      if (b.hitFlash > 0) {
        ctx.globalAlpha = alpha * b.hitFlash / 0.25 * 0.7;
        ctx.filter = "brightness(0) invert(1)";
        ctx.drawImage(sprite, -width / 2, 150 - height, width, height);
        ctx.filter = "none";
      }
    } else {
      // Brief loading fallback; the PNG replaces this as soon as it decodes.
      ctx.fillStyle = b.def.color;
      this.roundRectFill(ctx, -48, -90, 96, 190, 20);
      ctx.fillStyle = b.def.eyeColor;
      ctx.fillRect(-28, -60, 56, 12);
    }
    ctx.restore();

    // boss name + HP bar handled via HUD in React, but add "VS" floating label during intro
    if (b.phase === "intro" && b.phaseT < 1.2) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, 1 - (b.phaseT - 0.7) / 0.5);
      ctx.font = "bold 52px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.lineWidth = 8;
      ctx.strokeStyle = "rgba(0,0,0,0.8)";
      ctx.fillStyle = "#f43f5e";
      ctx.strokeText(`VS ${b.def.name.toUpperCase()}`, VIEW_W / 2, 130);
      ctx.fillText(`VS ${b.def.name.toUpperCase()}`, VIEW_W / 2, 130);
      ctx.restore();
    }
  }

  private roundRectFill(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
    ctx.fill();
  }

  private drawTexts(ctx: CanvasRenderingContext2D) {
    for (const t of this.texts) {
      ctx.globalAlpha = Math.max(0, Math.min(1, t.life / t.max));
      ctx.font = `bold ${t.size}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.lineWidth = 5;
      ctx.strokeStyle = "rgba(15,23,42,0.85)";
      ctx.strokeText(t.text, t.x, t.y);
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, t.x, t.y);
    }
    ctx.globalAlpha = 1;
  }
}
