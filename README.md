# axi-lab

Real-time multiplayer control interface for AxiDraw pen plotters. A Node.js backend communicates directly with the EiBotBoard over serial, while a React/Three.js frontend provides 3D visualization of the plotter workspace with live cursor presence for all connected clients.

## Architecture

```
Browser (SPA)  ──WebSocket──▶  Node.js backend  ──Serial──▶  AxiDraw EBB
   │                              │
   ├─ Three.js 3D canvas          ├─ Spatial processor (velocity/position)
   ├─ Remote cursor rendering      ├─ Client presence (identity, cursors)
   └─ Mantine UI controls          ├─ REST API (pen, move, SVG, queue)
                                   └─ Direct EBB serial commands
```

**Frontend:** React Router v7 SPA, React Three Fiber, Mantine, Framer Motion
**Backend:** Node.js, `ws`, `serialport` — no Python dependencies

## Quick Start

```bash
npm install
npm start              # Backend on :9700 (serves frontend from backend/public/)
```

```bash
# Build the frontend SPA into backend/public/
npm run build-ui

# Or develop frontend separately
cd frontend && npm install && npm run dev
```

## Multi-Client

Multiple browser tabs/devices connect to one backend via WebSocket. All clients share the same plotter state and see each other's cursors rendered as colored 3D markers on the canvas. Any client can send commands (last-write-wins).

Set the server URL in the settings drawer when connecting remotely.

## Deploy

Deploy to a remote server (frontend as static files via nginx, backend as a systemd service):

```bash
# First time — sets up server, installs deps, deploys everything
./deploy/scripts/deploy.sh --first-run

# Subsequent deploys
./deploy/scripts/deploy.sh

# Frontend-only update
./deploy/scripts/deploy.sh --frontend
```

See `deploy/` for nginx config, systemd unit, and the deploy script.

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `AXIDRAW_PORT` | `9700` | Server port |
| `AXIDRAW_HOST` | `0.0.0.0` | Server bind address |
| `AXIDRAW_SERIAL` | `auto` | Serial port path |
| `AXIDRAW_AUTO_CONNECT` | `true` | Connect to plotter on startup |
| `AXIDRAW_NARROW_BAND` | `true` | Brushless servo mode |
| `AXIDRAW_MODEL` | `V2_V3` | Model: `V2_V3`, `V3_A3`, `V3_XLX`, `MiniKit`, `SE_A1`, `SE_A2` |

## API

**REST:** `GET /health`, `GET /status`, `POST /pen/up`, `POST /pen/down`, `POST /move`, `POST /home`, `POST /svg`, `POST /queue`, `GET /path`

**WebSocket** (`ws://host:9700/spatial`): Bidirectional spatial state streaming — position, velocity, orientation, pen state, and client presence.

## License

MIT
