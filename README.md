# AxiDraw HTTP Server

A robust HTTP REST API server for controlling AxiDraw plotters via direct EBB (EiBotBoard) serial commands. Built from scratch with Node.js, eliminating the need for pyaxidraw while providing full control over the hardware.

## Features

- **Direct EBB Communication**: Raw serial protocol implementation, no Python dependencies
- **Narrow-Band Servo Support**: Full support for both standard and upgraded brushless lift motors
- **REST API**: Simple HTTP endpoints for all AxiDraw operations
- **Job Queue**: Queue multiple drawings with priority support
- **SVG Support**: Parse and plot SVG files directly
- **Service Ready**: Includes launchd (macOS) and systemd (Linux) service files
- **Auto-Discovery**: Automatically finds connected AxiDraw devices

## Quick Start

```bash
# Install dependencies
npm install

# Start the server
npm start

# Or with environment variables
AXIDRAW_PORT=9700 AXIDRAW_NARROW_BAND=true npm start
```

The server will start on port 9700 (configurable) and attempt to auto-connect to any detected AxiDraw.

## API Overview

Visit `http://localhost:9700/` for full API documentation.

### Basic Endpoints

```bash
# Health check
curl http://localhost:9700/health

# Get status
curl http://localhost:9700/status

# Connect to AxiDraw
curl -X POST http://localhost:9700/connect

# Pen control
curl -X POST http://localhost:9700/pen/up
curl -X POST http://localhost:9700/pen/down

# Movement (mm by default)
curl -X POST http://localhost:9700/move \
  -H "Content-Type: application/json" \
  -d '{"dx": 10, "dy": 0}'

curl -X POST http://localhost:9700/moveto \
  -H "Content-Type: application/json" \
  -d '{"x": 50, "y": 50}'

# Go home
curl -X POST http://localhost:9700/home

# Draw SVG
curl -X POST http://localhost:9700/svg \
  -H "Content-Type: application/json" \
  -d '{"svg": "<svg>...</svg>", "name": "My Drawing"}'

# Queue commands
curl -X POST http://localhost:9700/queue \
  -H "Content-Type: application/json" \
  -d '{
    "type": "commands",
    "data": [
      {"type": "moveTo", "x": 10, "y": 10},
      {"type": "penDown"},
      {"type": "lineTo", "dx": 50, "dy": 0},
      {"type": "penUp"}
    ],
    "name": "Square"
  }'
```

## Configuration

Environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `AXIDRAW_PORT` | `9700` | HTTP server port |
| `AXIDRAW_HOST` | `0.0.0.0` | HTTP server host |
| `AXIDRAW_SERIAL` | auto | Serial port path (e.g., `/dev/tty.usbmodemfoob1`) |
| `AXIDRAW_AUTO_CONNECT` | `true` | Auto-connect on startup |
| `AXIDRAW_NARROW_BAND` | `false` | Use narrow-band brushless servo |
| `AXIDRAW_MODEL` | `V2_V3` | AxiDraw model |
| `AXIDRAW_SPEED_DOWN` | `2.5` | Pen-down drawing speed (inches/sec) |
| `AXIDRAW_SPEED_UP` | `7.5` | Pen-up travel speed (inches/sec) |

Available models: `V2_V3`, `V3_A3`, `V3_XLX`, `MiniKit`, `SE_A1`, `SE_A2`

### Speed Configuration

Speed can be configured via environment variables or dynamically at runtime:

```bash
# Get current speeds
curl http://localhost:9700/speed

# Set speeds (inches per second)
curl -X POST http://localhost:9700/speed \
  -H "Content-Type: application/json" \
  -d '{"penDown": 1.5, "penUp": 5.0}'
```

Recommended ranges:
- **penDown** (drawing): 0.5 - 4.0 in/sec (slower = smoother lines)
- **penUp** (travel): 3.0 - 10.0 in/sec (faster = less wasted time)

## Installation

### Manual

```bash
git clone <repo> axi-server
cd axi-server
npm install
npm start
```

### As a Service

```bash
# Run interactive installer
./scripts/install.sh
```

The installer will:
1. Check Node.js version (requires 18+)
2. Install npm dependencies
3. Set up serial port permissions (Linux)
4. Offer service installation options:
   - **macOS**: launchd daemon or tmux session
   - **Linux**: systemd service

### macOS with tmux (recommended for development)

```bash
# After running install.sh with option 2
tmux attach -t axi
```

### macOS launchd

```bash
# Start
launchctl start com.axidraw.server

# Stop
launchctl stop com.axidraw.server

# View logs
tail -f /tmp/axidraw-server.log
```

### Linux systemd

```bash
sudo systemctl start axidraw-server
sudo systemctl status axidraw-server
sudo journalctl -u axidraw-server -f
```

## Testing

```bash
# Run endpoint tests
./scripts/test-endpoints.sh

# Or with custom host/port
./scripts/test-endpoints.sh xaria.local 9700
```

## Project Structure

```
axi-server/
├── src/
│   ├── index.js           # HTTP server and routes
│   └── lib/
│       ├── axidraw.js     # Main controller class
│       ├── ebb-serial.js  # EBB serial communication
│       ├── ebb-servo.js   # Pen servo control
│       ├── ebb-motion.js  # Motor/movement control
│       ├── job-queue.js   # Job queue system
│       └── svg-parser.js  # SVG to commands converter
├── scripts/
│   ├── install.sh         # Installation script
│   ├── uninstall.sh       # Uninstallation script
│   └── test-endpoints.sh  # API test script
├── services/
│   ├── com.axidraw.server.plist  # macOS launchd
│   ├── axidraw-tmux.plist        # macOS tmux launcher
│   └── axidraw-server.service    # Linux systemd
└── package.json
```

## EBB Protocol Reference

This implementation directly communicates with the EiBotBoard using the [EBB Command Set](https://evil-mad.github.io/EggBot/ebb.html).

### Key Commands Used

| Command | Description |
|---------|-------------|
| `V` | Query firmware version |
| `QG` | Query general status |
| `QS` | Query step positions |
| `QP` | Query pen state |
| `EM` | Enable/disable motors |
| `SM` | Stepper move (duration, steps) |
| `HM` | Home/absolute move |
| `SP` | Set pen state (up/down) |
| `SC` | Servo configuration |
| `SR` | Servo timeout |
| `ST` | Set nickname |
| `QT` | Query nickname |
| `ES` | Emergency stop |
| `R` | Reset |
| `RB` | Reboot |

### Servo Configurations

**Standard Servo (penlift=2)**
- Pin: B1
- Pulse: 0.82-2.32ms
- Sweep time: 200ms

**Narrow-Band Brushless (penlift=3)**
- Pin: B2
- Pulse: 0.45-1.05ms
- Sweep time: 70ms

---

## Future Roadmap

### Planned Features

#### Generative Art Module
- Procedural pattern generation (spirals, fractals, flow fields)
- Parametric shape generators
- Random seed-based reproducible art
- Integration with external generative art libraries

#### Agentic LLM Integration
The `/info` endpoint provides machine-readable documentation designed for LLM consumption. Future enhancements:
- OpenAPI/Swagger specification generation
- Example conversation flows for LLM agents
- Natural language command interpretation endpoint
- Claude/GPT tool use schemas

#### Webcam Monitoring Service
- Optional companion service for visual monitoring
- Progress detection via computer vision
- Error detection (pen out of ink, paper movement)
- Timelapse recording of plots
- REST API for current frame / status

#### Image to SVG Tracing
- Potrace integration for bitmap-to-vector conversion
- Edge detection and line extraction
- Configurable detail levels
- Direct plotting from images

#### Advanced Motion Planning
- Bezier curve optimization
- Travel path optimization (TSP)
- Acceleration/deceleration profiles
- Constant-speed mode for consistent line weight

#### Multi-AxiDraw Support
- Manage multiple connected devices
- Job routing to specific machines
- Parallel plotting coordination
- Device naming and discovery

#### Python Transformers Integration
- Neural style transfer for drawings
- AI-generated art pipelines
- Image captioning for automatic naming
- Sketch simplification models

#### Web Dashboard
- Real-time status monitoring
- Queue management UI
- SVG upload and preview
- Configuration interface

### Ideas for Exploration

1. **HPGL/G-code Import**: Support for legacy plotter formats
2. **Tiling**: Automatic tiling for plots larger than work area
3. **Layer Support**: Plot specific SVG layers
4. **Registration Marks**: Multi-pass alignment
5. **Pressure Sensitivity**: Variable pen pressure via servo position
6. **Sound Generation**: Convert audio waveforms to visual plots
7. **Real-time Plotting**: Stream coordinates as they're generated
8. **Undo/Resume**: Save plot state for recovery after errors

---

## Contributing

Contributions welcome! Please:
1. Fork the repository
2. Create a feature branch
3. Add tests for new functionality
4. Submit a pull request

## License

MIT

## Acknowledgments

- [Evil Mad Scientist](https://www.evilmadscientist.com/) for AxiDraw hardware and EBB protocol documentation
- [thi.ng/axidraw](https://github.com/thi-ng/umbrella/tree/develop/packages/axidraw) for implementation inspiration
- [pyaxidraw](https://github.com/evil-mad/axidraw) for servo timing calculations reference
