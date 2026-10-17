// Boss definitions for the multiplication duel.
export interface BossDef {
  name: string;
  color: string;
  accent: string;
  eyeColor: string;
  hp: number;
  // extra reaction-time penalty (shorter answer window) vs regular run
  reaction: number;
  intro: string;
}

export const BOSSES: BossDef[] = [
  {
    name: "Dr. Baja",
    color: "#6b7280",
    accent: "#dc2626",
    eyeColor: "#fca5a5",
    hp: 3,
    reaction: 4.4,
    intro: "⚠️ Dr. Baja muncul! Jawab cepat untuk menembaknya!",
  },
  {
    name: "Raja Kobalt",
    color: "#1e3a8a",
    accent: "#60a5fa",
    eyeColor: "#fbbf24",
    hp: 4,
    reaction: 3.8,
    intro: "⚠️ Raja Kobalt menantang duel! Tembak balik secepatnya!",
  },
  {
    name: "Jenderal Crimson",
    color: "#7f1d1d",
    accent: "#facc15",
    eyeColor: "#fde047",
    hp: 5,
    reaction: 3.4,
    intro: "⚠️ Jenderal Crimson! Duel cepat, 5 tembakan untuk kalah!",
  },
];
