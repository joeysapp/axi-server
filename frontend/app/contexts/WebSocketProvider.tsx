/**
 * WebSocketProvider.tsx
 *
 * Manages WebSocket lifecycle using external store pattern.
 */
import React, {
	createContext,
	useContext,
	useSyncExternalStore,
	useEffect,
	useMemo,
	type ReactNode,
} from "react";
import { websocketStore, type SpatialState } from "../stores/websocket";

interface WebSocketActions {
	send: (data: any) => boolean;
	emit: (action: string, payload?: any) => boolean;
	sendSpatial: (spatialData: any) => boolean;
	sendCursor: (cursor: { x: number; y: number; z: number }) => boolean;
	setName: (name: string) => boolean;
	penUp: () => void;
	penDown: () => void;
	penToggle: () => void;
	penSync: () => void;
	home: () => void;
	stop: () => void;
}

const WebSocketStateContext = createContext<SpatialState>(websocketStore.getSnapshot());
const WebSocketActionsContext = createContext<WebSocketActions>({
	send: () => false,
	emit: () => false,
	sendSpatial: () => false,
	sendCursor: () => false,
	setName: () => false,
	penUp: () => {},
	penDown: () => {},
	penToggle: () => {},
	penSync: () => {},
	home: () => {},
	stop: () => {},
});

export function WebSocketProvider({ children, host }: { children: ReactNode, host?: string }) {
	const state = useSyncExternalStore(
		websocketStore.subscribe,
		websocketStore.getSnapshot,
		websocketStore.getSnapshot,
	);

	useEffect(() => {
		const savedHost =
			typeof window !== "undefined" ? localStorage.getItem("axiApiHost") : null;
		const baseHost =
			host ||
			savedHost ||
			(typeof window !== "undefined"
				? window.location.origin
				: "http://localhost:9700");
		const wsHost = baseHost.replace(/^http/, "ws");
		const wsUrl = wsHost.endsWith("/spatial") ? wsHost : `${wsHost}/spatial`;

		websocketStore.connect(wsUrl);

		return () => {
			websocketStore.disconnect();
		};
	}, [host]);

	const actions = useMemo(
		() => ({
			send: websocketStore.send.bind(websocketStore),
			emit: websocketStore.emit.bind(websocketStore),
			sendSpatial: websocketStore.sendSpatial.bind(websocketStore),
			sendCursor: websocketStore.sendCursor.bind(websocketStore),
			setName: websocketStore.setName.bind(websocketStore),
			penUp: websocketStore.penUp,
			penDown: websocketStore.penDown,
			penToggle: websocketStore.penToggle,
			penSync: websocketStore.penSync,
			home: websocketStore.home,
			stop: websocketStore.stop,
		}),
		[],
	);

	return (
		<WebSocketActionsContext.Provider value={actions}>
			<WebSocketStateContext.Provider value={state}>
				{children}
			</WebSocketStateContext.Provider>
		</WebSocketActionsContext.Provider>
	);
}

export function useWebSocketState() {
	return useContext(WebSocketStateContext);
}

export function useWebSocketActions() {
	return useContext(WebSocketActionsContext);
}

export function useWebSocket() {
	const state = useContext(WebSocketStateContext);
	const actions = useContext(WebSocketActionsContext);
	return { state, ...actions };
}

export { WebSocketStateContext, WebSocketActionsContext };
