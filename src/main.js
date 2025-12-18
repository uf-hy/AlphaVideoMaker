import './style.css';
import { FFmpeg } from '@ffmpeg/ffmpeg';

const baseCoreURL = 'https://unpkg.com/@ffmpeg/core-mt@0.12.10/dist/esm';
const ffmpeg = new FFmpeg();
let ffmpegReady = false;
let downloadUrl = null;

const dom = {
  form: document.getElementById('controls'),
  width: document.getElementById('width'),
  height: document.getElementById('height'),
  duration: document.getElementById('duration'),
  fps: document.getElementById('fps'),
  codec: document.getElementById('codec'),
  record: document.getElementById('record'),
  frameProgress: document.getElementById('frameProgress'),
  encodeProgress: document.getElementById('encodeProgress'),
  status: document.getElementById('status'),
  download: document.getElementById('download'),
  canvas: document.getElementById('viewport'),
};

const ctx = dom.canvas.getContext('2d');

function setStatus(message) {
  dom.status.textContent = message;
}

function resetProgress() {
  dom.frameProgress.value = 0;
  dom.encodeProgress.value = 0;
}

function setBusy(isBusy) {
  dom.record.disabled = isBusy;
  dom.form.querySelectorAll('input, select').forEach((el) => {
    el.disabled = isBusy;
  });
}

async function ensureFFmpeg() {
  if (ffmpegReady) return;

  setStatus('Loading FFmpeg (multi-thread)...');
  await ffmpeg.load({
    coreURL: `${baseCoreURL}/ffmpeg-core.js`,
    wasmURL: `${baseCoreURL}/ffmpeg-core.wasm`,
    workerURL: `${baseCoreURL}/ffmpeg-core.worker.js`,
  });
  ffmpegReady = true;
  setStatus('FFmpeg ready.');
}

function cleanupDownloadUrl() {
  if (downloadUrl) {
    URL.revokeObjectURL(downloadUrl);
    downloadUrl = null;
  }
  dom.download.innerHTML = '';
}

async function cleanupFilesystem(frameNames, outputName) {
  const targets = [...frameNames, outputName].filter(Boolean);
  for (const target of targets) {
    try {
      await ffmpeg.deleteFile(target);
    } catch (err) {
      // File may not exist; ignore to allow cleanup to continue.
    }
  }
}

function padFrameNumber(index) {
  return String(index).padStart(3, '0');
}

function deterministicStep(state, dt) {
  const speed = 120;
  state.time += dt;
  state.x += state.direction * speed * dt;
  if (state.x > state.bounds.width - state.radius || state.x < state.radius) {
    state.direction *= -1;
    state.x = Math.min(Math.max(state.x, state.radius), state.bounds.width - state.radius);
  }
  state.y = state.bounds.height / 2 + Math.sin(state.time * 2) * 60;
  state.rotation = (state.rotation + dt * Math.PI) % (Math.PI * 2);
}

function renderState(state) {
  ctx.clearRect(0, 0, dom.canvas.width, dom.canvas.height);
  ctx.save();
  ctx.translate(state.x, state.y);
  ctx.rotate(state.rotation);
  const gradient = ctx.createLinearGradient(-state.radius, -state.radius, state.radius, state.radius);
  gradient.addColorStop(0, 'rgba(74, 212, 255, 0.9)');
  gradient.addColorStop(1, 'rgba(159, 122, 234, 0.9)');
  ctx.fillStyle = gradient;
  ctx.shadowColor = 'rgba(79, 209, 255, 0.4)';
  ctx.shadowBlur = 20;
  ctx.beginPath();
  ctx.roundRect(-state.radius, -state.radius, state.radius * 2, state.radius * 2, 12);
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = 'rgba(255, 255, 255, 0.24)';
  ctx.font = '16px monospace';
  ctx.fillText(`t=${state.time.toFixed(2)}s`, 12, 24);
}

function captureCanvas(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('Canvas capture failed'));
        return;
      }
      resolve(blob);
    }, 'image/png');
  });
}

function buildEncodingArgs(codec, fps) {
  const fpsValue = String(fps);
  if (codec === 'png') {
    return ['-framerate', fpsValue, '-i', 'frame_%03d.png', '-c:v', 'png', '-pix_fmt', 'rgba', '-movflags', '+faststart', 'output.mov'];
  }
  if (codec === 'prores_ks') {
    return [
      '-framerate',
      fpsValue,
      '-i',
      'frame_%03d.png',
      '-c:v',
      'prores_ks',
      '-profile:v',
      '4444',
      '-pix_fmt',
      'yuva444p10le',
      'output.mov',
    ];
  }
  return ['-framerate', fpsValue, '-i', 'frame_%03d.png', '-c:v', 'qtrle', '-pix_fmt', 'argb', 'output.mov'];
}

async function captureFrames({ width, height, duration, fps }) {
  const frameCount = Math.round(duration * fps);
  const dt = 1 / fps;
  const frames = [];
  const state = {
    time: 0,
    x: width / 4,
    y: height / 2,
    radius: Math.min(width, height) / 10,
    direction: 1,
    rotation: 0,
    bounds: { width, height },
  };

  for (let i = 0; i < frameCount; i += 1) {
    deterministicStep(state, dt);
    renderState(state);

    const blob = await captureCanvas(dom.canvas);
    const buffer = await blob.arrayBuffer();
    const frameName = `frame_${padFrameNumber(i)}.png`;
    await ffmpeg.writeFile(frameName, new Uint8Array(buffer));
    frames.push(frameName);

    dom.frameProgress.value = (i + 1) / frameCount;
    setStatus(`Captured frame ${i + 1} / ${frameCount}`);
  }

  return frames;
}

function renderDownloadLink(blob, label) {
  cleanupDownloadUrl();
  downloadUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = downloadUrl;
  link.download = 'output.mov';
  link.textContent = `Download ${label}`;
  link.className = 'download-link';
  dom.download.appendChild(link);
}

async function encodeAndExport(codec, fps) {
  const args = buildEncodingArgs(codec, fps);
  try {
    await ffmpeg.deleteFile('output.mov');
  } catch (err) {
    // Previous output file may not exist; ignore.
  }

  const onProgress = ({ progress }) => {
    dom.encodeProgress.value = progress;
    setStatus(`Encoding ${(progress * 100).toFixed(0)}%...`);
  };

  ffmpeg.on('progress', onProgress);
  try {
    await ffmpeg.exec(args);
  } finally {
    ffmpeg.off('progress', onProgress);
  }

  const data = await ffmpeg.readFile('output.mov');
  const blob = new Blob([data.buffer], { type: 'video/quicktime' });
  renderDownloadLink(blob, dom.codec.options[dom.codec.selectedIndex].text);
}

async function record() {
  const width = Number(dom.width.value);
  const height = Number(dom.height.value);
  const duration = Number(dom.duration.value);
  const fps = Number(dom.fps.value);
  const codec = dom.codec.value;

  dom.canvas.width = width;
  dom.canvas.height = height;
  resetProgress();
  setBusy(true);
  cleanupDownloadUrl();

  const frameNames = [];
  try {
    await ensureFFmpeg();
    setStatus('Capturing frames...');
    const captured = await captureFrames({ width, height, duration, fps });
    frameNames.push(...captured);

    setStatus('Encoding video...');
    await encodeAndExport(codec, fps);
    setStatus('Complete.');
  } catch (err) {
    console.error(err);
    setStatus(`Error: ${err.message}`);
  } finally {
    await cleanupFilesystem(frameNames, 'output.mov');
    setBusy(false);
  }
}

dom.form.addEventListener('submit', (event) => {
  event.preventDefault();
  record();
});

renderState({
  time: 0,
  x: dom.canvas.width / 4,
  y: dom.canvas.height / 2,
  radius: Math.min(dom.canvas.width, dom.canvas.height) / 10,
  direction: 1,
  rotation: 0,
  bounds: { width: dom.canvas.width, height: dom.canvas.height },
});
