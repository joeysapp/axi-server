import { WebSocketServer } from 'ws';
import { SpatialProcessor } from '../lib/spatial-processor.js';
import { AXIDRAW_MODELS, AxiDrawState } from '../lib/axidraw.js';

export function setupWebSocketServer(server, axi, config) {
	const { MODEL } = config;

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
			// Bounds from AxiDraw model (converted to mm)
			minX: 0,
			maxX: modelConfig.xTravel * 25.4,
			minY: 0,
			maxY: modelConfig.yTravel * 25.4,

			// Processing parameters
			deadzone: 0.08,
			velocityCurve: 'cubic',
			maxLinearSpeed: 200.0,
			maxAngularSpeed: 6.0,
			linearDamping: 0.92,
			angularDamping: 0.96,
		 smoothingAlpha: 0.15,
		 // Did not work:
		 // tickRate: 240,
		 tickRate: 120,		 
		 networkLatency: 15,
		 // We accumulate momvemnts until we have over half of a mm..
		 // .. so this slightly reduces the sound, but it does reduce responsiveness too..
		 // movementThreshold:0.20,		 
		 movementThreshold: 0.1,

			// Movement callback - send to AxiDraw
			onMovement: async (movement) => {
				if (axi.state !== AxiDrawState.READY && axi.state !== AxiDrawState.BUSY) {
					return;
				}

				try {
					let duration = 0;
					if (movement.penDown) {
						duration = await axi.lineTo(movement.dx, movement.dy, 'mm');
					} else {
						duration = await axi.move(movement.dx, movement.dy, 'mm');
					}

					if (duration > 0) {
						await new Promise(resolve => setTimeout(resolve, duration));
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

		if (path !== '/spatial') {
			ws.close(4000, 'Invalid path. Use /spatial');
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
				if (process.env.AXIDRAW_DEBUG) {
					console.log(`[WS RECV] ${new Date().toISOString()} ${JSON.stringify(message)}`);
				}
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
			case 'spatial':
				spatialProcessor.processSpatialState(message);
				break;

			case 'button':
				spatialProcessor.handleButtonEvent(message.button, message.state);
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

			case 'event':
				spatialProcessor.handleActionEvent(message.action);
				switch (message.action) {
					case 'pen_down':
						await axi.penDown();
						break;
					case 'pen_up':
						await axi.penUp();
						break;
					case 'pen_toggle':
						await axi.penToggle();
						// Sync pen state just in case it got out of sync
						spatialProcessor.penDown = !axi.servo?.isUp;
						break;
					case 'stop':
						await axi.emergencyStop();
						break;
					case 'home':
						await axi.home();
						break;
					case 'version':
						const version = await axi.getVersion();
						ws.send(JSON.stringify({
							type: 'version',
							version,
						}));
						break;

					case 'nickname':
						const nickname = await axi.getNickname();
						ws.send(JSON.stringify({
							type: 'nickname',
							nickname,
						}));
						break;
					case 'reset':
						await axi.reset();
						break;
					case 'reboot':
						await axi.reboot();
						break;
				}
				break;

			case 'dpad':
				if (message.state === 'pressed') {
					const step = 5;
					switch (message.direction) {
						case 'up': await axi.move(0, -step, 'mm'); break;
						case 'down': await axi.move(0, step, 'mm'); break;
						case 'left': await axi.move(-step, 0, 'mm'); break;
						case 'right': await axi.move(step, 0, 'mm'); break;
					}
				}
				break;

			case 'motion':
			case 'touch':
				break;

			case 'system':
				if (message.action === 'pause') {
					spatialProcessor.stop();
				}
				break;

			case 'config':
				spatialProcessor.updateConfig(message.config);
				ws.send(JSON.stringify({
					type: 'config_updated',
					config: spatialProcessor.getConfig()
				}));
				break;

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

			case 'ping':
				ws.send(JSON.stringify({ type: 'pong', ts: Date.now() }));
				break;

			default:
				console.log(`[WebSocket] Unknown message type: ${type}`);
		}
	}

	return wss;
}
