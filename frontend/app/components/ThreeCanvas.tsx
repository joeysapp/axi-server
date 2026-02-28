import { useRef, useMemo, useEffect, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import {
	TrackballControls,
	OrbitControls,
	PerspectiveCamera,
	Environment,
	Html,
} from "@react-three/drei";
import {
	useWebSocket,
	useWebSocketState,
} from "~/contexts/WebSocketProvider";
import { websocketStore, type RemoteClient } from "~/stores/websocket";
import { SpatialHUD, VectorComponent, OrientationGizmo } from "./SpatialHUD";

const CURSOR_POOL_SIZE = 16;
const CURSOR_BROADCAST_HZ = 20;

function AxiHead() {
	const headRef = useRef<THREE.Group>(null);
	const velocityArrowRef = useRef<THREE.ArrowHelper>(null);
	const orientationRef = useRef<THREE.Group>(null);
	const tipRef = useRef<THREE.Mesh>(null);

	useFrame(() => {
		const spatial = websocketStore.getSnapshot();
		if (!headRef.current) return;

		// Update position
		headRef.current.position.set(spatial.position.x, -spatial.position.y, 0);

		// Update pen lift visual (just move the tip)
		if (tipRef.current) {
			const targetZ = spatial.penDown ? 0 : 8;
			tipRef.current.position.z += (targetZ - tipRef.current.position.z) * 0.2;

			(tipRef.current.material as THREE.MeshStandardMaterial).color.set(
				spatial.penDown ? "#ff4d4d" : "#4ecca3",
			);
			(tipRef.current.material as THREE.MeshStandardMaterial).emissive.set(
				spatial.penDown ? "#ff4d4d" : "#4ecca3",
			);
			(
				tipRef.current.material as THREE.MeshStandardMaterial
			).emissiveIntensity = spatial.penDown ? 1 : 0.5;
		}

		// Update velocity arrow
		if (velocityArrowRef.current) {
			const velX = spatial.velocity.x;
			const velY = -spatial.velocity.y;
			const mag = Math.sqrt(velX * velX + velY * velY);

			if (mag > 0.1) {
				velocityArrowRef.current.visible = true;
				velocityArrowRef.current.setDirection(
					new THREE.Vector3(velX, velY, 0).normalize(),
				);
				velocityArrowRef.current.setLength(mag / 2, Math.min(mag / 4, 3), 1.5);
			} else {
				velocityArrowRef.current.visible = false;
			}
		}

		// Update orientation
		if (orientationRef.current && spatial.orientation) {
			orientationRef.current.quaternion.set(
				spatial.orientation.x,
				spatial.orientation.y,
				spatial.orientation.z,
				spatial.orientation.w,
			);
		}
	});

	return (
		<group ref={headRef}>
			{/* Pen Tip/Body */}
			<mesh ref={tipRef} position={[0, 0, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
				<cylinderGeometry
					args={[1.8, 0.1, 10, 16]}
				/>
				<meshStandardMaterial
					color="#4ecca3"
					emissive="#4ecca3"
					emissiveIntensity={0.5}
					metalness={0.8}
					roughness={0.2}
				/>
			</mesh>

			{/* Carriage Holder */}
			<mesh position={[0, 0, 10]} castShadow>
				<boxGeometry args={[6, 6, 2]} />
				<meshStandardMaterial color="#222" metalness={0.5} roughness={0.5} />
			</mesh>

			{/* Velocity Vector */}
			<arrowHelper
				ref={velocityArrowRef}
				args={[
					new THREE.Vector3(1, 0, 0),
					new THREE.Vector3(0, 0, 0),
					1,
					0x4ecca3,
				]}
			/>

			{/* Orientation Indicator (shows controller tilt) */}
			<group ref={orientationRef}>
				{/* Stylized "Gimbal" or indicator */}
				<mesh position={[0, 0, 15]}>
					<boxGeometry args={[10, 0.5, 0.5]} />
					<meshStandardMaterial color="red" />
				</mesh>
				<mesh position={[0, 0, 15]}>
					<boxGeometry args={[0.5, 10, 0.5]} />
					<meshStandardMaterial color="green" />
				</mesh>
				<mesh position={[0, 0, 15]}>
					<boxGeometry args={[0.5, 0.5, 10]} />
					<meshStandardMaterial color="blue" />
				</mesh>
			</group>
		</group>
	);
}

interface CursorPoolEntry {
	group: THREE.Group;
	cone: THREE.Mesh;
	ring: THREE.Mesh;
	material: THREE.MeshStandardMaterial;
	ringMaterial: THREE.MeshStandardMaterial;
	targetPos: THREE.Vector3;
	assignedTo: string | null;
}

function RemoteCursors() {
	const poolRef = useRef<CursorPoolEntry[]>([]);
	const groupRef = useRef<THREE.Group>(null);
	const [labels, setLabels] = useState<Array<{ id: string; name: string; color: string; pos: [number, number, number] }>>([]);
	// Local cursor position for non-controllers (frozen at last axi position when control was lost)
	const localCursorRef = useRef<{ x: number; y: number; z: number } | null>(null);
	const wasInControlRef = useRef(false);

	// Build the pool once
	useEffect(() => {
		if (!groupRef.current) return;
		const pool: CursorPoolEntry[] = [];

		for (let i = 0; i < CURSOR_POOL_SIZE; i++) {
			const material = new THREE.MeshStandardMaterial({
				color: '#ffffff',
				emissive: '#ffffff',
				emissiveIntensity: 0.6,
				metalness: 0.5,
				roughness: 0.3,
			});

			const ringMaterial = new THREE.MeshStandardMaterial({
				color: '#ffffff',
				emissive: '#ffffff',
				emissiveIntensity: 0.6,
				metalness: 0.5,
				roughness: 0.3,
			});

			// Cone pointing down
			const coneGeo = new THREE.ConeGeometry(3, 10, 12);
			const cone = new THREE.Mesh(coneGeo, material);
			cone.rotation.x = Math.PI; // point down

			// Ring at base
			const ringGeo = new THREE.TorusGeometry(4, 0.5, 8, 24);
			const ring = new THREE.Mesh(ringGeo, ringMaterial);
			ring.rotation.x = Math.PI / 2;

			const group = new THREE.Group();
			group.add(cone);
			group.add(ring);
			group.visible = false;

			groupRef.current.add(group);

			pool.push({
				group,
				cone,
				ring,
				material,
				ringMaterial,
				targetPos: new THREE.Vector3(),
				assignedTo: null,
			});
		}

		poolRef.current = pool;

		return () => {
			for (const entry of pool) {
				entry.cone.geometry.dispose();
				entry.ring.geometry.dispose();
				entry.material.dispose();
				entry.ringMaterial.dispose();
			}
		};
	}, []);

	// Broadcast cursor at 20Hz
	useEffect(() => {
		const interval = setInterval(() => {
			const snap = websocketStore.getSnapshot();
			if (!snap.connected) return;

			const inControl = websocketStore.isInControl();

			// Detect control loss: freeze local cursor at current axi position
			if (wasInControlRef.current && !inControl) {
				localCursorRef.current = {
					x: snap.position.x,
					y: snap.position.y,
					z: snap.penDown ? 0 : 8,
				};
			}
			wasInControlRef.current = inControl;

			if (inControl) {
				// Controller broadcasts the axi head position as their cursor
				websocketStore.sendCursor({
					x: snap.position.x,
					y: snap.position.y,
					z: snap.penDown ? 0 : 8,
				});
			} else if (localCursorRef.current) {
				// Non-controller broadcasts their frozen/local cursor
				websocketStore.sendCursor(localCursorRef.current);
			}
		}, 1000 / CURSOR_BROADCAST_HZ);

		return () => clearInterval(interval);
	}, []);

	const labelUpdateCounter = useRef(0);

	useFrame(() => {
		const pool = poolRef.current;
		if (pool.length === 0) return;

		const snap = websocketStore.getSnapshot();
		const clients = snap.remoteClients;
		const activeIds = new Set<string>();

		// Build a combined map: remote clients + self
		const allCursors: Record<string, { color: string; cursor: { x: number; y: number; z: number } | null; name: string }> = {};

		for (const [id, client] of Object.entries(clients)) {
			allCursors[id] = client;
		}

		// Add self cursor so the local user sees their own model
		if (snap.clientId && snap.clientColor) {
			const inControl = websocketStore.isInControl();
			const selfCursor = inControl
				? { x: snap.position.x, y: snap.position.y, z: snap.penDown ? 0 : 8 }
				: localCursorRef.current;

			if (selfCursor) {
				allCursors[snap.clientId] = {
					color: snap.clientColor,
					cursor: selfCursor,
					name: snap.clientId,
				};
			}
		}

		// Assign pool entries to active cursors
		for (const [id, client] of Object.entries(allCursors)) {
			if (!client.cursor) continue;
			activeIds.add(id);

			// Find existing assignment or grab a free slot
			let entry = pool.find(e => e.assignedTo === id);
			if (!entry) {
				entry = pool.find(e => e.assignedTo === null);
				if (!entry) continue; // pool exhausted
				entry.assignedTo = id;
				entry.material.color.set(client.color);
				entry.material.emissive.set(client.color);
				entry.ringMaterial.color.set(client.color);
				entry.ringMaterial.emissive.set(client.color);
			}

			entry.targetPos.set(client.cursor.x, -client.cursor.y, client.cursor.z + 12);
			entry.group.visible = true;
		}

		// Free unused entries
		for (const entry of pool) {
			if (entry.assignedTo && !activeIds.has(entry.assignedTo)) {
				entry.assignedTo = null;
				entry.group.visible = false;
			}
			// Lerp toward target
			if (entry.group.visible) {
				entry.group.position.lerp(entry.targetPos, 0.15);
			}
		}

		// Update HTML labels at a lower rate (~4Hz)
		labelUpdateCounter.current++;
		if (labelUpdateCounter.current % 15 === 0) {
			const newLabels: typeof labels = [];
			for (const entry of pool) {
				if (entry.assignedTo && entry.group.visible) {
					const client = allCursors[entry.assignedTo];
					if (client) {
						const isController = entry.assignedTo === snap.controllerId;
						const isSelf = entry.assignedTo === snap.clientId;
						let displayName = client.name;
						if (isSelf) displayName += ' (you)';
						if (isController) displayName += ' ✦';

						newLabels.push({
							id: entry.assignedTo,
							name: displayName,
							color: client.color,
							pos: [entry.group.position.x, entry.group.position.y, entry.group.position.z + 12],
						});
					}
				}
			}
			setLabels(newLabels);
		}
	});

	return (
		<group ref={groupRef}>
			{labels.map(label => (
				<Html key={label.id} position={label.pos} center>
					<div style={{
						color: label.color,
						fontSize: '10px',
						fontFamily: 'monospace',
						fontWeight: 600,
						background: 'rgba(0,0,0,0.6)',
						padding: '2px 6px',
						borderRadius: '4px',
						whiteSpace: 'nowrap',
						pointerEvents: 'none',
						border: `1px solid ${label.color}33`,
					}}>
						{label.name}
					</div>
				</Html>
			))}
		</group>
	);
}

function PathVisualizer({ path, bounds }: { path: any[], bounds: { maxX: number, maxY: number } }) {
	const points = useMemo(() => {
		if (!path || path.length === 0) return [];

		const segments = [];
		let currentSegment = [];

		for (let i = 0; i < path.length; i++) {
			const pt = path[i];
			if (pt.penDown) {
				if (currentSegment.length === 0 && i > 0) {
					const prev = path[i - 1];
					currentSegment.push(new THREE.Vector3(prev.x, -prev.y, 0));
				}
				currentSegment.push(new THREE.Vector3(pt.x, -pt.y, 0));
			} else {
				if (currentSegment.length > 0) {
					segments.push([...currentSegment]);
					currentSegment = [];
				}
			}
		}
		if (currentSegment.length > 0) segments.push(currentSegment);
		return segments;
	}, [path]);

	const labelStyle = {
		color: "#4ecca3",
		fontSize: "8px",
		fontFamily: "monospace",
		background: "rgba(0,0,0,0.5)",
		padding: "2px 4px",
		borderRadius: "2px",
		pointerEvents: "none",
		whiteSpace: "nowrap",
	};

	return (
		<group>
			{/* Work Surface */}
			<mesh position={[bounds.maxX / 2, -bounds.maxY / 2, -2.5]} receiveShadow>
				<planeGeometry args={[bounds.maxX, bounds.maxY]} />
				<meshStandardMaterial
					color="#111"
					roughness={0.8}
					metalness={0.2}
					emissive="#050505"
				/>
			</mesh>

			{/* Surface Border */}
			<lineSegments position={[bounds.maxX / 2, -bounds.maxY / 2, -2.4]}>
				<edgesGeometry
					args={[new THREE.PlaneGeometry(bounds.maxX, bounds.maxY)]}
				/>
				<lineBasicMaterial color="#333" />
			</lineSegments>

			{/* Corner Labels */}
			<Html position={[0, 0, 0]} center>
				<div style={labelStyle as any}>(0,0)</div>
			</Html>
			<Html position={[bounds.maxX, 0, 0]} center>
				<div style={labelStyle as any}>({bounds.maxX},0)</div>
			</Html>
			<Html position={[0, -bounds.maxY, 0]} center>
				<div style={labelStyle as any}>(0,{bounds.maxY})</div>
			</Html>
			<Html position={[bounds.maxX, -bounds.maxY, 0]} center>
				<div style={labelStyle as any}>
					({bounds.maxX},{bounds.maxY})
				</div>
			</Html>

			{/* Path Segments as strokes */}
			{points.map((segment, idx) => (
				<line key={idx}>
					<bufferGeometry attach="geometry">
						<float32BufferAttribute
							attach="attributes-position"
							args={[new Float32Array(segment.flatMap((v) => [v.x, v.y, v.z])), 3]}
						/>
					</bufferGeometry>
					<lineBasicMaterial
						attach="material"
						color="#4ecca3"
						linewidth={2}
						transparent
						opacity={0.8}
					/>
				</line>
			))}

			{/* Home Indicator */}
			<mesh position={[0, 0, 0]}>
				<sphereGeometry args={[1, 16, 16]} />
				<meshStandardMaterial
					color="#ffc107"
					emissive="#ffc107"
					emissiveIntensity={2}
				/>
			</mesh>
		</group>
	);
}

function PlannedPathVisualizer({ jobs }: { jobs: any[] }) {
	const colors = [
		"#ff9800",
		"#e91e63",
		"#9c27b0",
		"#3f51b5",
		"#03a9f4",
		"#00bcd4",
		"#009688",
	];

	return (
		<group>
			{jobs
				.filter((j: any) => j.state === "planned" || j.state === "pending")
				.map((job: any, jobIdx: number) => {
					const color = colors[jobIdx % colors.length];
					const commands = job.dataPreview?.commands || [];

					// Process commands into segments
					const segments = [];
					let currentSegment = [];
					let curX = 0,
						curY = 0;

					for (const cmd of commands) {
						if (cmd.type === "moveTo") {
							if (currentSegment.length > 0) segments.push([...currentSegment]);
							currentSegment = [];
							curX = cmd.x;
							curY = cmd.y;
						} else if (cmd.type === "move") {
							if (currentSegment.length > 0) segments.push([...currentSegment]);
							currentSegment = [];
							curX += cmd.dx;
							curY += cmd.dy;
						} else if (cmd.type === "lineTo") {
							if (currentSegment.length === 0) {
								currentSegment.push(new THREE.Vector3(curX, -curY, 0));
							}
							curX += cmd.dx;
							curY += cmd.dy;
							currentSegment.push(new THREE.Vector3(curX, -curY, 0));
						} else if (cmd.type === "home") {
							if (currentSegment.length > 0) segments.push([...currentSegment]);
							currentSegment = [];
							curX = 0;
							curY = 0;
						}
					}
					if (currentSegment.length > 0) segments.push(currentSegment);

					return (
						<group key={job.id || jobIdx}>
							{segments.map((segment: any, segIdx: number) => (
								<line
									key={segIdx}
								>
									<bufferGeometry attach="geometry">
										<float32BufferAttribute
											attach="attributes-position"
											args={[new Float32Array(segment.flatMap((v: any) => [v.x, v.y, v.z])), 3]}
										/>
									</bufferGeometry>
									<lineDashedMaterial
										attach="material"
										color={color}
										linewidth={1}
										transparent
										opacity={0.6}
										dashSize={2}
										gapSize={1}
									/>
								</line>
							))}
						</group>
					);
				})}
		</group>
	);
}

export function ThreeCanvas() {
	const [pathData, setPathData] = useState({
		path: [],
		bounds: { maxX: 300, maxY: 218 },
	});
	const [queuedJobs, setQueJobs] = useState([]);
	const state = useWebSocketState();

	useEffect(() => {
		const fetchPath = async () => {
			if (!state.serverConnected) return;
			try {
				const savedHost =
					localStorage.getItem("axiApiHost") || (import.meta as any).env?.VITE_AXI_API_HOST || window.location.origin;
				const res = await fetch(`${savedHost}/path`);
				const data = await res.json();
				setPathData(data);
			} catch (e) {
				// Silently fail
			}
		};

		if (state.serverConnected) {
			fetchPath();
		}
	}, [state.serverConnected]);

	// Listen for WebSocket updates
	useEffect(() => {
		const lastMessage = state.messages[state.messages.length - 1];
		if (!lastMessage) return;

		if (lastMessage.type === "connected") {
			if (lastMessage.path) {
				setPathData((prev) => ({ ...prev, path: lastMessage.path }));
			}
		} else if (lastMessage.type === "path_update") {
			setPathData((prev) => ({
				...prev,
				path:
					lastMessage.path || [...prev.path, lastMessage.point].filter(Boolean),
			}));
		} else if (lastMessage.type === "queue_update") {
			setQueJobs(lastMessage.jobs || []);
		}
	}, [state.messages]);

	return (
		<div
			style={{
				width: "100vw",
				height: "100vh",
				background: "#080808",
				position: "fixed",
				top: 0,
				left: 0,
				zIndex: 0,
				overflow: "hidden",
			}}
		>
			<Canvas
				shadows={{ type: THREE.PCFShadowMap }}
				dpr={[1, 2]}
				camera={{ position: [150, -350, 250], fov: 45, up: [0, 0, 1] }}
			>
				<OrbitControls
					target={[pathData.bounds.maxX / 2, -pathData.bounds.maxY / 2, 0]}
					enableDamping
					dampingFactor={0.05}
					enablePan={true}
					maxPolarAngle={Math.PI / 2.05} // Prevent going under the plane
					minDistance={50}
					maxDistance={1000}
				/>

				<ambientLight intensity={1.2} />
				<directionalLight
					position={[100, 100, 200]}
					intensity={1.5}
					castShadow
				/>
				<pointLight
					position={[-100, -200, 150]}
					intensity={1}
					color="#4ecca3"
				/>

				<PathVisualizer path={pathData.path} bounds={pathData.bounds} />
				<PlannedPathVisualizer jobs={queuedJobs} />
				<AxiHead />
				<RemoteCursors />

				<axesHelper args={[50]} position={[0, 0, 0.1]} />
				<Environment preset="city" environmentIntensity={1.5} />
				<gridHelper
					args={[1000, 50, "#222", "#111"]}
					rotation={[Math.PI / 2, 0, 0]}
					position={[0, 0, -5]}
				/>

				{/* Spatial UI Elements */}
				<group position={[pathData.bounds.maxX + 40, 0, 0]}>
					<VectorComponent />
				</group>
				<group position={[pathData.bounds.maxX + 40, -40, 0]}>
					<OrientationGizmo />
				</group>

				<SpatialHUD />
			</Canvas>
		</div>
	);
}
