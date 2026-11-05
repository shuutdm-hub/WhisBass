import type { ProcessedNote } from "./types";

type ActivePlayback = { context: AudioContext; sources: OscillatorNode[] } | null;
let activePlayback: ActivePlayback = null;

export function stopPlayback(): void {
  if (!activePlayback) return;
  activePlayback.sources.forEach((source) => { try { source.stop(); } catch { /* already stopped */ } });
  void activePlayback.context.close();
  activePlayback = null;
}

function addBassVoice(context: BaseAudioContext, destination: AudioNode, pitch: number, start: number, duration: number): OscillatorNode[] {
  const frequency = 440 * 2 ** ((pitch - 69) / 12);
  const gain = context.createGain();
  const filter = context.createBiquadFilter();
  const fundamental = context.createOscillator();
  const overtone = context.createOscillator();
  fundamental.type = "triangle";
  overtone.type = "sine";
  fundamental.frequency.value = frequency;
  overtone.frequency.value = frequency * 2;
  const end = start + Math.max(0.1, duration);
  // 音符の長さ全体に対応する包絡線。長い音ほど持続区間も比例して長くなる。
  const envelope = new Float32Array(128);
  for (let index = 0; index < envelope.length; index += 1) {
    const position = index / (envelope.length - 1);
    if (position < 0.035) envelope[index] = 0.0001 + (0.38 - 0.0001) * (position / 0.035);
    else if (position < 0.12) envelope[index] = 0.38 - (0.38 - 0.3) * ((position - 0.035) / 0.085);
    else if (position < 0.94) envelope[index] = 0.3;
    else envelope[index] = Math.max(0.0001, 0.3 * (1 - (position - 0.94) / 0.06));
  }
  gain.gain.setValueCurveAtTime(envelope, start, end - start);
  filter.type = "lowpass";
  filter.frequency.value = 1600;
  filter.Q.value = 0.7;
  fundamental.connect(gain);
  overtone.connect(gain);
  gain.connect(filter);
  filter.connect(destination);
  fundamental.start(start);
  overtone.start(start);
  fundamental.stop(end + 0.02);
  overtone.stop(end + 0.02);
  return [fundamental, overtone];
}

function tempoScaled(notes: ProcessedNote[], bpm: number): ProcessedNote[] {
  const ratio = 120 / bpm;
  return notes.map((note) => ({ ...note, startTimeSeconds: note.startTimeSeconds * ratio, durationSeconds: note.durationSeconds * ratio }));
}

export async function playNotes(notes: ProcessedNote[], bpm: number): Promise<void> {
  stopPlayback();
  const context = new AudioContext();
  await context.resume();
  const startAt = context.currentTime + 0.08;
  const sources = tempoScaled(notes, bpm).flatMap((note) => addBassVoice(context, context.destination, note.pitch, startAt + note.startTimeSeconds, note.durationSeconds));
  activePlayback = { context, sources };
}

function encodeWav(buffer: AudioBuffer): Blob {
  const samples = buffer.getChannelData(0);
  const out = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(out);
  const write = (offset: number, value: string) => [...value].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)));
  write(0, "RIFF"); view.setUint32(4, 36 + samples.length * 2, true); write(8, "WAVE"); write(12, "fmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, buffer.sampleRate, true); view.setUint32(28, buffer.sampleRate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); write(36, "data"); view.setUint32(40, samples.length * 2, true);
  samples.forEach((sample, i) => view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, sample)) * 0x7fff, true));
  return new Blob([out], { type: "audio/wav" });
}

export async function renderWav(notes: ProcessedNote[], bpm: number): Promise<Blob> {
  const scaled = tempoScaled(notes, bpm);
  const duration = Math.max(...scaled.map((n) => n.startTimeSeconds + n.durationSeconds), 1) + 0.4;
  const context = new OfflineAudioContext(1, Math.ceil(duration * 44100), 44100);
  scaled.forEach((note) => addBassVoice(context, context.destination, note.pitch, note.startTimeSeconds, note.durationSeconds));
  return encodeWav(await context.startRendering());
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = filename; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
