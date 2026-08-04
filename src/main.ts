import "./style.css";
import { downloadBlob, playNotes, renderWav, stopPlayback } from "./audio";
import { createMidi } from "./midi";
import { estimateKey, keyName, KEYS, noteName, processNotes } from "./music";
import { transcribeAudio } from "./transcribe";
import type { MusicalKey, NoteEvent, ProcessedNote } from "./types";

const MAX_SECONDS = 15;
const app = document.querySelector<HTMLDivElement>("#app")!;

app.innerHTML = `
  <header class="site-header">
    <a class="brand" href="#top" aria-label="WhisBass トップ">Whis<span>Bass</span></a>
    <nav aria-label="ページ内メニュー"><a href="#howto">使い方</a><a href="#system">システム概要</a></nav>
  </header>
  <main>
    <section id="top" class="hero">
      <p class="eyebrow">BASS PHRASE ASSIST SYSTEM</p>
      <h1>口笛から、<br><span>ベースフレーズへ。</span></h1>
      <p class="lead">思い浮かんだフレーズを15秒以内で口笛に。音程を解析し、4弦ベース向けに整えて、その場で試聴できます。</p>
      <div class="notice"><strong>きれいに変換するコツ</strong><span>静かな場所で、1音ずつはっきり口笛を吹いてください。</span></div>
    </section>

    <section class="workspace" aria-labelledby="record-title">
      <div class="section-heading"><span>01</span><div><p>RECORD</p><h2 id="record-title">口笛を録音</h2></div></div>
      <div class="recorder-panel">
        <div class="timer"><span id="record-dot"></span><strong id="timer">00:00.0</strong><small>/ 00:15</small></div>
        <canvas id="meter" width="760" height="72" aria-label="録音音量メーター"></canvas>
        <div class="actions">
          <button id="record" class="primary">● 録音開始</button>
          <button id="stop" disabled>■ 停止して変換</button>
        </div>
        <p id="status" class="status" role="status">マイクは録音中だけ使用します。音声を外部へ送信・保存しません。</p>
        <div id="progress-wrap" class="progress-wrap" hidden><div class="progress-label"><span>口笛をベースフレーズに変換しています</span><b id="progress-text">0%</b></div><progress id="progress" max="100" value="0"></progress></div>
      </div>
    </section>

    <section id="result" class="workspace result" aria-labelledby="result-title" hidden>
      <div class="section-heading"><span>02</span><div><p>RESULT</p><h2 id="result-title">変換結果</h2></div></div>
      <div class="result-grid">
        <div class="result-main">
          <div class="key-row"><label for="key-select">推定キー</label><select id="key-select"></select></div>
          <div><p class="label">補正後の音名</p><div id="note-names" class="note-names"></div></div>
          <div><div class="roll-head"><p class="label">簡易ピアノロール</p><div class="legend"><span class="before">検出音</span><span class="after">補正後</span></div></div><canvas id="roll" width="900" height="260"></canvas></div>
        </div>
        <aside class="control-card">
          <div class="tempo"><label for="tempo">テンポ <b id="tempo-value">120 BPM</b></label><input id="tempo" type="range" min="50" max="160" value="120"></div>
          <div class="play-actions"><button id="play" class="primary">▶ 再生</button><button id="play-stop">■ 停止</button></div>
          <hr>
          <button id="midi">MIDIを保存</button><button id="wav">ベース音をWAVで保存</button><button id="reset" class="text-button">↺ 最初から録音</button>
        </aside>
      </div>
    </section>

    <section id="howto" class="info-section"><div class="section-heading"><span>03</span><div><p>HOW TO USE</p><h2>使い方</h2></div></div><div class="steps"><article><b>1</b><h3>録音</h3><p>静かな場所で録音を始め、15秒以内で単旋律の口笛を吹きます。</p></article><article><b>2</b><h3>変換</h3><p>Basic Pitchが音程とリズムを抽出し、選択キーと4弦ベース音域へ補正します。</p></article><article><b>3</b><h3>試聴・保存</h3><p>テンポを調整して再生し、MIDIまたは合成ベース音のWAVを保存します。</p></article></div></section>
    <section id="system" class="info-section system"><div class="section-heading"><span>04</span><div><p>SYSTEM</p><h2>システム概要</h2></div></div><div class="flow"><div>マイク録音<small>ブラウザ内</small></div><i>→</i><div>音符抽出<small>Basic Pitch</small></div><i>→</i><div>キー推定<small>変更可能</small></div><i>→</i><div>音階補正<small>近い構成音</small></div><i>→</i><div>音域移調<small>4弦ベース</small></div><i>→</i><div>再生・保存<small>MIDI / WAV</small></div></div><p class="privacy">録音音声と解析結果は端末内だけで処理され、外部サーバーへ送信されません。</p></section>
  </main><footer>WhisBass — Graduation Research Prototype</footer>`;

// 研究用の操作画面に集中できるよう、説明用の装飾・補助セクションは非表示にする。
document.querySelectorAll(".site-header, .hero, #howto, #system, footer").forEach((node) => node.remove());
document.querySelector('[aria-labelledby="record-title"] .section-heading > span')?.remove();
const recordingTitle = document.getElementById("record-title");
if (recordingTitle) recordingTitle.textContent = "WhisBass";
document.head.insertAdjacentHTML("beforeend", `<style>
  body{background:#f7f8fa}
  .workspace{border-top:0;padding-top:48px}
  #result.workspace{padding-top:28px}
</style>`);

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const recordButton = element<HTMLButtonElement>("record");
const stopButton = element<HTMLButtonElement>("stop");
const status = element<HTMLParagraphElement>("status");
const timer = element<HTMLElement>("timer");
const meter = element<HTMLCanvasElement>("meter");
const meterContext = meter.getContext("2d")!;
meter.insertAdjacentHTML("afterend", `
  <div class="mic-select-row">
    <label for="mic-select">入力マイク</label>
    <select id="mic-select"><option value="">既定のマイク</option></select>
    <button id="refresh-mics" type="button">マイク一覧を更新</button>
  </div>
`);
const micSelect = element<HTMLSelectElement>("mic-select");
document.head.insertAdjacentHTML("beforeend", `<style>
  .mic-select-row{display:grid;grid-template-columns:auto minmax(220px,1fr) auto;gap:12px;align-items:center;max-width:760px;margin:18px auto 0}
  .mic-select-row label{font-size:13px;font-weight:800;color:#59616d}
  .mic-select-row select{min-width:0;padding:11px 12px;border:1px solid #cdd3db;background:#fff;color:#242a32}
  .mic-select-row button{padding:10px 14px;font-size:13px}
  @media(max-width:850px){.mic-select-row{grid-template-columns:1fr}.mic-select-row button{width:100%}}
</style>`);
const result = element<HTMLElement>("result");
const keySelect = element<HTMLSelectElement>("key-select");
const tempo = element<HTMLInputElement>("tempo");
const progressWrap = element<HTMLElement>("progress-wrap");
const progress = element<HTMLProgressElement>("progress");
let recorder: MediaRecorder | null = null;
let stream: MediaStream | null = null;
let chunks: Blob[] = [];
let startedAt = 0;
let timerId = 0;
let animationId = 0;
let audioContext: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let detectedNotes: NoteEvent[] = [];
let processedNotes: ProcessedNote[] = [];
let selectedKey: MusicalKey = KEYS[0];

KEYS.forEach((key, index) => keySelect.add(new Option(keyName(key), String(index))));

function message(text: string, error = false): void { status.textContent = text; status.classList.toggle("error", error); }
function setProgress(value: number): void { progress.value = value; element("progress-text").textContent = `${value}%`; }

async function loadInputDevices(): Promise<void> {
  if (!navigator.mediaDevices?.enumerateDevices) return;
  const previous = micSelect.value;
  const devices = (await navigator.mediaDevices.enumerateDevices()).filter((device) => device.kind === "audioinput");
  micSelect.replaceChildren(new Option("既定のマイク", ""));
  devices.forEach((device, index) => {
    micSelect.add(new Option(device.label || `マイク ${index + 1}（録音許可後に機器名を表示）`, device.deviceId));
  });
  if ([...micSelect.options].some((option) => option.value === previous)) micSelect.value = previous;
}

function updateMeter(): void {
  if (!analyser) return;
  const data = new Uint8Array(analyser.fftSize);
  analyser.getByteTimeDomainData(data);
  meterContext.clearRect(0, 0, meter.width, meter.height);
  meterContext.strokeStyle = "#2388ff"; meterContext.lineWidth = 2; meterContext.beginPath();
  data.forEach((value, index) => { const x = index / (data.length - 1) * meter.width; const y = value / 255 * meter.height; index ? meterContext.lineTo(x, y) : meterContext.moveTo(x, y); });
  meterContext.stroke();
  animationId = requestAnimationFrame(updateMeter);
}

function updateTimer(): void {
  const elapsed = Math.min(MAX_SECONDS, (performance.now() - startedAt) / 1000);
  timer.textContent = `00:${String(elapsed.toFixed(1)).padStart(4, "0")}`;
  if (elapsed >= MAX_SECONDS) void stopRecording();
}

async function startRecording(): Promise<void> {
  try {
    const deviceId = micSelect.value;
    stream = await navigator.mediaDevices.getUserMedia({ audio: { ...(deviceId ? { deviceId: { exact: deviceId } } : {}), echoCancellation: false, noiseSuppression: false, autoGainControl: true, channelCount: 1 } });
    await loadInputDevices();
    chunks = [];
    recorder = new MediaRecorder(stream);
    recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
    recorder.start();
    audioContext = new AudioContext();
    analyser = audioContext.createAnalyser(); analyser.fftSize = 512;
    audioContext.createMediaStreamSource(stream).connect(analyser);
    startedAt = performance.now(); timerId = window.setInterval(updateTimer, 50); updateMeter();
    recordButton.disabled = true; stopButton.disabled = false; element("record-dot").classList.add("live");
    message("録音中です。1音ずつ、はっきり口笛を吹いてください。");
  } catch (error) {
    message(error instanceof DOMException && error.name === "NotAllowedError" ? "マイクの使用が許可されていません。ブラウザの設定からマイクを許可してください。" : "マイクを開始できませんでした。接続とブラウザ設定を確認してください。", true);
  }
}

function recorderStopped(): Promise<void> { return new Promise((resolve) => { if (!recorder || recorder.state === "inactive") resolve(); else { recorder.addEventListener("stop", () => resolve(), { once: true }); recorder.stop(); } }); }

async function stopRecording(): Promise<void> {
  stopButton.disabled = true; clearInterval(timerId); cancelAnimationFrame(animationId); element("record-dot").classList.remove("live");
  await recorderStopped();
  stream?.getTracks().forEach((track) => track.stop());
  await audioContext?.close(); audioContext = null; analyser = null;
  const blob = new Blob(chunks, { type: recorder?.mimeType || "audio/webm" });
  if (blob.size === 0) { message("録音データを作成できませんでした。入力するマイクを確認して、もう一度お試しください。", true); recordButton.disabled = false; return; }
  progressWrap.hidden = false; setProgress(0); message("AIモデルを読み込み、音程を解析しています。");
  try {
    const decodeContext = new AudioContext();
    const buffer = await decodeContext.decodeAudioData(await blob.arrayBuffer());
    detectedNotes = await transcribeAudio(buffer, setProgress);
    await decodeContext.close();
    if (!detectedNotes.length) throw new Error("NO_NOTES");
    selectedKey = estimateKey(detectedNotes); keySelect.value = String(KEYS.findIndex((key) => key.root === selectedKey.root && key.mode === selectedKey.mode));
    refreshResult(); result.hidden = false; result.scrollIntoView({ behavior: "smooth" }); message(`${detectedNotes.length}個の音を検出しました。`);
  } catch (error) {
    console.error(error);
    const reason = error instanceof Error ? error.message : "";
    message(
      reason === "SILENT_AUDIO"
        ? "マイクの音量が小さすぎます。入力するマイクを確認し、音量メーターが動く距離で口笛を吹いてください。"
        : reason === "NO_NOTES"
          ? "音声は録音できましたが、音符を検出できませんでした。一定の高さで、1音を少し長めに口笛で吹いてください。"
          : "音声の変換に失敗しました。ページを再読み込みして、もう一度お試しください。",
      true,
    );
  } finally { progressWrap.hidden = true; recordButton.disabled = false; }
}

function refreshResult(): void {
  processedNotes = processNotes(detectedNotes, selectedKey);
  element("note-names").textContent = processedNotes.map((note) => noteName(note.pitch)).join("  →  ");
  drawRoll();
}

function drawRoll(): void {
  const canvas = element<HTMLCanvasElement>("roll"); const context = canvas.getContext("2d")!;
  context.clearRect(0, 0, canvas.width, canvas.height); context.fillStyle = "#f5f7fa"; context.fillRect(0, 0, canvas.width, canvas.height);
  const allPitches = processedNotes.flatMap((note) => [note.originalPitch, note.pitch]);
  const min = Math.min(...allPitches) - 1; const max = Math.max(...allPitches) + 1; const end = Math.max(...processedNotes.map((note) => note.startTimeSeconds + note.durationSeconds));
  context.strokeStyle = "#dfe4ea";
  for (let i = 0; i < 8; i += 1) { const y = 18 + i * 31; context.beginPath(); context.moveTo(0, y); context.lineTo(canvas.width, y); context.stroke(); }
  const bar = (pitch: number, start: number, duration: number, color: string, offset: number) => { const x = 18 + start / end * (canvas.width - 38); const y = 18 + (max - pitch) / (max - min) * (canvas.height - 45) + offset; context.fillStyle = color; context.fillRect(x, y, Math.max(6, duration / end * (canvas.width - 38)), 9); };
  processedNotes.forEach((note) => { bar(note.originalPitch, note.startTimeSeconds, note.durationSeconds, "#9ca3af", -6); bar(note.pitch, note.startTimeSeconds, note.durationSeconds, "#2388ff", 6); });
}

recordButton.addEventListener("click", () => void startRecording()); stopButton.addEventListener("click", () => void stopRecording());
element("refresh-mics").addEventListener("click", () => void loadInputDevices());
navigator.mediaDevices?.addEventListener("devicechange", () => void loadInputDevices());
void loadInputDevices();
keySelect.addEventListener("change", () => { selectedKey = KEYS[Number(keySelect.value)]; refreshResult(); });
tempo.addEventListener("input", () => { element("tempo-value").textContent = `${tempo.value} BPM`; });
element("play").addEventListener("click", () => void playNotes(processedNotes, Number(tempo.value)));
element("play-stop").addEventListener("click", stopPlayback);
element("midi").addEventListener("click", () => downloadBlob(new Blob([createMidi(processedNotes, Number(tempo.value)) as BlobPart], { type: "audio/midi" }), "whisbass.mid"));
element("wav").addEventListener("click", async () => { message("WAVファイルを端末内で作成しています。"); downloadBlob(await renderWav(processedNotes, Number(tempo.value)), "whisbass-bass.wav"); message("WAVファイルを保存しました。"); });
element("reset").addEventListener("click", () => { stopPlayback(); result.hidden = true; detectedNotes = []; processedNotes = []; timer.textContent = "00:00.0"; message("新しいフレーズを録音できます。"); document.getElementById("top")?.scrollIntoView({ behavior: "smooth" }); });

declare global {
  interface Window {
    runWhisBassDiagnostic: () => Promise<{ count: number; pitches: number[] }>;
  }
}

// 公開前・更新時に、同梱AIモデルが実際に推論できるかを確認するための診断口。
window.runWhisBassDiagnostic = async () => {
  const sampleRate = 22050;
  const buffer = new AudioBuffer({ length: sampleRate * 2, sampleRate, numberOfChannels: 1 });
  const samples = buffer.getChannelData(0);
  for (let index = 0; index < samples.length; index += 1) {
    const fade = Math.min(1, index / 1000, (samples.length - index) / 1000);
    samples[index] = Math.sin(2 * Math.PI * 880 * index / sampleRate) * 0.65 * fade;
  }
  const notes = await transcribeAudio(buffer, () => undefined);
  return { count: notes.length, pitches: notes.map((note) => note.pitch) };
};

if (new URLSearchParams(location.search).has("diagnostic")) {
  progressWrap.hidden = false;
  message("Basic Pitchの実変換を診断しています。");
  void window.runWhisBassDiagnostic()
    .then((diagnostic) => {
      document.body.dataset.diagnostic = diagnostic.count > 0 ? "passed" : "failed";
      message(`診断完了：${diagnostic.count}個の音符を検出（MIDI ${diagnostic.pitches.join(", ")}）`);
    })
    .catch((error: unknown) => {
      console.error(error);
      document.body.dataset.diagnostic = "failed";
      message("診断失敗：Basic Pitchモデルを実行できませんでした。", true);
    })
    .finally(() => { progressWrap.hidden = true; });
}
