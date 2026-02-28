import React, { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import { useWebSocketState } from "~/contexts/WebSocketProvider";
import classes from "../styles/Glass.module.scss";

export const VectorComponent = () => {
  return (
    <group position={[-20, 20, 0]}>
      {/* X Axis - Red */}
      <mesh position={[5, 0, 0]}>
        <boxGeometry args={[10, 0.2, 0.2]} />
        <meshBasicMaterial color="#ff4d4d" />
      </mesh>
      {/* Y Axis - Green */}
      <mesh position={[0, -5, 0]}>
        <boxGeometry args={[0.2, 10, 0.2]} />
        <meshBasicMaterial color="#4ecca3" />
      </mesh>
      {/* Z Axis - Blue */}
      <mesh position={[0, 0, 5]}>
        <boxGeometry args={[0.2, 0.2, 10]} />
        <meshBasicMaterial color="#3498db" />
      </mesh>
      <Html position={[12, 0, 0]} center>
        <span style={{ color: '#ff4d4d', fontSize: 10, fontWeight: 'bold' }}>X</span>
      </Html>
      <Html position={[0, -12, 0]} center>
        <span style={{ color: '#4ecca3', fontSize: 10, fontWeight: 'bold' }}>Y</span>
      </Html>
      <Html position={[0, 0, 12]} center>
        <span style={{ color: '#3498db', fontSize: 10, fontWeight: 'bold' }}>Z</span>
      </Html>
    </group>
  );
};

export const OrientationGizmo = () => {
  const meshRef = useRef<THREE.Mesh>(null);
  const state = useWebSocketState();

  useFrame(() => {
    if (meshRef.current && state.orientation) {
      meshRef.current.quaternion.set(
        state.orientation.x,
        state.orientation.y,
        state.orientation.z,
        state.orientation.w
      );
    }
  });

  return (
    <mesh ref={meshRef} position={[0, 0, 0]}>
      <boxGeometry args={[10, 10, 10]} />
      <meshStandardMaterial color="#222" metalness={0.8} roughness={0.2} />
      {/* Colored faces or edges */}
      <lineSegments>
        <edgesGeometry args={[new THREE.BoxGeometry(10, 10, 10)]} />
        <lineBasicMaterial color="#4ecca3" />
      </lineSegments>
    </mesh>
  );
};

const MetricWidget = ({ label, value, color = "#4ecca3" }: { label: string, value: string, color?: string }) => (
  <div className={classes.hud} style={{ minWidth: 80 }}>
    <div style={{ fontSize: 8, color: '#888', textTransform: 'uppercase', marginBottom: 2 }}>{label}</div>
    <div style={{ display: 'flex', gap: 4, alignItems: 'baseline' }}>
      <span style={{ color: '#eee', fontWeight: 600 }}>{value}</span>
    </div>
  </div>
);

export const SpatialHUD = () => {
  const state = useWebSocketState();
  const velMag = Math.sqrt((state.velocity?.x || 0) ** 2 + (state.velocity?.y || 0) ** 2);
  const accMag = Math.sqrt((state.acceleration?.x || 0) ** 2 + (state.acceleration?.y || 0) ** 2);

  return (
    <Html 
      fullscreen 
      style={{ 
        pointerEvents: "none", 
        display: "flex", 
        flexDirection: "column", 
        padding: 24,
        justifyContent: "space-between"
      }}
    >
      {/* Top row: Vector Widgets */}
      <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
        <MetricWidget label="Position" value={`${state.position.x.toFixed(1)}, ${state.position.y.toFixed(1)}`} />
        <MetricWidget label="Velocity" value={velMag.toFixed(2)} />
        <MetricWidget label="Accel" value={accMag.toFixed(2)} />
      </div>

      {/* Middle/Side areas can be used for other HUD elements */}
      <div style={{ flexGrow: 1 }} />

      {/* Corner indicators could go here if needed */}
    </Html>
  );
};
