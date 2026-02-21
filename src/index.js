/**
 * AxiDraw HTTP Server
 *
 * REST API for controlling AxiDraw plotters via HTTP requests.
 * Provides endpoints for pen control, motion, SVG plotting, and job queue management.
 *
 * Default port: 9700 (configurable via AXIDRAW_PORT environment variable)
 */

import http from 'http';
import { URL } from 'url';
import { WebSocketServer } from 'ws';
import { AxiDraw, AXIDRAW_MODELS, AxiDrawState } from './lib/axidraw.js';
import { JobQueue, JobState, JobPriority } from './lib/job-queue.js';
import { SVGParser } from './lib/svg-parser.js';
import { EBBSerial } from './lib/ebb-serial.js';
import { SpatialProcessor } from './lib/spatial-processor.js';

// Command coalescing buffers for real-time input smoothing
// Separate buffers per unit type to avoid conversion issues
const coalesceBuffers = {
  move: { mm: { dx: 0, dy: 0 }, inches: { dx: 0, dy: 0 }, steps: { dx: 0, dy: 0 }, timer: null, pending: [] },
  lineto: { mm: { dx: 0, dy: 0 }, inches: { dx: 0, dy: 0 }, steps: { dx: 0, dy: 0 }, timer: null, pending: [] }
};

/**
 * Flush coalesced movement buffer
 * @param {string} type - 'move' or 'lineto'
 * @param {object} axi - AxiDraw instance
 */
async function flushCoalesceBuffer(type, axi) {
  const buffer = coalesceBuffers[type];
  buffer.timer = null;

  // Process each unit type that has accumulated movement
  for (const units of ['mm', 'inches', 'steps']) {
    const { dx, dy } = buffer[units];
    if (dx !== 0 || dy !== 0) {
      try {
        if (type === 'move') {
          await axi.move(dx, dy, units);
        } else {
          await axi.lineTo(dx, dy, units);
        }
      } catch (e) {
        console.error(`[Coalesce] Error flushing ${type} (${units}):`, e.message);
      }
      buffer[units].dx = 0;
      buffer[units].dy = 0;
    }
  }

  // Resolve all pending responses
  const position = axi.motion?.getPosition();
  for (const resolve of buffer.pending) {
    resolve(position);
  }
  buffer.pending = [];
}

/**
 * Add movement to coalesce buffer
 * @param {string} type - 'move' or 'lineto'
 * @param {number} dx - Delta X
 * @param {number} dy - Delta Y
 * @param {string} units - 'mm', 'inches', or 'steps'
 * @param {number} coalesceMs - Flush interval in ms
 * @param {object} axi - AxiDraw instance
 * @returns {Promise<object>} Position after flush
 */
function addToCoalesceBuffer(type, dx, dy, units, coalesceMs, axi) {
  const buffer = coalesceBuffers[type];
  const unitBuffer = buffer[units] || buffer.mm; // Default to mm

  unitBuffer.dx += dx;
  unitBuffer.dy += dy;

  return new Promise((resolve) => {
    buffer.pending.push(resolve);

    if (!buffer.timer) {
      buffer.timer = setTimeout(() => flushCoalesceBuffer(type, axi), coalesceMs);
    }
  });
}

// Configuration from environment
const PORT = parseInt(process.env.AXIDRAW_PORT || '9700', 10);
const HOST = process.env.AXIDRAW_HOST || '0.0.0.0';
const SERIAL_PORT = process.env.AXIDRAW_SERIAL || null;
const AUTO_CONNECT = process.env.AXIDRAW_AUTO_CONNECT !== 'false';
const NARROW_BAND = process.env.AXIDRAW_NARROW_BAND === 'true';
const MODEL = process.env.AXIDRAW_MODEL || 'V2_V3';

// Speed configuration (inches per second)
const SPEED_PEN_DOWN = parseFloat(process.env.AXIDRAW_SPEED_DOWN || '2.5');
const SPEED_PEN_UP = parseFloat(process.env.AXIDRAW_SPEED_UP || '7.5');

// Create AxiDraw instance
const axi = new AxiDraw({
  portPath: SERIAL_PORT,
  model: MODEL,
  narrowBand: NARROW_BAND,
  speedPenDown: SPEED_PEN_DOWN,
  speedPenUp: SPEED_PEN_UP,
  onStateChange: (newState, oldState, error) => {
    console.log(`[AxiDraw] State: ${oldState} -> ${newState}${error ? ` (${error})` : ''}`);
  }
});

// Create job queue
const queue = new JobQueue({
  onJobStart: (job) => console.log(`[Queue] Started: ${job.name}`),
  onJobComplete: (job) => console.log(`[Queue] Completed: ${job.name}`),
  onJobFailed: (job, err) => console.log(`[Queue] Failed: ${job.name} - ${err.message}`)
});

// SVG parser
const svgParser = new SVGParser();

/**
 * Control Panel HTML
 *
 * Self-contained web UI for controlling the AxiDraw plotter.
 * This interface is designed to work standalone and can be hosted separately
 * from any static file server, React/Vite app, or CDN - simply update the
 * API_BASE_URL to point to your AxiDraw server.
 */
const CONTROL_PANEL_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
  <title>AxiDraw Control Panel</title>
  <style>
    :root {
      --bg: #1a1a2e;
      --surface: #16213e;
      --surface-light: #1f3460;
      --primary: #e94560;
      --primary-hover: #ff6b6b;
      --success: #4ecca3;
      --warning: #ffc107;
      --text: #eee;
      --text-dim: #888;
      --radius: 8px;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: var(--bg);
      color: var(--text);
      min-height: 100vh;
      padding: 16px;
    }

    .container {
      max-width: 600px;
      margin: 0 auto;
    }

    header {
      text-align: center;
      margin-bottom: 20px;
    }

    header h1 {
      font-size: 1.5rem;
      font-weight: 600;
    }

    .status-bar {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      margin-top: 8px;
      font-size: 0.875rem;
    }

    .status-dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: var(--text-dim);
    }

    .status-dot.connected { background: var(--success); }
    .status-dot.disconnected { background: var(--primary); }
    .status-dot.busy { background: var(--warning); animation: pulse 1s infinite; }

    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }

    .card {
      background: var(--surface);
      border-radius: var(--radius);
      padding: 16px;
      margin-bottom: 16px;
    }

    .card h2 {
      font-size: 0.875rem;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--text-dim);
      margin-bottom: 12px;
    }

    .btn-row {
      display: flex;
      gap: 8px;
    }

    .btn {
      flex: 1;
      padding: 12px 16px;
      border: none;
      border-radius: var(--radius);
      background: var(--surface-light);
      color: var(--text);
      font-size: 0.9rem;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.15s;
      touch-action: manipulation;
    }

    .btn:hover { background: #2a4a7f; }
    .btn:active { transform: scale(0.98); }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }

    .btn.primary { background: var(--primary); }
    .btn.primary:hover { background: var(--primary-hover); }

    .btn.success { background: var(--success); color: #000; }
    .btn.success:hover { background: #6eecc3; }

    .btn.warning { background: var(--warning); color: #000; }

    .btn.small {
      padding: 8px 12px;
      font-size: 0.8rem;
    }

    /* D-Pad */
    .dpad-container {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4px;
    }

    .dpad-row {
      display: flex;
      gap: 4px;
    }

    .dpad-btn {
      width: 64px;
      height: 64px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 1.5rem;
      background: var(--surface-light);
      border: none;
      border-radius: var(--radius);
      color: var(--text);
      cursor: pointer;
      transition: all 0.1s;
      touch-action: manipulation;
      user-select: none;
    }

    .dpad-btn:hover { background: #2a4a7f; }
    .dpad-btn:active { background: var(--primary); transform: scale(0.95); }

    .dpad-btn.home {
      font-size: 1rem;
      background: var(--warning);
      color: #000;
    }

    .dpad-placeholder {
      width: 64px;
      height: 64px;
    }

    /* Position Display */
    .position-display {
      display: flex;
      justify-content: center;
      gap: 24px;
      padding: 16px;
      background: var(--surface-light);
      border-radius: var(--radius);
      font-family: 'SF Mono', Monaco, monospace;
      font-size: 1.25rem;
    }

    .position-display .coord {
      display: flex;
      align-items: baseline;
      gap: 4px;
    }

    .position-display .label {
      color: var(--text-dim);
      font-size: 0.875rem;
    }

    .position-display .value {
      min-width: 80px;
      text-align: right;
    }

    /* Sliders */
    .slider-group {
      margin-bottom: 16px;
    }

    .slider-group:last-child {
      margin-bottom: 0;
    }

    .slider-label {
      display: flex;
      justify-content: space-between;
      margin-bottom: 8px;
      font-size: 0.875rem;
    }

    .slider-label .value {
      color: var(--primary);
      font-weight: 600;
    }

    input[type="range"] {
      width: 100%;
      height: 8px;
      border-radius: 4px;
      background: var(--surface-light);
      appearance: none;
      outline: none;
    }

    input[type="range"]::-webkit-slider-thumb {
      appearance: none;
      width: 20px;
      height: 20px;
      border-radius: 50%;
      background: var(--primary);
      cursor: pointer;
    }

    /* SVG Upload */
    .upload-zone {
      border: 2px dashed var(--surface-light);
      border-radius: var(--radius);
      padding: 24px;
      text-align: center;
      cursor: pointer;
      transition: all 0.2s;
    }

    .upload-zone:hover, .upload-zone.dragover {
      border-color: var(--primary);
      background: rgba(233, 69, 96, 0.1);
    }

    .upload-zone input {
      display: none;
    }

    .upload-zone .icon {
      font-size: 2rem;
      margin-bottom: 8px;
    }

    .upload-zone p {
      color: var(--text-dim);
      font-size: 0.875rem;
    }

    /* Queue */
    .queue-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px;
      background: var(--surface-light);
      border-radius: var(--radius);
      margin-bottom: 8px;
    }

    .queue-item:last-child {
      margin-bottom: 0;
    }

    .queue-item .name {
      font-weight: 500;
    }

    .queue-item .status {
      font-size: 0.75rem;
      padding: 4px 8px;
      border-radius: 4px;
      background: var(--surface);
    }

    .queue-item .status.running {
      background: var(--success);
      color: #000;
    }

    .queue-empty {
      text-align: center;
      color: var(--text-dim);
      padding: 16px;
    }

    /* Toast notifications */
    .toast-container {
      position: fixed;
      bottom: 20px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 1000;
    }

    .toast {
      background: var(--surface);
      color: var(--text);
      padding: 12px 20px;
      border-radius: var(--radius);
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      margin-top: 8px;
      animation: slideUp 0.3s ease;
    }

    .toast.error {
      background: var(--primary);
    }

    .toast.success {
      background: var(--success);
      color: #000;
    }

    @keyframes slideUp {
      from { opacity: 0; transform: translateY(20px); }
      to { opacity: 1; transform: translateY(0); }
    }

    /* Pen indicator */
    .pen-indicator {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 8px 16px;
      background: var(--surface-light);
      border-radius: var(--radius);
      margin-bottom: 12px;
    }

    .pen-icon {
      font-size: 1.25rem;
      transition: transform 0.3s;
    }

    .pen-icon.down {
      transform: translateY(4px);
      color: var(--success);
    }

    .pen-icon.up {
      color: var(--text-dim);
    }

    /* API Host Config */
    .api-config {
      display: flex;
      gap: 8px;
      margin-bottom: 12px;
    }

    .api-config input {
      flex: 1;
      padding: 8px 12px;
      border: 1px solid var(--surface-light);
      border-radius: var(--radius);
      background: var(--surface-light);
      color: var(--text);
      font-size: 0.875rem;
    }

    .api-config input:focus {
      outline: none;
      border-color: var(--primary);
    }

    /* Note about hosting */
    .hosting-note {
      font-size: 0.75rem;
      color: var(--text-dim);
      text-align: center;
      margin-top: 16px;
      padding: 12px;
      background: var(--surface);
      border-radius: var(--radius);
      line-height: 1.5;
    }

    .hosting-note code {
      background: var(--surface-light);
      padding: 2px 6px;
      border-radius: 4px;
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>AxiDraw Control Panel</h1>
      <div class="status-bar">
        <span class="status-dot" id="statusDot"></span>
        <span id="statusText">Checking...</span>
      </div>
    </header>

    <!-- API Configuration -->
    <div class="card">
      <h2>API Server</h2>
      <div class="api-config">
        <input type="text" id="apiHost" placeholder="http://localhost:9700">
        <button class="btn small" onclick="updateApiHost()">Set</button>
      </div>
      <div class="btn-row">
        <button class="btn success" id="connectBtn" onclick="connect()">Connect</button>
        <button class="btn" id="disconnectBtn" onclick="disconnect()">Disconnect</button>
      </div>
    </div>

    <!-- Pen Control -->
    <div class="card">
      <h2>Pen Control</h2>
      <div class="pen-indicator">
        <span class="pen-icon" id="penIcon">&#9999;&#65039;</span>
        <span id="penStatus">Unknown</span>
      </div>
      <div class="btn-row">
        <button class="btn" onclick="penUp()">Pen Up</button>
        <button class="btn" onclick="penDown()">Pen Down</button>
        <button class="btn primary" onclick="penToggle()">Toggle</button>
      </div>
    </div>

    <!-- Position & Movement -->
    <div class="card">
      <h2>Position</h2>
      <div class="position-display">
        <div class="coord">
          <span class="label">X:</span>
          <span class="value" id="posX">0.00</span>
          <span class="label">mm</span>
        </div>
        <div class="coord">
          <span class="label">Y:</span>
          <span class="value" id="posY">0.00</span>
          <span class="label">mm</span>
        </div>
      </div>
    </div>

    <!-- D-Pad -->
    <div class="card">
      <h2>Movement</h2>
      <div class="slider-group">
        <div class="slider-label">
          <span>Step Size</span>
          <span class="value"><span id="stepValue">5</span> mm</span>
        </div>
        <input type="range" id="stepSize" min="1" max="50" value="5" oninput="updateStep()">
      </div>
      <div class="dpad-container">
        <div class="dpad-row">
          <div class="dpad-placeholder"></div>
          <button class="dpad-btn" onpointerdown="move(0, -1)" ontouchstart="move(0, -1)">&#9650;</button>
          <div class="dpad-placeholder"></div>
        </div>
        <div class="dpad-row">
          <button class="dpad-btn" onpointerdown="move(-1, 0)" ontouchstart="move(-1, 0)">&#9664;</button>
          <button class="dpad-btn home" onclick="goHome()">HOME</button>
          <button class="dpad-btn" onpointerdown="move(1, 0)" ontouchstart="move(1, 0)">&#9654;</button>
        </div>
        <div class="dpad-row">
          <div class="dpad-placeholder"></div>
          <button class="dpad-btn" onpointerdown="move(0, 1)" ontouchstart="move(0, 1)">&#9660;</button>
          <div class="dpad-placeholder"></div>
        </div>
      </div>
    </div>

    <!-- Speed Control -->
    <div class="card">
      <h2>Speed Settings</h2>
      <div class="slider-group">
        <div class="slider-label">
          <span>Pen Down Speed</span>
          <span class="value"><span id="speedDownValue">2.5</span> in/s</span>
        </div>
        <input type="range" id="speedDown" min="0.5" max="5" step="0.1" value="2.5" oninput="updateSpeedDisplay()">
      </div>
      <div class="slider-group">
        <div class="slider-label">
          <span>Pen Up Speed</span>
          <span class="value"><span id="speedUpValue">7.5</span> in/s</span>
        </div>
        <input type="range" id="speedUp" min="1" max="15" step="0.5" value="7.5" oninput="updateSpeedDisplay()">
      </div>
      <button class="btn" onclick="setSpeed()">Apply Speed</button>
    </div>

    <!-- SVG Upload -->
    <div class="card">
      <h2>SVG Upload</h2>
      <div class="upload-zone" id="uploadZone" onclick="document.getElementById('svgFile').click()">
        <input type="file" id="svgFile" accept=".svg,image/svg+xml" onchange="uploadSVG(event)">
        <div class="icon">&#128196;</div>
        <p>Click or drag SVG file here</p>
      </div>
    </div>

    <!-- Queue -->
    <div class="card">
      <h2>Job Queue</h2>
      <div id="queueList">
        <div class="queue-empty">No jobs in queue</div>
      </div>
      <div class="btn-row" style="margin-top: 12px;">
        <button class="btn small" onclick="pauseQueue()">Pause</button>
        <button class="btn small" onclick="resumeQueue()">Resume</button>
        <button class="btn small warning" onclick="clearQueue()">Clear</button>
      </div>
    </div>

    <!-- Emergency Stop -->
    <div class="card">
      <button class="btn primary" style="width: 100%; padding: 16px; font-size: 1.1rem;" onclick="emergencyStop()">
        &#9632; EMERGENCY STOP
      </button>
    </div>

    <!-- Hosting Note -->
    <div class="hosting-note">
      This UI can be hosted separately from the AxiDraw server.<br>
      Copy this HTML to any static host, CDN, or embed in a React/Vite app.<br>
      Just update the API Server URL above to point to your AxiDraw instance.
    </div>
  </div>

  <div class="toast-container" id="toasts"></div>

  <script>
    // Configuration - can be changed to point to any AxiDraw server
    let API_BASE = '';

    // Initialize API base from current location or localStorage
    function initApiBase() {
      const saved = localStorage.getItem('axiApiHost');
      if (saved) {
        API_BASE = saved;
      } else {
        // Default to same origin
        API_BASE = window.location.origin;
      }
      document.getElementById('apiHost').value = API_BASE;
    }

    function updateApiHost() {
      const input = document.getElementById('apiHost').value.trim();
      API_BASE = input.replace(/\\/$/, ''); // Remove trailing slash
      localStorage.setItem('axiApiHost', API_BASE);
      toast('API host updated', 'success');
      refreshStatus();
    }

    // Toast notifications
    function toast(message, type = 'info') {
      const container = document.getElementById('toasts');
      const el = document.createElement('div');
      el.className = 'toast ' + type;
      el.textContent = message;
      container.appendChild(el);
      setTimeout(() => el.remove(), 3000);
    }

    // API helpers
    async function api(endpoint, options = {}) {
      try {
        const res = await fetch(API_BASE + endpoint, {
          ...options,
          headers: {
            'Content-Type': 'application/json',
            ...options.headers
          }
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        return data;
      } catch (e) {
        toast(e.message, 'error');
        throw e;
      }
    }

    async function post(endpoint, body = {}) {
      return api(endpoint, { method: 'POST', body: JSON.stringify(body) });
    }

    // Status polling
    let statusInterval;

    async function refreshStatus() {
      try {
        const data = await api('/health');
        const dot = document.getElementById('statusDot');
        const text = document.getElementById('statusText');

        if (data.connected) {
          dot.className = 'status-dot connected';
          text.textContent = 'Connected - ' + (data.state || 'ready');
        } else {
          dot.className = 'status-dot disconnected';
          text.textContent = 'Disconnected';
        }

        // Update position
        const status = await api('/status');
        if (status.motion?.position) {
          document.getElementById('posX').textContent = status.motion.position.mm.x.toFixed(2);
          document.getElementById('posY').textContent = status.motion.position.mm.y.toFixed(2);
        }

        // Update pen status
        const penIcon = document.getElementById('penIcon');
        const penStatus = document.getElementById('penStatus');
        if (status.servo?.isUp !== undefined) {
          penIcon.className = 'pen-icon ' + (status.servo.isUp ? 'up' : 'down');
          penStatus.textContent = status.servo.isUp ? 'Up' : 'Down';
        }

        // Update queue
        const queue = await api('/queue');
        updateQueueDisplay(queue);

        // Update speed sliders
        const speed = await api('/speed');
        if (speed.speed) {
          document.getElementById('speedDown').value = speed.speed.penDown;
          document.getElementById('speedUp').value = speed.speed.penUp;
          updateSpeedDisplay();
        }
      } catch (e) {
        document.getElementById('statusDot').className = 'status-dot disconnected';
        document.getElementById('statusText').textContent = 'Server unreachable';
      }
    }

    function updateQueueDisplay(data) {
      const container = document.getElementById('queueList');
      const jobs = data.jobs || [];

      if (jobs.length === 0) {
        container.innerHTML = '<div class="queue-empty">No jobs in queue</div>';
        return;
      }

      container.innerHTML = jobs.map(job => \`
        <div class="queue-item">
          <div>
            <div class="name">\${job.name || 'Unnamed'}</div>
            <div style="font-size: 0.75rem; color: var(--text-dim);">\${job.progress || 0}%</div>
          </div>
          <span class="status \${job.state === 'running' ? 'running' : ''}">\${job.state}</span>
        </div>
      \`).join('');
    }

    // Connection
    async function connect() {
      await post('/connect');
      toast('Connected!', 'success');
      refreshStatus();
    }

    async function disconnect() {
      await post('/disconnect');
      toast('Disconnected', 'info');
      refreshStatus();
    }

    // Pen control
    async function penUp() {
      await post('/pen/up');
      refreshStatus();
    }

    async function penDown() {
      await post('/pen/down');
      refreshStatus();
    }

    async function penToggle() {
      await post('/pen/toggle');
      refreshStatus();
    }

    // Movement
    function getStepSize() {
      return parseFloat(document.getElementById('stepSize').value);
    }

    function updateStep() {
      document.getElementById('stepValue').textContent = getStepSize();
    }

    async function move(dx, dy) {
      const step = getStepSize();
      await post('/move?coalesce=50', { dx: dx * step, dy: dy * step, units: 'mm' });
      refreshStatus();
    }

    async function goHome() {
      await post('/home');
      toast('Moving home...', 'info');
      refreshStatus();
    }

    // Speed
    function updateSpeedDisplay() {
      document.getElementById('speedDownValue').textContent = document.getElementById('speedDown').value;
      document.getElementById('speedUpValue').textContent = document.getElementById('speedUp').value;
    }

    async function setSpeed() {
      const penDown = parseFloat(document.getElementById('speedDown').value);
      const penUp = parseFloat(document.getElementById('speedUp').value);
      await post('/speed', { penDown, penUp });
      toast('Speed updated', 'success');
    }

    // SVG Upload
    const uploadZone = document.getElementById('uploadZone');

    uploadZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      uploadZone.classList.add('dragover');
    });

    uploadZone.addEventListener('dragleave', () => {
      uploadZone.classList.remove('dragover');
    });

    uploadZone.addEventListener('drop', (e) => {
      e.preventDefault();
      uploadZone.classList.remove('dragover');
      const file = e.dataTransfer.files[0];
      if (file) handleSVGFile(file);
    });

    function uploadSVG(event) {
      const file = event.target.files[0];
      if (file) handleSVGFile(file);
    }

    async function handleSVGFile(file) {
      const formData = new FormData();
      formData.append('file', file);

      try {
        const res = await fetch(API_BASE + '/svg/upload', {
          method: 'POST',
          body: formData
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        toast(\`Queued: \${file.name} (\${data.commandCount} commands)\`, 'success');
        refreshStatus();
      } catch (e) {
        toast(e.message, 'error');
      }
    }

    // Queue controls
    async function pauseQueue() {
      await post('/queue/pause');
      toast('Queue paused', 'info');
    }

    async function resumeQueue() {
      await post('/queue/resume');
      toast('Queue resumed', 'success');
    }

    async function clearQueue() {
      await post('/queue/clear');
      toast('Queue cleared', 'info');
      refreshStatus();
    }

    // Emergency stop
    async function emergencyStop() {
      await post('/stop');
      toast('EMERGENCY STOP', 'error');
      refreshStatus();
    }

    // Initialize
    initApiBase();
    refreshStatus();
    statusInterval = setInterval(refreshStatus, 2000);
  </script>
</body>
</html>
`;

// Set up job processor
queue.processor = async (job, updateProgress) => {
  await axi.ensureReady();

  if (job.type === 'commands' && Array.isArray(job.data)) {
    const commands = job.data;
    for (let i = 0; i < commands.length; i++) {
      if (job.state === JobState.CANCELLED) {
        throw new Error('Job cancelled');
      }
      await axi.execute([commands[i]]);
      updateProgress(Math.round((i + 1) / commands.length * 100));
    }
  } else if (job.type === 'svg' && typeof job.data === 'string') {
    const commands = await svgParser.parse(job.data);
    for (let i = 0; i < commands.length; i++) {
      if (job.state === JobState.CANCELLED) {
        throw new Error('Job cancelled');
      }
      await axi.execute([commands[i]]);
      updateProgress(Math.round((i + 1) / commands.length * 100));
    }
  }
};

// API Documentation
const API_DOCS = {
  name: 'AxiDraw HTTP API',
  version: '1.0.0',
  description: 'REST API for controlling AxiDraw plotters via direct EBB serial commands',
  baseUrl: `http://localhost:${PORT}`,
  endpoints: {
    // Web UI
    'GET /ui': 'Web control panel - mobile-friendly UI for testing and demos',

    // Status & Info
    'GET /': 'API documentation (this page)',
    'GET /info': 'API documentation as JSON',
    'GET /health': 'Health check - returns server and connection status',
    'GET /status': 'Detailed AxiDraw status including position, servo state, etc.',
    'GET /history': 'Get action history (query: ?limit=100)',
    'GET /ports': 'List available serial ports with EBB devices',

    // Connection
    'POST /connect': 'Connect to AxiDraw (body: { port?: string })',
    'POST /disconnect': 'Disconnect from AxiDraw',
    'POST /initialize': 'Initialize AxiDraw (configure servo, enable motors)',

    // Device
    'GET /version': 'Get firmware version',
    'GET /nickname': 'Get device nickname',
    'POST /nickname': 'Set device nickname (body: { name: string })',
    'POST /reboot': 'Reboot the EBB',
    'POST /reset': 'Reset EBB to default state',

    // Pen Control
    'POST /pen/up': 'Raise the pen',
    'POST /pen/down': 'Lower the pen',
    'POST /pen/toggle': 'Toggle pen state',
    'GET /pen/status': 'Get pen status',
    'POST /pen/config': 'Configure pen settings (body: { posUp?, posDown?, rateRaise?, rateLower?, delayUp?, delayDown? })',

    // Motion
    'POST /home': 'Move to home position (0,0) - body: { rate?: number }',
    'POST /move': 'Relative move (pen up) - body: { dx, dy, units?: "mm"|"inches"|"steps" }, query: ?coalesce=50 (ms)',
    'POST /moveto': 'Absolute move (pen up) - body: { x, y, units?: "mm"|"inches"|"steps" }',
    'POST /lineto': 'Draw line (pen down) - body: { dx, dy, units?: "mm"|"inches"|"steps" }, query: ?coalesce=50 (ms)',
    'POST /execute': 'Execute command sequence - body: { commands: [...] }',
    'POST /batch': 'Execute multiple endpoints atomically - body: { commands: [{endpoint, body?}, ...] }',
    'GET /position': 'Get current position',
    'GET /speed': 'Get current speed settings',
    'POST /speed': 'Set speed settings - body: { penDown?: number, penUp?: number } (inches/sec)',
    'POST /motors/on': 'Enable motors',
    'POST /motors/off': 'Disable motors',
    'POST /stop': 'Emergency stop',

    // Queue
    'GET /queue': 'Get queue status and jobs',
    'POST /queue': 'Add job to queue - body: { type: "commands"|"svg", data: ..., name?, priority? }',
    'DELETE /queue/:id': 'Remove/cancel job from queue',
    'POST /queue/pause': 'Pause queue processing',
    'POST /queue/resume': 'Resume queue processing',
    'POST /queue/clear': 'Clear all pending jobs',
    'GET /queue/history': 'Get completed job history',

    // SVG
    'POST /svg': 'Parse and queue SVG for drawing - body: { svg: string, name?, options? }',
    'POST /svg/upload': 'Upload SVG file (multipart/form-data) - form field: file',
    'POST /svg/preview': 'Parse SVG and return commands without drawing - body: { svg: string, options? }',

    // WebSocket
    'WS /spatial': 'WebSocket for spatial streaming - receives position/velocity state, sends movement commands',
    'WS /controller': 'WebSocket for raw controller input - receives stick/trigger/button state'
  },
  websocketMessages: {
    // Incoming (from controller)
    'spatial': '{ type: "spatial", ts, position, velocity, orientation, angular_velocity, linear_accel, buttons }',
    'state': '{ type: "state", ts, sticks: {lx, ly, rx, ry}, triggers: {l2, r2}, orientation, gyro, accel }',
    'button': '{ type: "button", button: string, state: "pressed"|"released" }',
    'event': '{ type: "event", action: "pen_down"|"pen_up"|"stop"|"home" }',
    'dpad': '{ type: "dpad", direction: "up"|"down"|"left"|"right", state: "pressed"|"released" }',
    'config': '{ type: "config", config: {...} }',
    'sync': '{ type: "sync" }',
    'ping': '{ type: "ping" }',
    // Outgoing (to controller)
    'connected': '{ type: "connected", ts, config, position, penDown }',
    'state_update': '{ type: "state", ts, position, velocity, orientation, angularVelocity, penDown }',
    'pong': '{ type: "pong", ts }'
  },
  commandTypes: {
    moveTo: '{ type: "moveTo", x: number, y: number, units?: string }',
    move: '{ type: "move", dx: number, dy: number, units?: string }',
    lineTo: '{ type: "lineTo", dx: number, dy: number, units?: string }',
    penUp: '{ type: "penUp" }',
    penDown: '{ type: "penDown" }',
    pause: '{ type: "pause", ms: number }',
    home: '{ type: "home", rate?: number }'
  },
  units: ['mm (default)', 'inches', 'steps'],
  priorities: { LOW: 0, NORMAL: 1, HIGH: 2, URGENT: 3 },
  configuration: {
    AXIDRAW_PORT: 'HTTP server port (default: 9700)',
    AXIDRAW_HOST: 'HTTP server host (default: 0.0.0.0)',
    AXIDRAW_SERIAL: 'Serial port path (default: auto-detect)',
    AXIDRAW_AUTO_CONNECT: 'Auto-connect on startup (default: true)',
    AXIDRAW_NARROW_BAND: 'Use narrow-band brushless servo (default: false)',
    AXIDRAW_MODEL: 'AxiDraw model: V2_V3, V3_A3, V3_XLX, MiniKit, SE_A1, SE_A2',
    AXIDRAW_SPEED_DOWN: 'Pen-down drawing speed in inches/sec (default: 2.5)',
    AXIDRAW_SPEED_UP: 'Pen-up travel speed in inches/sec (default: 7.5)'
  },
  spatialProcessing: {
    tickRate: '120 Hz - fixed update rate for velocity integration',
    deadzone: '0.08 - input deadzone threshold',
    velocityCurve: 'cubic - response curve for precise low-speed control',
    maxLinearSpeed: '200 mm/s - maximum planar velocity',
    linearDamping: '0.92 - velocity damping per tick',
    smoothingAlpha: '0.15 - exponential smoothing factor',
    networkLatency: '15 ms - prediction compensation'
  }
};

// Helper functions
function sendJSON(res, data, status = 200) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*'
  });
  res.end(JSON.stringify(data, null, 2));
}

function sendError(res, message, status = 400) {
  sendJSON(res, { error: message }, status);
}

function sendSuccess(res, data = {}) {
  sendJSON(res, { success: true, ...data });
}

async function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (e) {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

/**
 * Parse multipart form data (simple implementation for file uploads)
 * @param {http.IncomingMessage} req - Request object
 * @returns {Promise<{fields: object, files: object}>}
 */
async function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    const contentType = req.headers['content-type'] || '';
    const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/);
    if (!boundaryMatch) {
      reject(new Error('Missing boundary in multipart request'));
      return;
    }
    const boundary = boundaryMatch[1] || boundaryMatch[2];

    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      const buffer = Buffer.concat(chunks);
      const parts = parseMultipartBuffer(buffer, boundary);
      resolve(parts);
    });
    req.on('error', reject);
  });
}

/**
 * Parse multipart buffer into fields and files
 */
function parseMultipartBuffer(buffer, boundary) {
  const fields = {};
  const files = {};
  const boundaryBuffer = Buffer.from('--' + boundary);
  const endBoundary = Buffer.from('--' + boundary + '--');

  let start = buffer.indexOf(boundaryBuffer) + boundaryBuffer.length + 2; // Skip \r\n

  while (start < buffer.length) {
    const nextBoundary = buffer.indexOf(boundaryBuffer, start);
    if (nextBoundary === -1) break;

    const partEnd = nextBoundary - 2; // Exclude \r\n before boundary
    const partData = buffer.slice(start, partEnd);

    // Find header/body separator (double CRLF)
    const headerEnd = partData.indexOf('\r\n\r\n');
    if (headerEnd === -1) {
      start = nextBoundary + boundaryBuffer.length + 2;
      continue;
    }

    const headers = partData.slice(0, headerEnd).toString('utf8');
    const body = partData.slice(headerEnd + 4);

    // Parse Content-Disposition
    const nameMatch = headers.match(/name="([^"]+)"/);
    const filenameMatch = headers.match(/filename="([^"]+)"/);

    if (nameMatch) {
      const name = nameMatch[1];
      if (filenameMatch) {
        // It's a file
        const contentTypeMatch = headers.match(/Content-Type:\s*([^\r\n]+)/i);
        files[name] = {
          filename: filenameMatch[1],
          contentType: contentTypeMatch ? contentTypeMatch[1].trim() : 'application/octet-stream',
          data: body
        };
      } else {
        // It's a field
        fields[name] = body.toString('utf8');
      }
    }

    start = nextBoundary + boundaryBuffer.length + 2;

    // Check for end boundary
    if (buffer.slice(nextBoundary, nextBoundary + endBoundary.length).equals(endBoundary)) {
      break;
    }
  }

  return { fields, files };
}

/**
 * Execute a batch command (subset of endpoints that make sense for batching)
 * @param {string} endpoint - Endpoint path (e.g., '/pen/up', '/moveto')
 * @param {object} body - Request body
 * @returns {Promise<object>} Result data
 */
async function executeBatchCommand(endpoint, body) {
  switch (endpoint) {
    case '/pen/up':
      return { time: await axi.penUp() };
    case '/pen/down':
      return { time: await axi.penDown() };
    case '/pen/toggle':
      return { time: await axi.penToggle(), isUp: axi.servo?.isUp };
    case '/home':
      await axi.home(body.rate);
      return {};
    case '/move':
      await axi.move(body.dx ?? 0, body.dy ?? 0, body.units || 'mm');
      return { position: axi.motion?.getPosition() };
    case '/moveto':
      await axi.moveTo(body.x ?? 0, body.y ?? 0, body.units || 'mm');
      return { position: axi.motion?.getPosition() };
    case '/lineto':
      await axi.lineTo(body.dx ?? 0, body.dy ?? 0, body.units || 'mm');
      return { position: axi.motion?.getPosition() };
    case '/motors/on':
      await axi.motorsOn();
      return {};
    case '/motors/off':
      await axi.motorsOff();
      return {};
    case '/pause':
      await new Promise(resolve => setTimeout(resolve, body.ms || 100));
      return { paused: body.ms || 100 };
    default:
      throw new Error(`Endpoint not supported in batch: ${endpoint}`);
  }
}

// Request handler
async function handleRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;
  const method = req.method.toUpperCase();

  // CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    res.end();
    return;
  }

  console.log(`[HTTP] ${method} ${path}`);

  try {
    // Route handling
    // ==================== Web UI ====================
    if (method === 'GET' && path === '/ui') {
      res.writeHead(200, {
        'Content-Type': 'text/html',
        'Access-Control-Allow-Origin': '*'
      });
      res.end(CONTROL_PANEL_HTML);
      return;
    }

    // ==================== Status & Info ====================
    if (method === 'GET' && path === '/') {
      // Return docs as formatted text
      res.writeHead(200, {
        'Content-Type': 'text/plain',
        'Access-Control-Allow-Origin': '*'
      });
      res.end(formatDocs(API_DOCS));
      return;
    }

    if (method === 'GET' && path === '/info') {
      sendJSON(res, API_DOCS);
      return;
    }

    if (method === 'GET' && path === '/health') {
      const status = await axi.getStatus();
      sendJSON(res, {
        ok: status.connected,
        state: status.state,
        connected: status.connected,
        port: status.connection?.portPath || null,
        firmware: status.connection?.firmwareVersion || null,
        queue: queue.getStatus()
      });
      return;
    }

    if (method === 'GET' && path === '/status') {
      const status = await axi.getStatus();
      sendJSON(res, status);
      return;
    }

    if (method === 'GET' && path === '/history') {
      const limit = parseInt(url.searchParams.get('limit') || '100', 10);
      sendJSON(res, { history: axi.getHistory(limit) });
      return;
    }

    if (method === 'GET' && path === '/ports') {
      const ports = await EBBSerial.listPorts();
      sendJSON(res, { ports });
      return;
    }

    // ==================== Connection ====================
    if (method === 'POST' && path === '/connect') {
      const body = await parseBody(req);
      await axi.connect(body.port);
      sendSuccess(res, { port: axi.ebb?.portPath });
      return;
    }

    if (method === 'POST' && path === '/disconnect') {
      await axi.disconnect();
      sendSuccess(res);
      return;
    }

    if (method === 'POST' && path === '/initialize') {
      await axi.initialize();
      sendSuccess(res, { state: axi.state });
      return;
    }

    // ==================== Device ====================
    if (method === 'GET' && path === '/version') {
      const version = await axi.getVersion();
      sendJSON(res, { version });
      return;
    }

    if (method === 'GET' && path === '/nickname') {
      const info = await axi.getInfo();
      sendJSON(res, { nickname: info?.nickname || null });
      return;
    }

    if (method === 'POST' && path === '/nickname') {
      const body = await parseBody(req);
      if (!body.name) {
        sendError(res, 'Missing name parameter');
        return;
      }
      await axi.setNickname(body.name);
      sendSuccess(res, { nickname: body.name });
      return;
    }

    if (method === 'POST' && path === '/reboot') {
      await axi.reboot();
      sendSuccess(res, { message: 'Rebooting...' });
      return;
    }

    if (method === 'POST' && path === '/reset') {
      await axi.reset();
      sendSuccess(res);
      return;
    }

    // ==================== Pen Control ====================
    if (method === 'POST' && path === '/pen/up') {
      const time = await axi.penUp();
      sendSuccess(res, { time });
      return;
    }

    if (method === 'POST' && path === '/pen/down') {
      const time = await axi.penDown();
      sendSuccess(res, { time });
      return;
    }

    if (method === 'POST' && path === '/pen/toggle') {
      const time = await axi.penToggle();
      sendSuccess(res, { time, isUp: axi.servo?.isUp });
      return;
    }

    if (method === 'GET' && path === '/pen/status') {
      const status = axi.servo?.getStatus() || null;
      sendJSON(res, { pen: status });
      return;
    }

    if (method === 'POST' && path === '/pen/config') {
      const body = await parseBody(req);
      await axi.configurePen(body);
      sendSuccess(res, { config: axi.servo?.getStatus()?.config });
      return;
    }

    // ==================== Motion ====================
    if (method === 'POST' && path === '/home') {
      const body = await parseBody(req);
      await axi.home(body.rate);
      sendSuccess(res);
      return;
    }

    if (method === 'POST' && path === '/move') {
      const body = await parseBody(req);
      if (body.dx === undefined || body.dy === undefined) {
        sendError(res, 'Missing dx or dy parameters');
        return;
      }
      const units = body.units || 'mm';
      const coalesceMs = parseInt(url.searchParams.get('coalesce') || '0', 10);

      if (coalesceMs > 0) {
        // Buffer the movement and flush after coalesceMs
        const position = await addToCoalesceBuffer('move', body.dx, body.dy, units, coalesceMs, axi);
        sendSuccess(res, { buffered: true, position });
        return;
      }

      await axi.move(body.dx, body.dy, units);
      sendSuccess(res, { position: axi.motion?.getPosition() });
      return;
    }

    if (method === 'POST' && path === '/moveto') {
      const body = await parseBody(req);
      if (body.x === undefined || body.y === undefined) {
        sendError(res, 'Missing x or y parameters');
        return;
      }
      await axi.moveTo(body.x, body.y, body.units || 'mm');
      sendSuccess(res, { position: axi.motion?.getPosition() });
      return;
    }

    if (method === 'POST' && path === '/lineto') {
      const body = await parseBody(req);
      if (body.dx === undefined || body.dy === undefined) {
        sendError(res, 'Missing dx or dy parameters');
        return;
      }
      const units = body.units || 'mm';
      const coalesceMs = parseInt(url.searchParams.get('coalesce') || '0', 10);

      if (coalesceMs > 0) {
        // Buffer the movement and flush after coalesceMs
        const position = await addToCoalesceBuffer('lineto', body.dx, body.dy, units, coalesceMs, axi);
        sendSuccess(res, { buffered: true, position });
        return;
      }

      await axi.lineTo(body.dx, body.dy, units);
      sendSuccess(res, { position: axi.motion?.getPosition() });
      return;
    }

    if (method === 'POST' && path === '/execute') {
      const body = await parseBody(req);
      if (!Array.isArray(body.commands)) {
        sendError(res, 'Missing commands array');
        return;
      }
      await axi.execute(body.commands);
      sendSuccess(res, { position: axi.motion?.getPosition() });
      return;
    }

    if (method === 'POST' && path === '/batch') {
      const body = await parseBody(req);
      if (!Array.isArray(body.commands)) {
        sendError(res, 'Missing commands array');
        return;
      }

      const results = [];
      for (const cmd of body.commands) {
        if (!cmd.endpoint) {
          results.push({ error: 'Missing endpoint' });
          continue;
        }

        try {
          const result = await executeBatchCommand(cmd.endpoint, cmd.body || {});
          results.push({ endpoint: cmd.endpoint, success: true, ...result });
        } catch (e) {
          results.push({ endpoint: cmd.endpoint, success: false, error: e.message });
        }
      }

      sendSuccess(res, { results, position: axi.motion?.getPosition() });
      return;
    }

    if (method === 'GET' && path === '/position') {
      const position = axi.motion?.getPosition() || null;
      sendJSON(res, { position });
      return;
    }

    if (method === 'GET' && path === '/speed') {
      sendJSON(res, {
        speed: {
          penDown: axi.motion?.speedPenDown ?? SPEED_PEN_DOWN,
          penUp: axi.motion?.speedPenUp ?? SPEED_PEN_UP,
          units: 'inches/sec'
        }
      });
      return;
    }

    if (method === 'POST' && path === '/speed') {
      const body = await parseBody(req);
      const speeds = {};
      if (body.penDown !== undefined) {
        speeds.penDown = parseFloat(body.penDown);
      }
      if (body.penUp !== undefined) {
        speeds.penUp = parseFloat(body.penUp);
      }
      if (Object.keys(speeds).length === 0) {
        sendError(res, 'Missing penDown or penUp parameter');
        return;
      }
      if (axi.motion) {
        axi.motion.updateSpeeds(speeds);
      }
      sendSuccess(res, {
        speed: {
          penDown: axi.motion?.speedPenDown ?? SPEED_PEN_DOWN,
          penUp: axi.motion?.speedPenUp ?? SPEED_PEN_UP,
          units: 'inches/sec'
        }
      });
      return;
    }

    if (method === 'POST' && path === '/motors/on') {
      await axi.motorsOn();
      sendSuccess(res);
      return;
    }

    if (method === 'POST' && path === '/motors/off') {
      await axi.motorsOff();
      sendSuccess(res);
      return;
    }

    if (method === 'POST' && path === '/stop') {
      await axi.emergencyStop();
      sendSuccess(res, { message: 'Emergency stop executed' });
      return;
    }

    // ==================== Queue ====================
    if (method === 'GET' && path === '/queue') {
      sendJSON(res, {
        status: queue.getStatus(),
        jobs: queue.getQueue()
      });
      return;
    }

    if (method === 'POST' && path === '/queue') {
      const body = await parseBody(req);
      if (!body.type || !body.data) {
        sendError(res, 'Missing type or data');
        return;
      }
      const job = queue.add({
        type: body.type,
        data: body.data,
        name: body.name,
        priority: body.priority ?? JobPriority.NORMAL,
        metadata: body.metadata
      });
      sendSuccess(res, { job: job.toJSON() });
      return;
    }

    if (method === 'DELETE' && path.startsWith('/queue/')) {
      const id = path.slice(7);
      const success = await queue.cancel(id);
      if (success) {
        sendSuccess(res);
      } else {
        sendError(res, 'Job not found or cannot be cancelled', 404);
      }
      return;
    }

    if (method === 'POST' && path === '/queue/pause') {
      queue.pause();
      sendSuccess(res);
      return;
    }

    if (method === 'POST' && path === '/queue/resume') {
      queue.resume();
      sendSuccess(res);
      return;
    }

    if (method === 'POST' && path === '/queue/clear') {
      const count = queue.clear();
      sendSuccess(res, { cleared: count });
      return;
    }

    if (method === 'GET' && path === '/queue/history') {
      const limit = parseInt(url.searchParams.get('limit') || '50', 10);
      sendJSON(res, { history: queue.getHistory(limit) });
      return;
    }

    // ==================== SVG ====================
    if (method === 'POST' && path === '/svg') {
      const body = await parseBody(req);
      if (!body.svg) {
        sendError(res, 'Missing svg data');
        return;
      }
      const parser = new SVGParser(body.options || {});
      const commands = await parser.parse(body.svg);
      const job = queue.add({
        type: 'commands',
        data: commands,
        name: body.name || 'SVG Plot',
        priority: body.priority ?? JobPriority.NORMAL,
        metadata: { svgBounds: parser.bounds }
      });
      sendSuccess(res, {
        job: job.toJSON(),
        commandCount: commands.length,
        bounds: parser.bounds
      });
      return;
    }

    if (method === 'POST' && path === '/svg/upload') {
      const contentType = req.headers['content-type'] || '';
      if (!contentType.includes('multipart/form-data')) {
        sendError(res, 'Expected multipart/form-data');
        return;
      }

      const { fields, files } = await parseMultipart(req);
      const svgFile = files.file || files.svg;
      if (!svgFile) {
        sendError(res, 'Missing file field in form data');
        return;
      }

      const svgString = svgFile.data.toString('utf8');
      const options = fields.options ? JSON.parse(fields.options) : {};
      const parser = new SVGParser(options);
      const commands = await parser.parse(svgString);
      const job = queue.add({
        type: 'commands',
        data: commands,
        name: fields.name || svgFile.filename || 'SVG Upload',
        priority: parseInt(fields.priority || '1', 10),
        metadata: { svgBounds: parser.bounds, filename: svgFile.filename }
      });
      sendSuccess(res, {
        job: job.toJSON(),
        commandCount: commands.length,
        bounds: parser.bounds,
        filename: svgFile.filename
      });
      return;
    }

    if (method === 'POST' && path === '/svg/preview') {
      const body = await parseBody(req);
      if (!body.svg) {
        sendError(res, 'Missing svg data');
        return;
      }
      const parser = new SVGParser(body.options || {});
      const commands = await parser.parse(body.svg);
      sendJSON(res, {
        commands,
        commandCount: commands.length,
        bounds: parser.bounds
      });
      return;
    }

    // 404 - Not found
    sendError(res, `Unknown endpoint: ${method} ${path}`, 404);

  } catch (err) {
    console.error(`[HTTP] Error: ${err.message}`);
    sendError(res, err.message, 500);
  }
}

// Format documentation as plain text
function formatDocs(docs) {
  let text = `
${docs.name} v${docs.version}
${'='.repeat(40)}
${docs.description}

Base URL: ${docs.baseUrl}

ENDPOINTS
---------
`;

  for (const [endpoint, desc] of Object.entries(docs.endpoints)) {
    text += `${endpoint.padEnd(30)} ${desc}\n`;
  }

  text += `
COMMAND TYPES
-------------
`;
  for (const [type, schema] of Object.entries(docs.commandTypes)) {
    text += `${type.padEnd(15)} ${schema}\n`;
  }

  text += `
UNITS
-----
${docs.units.join(', ')}

PRIORITIES
----------
${Object.entries(docs.priorities).map(([k, v]) => `${k}=${v}`).join(', ')}

CONFIGURATION (Environment Variables)
-------------------------------------
`;
  for (const [key, desc] of Object.entries(docs.configuration)) {
    text += `${key.padEnd(25)} ${desc}\n`;
  }

  text += `
WEBSOCKET MESSAGES
------------------
`;
  for (const [type, schema] of Object.entries(docs.websocketMessages)) {
    text += `${type.padEnd(15)} ${schema}\n`;
  }

  text += `
SPATIAL PROCESSING
------------------
`;
  for (const [key, desc] of Object.entries(docs.spatialProcessing)) {
    text += `${key.padEnd(20)} ${desc}\n`;
  }

  return text;
}

// Create and start server
const server = http.createServer(handleRequest);

// ==================== WebSocket Server ====================

// Create WebSocket server attached to HTTP server
const wss = new WebSocketServer({ server });

// Spatial processor instance (created per connection or shared)
let spatialProcessor = null;

// Track connected WebSocket clients
const wsClients = new Set();

/**
 * Initialize spatial processor with AxiDraw integration
 */
function initSpatialProcessor() {
  if (spatialProcessor) {
    spatialProcessor.stop();
  }

  // Get workspace bounds from the AxiDraw model
  const modelConfig = AXIDRAW_MODELS[MODEL] || AXIDRAW_MODELS.V2_V3;

  spatialProcessor = new SpatialProcessor({
    // Bounds from AxiDraw model
    minX: 0,
    maxX: modelConfig.xTravel,
    minY: 0,
    maxY: modelConfig.yTravel,

    // Processing parameters (matching websocket-spatial-streaming.json)
    deadzone: 0.08,
    velocityCurve: 'cubic',
    maxLinearSpeed: 200.0,
    maxAngularSpeed: 6.0,
    linearDamping: 0.92,
    angularDamping: 0.96,
    smoothingAlpha: 0.15,
    tickRate: 120,
    networkLatency: 15,
    movementThreshold: 0.1,

    // Movement callback - send to AxiDraw
    onMovement: async (movement) => {
      if (axi.state !== AxiDrawState.READY && axi.state !== AxiDrawState.BUSY) {
        return;
      }

      try {
        if (movement.penDown) {
          await axi.lineTo(movement.dx, movement.dy, 'mm');
        } else {
          await axi.move(movement.dx, movement.dy, 'mm');
        }
      } catch (e) {
        console.error('[SpatialProcessor] Movement error:', e.message);
      }
    },

    // State update callback - broadcast to clients
    onStateUpdate: (state) => {
      const message = JSON.stringify({
        type: 'state',
        ts: Date.now(),
        position: state.position,
        velocity: state.velocity,
        orientation: state.orientation,
        angularVelocity: state.angularVelocity,
        penDown: spatialProcessor.penDown
      });

      for (const client of wsClients) {
        if (client.readyState === 1) { // WebSocket.OPEN
          client.send(message);
        }
      }
    }
  });

  // Sync initial position from AxiDraw
  const position = axi.motion?.getPosition();
  if (position?.mm) {
    spatialProcessor.syncPosition(position.mm);
  }

  return spatialProcessor;
}

/**
 * Handle WebSocket connection
 */
wss.on('connection', (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;

  console.log(`[WebSocket] Connection on ${path}`);

  // Only handle /spatial and /controller paths
  if (path !== '/spatial' && path !== '/controller') {
    ws.close(4000, 'Invalid path. Use /spatial or /controller');
    return;
  }

  wsClients.add(ws);

  // Initialize spatial processor on first connection
  if (!spatialProcessor) {
    initSpatialProcessor();
  }

  // Start processing if not already running
  if (!spatialProcessor.tickInterval) {
    spatialProcessor.start();
  }

  // Send initial state
  const state = spatialProcessor.getState();
  ws.send(JSON.stringify({
    type: 'connected',
    ts: Date.now(),
    config: spatialProcessor.getConfig(),
    position: state.position,
    penDown: spatialProcessor.penDown
  }));

  // Handle incoming messages
  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());
      handleWebSocketMessage(ws, message, path);
    } catch (e) {
      console.error('[WebSocket] Parse error:', e.message);
      ws.send(JSON.stringify({ type: 'error', error: 'Invalid JSON' }));
    }
  });

  // Handle disconnect
  ws.on('close', () => {
    console.log('[WebSocket] Client disconnected');
    wsClients.delete(ws);

    // Stop processor if no clients connected
    if (wsClients.size === 0 && spatialProcessor) {
      spatialProcessor.stop();
    }
  });

  ws.on('error', (err) => {
    console.error('[WebSocket] Error:', err.message);
    wsClients.delete(ws);
  });
});

/**
 * Handle WebSocket message
 */
async function handleWebSocketMessage(ws, message, path) {
  const { type } = message;

  switch (type) {
    // New spatial streaming format (from websocket-spatial-streaming.json)
    case 'spatial':
      spatialProcessor.processSpatialState(message);
      break;

    // Old raw state format (from websocket-streaming.json)
    case 'state':
      spatialProcessor.processRawState(message);
      break;

    // Button events
    case 'button':
      spatialProcessor.handleButtonEvent(message.button, message.state);
      // Handle AxiDraw-specific button actions
      if (message.state === 'pressed') {
        switch (message.button) {
          case 'cross':
            await axi.penDown();
            spatialProcessor.penDown = true;
            break;
          case 'circle':
            await axi.penUp();
            spatialProcessor.penDown = false;
            break;
          case 'triangle':
            await axi.home();
            spatialProcessor.handleActionEvent('home');
            break;
          case 'options':
            await axi.emergencyStop();
            spatialProcessor.handleActionEvent('stop');
            break;
        }
      }
      break;

    // Action events (from websocket-spatial-streaming.json)
    case 'event':
      spatialProcessor.handleActionEvent(message.action);
      switch (message.action) {
        case 'pen_down':
          await axi.penDown();
          break;
        case 'pen_up':
          await axi.penUp();
          break;
        case 'stop':
          await axi.emergencyStop();
          break;
        case 'home':
          await axi.home();
          break;
      }
      break;

    // D-pad events
    case 'dpad':
      // D-pad can be used for discrete movements
      if (message.state === 'pressed') {
        const step = 5; // mm
        switch (message.direction) {
          case 'up':
            await axi.move(0, -step, 'mm');
            break;
          case 'down':
            await axi.move(0, step, 'mm');
            break;
          case 'left':
            await axi.move(-step, 0, 'mm');
            break;
          case 'right':
            await axi.move(step, 0, 'mm');
            break;
        }
      }
      break;

    // Motion/orientation events (from old format)
    case 'motion':
      // Could be used for tilt-based control in the future
      break;

    // Touch events
    case 'touch':
      // Could be used for touchpad drawing
      break;

    // System events
    case 'system':
      if (message.action === 'pause') {
        spatialProcessor.stop();
      }
      break;

    // Configuration
    case 'config':
      spatialProcessor.updateConfig(message.config);
      ws.send(JSON.stringify({
        type: 'config_updated',
        config: spatialProcessor.getConfig()
      }));
      break;

    // Sync position from hardware
    case 'sync':
      const position = axi.motion?.getPosition();
      if (position?.mm) {
        spatialProcessor.syncPosition(position.mm);
      }
      ws.send(JSON.stringify({
        type: 'synced',
        position: spatialProcessor.getState().position
      }));
      break;

    // Ping/pong for keepalive
    case 'ping':
      ws.send(JSON.stringify({ type: 'pong', ts: Date.now() }));
      break;

    default:
      console.log(`[WebSocket] Unknown message type: ${type}`);
  }
}

// ==================== End WebSocket Server ====================

server.listen(PORT, HOST, async () => {
  console.log(`
${'='.repeat(50)}
  AxiDraw HTTP + WebSocket Server
${'='.repeat(50)}
  HTTP:      http://${HOST}:${PORT}
  WebSocket: ws://${HOST}:${PORT}/spatial

  Documentation: http://localhost:${PORT}/
  Health check:  http://localhost:${PORT}/health
  Web UI:        http://localhost:${PORT}/ui
${'='.repeat(50)}
`);

  // Auto-connect if enabled
  if (AUTO_CONNECT) {
    console.log('[Startup] Auto-connect enabled, searching for AxiDraw...');
    try {
      await axi.connect();
      console.log(`[Startup] Connected to ${axi.ebb?.portPath}`);
      await axi.initialize();
      console.log('[Startup] AxiDraw initialized and ready');
    } catch (err) {
      console.log(`[Startup] Auto-connect failed: ${err.message}`);
      console.log('[Startup] Use POST /connect to connect manually');
    }
  }
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n[Shutdown] Received SIGINT, shutting down...');
  try {
    await axi.disconnect();
  } catch (e) {
    // Ignore
  }
  server.close(() => {
    console.log('[Shutdown] Server closed');
    process.exit(0);
  });
});

process.on('SIGTERM', async () => {
  console.log('\n[Shutdown] Received SIGTERM, shutting down...');
  try {
    await axi.disconnect();
  } catch (e) {
    // Ignore
  }
  server.close(() => {
    console.log('[Shutdown] Server closed');
    process.exit(0);
  });
});

export default server;
