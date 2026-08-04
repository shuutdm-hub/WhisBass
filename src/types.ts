export type NoteEvent = {
  pitch: number;
  startTimeSeconds: number;
  durationSeconds: number;
  amplitude: number;
};

export type KeyMode = "major" | "minor";

export type MusicalKey = {
  root: number;
  mode: KeyMode;
};

export type ProcessedNote = NoteEvent & {
  originalPitch: number;
};
