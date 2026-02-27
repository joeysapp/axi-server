/**
 * AxiDraw Controller
 *
 * High-level controller that combines serial communication,
 * servo control, and motion control into a unified interface.
 */

import { EBBSerial } from './ebb-serial.js';
import { EBBServo, SERVO_CONFIGS, PEN_DEFAULTS } from './ebb-servo.js';
import { EBBMotion, AXIDRAW_MODELS, MOTOR_RESOLUTION } from './ebb-motion.js';

/**
 * Controller states
 */
export const AxiDrawState = {
  DISCONNECTED: 'disconnected',
  CONNECTED: 'connected',
  READY: 'ready',
  BUSY: 'busy',
  PAUSED: 'paused',
  ERROR: 'error'
};

/**
 * AxiDraw - Main controller class
 */
export class AxiDraw {
  constructor(options = {}) {
    // Configuration
    this.portPath = options.portPath || null;
    this.modelKey = options.model || 'V2_V3';
    this.model = AXIDRAW_MODELS[this.modelKey] || AXIDRAW_MODELS.V2_V3;
    this.resolution = options.resolution || 1; // 1 = high, 2 = low
   this.narrowBand = options.narrowBand === true ? true : false; // Use narrow-band servo

    // Speed settings (inches per second)
    this.speedPenDown = options.speedPenDown || 0.25;
    this.speedPenUp = options.speedPenUp || 0.50;

    // State
    this.state = AxiDrawState.DISCONNECTED;
    this.error = null;

    // Sub-modules (created on connect)
    this.ebb = null;
    this.servo = null;
    this.motion = null;

    // Event handlers
    this.onStateChange = options.onStateChange || null;
    this.onPathUpdate = options.onPathUpdate || null;
    this.onStatusUpdate = options.onStatusUpdate || null;

    // History tracking
    this.history = [];
    this.pathHistory = [];
    this.maxHistory = options.maxHistory || 5000;

    // Heartbeat for connection monitoring
    this._heartbeatInterval = null;
    this._heartbeatMs = options.heartbeatMs || 30000; // 30 seconds default
  }

  /**
   * Log an action to history
   */
  _logAction(action, details = {}) {
    const entry = {
      timestamp: new Date().toISOString(),
      action,
      ...details
    };
    this.history.push(entry);
    if (this.history.length > this.maxHistory) {
      this.history.shift();
    }

    // Path tracking for SVG shape creation
    const movementActions = ['home', 'move_to', 'move', 'line_to', 'pen_up', 'pen_down', 'pen_toggle'];
    if (movementActions.includes(action) && this.motion && this.servo) {
      const pos = this.motion.getPosition().mm;
      const point = {
        action,
        x: pos.x,
        y: pos.y,
        penDown: this.servo.isUp === false,
        time: Date.now()
      };
      this.pathHistory.push(point);

      if (this.onPathUpdate) {
        this.onPathUpdate(point, this.pathHistory);
      }
    }
  }

  /**
   * Clear path history
   */
  clearPathHistory() {
    this.pathHistory = [];
    if (this.onPathUpdate) {
      this.onPathUpdate(null, this.pathHistory);
    }
  }

  /**
   * Update state and notify listeners
   */
  _setState(newState, error = null) {
    const oldState = this.state;
    this.state = newState;
    this.error = error;

    if (this.onStateChange && oldState !== newState) {
      this.onStateChange(newState, oldState, error);
    }

    if (this.onStatusUpdate) {
      this.onStatusUpdate({
        state: this.state,
        error: this.error,
        oldState
      });
    }
  }

  /**
   * Start heartbeat polling to detect connection drops
   */
  _startHeartbeat() {
    this._stopHeartbeat(); // Clear any existing

    this._heartbeatInterval = setInterval(async () => {
      if (this.ebb?.connected) {
        try {
         const status = await this.ebb.queryGeneral();
		 console.log(`[Heartbeat] ${status}`);
        } catch (e) {
          console.log('[Heartbeat] Connection lost:', e.message);
          this._stopHeartbeat();
          this._setState(AxiDrawState.DISCONNECTED);
        }
      }
    }, this._heartbeatMs);
  }

  /**
   * Stop heartbeat polling
   */
  _stopHeartbeat() {
    if (this._heartbeatInterval) {
      clearInterval(this._heartbeatInterval);
      this._heartbeatInterval = null;
    }
  }

  /**
   * Connect to AxiDraw
   * @param {string} portPath - Optional specific port
   * @returns {Promise<boolean>}
   */
  async connect(portPath = null) {
    if (this.state !== AxiDrawState.DISCONNECTED) {
      return this.state === AxiDrawState.CONNECTED ||
             this.state === AxiDrawState.READY;
    }

    try {
      // Create serial connection
      this.ebb = new EBBSerial({
        portPath: portPath || this.portPath,
        timeout: 5000,
       onCommandError: (error, cmd) => {
        console.log(`[AxiDraw] Command error: ${cmd} ${error}`);
          // Reset servo state to unknown on any command error
          // This prevents stale state causing repeated penUp/penDown calls
          if (this.servo) {
            console.log('[AxiDraw] Command error - resetting servo state to unknown');
            this.servo.isUp = null;
          }
        }
      });

     await this.ebb.connect(portPath || this.portPath);

     // Create servo controller
      this.servo = new EBBServo(this.ebb, {
        narrowBand: this.narrowBand
      });

     // Create motion controller
      this.motion = new EBBMotion(this.ebb, {
        model: this.model,
        resolution: this.resolution,
        speedPenDown: this.speedPenDown,
        speedPenUp: this.speedPenUp
      });

      this._setState(AxiDrawState.CONNECTED);
      this._logAction('connect', { port: this.ebb.portPath });

      return true;
    } catch (err) {
      this._setState(AxiDrawState.ERROR, err.message);
      this._logAction('connect_error', { error: err.message });
      throw err;
    }
  }

  /**
   * Disconnect from AxiDraw
   */
  async disconnect() {
    // Stop heartbeat first
    this._stopHeartbeat();

    if (this.ebb) {
      // Try to leave in safe state
      try {
        if (this.servo && this.servo.isUp === false) {
          await this.servo.penUp();
        }
        if (this.motion && this.motion.motorsEnabled) {
          await this.motion.disableMotors();
        }
      } catch (e) {
        // Ignore errors during cleanup
      }

      await this.ebb.disconnect();
    }

    this.ebb = null;
    this.servo = null;
    this.motion = null;
    this._setState(AxiDrawState.DISCONNECTED);
    this._logAction('disconnect');
  }

  /**
   * Initialize AxiDraw for operation
   * Configures servo and enables motors
   */
  async initialize() {
    if (this.state !== AxiDrawState.CONNECTED) {
      if (this.state === AxiDrawState.DISCONNECTED) {
        await this.connect();
      } else if (this.state === AxiDrawState.READY) {
        return; // Already initialized
      } else {
        throw new Error(`Cannot initialize in state: ${this.state}`);
      }
    }

    this._setState(AxiDrawState.BUSY);

    try {
      // Skip emergency stop - just clear step positions
      console.log('[Init] Clearing step positions...');
      try {
        await this.ebb.clearSteps();
        console.log('[Init] Steps cleared');
        
        // Optimize FIFO buffer for smooth movements
        try {
          const maxFifo = await this.ebb.query('QU,2');
          console.log(`[Init] maxFifo raw response: ${maxFifo}`);
         const maxFifoSize = parseInt(maxFifo, 10);
          if (!isNaN(maxFifoSize) && maxFifoSize > 1) {
            await this.ebb.command(`CU,4,${maxFifoSize}`);
            console.log(`[Init] FIFO size increased to ${maxFifoSize}`);
          }
        } catch (e) {
         console.log('[Init] FIFO optimization not supported on this firmware version');
		 console.error(e);
        }
      } catch (e) {
        console.log('[Init] CS command failed:', e.message);
      }

      // Initialize servo
      console.log('[Init] Initializing servo...');
      await this.servo.initialize();

     // Enable motors
     console.log('[Init] Enabling motors....');	 
      const res = this.resolution === 1
        ? MOTOR_RESOLUTION.MICRO_16X
        : MOTOR_RESOLUTION.MICRO_8X;
      await this.motion.enableMotors(res);

     // Raise pen if not already up
     if (this.servo.isUp !== true) {
	  console.log('[Init] [WARN] THIS SHOULD NEVER OCCUR RIGHT? HAVING TO RAISE PEN ON INIT?');
        await this.servo.penUp();
      }

     // Start heartbeat monitoring
     console.log('[Init] Starting heartbeat.......');	 	 
      this._startHeartbeat();

      this._setState(AxiDrawState.READY);
      this._logAction('initialize');
    } catch (err) {
      this._setState(AxiDrawState.ERROR, err.message);
      this._logAction('initialize_error', { error: err.message });
      throw err;
    }
  }

  /**
   * Ensure AxiDraw is ready for operation
   * Handles reconnection if serial connection was lost
   */
  async ensureReady() {
    // Check if we think we're ready but serial is actually disconnected
    if ((this.state === AxiDrawState.READY || this.state === AxiDrawState.BUSY) &&
        (!this.ebb || !this.ebb.connected)) {
      console.log('[ensureReady] Serial connection lost, resetting state');
      this._stopHeartbeat();
      this._setState(AxiDrawState.DISCONNECTED);
    }

    if (this.state === AxiDrawState.READY || this.state === AxiDrawState.BUSY) {
      return; // BUSY is ok - we're in the middle of an operation
    }
    if (this.state === AxiDrawState.DISCONNECTED) {
      await this.connect();
    }
    if (this.state === AxiDrawState.CONNECTED) {
      await this.initialize();
    }
    if (this.state !== AxiDrawState.READY && this.state !== AxiDrawState.BUSY) {
      throw new Error(`AxiDraw not ready: ${this.state}`);
    }
  }

  // ==================== Pen Control ====================

  /**
   * Raise the pen
   */
  async penUp() {
    await this.ensureReady();
    this._setState(AxiDrawState.BUSY);
    const time = await this.servo.penUp();
    this._setState(AxiDrawState.READY);
    this._logAction('pen_up', { time });
    return time;
  }

  /**
   * Lower the pen
   */
  async penDown() {
    await this.ensureReady();
    this._setState(AxiDrawState.BUSY);
    const time = await this.servo.penDown();
    this._setState(AxiDrawState.READY);
    this._logAction('pen_down', { time });
    return time;
  }

  /**
   * Synchronize pen state with hardware
   */
  async syncPenState() {
    await this.ensureReady();
    const isUp = await this.servo.queryHardwareState();
    this._logAction('pen_sync', { isUp });
    return isUp;
  }

 /**
  * [TODO] There's some weird behavior this causes on the frontend. Debug
   * Toggle pen state
   */
  async penToggle() {
    await this.ensureReady();
    this._setState(AxiDrawState.BUSY);
    const time = await this.servo.toggle();
    this._setState(AxiDrawState.READY);
    this._logAction('pen_toggle', { isUp: this.servo.isUp, time });
    return time;
  }

  /**
   * Configure pen settings
   * @param {Object} config - Pen configuration
   */
  async configurePen(config) {
    await this.ensureReady();
    await this.servo.updateConfig(config);
    this._logAction('configure_pen', config);
  }

  // ==================== Motion Control ====================

  /**
   * Move to home position (0, 0)
   * @param {number} rate - Movement rate (steps/sec)
   */
  async home(rate = 2032) {
    await this.ensureReady();
    this._setState(AxiDrawState.BUSY);

    // Raise pen first
    if (this.servo.isUp !== true) {
      await this.servo.penUp();
    }

    await this.motion.home(rate);
    this._setState(AxiDrawState.READY);
    this._logAction('home', { rate });
  }

  /**
   * Move to absolute position (with pen up)
   * @param {number} x - X position
   * @param {number} y - Y position
   * @param {string} units - 'steps', 'inches', or 'mm' (default: 'mm')
   */
  async moveTo(x, y, units = 'mm') {
    await this.ensureReady();
    this._setState(AxiDrawState.BUSY);

    // Raise pen first
    if (this.servo.isUp !== true) {
      await this.servo.penUp();
    }

    // Convert to steps
    let stepsX, stepsY;
    switch (units) {
      case 'inches':
        stepsX = this.motion.inchesToSteps(x);
        stepsY = this.motion.inchesToSteps(y);
        break;
      case 'mm':
        stepsX = this.motion.mmToSteps(x);
        stepsY = this.motion.mmToSteps(y);
        break;
      default:
        stepsX = Math.round(x);
        stepsY = Math.round(y);
    }

    const duration = await this.motion.moveToAbsolute(stepsX, stepsY);
    this._setState(AxiDrawState.READY);
    this._logAction('move_to', { x, y, units });
    return duration;
  }

  /**
   * Move relative to current position (with pen up)
   * @param {number} dx - X delta
   * @param {number} dy - Y delta
   * @param {string} units - 'steps', 'inches', or 'mm' (default: 'mm')
   */
  async move(dx, dy, units = 'mm', options = {}) {
    await this.ensureReady();
    this._setState(AxiDrawState.BUSY);

    // Raise pen first
    if (this.servo.isUp !== true) {
      await this.servo.penUp();
    }

    let duration = null;
    switch (units) {
      case 'inches':
        duration = await this.motion.moveXYInches(dx, dy, options.speed, options.duration);
        break;
      case 'mm':
        duration = await this.motion.moveXYMm(dx, dy, options.speed, options.duration);
        break;
      default:
        duration = await this.motion.moveXY(dx, dy, options.duration);
    }

    this._setState(AxiDrawState.READY);
    this._logAction('move', { dx, dy, units });
    return duration;
  }

  /**
   * Draw a line from current position (pen down movement)
   * @param {number} dx - X delta
   * @param {number} dy - Y delta
   * @param {string} units - 'steps', 'inches', or 'mm' (default: 'mm')
   */
  async lineTo(dx, dy, units = 'mm', options = {}) {
    await this.ensureReady();
    this._setState(AxiDrawState.BUSY);

    // Lower pen
    if (this.servo.isUp !== false) {
      await this.servo.penDown();
    }

    let duration = null;
    switch (units) {
      case 'inches':
        duration = await this.motion.moveXYInches(dx, dy, options.speed || this.motion.speedPenDown, options.duration);
        break;
      case 'mm':
        duration = await this.motion.moveXYMm(dx, dy, options.speed || (this.motion.speedPenDown * 25.4), options.duration);
        break;
      default:
        duration = await this.motion.moveXY(dx, dy, options.duration);
    }

    this._setState(AxiDrawState.READY);
    this._logAction('line_to', { dx, dy, units });
    return duration;
  }

  /**
   * Execute a series of movement commands
   * @param {Array} commands - Array of command objects
   */
  async execute(commands) {
    await this.ensureReady();
    this._setState(AxiDrawState.BUSY);

    for (const cmd of commands) {
      switch (cmd.type) {
        case 'moveTo':
          await this.moveTo(cmd.x, cmd.y, cmd.units || 'mm');
          break;
        case 'move':
          await this.move(cmd.dx, cmd.dy, cmd.units || 'mm');
          break;
        case 'lineTo':
          await this.lineTo(cmd.dx, cmd.dy, cmd.units || 'mm');
          break;
        case 'penUp':
          await this.servo.penUp();
          break;
        case 'penDown':
          await this.servo.penDown();
          break;
        case 'pause':
          await this.motion.pause(cmd.ms || 100);
          break;
        case 'home':
          await this.home(cmd.rate);
          break;
        default:
          console.warn(`Unknown command type: ${cmd.type}`);
      }
    }

    this._setState(AxiDrawState.READY);
    this._logAction('execute', { commandCount: commands.length });
  }

  // ==================== Motor Control ====================

  /**
   * Enable motors
   */
  async motorsOn() {
    await this.ensureReady();
    const res = this.resolution === 1
      ? MOTOR_RESOLUTION.MICRO_16X
      : MOTOR_RESOLUTION.MICRO_8X;
    await this.motion.enableMotors(res);
    this._logAction('motors_on');
  }

  /**
   * Disable motors
   */
  async motorsOff() {
    if (this.state === AxiDrawState.DISCONNECTED) {
      return;
    }
    await this.motion.disableMotors();
    this._logAction('motors_off');
  }

  /**
   * Emergency stop
   */
  async emergencyStop() {
    if (this.ebb && this.ebb.connected) {
      await this.motion.emergencyStop(true);
      this._setState(AxiDrawState.CONNECTED);
      this._logAction('emergency_stop');
    }
  }

  // ==================== Status & Info ====================

  /**
   * Get comprehensive status
   * @returns {Object} Status information
   */
  async getStatus(queryHardware = true) {
    const status = {
      state: this.state,
      error: this.error,
      connected: this.ebb ? this.ebb.connected : false
    };

    if (this.ebb && this.ebb.connected) {
      status.connection = this.ebb.getInfo();

      if (this.servo) {
        status.servo = this.servo.getStatus();
      }

      if (this.motion) {
        status.motion = this.motion.getStatus();

        if (queryHardware) {
          // Query actual position from EBB
          try {
            const pos = await this.motion.queryPosition();
            status.motion.actualPosition = pos;
          } catch (e) {
            // Ignore query errors
          }
        }
      }

      if (queryHardware) {
        // Query general status
        try {
          const qg = await this.ebb.queryGeneral();
          status.hardware = {
            penUp: !!(qg & 0x10),
            commandExecuting: !!(qg & 0x08),
            motor1Moving: !!(qg & 0x04),
            motor2Moving: !!(qg & 0x02),
            fifoFull: !!(qg & 0x01),
            buttonPressed: !!(qg & 0x20)
          };
        } catch (e) {
          // Ignore query errors
        }

        // Query voltage
        try {
          const voltage = await this.ebb.queryVoltage();
          status.power = {
            current: voltage.current,
            voltage: voltage.voltage,
            voltageLow: voltage.voltage < 250
          };
        } catch (e) {
          // Ignore query errors
        }
      }
    }

    return status;
  }

  /**
   * Get device info
   */
  async getInfo() {
    if (!this.ebb || !this.ebb.connected) {
      return null;
    }

    const info = this.ebb.getInfo();

    // Query nickname if supported
    try {
      info.nickname = await this.ebb.queryNickname();
    } catch (e) {
      // Ignore
    }

    return info;
  }

	/**
		* Set device nickname
		* @param {string} name - Nickname (3-16 chars)
		*/
	async setNickname(name) {
		if (!this.ebb || !this.ebb.connected) {
			throw new Error('Not connected');
		}
		await this.ebb.setNickname(name);
		// This command causes the EBB to drop off the USB, then completely reboot as if just plugged in. Useful after a name change with the ST command.
		console.log('Rebooting, you will need to reconnect..');
		await this.ebb.reboot();
		this._logAction('set_nickname', { name });
	}

  /**
   * Get action history
   * @param {number} limit - Maximum entries to return
   */
  getHistory(limit = 100) {
    return this.history.slice(-limit);
  }

  /**
   * Clear action history
   */
  clearHistory() {
    this.history = [];
  }

  /**
   * Query firmware version
   */
  async getVersion() {
    if (!this.ebb || !this.ebb.connected) {
      return null;
    }
    return this.ebb.queryVersion();
  }

  /**
   * Reboot the EBB
   */
  async reboot() {
    if (!this.ebb || !this.ebb.connected) {
      throw new Error('Not connected');
    }
    await this.ebb.reboot();
    this._setState(AxiDrawState.DISCONNECTED);
    this._logAction('reboot');
  }

  /**
   * Reset EBB to default state
   */
  async reset() {
    if (!this.ebb || !this.ebb.connected) {
      throw new Error('Not connected');
    }
    await this.ebb.reset();
    this._setState(AxiDrawState.CONNECTED);
    this._logAction('reset');
  }

  /**
   * Sleep helper
   */
  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Re-export useful constants
export { AXIDRAW_MODELS, MOTOR_RESOLUTION, SERVO_CONFIGS, PEN_DEFAULTS };

export default AxiDraw;
