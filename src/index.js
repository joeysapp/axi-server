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
import { AxiDraw, AXIDRAW_MODELS, AxiDrawState } from './lib/axidraw.js';
import { JobQueue, JobState, JobPriority } from './lib/job-queue.js';
import { SVGParser } from './lib/svg-parser.js';
import { EBBSerial } from './lib/ebb-serial.js';

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
    'POST /move': 'Relative move (pen up) - body: { dx, dy, units?: "mm"|"inches"|"steps" }',
    'POST /moveto': 'Absolute move (pen up) - body: { x, y, units?: "mm"|"inches"|"steps" }',
    'POST /lineto': 'Draw line (pen down) - body: { dx, dy, units?: "mm"|"inches"|"steps" }',
    'POST /execute': 'Execute command sequence - body: { commands: [...] }',
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
    'POST /svg/preview': 'Parse SVG and return commands without drawing - body: { svg: string, options? }'
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
      await axi.move(body.dx, body.dy, body.units || 'mm');
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
      await axi.lineTo(body.dx, body.dy, body.units || 'mm');
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

  return text;
}

// Create and start server
const server = http.createServer(handleRequest);

server.listen(PORT, HOST, async () => {
  console.log(`
${'='.repeat(50)}
  AxiDraw HTTP Server
${'='.repeat(50)}
  Listening on: http://${HOST}:${PORT}
  Documentation: http://localhost:${PORT}/
  Health check: http://localhost:${PORT}/health
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
