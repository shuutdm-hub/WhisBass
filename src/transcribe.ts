import { BasicPitch, addPitchBendsToNoteEvents, noteFramesToTime, outputToNotesPoly } from "@spotify/basic-pitch";
import type { NoteEvent } from "./types";

let instance: BasicPitch | null = null;

const TARGET_SAMPLE_RATE = 22050;
const MIN_INPUT_PEAK = 0.0015;
const MIN_INPUT_RMS = 0.00025;

function rootMeanSquare(samples: Float32Array): number {
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  return Math.sqrt(sum / Math.max(1, samples.length));
}

function overlapSeconds(a: NoteEvent, b: NoteEvent): number {
  return Math.max(0, Math.min(a.startTimeSeconds + a.durationSeconds, b.startTimeSeconds + b.durationSeconds) - Math.max(a.startTimeSeconds, b.startTimeSeconds));
}

function noteStrength(note: NoteEvent): number {
  return note.amplitude * Math.sqrt(note.durationSeconds);
}

/** Basic Pitchは多声音を出せるため、口笛入力では同時刻の弱い候補を除く。 */
function keepMonophonic(notes: NoteEvent[]): NoteEvent[] {
  const selected: NoteEvent[] = [];
  for (const note of [...notes].sort((a, b) => a.startTimeSeconds - b.startTimeSeconds || noteStrength(b) - noteStrength(a))) {
    const conflictIndex = selected.findIndex((other) => {
      const overlap = overlapSeconds(note, other);
      return overlap >= Math.min(note.durationSeconds, other.durationSeconds) * 0.45;
    });
    if (conflictIndex < 0) {
      selected.push(note);
    } else if (noteStrength(note) > noteStrength(selected[conflictIndex]) * 1.12) {
      selected[conflictIndex] = note;
    }
  }
  return selected.sort((a, b) => a.startTimeSeconds - b.startTimeSeconds);
}

/** ごく短い隙間で分断された同音・半音差の音を一つにつなぐ。 */
function mergeFragments(notes: NoteEvent[]): NoteEvent[] {
  const merged: NoteEvent[] = [];
  for (const note of notes) {
    const previous = merged.at(-1);
    if (previous) {
      const previousEnd = previous.startTimeSeconds + previous.durationSeconds;
      const gap = note.startTimeSeconds - previousEnd;
      if (gap <= 0.14 && gap >= -0.04 && Math.abs(note.pitch - previous.pitch) <= 1) {
        const totalWeight = previous.durationSeconds + note.durationSeconds;
        previous.pitch = Math.round((previous.pitch * previous.durationSeconds + note.pitch * note.durationSeconds) / totalWeight);
        previous.amplitude = Math.max(previous.amplitude, note.amplitude);
        previous.durationSeconds = Math.max(previousEnd, note.startTimeSeconds + note.durationSeconds) - previous.startTimeSeconds;
        continue;
      }
    }
    merged.push({ ...note });
  }
  return merged;
}

function cleanNoteEvents(notes: NoteEvent[]): NoteEvent[] {
  const plausible = notes.filter((note) =>
    Number.isFinite(note.pitch)
    && note.pitch >= 45
    && note.pitch <= 108
    && note.durationSeconds >= 0.08
    && note.amplitude >= 0.08
  );
  return mergeFragments(keepMonophonic(plausible)).filter((note) => note.durationSeconds >= 0.11 && note.amplitude >= 0.1);
}

async function prepareMonoBuffer(audioBuffer: AudioBuffer): Promise<AudioBuffer> {
  const mono = new AudioBuffer({
    length: audioBuffer.length,
    numberOfChannels: 1,
    sampleRate: audioBuffer.sampleRate,
  });
  const output = mono.getChannelData(0);

  for (let channel = 0; channel < audioBuffer.numberOfChannels; channel += 1) {
    const input = audioBuffer.getChannelData(channel);
    for (let index = 0; index < input.length; index += 1) {
      output[index] += input[index] / audioBuffer.numberOfChannels;
    }
  }

  let peak = 0;
  for (const sample of output) peak = Math.max(peak, Math.abs(sample));
  const rms = rootMeanSquare(output);
  if (peak < MIN_INPUT_PEAK || rms < MIN_INPUT_RMS) throw new Error("SILENT_AUDIO");

  // 小さな環境音まで持ち上げないよう、入力差の補正は最大12倍に留める。
  const gain = Math.min(12, 0.78 / peak);
  for (let index = 0; index < output.length; index += 1) output[index] *= gain;

  const outputLength = Math.ceil(mono.duration * TARGET_SAMPLE_RATE);
  const offline = new OfflineAudioContext(1, outputLength, TARGET_SAMPLE_RATE);
  const source = offline.createBufferSource();
  const highpass = offline.createBiquadFilter();
  const lowpass = offline.createBiquadFilter();
  source.buffer = mono;
  highpass.type = "highpass";
  highpass.frequency.value = 180;
  highpass.Q.value = 0.7;
  lowpass.type = "lowpass";
  lowpass.frequency.value = 5000;
  lowpass.Q.value = 0.7;
  source.connect(highpass).connect(lowpass).connect(offline.destination);
  source.start(0);
  return offline.startRendering();
}

export async function transcribeAudio(audioBuffer: AudioBuffer, onProgress: (value: number) => void): Promise<NoteEvent[]> {
  instance ??= new BasicPitch(new URL("model/model.json", document.baseURI).href);
  const preparedBuffer = await prepareMonoBuffer(audioBuffer);
  const frames: number[][] = [];
  const onsets: number[][] = [];
  const contours: number[][] = [];
  await instance.evaluateModel(
    preparedBuffer,
    (frameBatch, onsetBatch, contourBatch) => {
      frames.push(...frameBatch);
      onsets.push(...onsetBatch);
      contours.push(...contourBatch);
    },
    (progress) => onProgress(Math.round(progress * 100)),
  );
  const events = noteFramesToTime(addPitchBendsToNoteEvents(contours, outputToNotesPoly(frames, onsets, 0.35, 0.42, 7)));
  return cleanNoteEvents(events.map((event) => ({
    pitch: event.pitchMidi,
    startTimeSeconds: event.startTimeSeconds,
    durationSeconds: event.durationSeconds,
    amplitude: event.amplitude,
  })));
}
