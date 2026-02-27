# AxiDraw HTTP Server

A robust HTTP REST and WebSocket API server for controlling AxiDraw plotters via direct EBB (EiBotBoard) serial commands. Built from scratch with Node.js, eliminating the need for `pyaxidraw` while providing full control over the hardware.

## Features
- **Direct EBB Communication:** Raw serial protocol implementation, no Python dependencies.
- **Narrow-Band Servo Support:** Full support for standard and upgraded brushless lift motors.
- **REST & WebSocket APIs:** Simple endpoints and real-time WebSocket streams for all operations.
- **Job Queue:** Queue multiple drawings with priority support.
- **SVG Support:** Parse and plot SVG files directly.
- **Auto-Discovery:** Automatically finds connected AxiDraw devices.

## Quick Start

```bash
npm install
npm start

# Or with with environment variables:
AXIDRAW_PORT=9700 AXIDRAW_NARROW_BAND=false npm start
```

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `AXIDRAW_PORT` | `9700` | HTTP server port |
| `AXIDRAW_HOST` | `0.0.0.0` | HTTP server host |
| `AXIDRAW_SERIAL` | `auto` | Serial port path |
| `AXIDRAW_AUTO_CONNECT` | `true` | Auto-connect on startup |
| `AXIDRAW_NARROW_BAND` | `true` | Use narrow-band brushless servo |
| `AXIDRAW_MODEL` | `V2_V3` | AxiDraw model (`V2_V3`, `V3_A3`, `V3_XLX`, `MiniKit`, `SE_A1`, `SE_A2`) |

## API Overview

### Basic Endpoints
- `GET /health` - Health check
- `GET /status` - Get system status
- `GET /info` - Verbose info
- `POST /connect` - Connect to AxiDraw
- `POST /pen/up` / `POST /pen/down` - Pen control
- `POST /move` / `POST /moveto` - Movement commands
- `POST /home` - Go home
- `POST /svg` - Draw SVG
- `POST /queue` - Queue commands

## Backend and Frontend Spatial States
### Coordinate System
- **AxiDraw Surface**: Represented as a 2D plane in 3D space.
- **X-Axis**: Matches AxiDraw X (Right).
- **Y-Axis**: Matches AxiDraw Y (Down). In Three.js, we use `-Y` to maintain the "downward is positive" logic of the plotter while staying in a standard right-handed coordinate system.
- **Z-Axis**: Used for pen height and 3D object projection.

### Vector Representation
1. **Position**: `THREE.Vector3(x, -y, 0)`
2. **Velocity**: Represented by `VersorComponent` (bar charts) and planned as arrows in 3D space using `THREE.ArrowHelper`.
3. **Orientation (Quaternion)**: 
   - The AxiDraw spatial state includes a quaternion `{x, y, z, w}`.
   - Visually represented in `ThreeCanvas` by applying the quaternion to a group containing a "pen" object (cylinder) and an orientation indicator (box).
   - This allows visualizing the "tilt" or "direction" if the plotter had such degrees of freedom, or for projecting 3D orientations onto the 2D plane.

## Roadmap

### 1. Frontend Evolution (Next Priorities)
- **React Migration:** Migrate the single-file HTML frontend to a modern React application.
- **Interactive Canvas:** Implement interactive SVG manipulation on the canvas (positioning, scaling, and rotation) prior to printing.

### 2. Generative Art Module
- Macros for procedural pattern generation (spirals, fractals, flow fields).
- Parametric shape generators and novel movement macros.
- Random seed-based reproducible art.

### 3. Advanced Motion Planning
- Bezier curve optimization.
- Travel path optimization (TSP) for faster plots.
- Acceleration/deceleration profiles.

### 4. Machine Vision & AI
- Webcam monitoring for visual progress, out-of-ink detection, and timelapses.
- Image to SVG tracing (Potrace integration).
- Neural style transfer pipelines.

### 3D to 2D Projection
To project 3D objects (like GLTF models) onto the AxiDraw's 2D plane:
1. **Camera Mapping**: Use the `THREE.Camera` projection matrix to transform 3D vertices into normalized device coordinates (NDC).
2. **Scaling**: Transform NDC `[-1, 1]` to AxiDraw bounds `[0, maxX]` and `[0, maxY]`.
3. **Path Generation**: Extract edges or wireframes from the 3D model, project them, and send as a series of `moveTo`/`lineTo` commands.

## Library Roadmap
- **@react-three/fiber**: (Installed) Core rendering.
- **@react-three/drei**: (Installed) Helpers like `OrbitControls`, `Grid`, `PerspectiveCamera`.
- **three/addons/renderers/SVGRenderer.js**: (Available in `three`) For rendering the 3D scene back into an SVG for storage or local plotting.
- **lucide-react**: (Planned) For consistent iconography.

## Goal State
The intent of this project is to serve as a comprehensive tool to monitor and control the AxiDraw remotely. The frontend aims to be an intuitive, cross-platform interface providing novel movements, shapes, and macros through the UI using WebSocket (or REST for headless control) with a strong focus on Generative Art.

## Current State
- **Backend:** Node.js REST and WebSocket API communicating directly with the EiBotBoard over serial.
- **Frontend:** A lightweight, framework-agnostic single-file control panel (`src/public/index.html`) offering essential control, job queuing, high-DPI canvas path rendering, and D-Pad movement.
