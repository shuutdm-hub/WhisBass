import { BasicPitch, addPitchBendsToNoteEvents, noteFramesToTime, outputToNotesPoly } from "@spotify/basic-pitch";
import type { NoteEvent } from "./types";

let instance: BasicPitch | null = null;

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
  // MediaRecorderのデコード結果は、実際に聞こえる音でも端末によって
  // 非常に小さい値になる。完全な無音に近い場合だけエラーにする。
  if (peak < 0.00001) throw new Error("SILENT_AUDIO");

  // マイクごとの入力音量差を吸収し、口笛をBasic Pitchが拾いやすくする。
  const gain = Math.min(80, 0.9 / peak);
  for (let index = 0; index < output.length; index += 1) output[index] *= gain;
  if (mono.sampleRate === 22050) return mono;

  const outputLength = Math.ceil(mono.duration * 22050);
  const offline = new OfflineAudioContext(1, outputLength, 22050);
  const source = offline.createBufferSource();
  source.buffer = mono;
  source.connect(offline.destination);
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
  const events = noteFramesToTime(addPitchBendsToNoteEvents(contours, outputToNotesPoly(frames, onsets, 0.22, 0.18, 4)));
  return events.map((event) => ({
    pitch: event.pitchMidi,
    startTimeSeconds: event.startTimeSeconds,
    durationSeconds: event.durationSeconds,
    amplitude: event.amplitude,
  }));
}
