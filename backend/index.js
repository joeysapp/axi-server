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
import { setupWebSocketServer } from './api/websocket.js';
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

	// Capture accumulated movements and pending resolvers synchronously
	const movements = [];
	for (const units of ['mm', 'inches', 'steps']) {
		const { dx, dy } = buffer[units];
		if (dx !== 0 || dy !== 0) {
			movements.push({ units, dx, dy });
			buffer[units].dx = 0;
			buffer[units].dy = 0;
		}
	}

	const pending = buffer.pending;
	buffer.pending = [];

 // [TODO] I believe this is where we need to use our batch command functionality
	// Process each unit type that has accumulated movement
	for (const { units, dx, dy } of movements) {
		try {
			if (type === 'move') {
				await axi.move(dx, dy, units);
			} else {
				await axi.lineTo(dx, dy, units);
			}
		} catch (e) {
			console.error(`[Coalesce] Error flushing ${type} (${units}):`, e.message);
		}
	}

	// Resolve all pending responses
	const position = axi.motion?.getPosition();
	for (const resolve of pending) {
		resolve(position);
	}
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
const NARROW_BAND = process.env.AXIDRAW_NARROW_BAND !== 'false'; // Default to true as requested
const MODEL = process.env.AXIDRAW_MODEL || 'V2_V3';

// Speed configuration (inches per second)
// Lowered defaults to prevent loud stepper chatter since XM uses constant velocity (no accel planner)
const SPEED_PEN_DOWN = parseFloat(process.env.AXIDRAW_SPEED_DOWN || '0.3');
const SPEED_PEN_UP = parseFloat(process.env.AXIDRAW_SPEED_UP || '0.6');

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
	*/
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const MIME_TYPES = {
	'.html': 'text/html',
	'.js': 'text/javascript',
	'.css': 'text/css',
	'.json': 'application/json',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.gif': 'image/gif',
	'.svg': 'image/svg+xml',
	'.wav': 'audio/wav',
	'.mp4': 'video/mp4',
	'.woff': 'application/font-woff',
	'.ttf': 'application/font-ttf',
	'.eot': 'application/vnd.ms-fontobject',
	'.otf': 'application/font-otf',
	'.wasm': 'application/wasm',
	'.ico': 'image/x-icon',
};

/**
	* Serve a static file with correct MIME type
	*/
function serveStatic(res, filePath) {
	try {
		if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
			// If it's a directory or doesn't exist, try index.html for SPA routing
			const indexHtml = path.join(__dirname, 'public', 'index.html');
			if (fs.existsSync(indexHtml)) {
				filePath = indexHtml;
			} else {
				sendError(res, 'File not found', 404);
				return;
			}
		}

		const ext = path.extname(filePath).toLowerCase();
		const contentType = MIME_TYPES[ext] || 'application/octet-stream';

		res.writeHead(200, {
			'Content-Type': contentType,
			'Access-Control-Allow-Origin': '*',
			'Cache-Control': 'public, max-age=3600'
		});

		const stream = fs.createReadStream(filePath);
		stream.pipe(res);
	} catch (err) {
		console.error(`[Static] Error serving ${filePath}:`, err.message);
		sendError(res, 'Internal server error', 500);
	}
}

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
	name: 'AxiDraw',
	version: '1.0.0',
 description: 'Control Dashboard for AxiDraw plotters',
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
		'POST /pen/sync': 'Sync pen state with hardware',
		'GET /pen/status': 'Get pen status',
		'POST /pen/config': 'Configure pen settings (body: { posUp?, posDown?, rateRaise?, rateLower?, delayUp?, delayDown? })',
		'POST /config': 'Universal configuration endpoint (body: { penDownSpeed?, penUpSpeed?, posUp?, posDown?, rateRaise?, rateLower? })',

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
	 // tickRate: '120 Hz - fixed update rate for velocity integration',	 
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
			let parsed = {};
			if (body) {
				try {
					parsed = JSON.parse(body);
				} catch (e) {
					reject(new Error('Invalid JSON body'));
					return;
				}
			}
			if (process.env.AXIDRAW_DEBUG) {
				console.log(`[REST RECV] ${new Date().toISOString()} ${req.method} ${req.url}`, JSON.stringify(parsed));
			}
			resolve(parsed);
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
	const pathname = url.pathname;
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

	console.log(`[HTTP] ${method} ${pathname}`);

	try {
		// Route handling
		// ==================== Web UI ====================
		if (method === 'GET' && (pathname === '/ui' || pathname.startsWith('/ui/'))) {
			// Serve index.html for /ui and any sub-routes (SPA)
			const filePath = path.join(__dirname, 'public', 'index.html');
			serveStatic(res, filePath);
			return;
		}

		// Serve assets (anything with an extension that isn't an API call)
		const hasExtension = pathname.includes('.');
		if (method === 'GET' && hasExtension && !pathname.startsWith('/api/')) {
			// Try to serve from public directory
			const relativePath = pathname.startsWith('/assets/') ? pathname : pathname.replace(/^\//, '');
			const filePath = path.join(__dirname, 'public', relativePath);
			
			if (fs.existsSync(filePath)) {
				serveStatic(res, filePath);
				return;
			}
			// Fall through to 404 if not found
		}

		// ==================== Status & Info ====================
		if (method === 'GET' && pathname === '/') {
			// Return docs as formatted text
			res.writeHead(200, {
				'Content-Type': 'text/plain',
				'Access-Control-Allow-Origin': '*'
			});
			res.end(formatDocs(API_DOCS));
			return;
		}

		if (method === 'GET' && pathname === '/info') {
			sendJSON(res, API_DOCS);
			return;
		}

		if (method === 'GET' && pathname === '/health') {
			const status = await axi.getStatus(false);
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

		if (method === 'GET' && pathname === '/status') {
			const queryHardware = url.searchParams.get('hardware') === 'true';
			const status = await axi.getStatus(queryHardware);
			sendJSON(res, status);
			return;
		}

		if (method === 'GET' && pathname === '/history') {
			const limit = parseInt(url.searchParams.get('limit') || '100', 10);
			sendJSON(res, { history: axi.getHistory(limit) });
			return;
		}

		if (method === 'GET' && pathname === '/ports') {
			const ports = await EBBSerial.listPorts();
			sendJSON(res, { ports });
			return;
		}

		// ==================== Connection ====================
		if (method === 'POST' && pathname === '/connect') {
			const body = await parseBody(req);
			await axi.connect(body.port);
			sendSuccess(res, { port: axi.ebb?.portPath });
			return;
		}

		if (method === 'POST' && pathname === '/disconnect') {
			await axi.disconnect();
			sendSuccess(res);
			return;
		}

		if (method === 'POST' && pathname === '/initialize') {
			await axi.initialize();
			sendSuccess(res, { state: axi.state });
			return;
		}

		// ==================== Device ====================
		if (method === 'GET' && pathname === '/version') {
			const version = await axi.getVersion();
			sendJSON(res, { version });
			return;
		}

		if (method === 'GET' && pathname === '/nickname') {
			const info = await axi.getInfo();
			sendJSON(res, { nickname: info?.nickname || null });
			return;
		}

		if (method === 'POST' && pathname === '/nickname') {
			const body = await parseBody(req);
			if (!body.name) {
				sendError(res, 'Missing name parameter');
				return;
			}
			await axi.setNickname(body.name);
			sendSuccess(res, { nickname: body.name });
			return;
		}

		if (method === 'POST' && pathname === '/reboot') {
			await axi.reboot();
			sendSuccess(res, { message: 'Rebooting...' });
			return;
		}

		if (method === 'POST' && pathname === '/reset') {
			await axi.reset();
			sendSuccess(res);
			return;
		}

		// ==================== Pen Control ====================
		if (method === 'POST' && pathname === '/pen/up') {
			const time = await axi.penUp();
			sendSuccess(res, { time });
			return;
		}

		if (method === 'POST' && pathname === '/pen/down') {
			const time = await axi.penDown();
			sendSuccess(res, { time });
			return;
		}

		if (method === 'POST' && pathname === '/pen/toggle') {
			const time = await axi.penToggle();
			sendSuccess(res, { time, isUp: axi.servo?.isUp });
			return;
		}

		if (method === 'POST' && pathname === '/pen/sync') {
			const isUp = await axi.syncPenState();
			sendSuccess(res, { isUp });
			return;
		}

		if (method === 'GET' && pathname === '/pen/status') {
			const status = axi.servo?.getStatus() || null;
			sendJSON(res, { pen: status });
			return;
		}

		if (method === 'POST' && pathname === '/pen/config') {
			const body = await parseBody(req);
			await axi.configurePen(body);
			sendSuccess(res, { config: axi.servo?.getStatus()?.config });
			return;
		}

		if (method === 'POST' && pathname === '/config') {
			const body = await parseBody(req);
			
      // Update speeds
      if (body.penDownSpeed !== undefined || body.penUpSpeed !== undefined) {
        if (axi.motion) {
          axi.motion.updateSpeeds({
            penDown: body.penDownSpeed,
            penUp: body.penUpSpeed
          });
        }
      }

      // Update pen settings
      const penConfig = {};
      if (body.posUp !== undefined) penConfig.posUp = body.posUp;
      if (body.posDown !== undefined) penConfig.posDown = body.posDown;
      if (body.rateRaise !== undefined) penConfig.rateRaise = body.rateRaise;
      if (body.rateLower !== undefined) penConfig.rateLower = body.rateLower;
      
      if (Object.keys(penConfig).length > 0) {
        await axi.configurePen(penConfig);
      }

			sendSuccess(res, { 
        speed: axi.motion?.getStatus()?.speed,
        pen: axi.servo?.getStatus()?.config
      });
			return;
		}

		// ==================== Motion ====================
		if (method === 'POST' && pathname === '/home') {
			const body = await parseBody(req);
			await axi.home(body.rate);
			sendSuccess(res);
			return;
		}

		if (method === 'POST' && pathname === '/move') {
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

		if (method === 'POST' && pathname === '/moveto') {
			const body = await parseBody(req);
			if (body.x === undefined || body.y === undefined) {
				sendError(res, 'Missing x or y parameters');
				return;
			}
			await axi.moveTo(body.x, body.y, body.units || 'mm');
			sendSuccess(res, { position: axi.motion?.getPosition() });
			return;
		}

		if (method === 'POST' && pathname === '/lineto') {
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

		if (method === 'POST' && pathname === '/execute') {
			const body = await parseBody(req);
			if (!Array.isArray(body.commands)) {
				sendError(res, 'Missing commands array');
				return;
			}
			await axi.execute(body.commands);
			sendSuccess(res, { position: axi.motion?.getPosition() });
			return;
		}

		if (method === 'POST' && pathname === '/batch') {
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

		if (method === 'GET' && pathname === '/position') {
			const position = axi.motion?.getPosition() || null;
			sendJSON(res, { position });
			return;
		}

		if (method === 'GET' && pathname === '/speed') {
			sendJSON(res, {
				speed: {
					penDown: axi.motion?.speedPenDown ?? SPEED_PEN_DOWN,
					penUp: axi.motion?.speedPenUp ?? SPEED_PEN_UP,
					units: 'inches/sec'
				}
			});
			return;
		}

		if (method === 'POST' && pathname === '/speed') {
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

		if (method === 'POST' && pathname === '/motors/on') {
			await axi.motorsOn();
			sendSuccess(res);
			return;
		}

		if (method === 'POST' && pathname === '/motors/off') {
			await axi.motorsOff();
			sendSuccess(res);
			return;
		}

		if (method === 'POST' && pathname === '/stop') {
			await axi.emergencyStop();
			sendSuccess(res, { message: 'Emergency stop executed' });
			return;
		}

		// ==================== Queue ====================
		if (method === 'GET' && pathname === '/queue') {
			sendJSON(res, {
				status: queue.getStatus(),
				jobs: queue.getQueue()
			});
			return;
		}

		if (method === 'POST' && pathname === '/queue') {
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

		if (method === 'DELETE' && pathname.startsWith('/queue/')) {
			const id = pathname.slice(7);
			const success = await queue.cancel(id);
			if (success) {
				sendSuccess(res);
			} else {
				sendError(res, 'Job not found or cannot be cancelled', 404);
			}
			return;
		}

		if (method === 'POST' && pathname === '/queue/pause') {
			queue.pause();
			sendSuccess(res);
			return;
		}

		if (method === 'POST' && pathname === '/queue/resume') {
			queue.resume();
			sendSuccess(res);
			return;
		}

		if (method === 'POST' && pathname === '/queue/clear') {
			const count = queue.clear();
			sendSuccess(res, { cleared: count });
			return;
		}

		if (method === 'GET' && pathname === '/queue/history') {
			const limit = parseInt(url.searchParams.get('limit') || '50', 10);
			sendJSON(res, { history: queue.getHistory(limit) });
			return;
		}

		// ==================== SVG ====================
		if (method === 'POST' && pathname === '/svg') {
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

		if (method === 'POST' && pathname === '/svg/upload') {
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

		if (method === 'POST' && pathname === '/svg/preview') {
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

		// ==================== Path State ====================
		if (method === 'GET' && pathname === '/path') {
			const history = axi.pathHistory || [];
			let svgPath = '';
			for (const point of history) {
				if (point.action === 'pen_up' || point.action === 'pen_down') continue;
				const cmd = point.penDown ? 'L' : 'M';
				svgPath += `${cmd} ${point.x.toFixed(2)} ${point.y.toFixed(2)} `;
			}

			const bounds = axi.motion?.getStatus()?.bounds?.mm || { maxX: 300, maxY: 218 };

			const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${bounds.maxX} ${bounds.maxY}" width="100%" height="100%">
  <path d="${svgPath.trim()}" fill="none" stroke="#000000" stroke-width="0.5" stroke-linejoin="round" stroke-linecap="round" />
</svg>`;

			sendJSON(res, {
				path: history,
				svg,
				bounds
			});
			return;
		}

		if (method === 'POST' && pathname === '/path/clear') {
			axi.clearPathHistory?.();
			sendSuccess(res, { message: 'Path history cleared' });
			return;
		}

		// 404 - Not found
		sendError(res, `Unknown endpoint: ${method} ${pathname}`, 404);

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

const wss = setupWebSocketServer(server, axi, { MODEL });

server.listen(PORT, HOST, async () => {
	const listenHost = HOST === '0.0.0.0' ? 'localhost' : HOST;
	console.log(`
${'='.repeat(50)}
  AxiDraw HTTP + WebSocket Server
${'='.repeat(50)}
  HTTP:      http://${HOST}:${PORT}
  WebSocket: ws://${HOST}:${PORT}/spatial

  Documentation: http://${listenHost}:${PORT}/
  Health check:  http://${listenHost}:${PORT}/health
  Web UI:        http://${listenHost}:${PORT}/ui
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
	if (wss) {
		for (const client of wss.clients) {
			client.terminate();
		}
	}
	server.closeAllConnections?.();
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
	if (wss) {
		for (const client of wss.clients) {
			client.terminate();
		}
	}
	server.closeAllConnections?.();
	server.close(() => {
		console.log('[Shutdown] Server closed');
		process.exit(0);
	});
});

export default server;

process.on('uncaughtException', async (err) => {
 console.error(err);
 console.log('Disconnecting axi');
	try {
		await axi.disconnect();
	} catch (e) {
		// Ignore
	}
});
