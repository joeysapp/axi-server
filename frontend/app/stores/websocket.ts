/**
 * websocketStore.ts
 *
 * A useSyncExternalStore compatible store for AxiDraw spatial state and status.
 */

export interface RemoteClient {
	id: string;
	name: string;
	color: string;
	cursor: { x: number; y: number; z: number } | null;
}

export interface SpatialState {
	connected: boolean;
	serverConnected: boolean;
	position: { x: number; y: number };
	velocity: { x: number; y: number };
	orientation: { x: number; y: number; z: number; w: number };
	acceleration?: { x: number; y: number; z: number };
	angularVelocity: { x: number; y: number; z: number };
	penDown: boolean;
	config: any;
	version: string | null;
	nickname: string | null;
	messages: any[];
	lastUpdate: number;
	reconnectAttempts: number;
	lastError: string | null;
	serialState: any;
	state?: string;
	clientId: string | null;
	clientColor: string | null;
	controllerId: string | null;
	remoteClients: Record<string, RemoteClient>;
}

let state: SpatialState = {
	connected: false,
	serverConnected: false,
	position: { x: 0, y: 0 },
	velocity: { x: 0, y: 0 },
	orientation: { x: 0, y: 0, z: 0, w: 1 },
	angularVelocity: { x: 0, y: 0, z: 0 },
	penDown: false,
	config: null,
	version: null,
	nickname: null,
	messages: [],
	lastUpdate: Date.now(),
	reconnectAttempts: 0,
	lastError: null,
	serialState: null,
	state: 'idle',
	clientId: null,
	clientColor: null,
	controllerId: null,
	remoteClients: {},
};

const listeners = new Set<() => void>();
let emitTimer: number | null = null;
const MAX_RECONNECT_ATTEMPTS = 3;

function emitChange() {
	if (emitTimer) return;
	emitTimer = requestAnimationFrame(() => {
		emitTimer = null;
		for (const listener of listeners) {
			listener();
		}
	});
}

let ws: WebSocket | null = null;
let reconnectTimer: NodeJS.Timeout | number | null = null;
let shouldReconnect = true;

export const websocketStore = {
	subscribe(listener: () => void) {
		listeners.add(listener);
		return () => listeners.delete(listener);
	},

	getSnapshot() {
		return state;
	},

	isInControl() {
		return state.clientId !== null && state.clientId === state.controllerId;
	},

	connect(url: string) {
		if (ws) {
			ws.onclose = null;
			ws.close();
		}

		shouldReconnect = true;
		console.log(`[WebSocket] Connecting to ${url} (Attempt ${state.reconnectAttempts + 1}/${MAX_RECONNECT_ATTEMPTS})`);
		ws = new WebSocket(url);

		ws.onopen = () => {
			console.log("[WebSocket] Connected");
			state = { ...state, serverConnected: true, reconnectAttempts: 0, lastError: null };
			emitChange();
			if (reconnectTimer) {
				clearTimeout(reconnectTimer as any);
				reconnectTimer = null;
			}
		};

		ws.onmessage = (event) => {
			try {
				const data = JSON.parse(event.data);
				switch (data.type) {
					case "connected": {
						const remoteClients: Record<string, RemoteClient> = {};
						if (data.clients) {
							for (const c of data.clients) {
								remoteClients[c.id] = c;
							}
						}
						state = {
							...state,
							connected: true,
							clientId: data.clientId || null,
							clientColor: data.color || null,
							controllerId: data.controllerId ?? null,
							remoteClients,
							config: data.config,
							position: data.position || state.position,
							penDown: data.penDown !== undefined ? data.penDown : state.penDown,
							lastUpdate: Date.now(),
						};
						break;
					}
					case "state":
						state = {
							...state,
							position: data.position || state.position,
							velocity: data.velocity || state.velocity,
							acceleration: data.acceleration || state.acceleration,
							orientation: data.orientation || state.orientation,
							angularVelocity: data.angularVelocity || state.angularVelocity,
							penDown: data.penDown !== undefined ? data.penDown : state.penDown,
							lastUpdate: Date.now(),
						};
						break;
					case "control_changed":
						state = {
							...state,
							controllerId: data.controllerId,
						};
						break;
					case "client_joined": {
						const client = data.client;
						state = {
							...state,
							remoteClients: {
								...state.remoteClients,
								[client.id]: client,
							},
						};
						break;
					}
					case "client_left": {
						const { [data.clientId]: _, ...rest } = state.remoteClients;
						state = { ...state, remoteClients: rest };
						break;
					}
					case "client_cursor": {
						const existing = state.remoteClients[data.clientId];
						if (existing) {
							state = {
								...state,
								remoteClients: {
									...state.remoteClients,
									[data.clientId]: { ...existing, cursor: data.cursor },
								},
							};
						}
						break;
					}
					case "client_updated": {
						const prev = state.remoteClients[data.clientId];
						if (prev) {
							state = {
								...state,
								remoteClients: {
									...state.remoteClients,
									[data.clientId]: {
										...prev,
										name: data.name ?? prev.name,
										color: data.color ?? prev.color,
									},
								},
							};
						}
						break;
					}
					case "version":
						state = { ...state, version: data.version };
						break;
					case "nickname":
						state = { ...state, nickname: data.nickname };
						break;
					case "config_updated":
						state = { ...state, config: data.config };
						break;
					case "synced":
						state = { ...state, position: data.position };
						break;
					case "serial_state":
						state = { ...state, serialState: data };
						break;
					case "error":
						console.error("[WebSocket Error]", data.error);
						state = {
							...state,
							messages: [
								...state.messages,
								{ type: "error", text: data.error, ts: Date.now() },
							],
						};
						break;
					default:
						state = {
							...state,
							messages: [
								...state.messages.slice(-49),
								{ ...data, ts: Date.now() },
							],
						};
				}
				emitChange();
			} catch (e) {
				console.error("[WebSocket] Failed to parse message", e);
			}
		};

		ws.onclose = () => {
			console.log("[WebSocket] Disconnected");
			state = { ...state, connected: false, serverConnected: false, clientId: null, clientColor: null, controllerId: null, remoteClients: {} };
			emitChange();

			if (shouldReconnect && !reconnectTimer && state.reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
				state = { ...state, reconnectAttempts: state.reconnectAttempts + 1 };
				emitChange();

				reconnectTimer = setTimeout(() => {
					reconnectTimer = null;
					this.connect(url);
				}, 5000);
			} else if (state.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
				console.warn("[WebSocket] Max reconnect attempts reached. Halting automatic retries.");
				state = { ...state, lastError: "Max reconnect attempts reached" };
				emitChange();
			}
		};

		ws.onerror = (err) => {
			console.error("[WebSocket] Error", err);
			if (ws) ws.close();
		};
	},

	disconnect() {
		shouldReconnect = false;
		if (reconnectTimer) {
			clearTimeout(reconnectTimer as any);
			reconnectTimer = null;
		}
		if (ws) {
			ws.onclose = null;
			ws.close();
			ws = null;
		}
		state = { ...state, reconnectAttempts: 0, clientId: null, clientColor: null, controllerId: null, remoteClients: {} };
		emitChange();
	},

	send(data: any) {
		if (ws && ws.readyState === WebSocket.OPEN) {
			ws.send(JSON.stringify(data));
			return true;
		}
		return false;
	},

	emit(action: string, payload: any = {}) {
		return this.send({ type: "event", action, ...payload });
	},

	sendSpatial(spatialData: any) {
		return this.send({
			type: "spatial",
			ts: Date.now(),
			...spatialData,
		});
	},

	sendCursor(cursor: { x: number; y: number; z: number }) {
		return this.send({ type: "client_cursor", cursor });
	},

	setName(name: string) {
		return this.send({ type: "client_name", name });
	},

	penUp: () => websocketStore.emit("pen_up"),
	penDown: () => websocketStore.emit("pen_down"),
	penToggle: () => websocketStore.emit("pen_toggle"),
	penSync: () => websocketStore.emit("pen_sync"),
	home: () => websocketStore.emit("home"),
	stop: () => websocketStore.emit("stop"),
	reset: () => websocketStore.emit("reset"),
	reboot: () => websocketStore.emit("reboot"),
};
