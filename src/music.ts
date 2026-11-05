import type { MusicalKey, NoteEvent, ProcessedNote } from "./types";

export const NOTE_NAMES = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];
export const KEYS: MusicalKey[] = ["major", "minor"].flatMap((mode) =>
  NOTE_NAMES.map((_, root) => ({ root, mode: mode as MusicalKey["mode"] })),
);

const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
};
const BASS_MIN = 28; // E1
const BASS_MAX = 55; // G3

export const noteName = (pitch: number) => `${NOTE_NAMES[((pitch % 12) + 12) % 12]}${Math.floor(pitch / 12) - 1}`;
export const keyName = (key: MusicalKey) => `${NOTE_NAMES[key.root]} ${key.mode === "major" ? "メジャー" : "マイナー"}`;

function scoreKey(notes: NoteEvent[], key: MusicalKey): number {
  const scale = SCALES[key.mode].map((step) => (key.root + step) % 12);
  return notes.reduce((score, note) => score + (scale.includes(note.pitch % 12) ? note.durationSeconds : -note.durationSeconds * 0.45), 0);
}

export function estimateKey(notes: NoteEvent[]): MusicalKey {
  return KEYS.reduce((best, key) => (scoreKey(notes, key) > scoreKey(notes, best) ? key : best), KEYS[0]);
}

function nearestScalePitch(pitch: number, key: MusicalKey): number {
  const allowed = SCALES[key.mode].map((step) => (key.root + step) % 12);
  for (let distance = 0; distance <= 6; distance += 1) {
    const down = pitch - distance;
    const up = pitch + distance;
    if (allowed.includes(((down % 12) + 12) % 12)) return down;
    if (allowed.includes(((up % 12) + 12) % 12)) return up;
  }
  return pitch;
}

function toBassRange(pitch: number): number {
  let result = pitch;
  while (result > BASS_MAX) result -= 12;
  while (result < BASS_MIN) result += 12;
  return Math.min(BASS_MAX, Math.max(BASS_MIN, result));
}

export function processNotes(notes: NoteEvent[], key: MusicalKey): ProcessedNote[] {
  return notes
    .filter((note) => note.durationSeconds >= 0.07 && note.amplitude >= 0.1)
    .sort((a, b) => a.startTimeSeconds - b.startTimeSeconds)
    .map((note) => ({ ...note, originalPitch: note.pitch, pitch: toBassRange(nearestScalePitch(note.pitch, key)) }));
}
