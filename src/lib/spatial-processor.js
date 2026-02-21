/**
 * Spatial State Processor
 *
 * Handles velocity integration, smoothing, and spatial state management
 * for real-time controller input processing.
 */

/**
 * Apply deadzone to a value
 * @param {number} value - Input value [-1, 1]
 * @param {number} deadzone - Deadzone threshold
 * @returns {number} Value with deadzone applied
 */
function applyDeadzone(value, deadzone) {
  if (Math.abs(value) < deadzone) return 0;
  // Rescale to full range outside deadzone
  const sign = Math.sign(value);
  return sign * (Math.abs(value) - deadzone) / (1 - deadzone);
}

/**
 * Apply cubic curve for more precise control at low speeds
 * @param {number} value - Input value [-1, 1]
 * @returns {number} Curved value
 */
function applyCubicCurve(value) {
  return Math.pow(value, 3);
}

/**
 * Clamp value to range
 */
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/**
 * SpatialState - Represents the current integrated state
 */
export class SpatialState {
  constructor() {
    // Position in mm
    this.position = { x: 0, y: 0, z: 0 };
    // Velocity in mm/s
    this.velocity = { x: 0, y: 0, z: 0 };
    // Orientation quaternion
    this.orientation = { w: 1, x: 0, y: 0, z: 0 };
    // Angular velocity in rad/s
    this.angularVelocity = { x: 0, y: 0, z: 0 };
    // Timestamp of last update
    this.lastUpdate = Date.now();
  }

  clone() {
    const s = new SpatialState();
    s.position = { ...this.position };
    s.velocity = { ...this.velocity };
    s.orientation = { ...this.orientation };
    s.angularVelocity = { ...this.angularVelocity };
    s.lastUpdate = this.lastUpdate;
    return s;
  }
}

/**
 * SpatialProcessor - Processes controller input into smooth spatial state
 *
 * Mode of operation:
 * - "position": Controller sends pre-integrated position, we calculate deltas
 * - "velocity": Controller sends velocity, we integrate locally (legacy)
 */
export class SpatialProcessor {
  constructor(options = {}) {
    // Processing parameters (matching websocket-spatial-streaming.json)
    this.config = {
      // Input processing
      deadzone: options.deadzone ?? 0.08,
      velocityCurve: options.velocityCurve ?? 'cubic',

      // Speed limits
      maxLinearSpeed: options.maxLinearSpeed ?? 200.0,   // mm/s
      maxAngularSpeed: options.maxAngularSpeed ?? 6.0,    // rad/s

      // Damping (friction) - applied each tick
      linearDamping: options.linearDamping ?? 0.92,
      angularDamping: options.angularDamping ?? 0.96,

      // Exponential smoothing for velocity changes
      smoothingAlpha: options.smoothingAlpha ?? 0.15,

      // Workspace bounds (mm)
      bounds: {
        minX: options.minX ?? 0,
        maxX: options.maxX ?? 300,
        minY: options.minY ?? 0,
        maxY: options.maxY ?? 218,
        minZ: options.minZ ?? 0,
        maxZ: options.maxZ ?? 100
      },

      // Tick rate (only used in velocity mode)
      tickRate: options.tickRate ?? 120,  // Hz

      // Network latency for prediction (ms)
      networkLatency: options.networkLatency ?? 15,

      // Control mode: "position" or "velocity"
      controlMode: options.controlMode ?? 'position',

      // Minimum movement threshold before sending command (mm)
      movementThreshold: options.movementThreshold ?? 0.5,

      // Maximum pending movements before dropping (backpressure)
      maxPendingCommands: options.maxPendingCommands ?? 3
    };

    // Current integrated state
    this.state = new SpatialState();

    // Target velocity (from controller input) - used in velocity mode
    this.targetVelocity = { x: 0, y: 0, z: 0 };
    this.targetAngularVelocity = { x: 0, y: 0, z: 0 };

    // Last received position from controller - used in position mode
    this.lastReceivedPosition = null;

    // Tick interval (only used in velocity mode)
    this.tickInterval = null;
    this.tickDt = 1000 / this.config.tickRate;  // ms per tick

    // Callbacks
    this.onStateUpdate = options.onStateUpdate ?? null;
    this.onMovement = options.onMovement ?? null;

    // Movement accumulator for batching
    this.pendingMovement = { dx: 0, dy: 0 };
    this.movementThreshold = this.config.movementThreshold;

    // Command queue state (for backpressure)
    this.commandInFlight = false;
    this.pendingCommands = 0;
    this.lastCommandTime = 0;
    this.minCommandInterval = 30; // ms - minimum time between commands

    // Pen state
    this.penDown = false;
  }

  /**
   * Start the processor
   * In position mode: no tick loop needed, movements triggered by incoming data
   * In velocity mode: starts fixed-rate tick loop for integration
   */
  start() {
    if (this.tickInterval) return;

    console.log(`[SpatialProcessor] Starting in ${this.config.controlMode} mode`);
    this.state.lastUpdate = Date.now();

    if (this.config.controlMode === 'velocity') {
      console.log(`[SpatialProcessor] Tick loop at ${this.config.tickRate} Hz`);
      this.tickInterval = setInterval(() => {
        this.tick();
      }, this.tickDt);
    }
  }

  /**
   * Stop the tick loop
   */
  stop() {
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
      console.log('[SpatialProcessor] Stopped');
    }
  }

  /**
   * Process a single tick - integrate velocity into position (velocity mode only)
   */
  tick() {
    // Position mode doesn't use tick loop
    if (this.config.controlMode === 'position') return;

    const now = Date.now();
    const dt = (now - this.state.lastUpdate) / 1000;  // seconds
    this.state.lastUpdate = now;

    // Skip if dt is too large (e.g., after pause)
    if (dt > 0.1) return;

    const prevPosition = { ...this.state.position };

    // Smooth velocity towards target
    this.state.velocity.x += (this.targetVelocity.x - this.state.velocity.x) * this.config.smoothingAlpha;
    this.state.velocity.y += (this.targetVelocity.y - this.state.velocity.y) * this.config.smoothingAlpha;
    this.state.velocity.z += (this.targetVelocity.z - this.state.velocity.z) * this.config.smoothingAlpha;

    // Apply damping
    this.state.velocity.x *= this.config.linearDamping;
    this.state.velocity.y *= this.config.linearDamping;
    this.state.velocity.z *= this.config.linearDamping;

    // Integrate position
    this.state.position.x += this.state.velocity.x * dt;
    this.state.position.y += this.state.velocity.y * dt;
    this.state.position.z += this.state.velocity.z * dt;

    // Clamp to workspace bounds
    this.state.position.x = clamp(this.state.position.x, this.config.bounds.minX, this.config.bounds.maxX);
    this.state.position.y = clamp(this.state.position.y, this.config.bounds.minY, this.config.bounds.maxY);
    this.state.position.z = clamp(this.state.position.z, this.config.bounds.minZ, this.config.bounds.maxZ);

    // Handle angular velocity (simplified for 2D projection)
    this.state.angularVelocity.x += (this.targetAngularVelocity.x - this.state.angularVelocity.x) * this.config.smoothingAlpha;
    this.state.angularVelocity.y += (this.targetAngularVelocity.y - this.state.angularVelocity.y) * this.config.smoothingAlpha;
    this.state.angularVelocity.z += (this.targetAngularVelocity.z - this.state.angularVelocity.z) * this.config.smoothingAlpha;

    this.state.angularVelocity.x *= this.config.angularDamping;
    this.state.angularVelocity.y *= this.config.angularDamping;
    this.state.angularVelocity.z *= this.config.angularDamping;

    // Calculate movement delta
    const dx = this.state.position.x - prevPosition.x;
    const dy = this.state.position.y - prevPosition.y;

    // Accumulate movement
    this.pendingMovement.dx += dx;
    this.pendingMovement.dy += dy;

    // Apply backpressure
    if (this.pendingCommands >= this.config.maxPendingCommands) {
      return;
    }

    // Emit movement if above threshold
    const movementMagnitude = Math.sqrt(
      this.pendingMovement.dx * this.pendingMovement.dx +
      this.pendingMovement.dy * this.pendingMovement.dy
    );

    if (movementMagnitude >= this.movementThreshold && this.onMovement) {
      const movement = {
        dx: this.pendingMovement.dx,
        dy: this.pendingMovement.dy,
        penDown: this.penDown
      };
      this.pendingMovement.dx = 0;
      this.pendingMovement.dy = 0;
      this.emitMovement(movement);
    }

    // Emit state update
    if (this.onStateUpdate) {
      this.onStateUpdate(this.state);
    }
  }

  /**
   * Process raw controller stick input
   * @param {number} stickX - Left stick X [-1, 1]
   * @param {number} stickY - Left stick Y [-1, 1]
   */
  processStickInput(stickX, stickY) {
    // Apply deadzone
    let x = applyDeadzone(stickX, this.config.deadzone);
    let y = applyDeadzone(stickY, this.config.deadzone);

    // Apply response curve
    if (this.config.velocityCurve === 'cubic') {
      x = applyCubicCurve(x);
      y = applyCubicCurve(y);
    }

    // Scale to max velocity
    this.targetVelocity.x = x * this.config.maxLinearSpeed;
    this.targetVelocity.y = y * this.config.maxLinearSpeed;
  }

  /**
   * Process right stick for angular velocity (yaw/pitch)
   * @param {number} stickX - Right stick X [-1, 1]
   * @param {number} stickY - Right stick Y [-1, 1]
   */
  processAngularInput(stickX, stickY) {
    let x = applyDeadzone(stickX, this.config.deadzone);
    let y = applyDeadzone(stickY, this.config.deadzone);

    if (this.config.velocityCurve === 'cubic') {
      x = applyCubicCurve(x);
      y = applyCubicCurve(y);
    }

    this.targetAngularVelocity.z = x * this.config.maxAngularSpeed;  // yaw
    this.targetAngularVelocity.x = y * this.config.maxAngularSpeed;  // pitch
  }

  /**
   * Process trigger for Z velocity
   * @param {number} triggerValue - Trigger value [0, 1]
   */
  processTriggerInput(triggerValue) {
    const deadzone = this.config.deadzone;
    let v = triggerValue > deadzone ? (triggerValue - deadzone) / (1 - deadzone) : 0;
    this.targetVelocity.z = v * this.config.maxLinearSpeed * 0.5;  // Half speed for Z
  }

  /**
   * Process complete spatial state from controller
   * This handles the new websocket-spatial-streaming format
   * @param {object} spatialData - Spatial state from controller
   */
  processSpatialState(spatialData) {
    const {
      position,
      velocity,
      orientation,
      angular_velocity: angularVelocity,
      linear_accel: linearAccel,
      buttons
    } = spatialData;

    if (this.config.controlMode === 'position' && position) {
      // Position mode: use incoming position directly, calculate deltas
      this.processPositionMode(position);
    } else if (velocity) {
      // Velocity mode: use velocity for local integration
      this.targetVelocity.x = clamp(velocity.x, -this.config.maxLinearSpeed, this.config.maxLinearSpeed);
      this.targetVelocity.y = clamp(velocity.y, -this.config.maxLinearSpeed, this.config.maxLinearSpeed);
      this.targetVelocity.z = clamp(velocity.z ?? 0, -this.config.maxLinearSpeed, this.config.maxLinearSpeed);
    }

    if (angularVelocity) {
      this.targetAngularVelocity.x = clamp(angularVelocity.x, -this.config.maxAngularSpeed, this.config.maxAngularSpeed);
      this.targetAngularVelocity.y = clamp(angularVelocity.y, -this.config.maxAngularSpeed, this.config.maxAngularSpeed);
      this.targetAngularVelocity.z = clamp(angularVelocity.z, -this.config.maxAngularSpeed, this.config.maxAngularSpeed);
    }

    if (orientation) {
      this.state.orientation = { ...orientation };
    }

    // Handle button state
    if (buttons !== undefined) {
      this.processButtons(buttons);
    }
  }

  /**
   * Process position mode - use incoming position directly
   * @param {object} position - Position from controller {x, y, z}
   */
  processPositionMode(position) {
    // Clamp incoming position to workspace bounds
    const clampedPos = {
      x: clamp(position.x, this.config.bounds.minX, this.config.bounds.maxX),
      y: clamp(position.y, this.config.bounds.minY, this.config.bounds.maxY),
      z: clamp(position.z ?? 0, this.config.bounds.minZ, this.config.bounds.maxZ)
    };

    // Initialize last position on first message
    if (this.lastReceivedPosition === null) {
      this.lastReceivedPosition = { ...clampedPos };
      this.state.position = { ...clampedPos };
      console.log(`[SpatialProcessor] Initial position: (${clampedPos.x.toFixed(1)}, ${clampedPos.y.toFixed(1)})`);
      return;
    }

    // Calculate delta from last received position
    const dx = clampedPos.x - this.lastReceivedPosition.x;
    const dy = clampedPos.y - this.lastReceivedPosition.y;

    // Update last received position
    this.lastReceivedPosition = { ...clampedPos };

    // Accumulate movement
    this.pendingMovement.dx += dx;
    this.pendingMovement.dy += dy;

    // Check movement magnitude
    const movementMagnitude = Math.sqrt(
      this.pendingMovement.dx * this.pendingMovement.dx +
      this.pendingMovement.dy * this.pendingMovement.dy
    );

    // Apply backpressure - don't emit if too many commands pending
    if (this.pendingCommands >= this.config.maxPendingCommands) {
      // Drop this update, keep accumulating
      return;
    }

    // Rate limit commands
    const now = Date.now();
    if (now - this.lastCommandTime < this.minCommandInterval) {
      return;
    }

    // Emit movement if above threshold
    if (movementMagnitude >= this.movementThreshold && this.onMovement) {
      this.pendingCommands++;
      this.lastCommandTime = now;

      // Update our internal state to match
      this.state.position.x += this.pendingMovement.dx;
      this.state.position.y += this.pendingMovement.dy;

      const movement = {
        dx: this.pendingMovement.dx,
        dy: this.pendingMovement.dy,
        penDown: this.penDown
      };

      // Clear pending
      this.pendingMovement.dx = 0;
      this.pendingMovement.dy = 0;

      // Emit with completion callback for backpressure tracking
      this.emitMovement(movement);
    }
  }

  /**
   * Emit movement with backpressure tracking
   */
  emitMovement(movement) {
    if (!this.onMovement) return;

    // Wrap callback to track completion
    const originalCallback = this.onMovement;
    const self = this;

    // Call the movement handler
    const result = originalCallback(movement);

    // If it returns a promise, track completion
    if (result && typeof result.then === 'function') {
      result
        .then(() => {
          self.pendingCommands = Math.max(0, self.pendingCommands - 1);
        })
        .catch((err) => {
          self.pendingCommands = Math.max(0, self.pendingCommands - 1);
          // Error already logged by caller
        });
    } else {
      // Synchronous completion
      this.pendingCommands = Math.max(0, this.pendingCommands - 1);
    }
  }

  /**
   * Process button events
   * @param {object|number} buttons - Button state (bitmask or object)
   */
  processButtons(buttons) {
    // Handle different button formats
    if (typeof buttons === 'number') {
      // Bitmask format - implementation depends on controller mapping
      return;
    }
    // Object format handled via separate event messages
  }

  /**
   * Handle button event
   * @param {string} button - Button name
   * @param {string} state - 'pressed' or 'released'
   */
  handleButtonEvent(button, state) {
    // Button events are handled separately via WebSocket messages
    // This is a hook for external handling
  }

  /**
   * Handle action event
   * @param {string} action - Action name (e.g., 'pen_down', 'pen_up', 'stop')
   */
  handleActionEvent(action) {
    switch (action) {
      case 'pen_down':
        this.penDown = true;
        break;
      case 'pen_up':
        this.penDown = false;
        break;
      case 'stop':
        this.stop();
        this.targetVelocity = { x: 0, y: 0, z: 0 };
        this.targetAngularVelocity = { x: 0, y: 0, z: 0 };
        this.state.velocity = { x: 0, y: 0, z: 0 };
        this.state.angularVelocity = { x: 0, y: 0, z: 0 };
        break;
      case 'home':
        this.state.position = { x: 0, y: 0, z: 0 };
        this.pendingMovement = { dx: 0, dy: 0 };
        break;
    }
  }

  /**
   * Get predicted position accounting for network latency
   * @returns {object} Predicted position
   */
  getPredictedPosition() {
    const latencySeconds = this.config.networkLatency / 1000;
    return {
      x: this.state.position.x + this.state.velocity.x * latencySeconds,
      y: this.state.position.y + this.state.velocity.y * latencySeconds,
      z: this.state.position.z + this.state.velocity.z * latencySeconds
    };
  }

  /**
   * Sync position from hardware
   * @param {object} position - Actual position from AxiDraw
   */
  syncPosition(position) {
    if (position.x !== undefined) this.state.position.x = position.x;
    if (position.y !== undefined) this.state.position.y = position.y;
    if (position.z !== undefined) this.state.position.z = position.z;
  }

  /**
   * Update configuration
   * @param {object} config - Configuration updates
   */
  updateConfig(config) {
    Object.assign(this.config, config);
    if (config.bounds) {
      Object.assign(this.config.bounds, config.bounds);
    }

    // Update tick rate if changed
    if (config.tickRate && this.tickInterval) {
      this.stop();
      this.tickDt = 1000 / this.config.tickRate;
      this.start();
    }
  }

  /**
   * Get current state
   * @returns {SpatialState}
   */
  getState() {
    return this.state.clone();
  }

  /**
   * Get current config
   * @returns {object}
   */
  getConfig() {
    return { ...this.config };
  }

  /**
   * Reset to home position
   */
  reset() {
    this.state = new SpatialState();
    this.targetVelocity = { x: 0, y: 0, z: 0 };
    this.targetAngularVelocity = { x: 0, y: 0, z: 0 };
    this.pendingMovement = { dx: 0, dy: 0 };
    this.lastReceivedPosition = null;
    this.pendingCommands = 0;
    this.lastCommandTime = 0;
    this.penDown = false;
  }

  /**
   * Get diagnostics for debugging
   */
  getDiagnostics() {
    return {
      mode: this.config.controlMode,
      pendingCommands: this.pendingCommands,
      pendingMovement: { ...this.pendingMovement },
      lastReceivedPosition: this.lastReceivedPosition ? { ...this.lastReceivedPosition } : null,
      currentPosition: { ...this.state.position },
      penDown: this.penDown
    };
  }
}

export default SpatialProcessor;
