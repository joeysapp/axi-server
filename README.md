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

## Goal State
The intent of this project is to serve as a comprehensive tool to monitor and control the AxiDraw remotely. The frontend aims to be an intuitive, cross-platform interface providing novel movements, shapes, and macros through the UI using WebSocket (or REST for headless control) with a strong focus on Generative Art.

## Current State
- **Backend:** Node.js REST and WebSocket API communicating directly with the EiBotBoard over serial.
- **Frontend:** A lightweight, framework-agnostic single-file control panel (`src/public/index.html`) offering essential control, job queuing, high-DPI canvas path rendering, and D-Pad movement.
