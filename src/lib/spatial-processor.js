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

      // Tick rate
      tickRate: options.tickRate ?? 120,  // Hz

      // Network latency for prediction (ms)
      networkLatency: options.networkLatency ?? 15
    };

    // Current integrated state
    this.state = new SpatialState();

    // Target velocity (from controller input)
    this.targetVelocity = { x: 0, y: 0, z: 0 };
    this.targetAngularVelocity = { x: 0, y: 0, z: 0 };

    // Tick interval
    this.tickInterval = null;
    this.tickDt = 1000 / this.config.tickRate;  // ms per tick

    // Callbacks
    this.onStateUpdate = options.onStateUpdate ?? null;
    this.onMovement = options.onMovement ?? null;

    // Movement accumulator for batching
    this.pendingMovement = { dx: 0, dy: 0 };
    this.movementThreshold = options.movementThreshold ?? 0.1;  // mm

    // Pen state
    this.penDown = false;
  }

  /**
   * Start the fixed-rate tick loop
   */
  start() {
    if (this.tickInterval) return;

    console.log(`[SpatialProcessor] Starting at ${this.config.tickRate} Hz`);
    this.state.lastUpdate = Date.now();

    this.tickInterval = setInterval(() => {
      this.tick();
    }, this.tickDt);
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
   * Process a single tick - integrate velocity into position
   */
  tick() {
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

    // Emit movement if above threshold
    const movementMagnitude = Math.sqrt(
      this.pendingMovement.dx * this.pendingMovement.dx +
      this.pendingMovement.dy * this.pendingMovement.dy
    );

    if (movementMagnitude >= this.movementThreshold && this.onMovement) {
      this.onMovement({
        dx: this.pendingMovement.dx,
        dy: this.pendingMovement.dy,
        penDown: this.penDown
      });
      this.pendingMovement.dx = 0;
      this.pendingMovement.dy = 0;
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

    // If controller is sending integrated state, use it directly
    // but still apply our own smoothing and bounds clamping
    if (velocity) {
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
      case 'pen_toggle':
        this.penDown = !this.penDown;
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
    this.penDown = false;
  }
}

export default SpatialProcessor;
