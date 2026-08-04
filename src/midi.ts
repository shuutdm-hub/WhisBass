import { Midi } from "@tonejs/midi";
import type { ProcessedNote } from "./types";

export function createMidi(notes: ProcessedNote[], bpm: number): Uint8Array {
  const midi = new Midi();
  midi.header.setTempo(bpm);
  const track = midi.addTrack();
  track.name = "WhisBass Bass";
  const ratio = 120 / bpm;
  notes.forEach((note) => track.addNote({
    midi: note.pitch,
    time: note.startTimeSeconds * ratio,
    duration: note.durationSeconds * ratio,
    velocity: Math.max(0.25, Math.min(1, note.amplitude)),
  }));
  return midi.toArray();
}
