/**
 * EBB Motion Control Module
 *
 * Handles stepper motor control for XY movement.
 * Implements SM, XM, HM, LM commands for various motion profiles.
 *
 * Reference: https://evil-mad.github.io/EggBot/ebb.html
 *
 * AxiDraw uses a CoreXY-style kinematics where:
 * - Motor 1 (Axis 1) controls Y axis
 * - Motor 2 (Axis 2) controls X axis
 * - Diagonal movements use both motors
 */

/**
 * AxiDraw model configurations
 */
export const AXIDRAW_MODELS = {
  V2_V3: {
    name: 'AxiDraw V2/V3',
    xTravel: 11.81,  // inches (300mm)
    yTravel: 8.58,   // inches (218mm)
    stepsPerInch: 2032 // High resolution mode (16x microstepping)
  },
  V3_A3: {
    name: 'AxiDraw V3/A3 or SE/A3',
    xTravel: 16.93,  // inches (430mm)
    yTravel: 11.69,  // inches (297mm)
    stepsPerInch: 2032
  },
  V3_XLX: {
    name: 'AxiDraw V3 XLX',
    xTravel: 23.42,  // inches (595mm)
    yTravel: 8.58,   // inches (218mm)
    stepsPerInch: 2032
  },
  MiniKit: {
    name: 'AxiDraw MiniKit',
    xTravel: 6.30,   // inches (160mm)
    yTravel: 4.00,   // inches (101.6mm)
    stepsPerInch: 2032
  },
  SE_A1: {
    name: 'AxiDraw SE/A1',
    xTravel: 34.02,  // inches (864mm)
    yTravel: 23.39,  // inches (594mm)
    stepsPerInch: 2032
  },
  SE_A2: {
    name: 'AxiDraw SE/A2',
    xTravel: 23.39,  // inches (594mm)
    yTravel: 17.01,  // inches (432mm)
    stepsPerInch: 2032
  }
};

/**
 * Motor resolution modes (EM command)
 */
export const MOTOR_RESOLUTION = {
  DISABLED: 0,
  MICRO_16X: 1,  // 16x microstepping (highest resolution)
  MICRO_8X: 2,   // 8x microstepping
  MICRO_4X: 3,   // 4x microstepping
  MICRO_2X: 4,   // 2x microstepping
  FULL_STEP: 5   // No microstepping (lowest resolution)
};

/**
 * EBBMotion - Manages stepper motor control
 */
export class EBBMotion {
  constructor(ebb, options = {}) {
    this.ebb = ebb;

    // Select model configuration
    this.model = options.model || AXIDRAW_MODELS.V2_V3;

    // Resolution: 1 = high (16x), 2 = low (8x)
    this.resolution = options.resolution || 1;
    this.stepsPerInch = this.resolution === 1
      ? this.model.stepsPerInch
      : this.model.stepsPerInch / 2;

    // Current position tracking (in steps)
    this.posX = 0;
    this.posY = 0;

    // Movement limits (in steps)
    this.maxX = Math.round(this.model.xTravel * this.stepsPerInch);
    this.maxY = Math.round(this.model.yTravel * this.stepsPerInch);

    // Speed settings (in/s)
    this.speedPenDown = options.speedPenDown || 0.25; // inches per second
    this.speedPenUp = options.speedPenUp || 0.5;
    this.acceleration = options.acceleration || 40.0; // in/s^2

    // Minimum movement duration in ms. EBB supports down to 2ms.
    // Set to 2ms to allow rapid processing of tiny line segments from SVG arcs.
    this.minMoveDurationMs = options.minMoveDurationMs || 2;

    // Motor state
    this.motorsEnabled = false;
    this.motorResolution = MOTOR_RESOLUTION.DISABLED;

    // Units conversion
    this.unitsPerInch = 25.4; // mm per inch
  }

  /**
   * Convert inches to steps
   * @param {number} inches
   * @returns {number} Steps
   */
  inchesToSteps(inches) {
    return Math.round(inches * this.stepsPerInch);
  }

  /**
   * Convert mm to steps
   * @param {number} mm
   * @returns {number} Steps
   */
  mmToSteps(mm) {
    return Math.round((mm / this.unitsPerInch) * this.stepsPerInch);
  }

  /**
   * Convert steps to inches
   * @param {number} steps
   * @returns {number} Inches
   */
  stepsToInches(steps) {
    return steps / this.stepsPerInch;
  }

  /**
   * Convert steps to mm
   * @param {number} steps
   * @returns {number} mm
   */
  stepsToMm(steps) {
    return (steps / this.stepsPerInch) * this.unitsPerInch;
  }

  /**
   * Enable motors at specified resolution
   * @param {number} resolution - Resolution mode (1-5, default 1 for 16x microstepping)
   */
  async enableMotors(resolution = MOTOR_RESOLUTION.MICRO_16X) {
    const res = Math.max(1, Math.min(5, resolution));
    await this.ebb.command(`EM,${res},${res}`);
    this.motorsEnabled = true;
    this.motorResolution = res;

    // Update steps per inch based on resolution
    const baseSteps = this.model.stepsPerInch;
    const resMultiplier = Math.pow(2, 5 - res); // 16, 8, 4, 2, 1
    this.stepsPerInch = baseSteps * (resMultiplier / 16);
  }

  /**
   * Disable motors
   */
  async disableMotors() {
    await this.ebb.command('EM,0,0');
    this.motorsEnabled = false;
    this.motorResolution = MOTOR_RESOLUTION.DISABLED;
  }

  /**
   * Move to home position (0, 0)
   * @param {number} rate - Step frequency (2-25000 steps/sec)
   */
  async home(rate = 3200) {
    // Calculate approximate time based on current position and rate
    const distance = Math.sqrt(this.posX * this.posX + this.posY * this.posY);
    const timeMs = Math.max(100, Math.round((distance / rate) * 1000));

    // HM command moves to position where motors were enabled
    await this.ebb.command(`HM,${rate}`);

    // Wait for movement to complete using proper idle detection
    await this.ebb.waitForIdle(timeMs + 100, 50);

    this.posX = 0;
    this.posY = 0;
  }

  /**
   * Move to absolute position
   * @param {number} x - Target X in steps
   * @param {number} y - Target Y in steps
   * @param {number} rate - Step frequency (2-25000 steps/sec)
   */
  async moveToAbsolute(x, y, rate = null) {
    // Clamp to bounds
    x = Math.max(0, Math.min(this.maxX, Math.round(x)));
    y = Math.max(0, Math.min(this.maxY, Math.round(y)));

    const dx = x - this.posX;
    const dy = y - this.posY;
    
    // CoreXY relies on mixed-axis moves, so delegate to the moveXY method
    return await this.moveXY(dx, dy, null);
  }

  /**
   * Sleep helper (if not already defined elsewhere)
   */
  _sleepHelper(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Relative XY move using SM command
   * @param {number} deltaX - X movement in steps
   * @param {number} deltaY - Y movement in steps
   * @param {number} duration - Duration in ms (1-16777215)
   */
  async moveXY(deltaX, deltaY, duration = null) {
    deltaX = Math.round(deltaX);
    deltaY = Math.round(deltaY);

    // Prevent out-of-bounds movement
    const targetX = Math.max(0, Math.min(this.maxX, this.posX + deltaX));
    const targetY = Math.max(0, Math.min(this.maxY, this.posY + deltaY));
    deltaX = targetX - this.posX;
    deltaY = targetY - this.posY;

    if (deltaX === 0 && deltaY === 0) {
      return 0;
    }

    // Calculate duration if not provided
    if (duration === null) {
      const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
      const distanceInches = this.stepsToInches(distance);
      const speed = this.speedPenUp; // Use pen-up speed for moves
      duration = Math.round((distanceInches / speed) * 1000);
    }

   // Enforce minimum duration to prevent overloading EBB is firmware >3.0
    duration = Math.max(this.minMoveDurationMs, duration);

    // Enforce maximum EBB step rate limit (25,000 steps/sec per motor)
    // CoreXY: Motor 1 = A + B, Motor 2 = A - B
    const maxMotorSteps = Math.max(
      Math.abs(deltaX + deltaY),
      Math.abs(deltaX - deltaY)
    );
    // duration must be at least (maxMotorSteps / 25000) seconds = maxMotorSteps / 25 ms
    const minSafeDuration = Math.ceil(maxMotorSteps / 25);
    if (duration < minSafeDuration) {
      if (process.env.AXIDRAW_DEBUG) {
        console.log(`[Motion] Speed limit exceeded! Throttling duration from ${duration}ms to ${minSafeDuration}ms for ${maxMotorSteps} max motor steps.`);
      }
      duration = minSafeDuration;
    }

    // XM command: XM,duration,axisA,axisB
    // For AxiDraw (CoreXY): XM handles the conversion to Motor1 & Motor2 internally
    await this.ebb.command(`XM,${duration},${deltaX},${deltaY}`, duration + 5000);

    // Update position
    this.posX += deltaX;
    this.posY += deltaY;

    return duration;
  }

  /**
   * Sleep helper
   * @param {number} ms - Milliseconds to sleep
   */
  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Relative XY move in inches
   * @param {number} inchesX - X movement in inches
   * @param {number} inchesY - Y movement in inches
   * @param {number} speed - Speed in inches/second (optional)
   */
  async moveXYInches(inchesX, inchesY, speed = null, durationOverride = null) {
    const stepsX = this.inchesToSteps(inchesX);
    const stepsY = this.inchesToSteps(inchesY);

    let duration = durationOverride;
    if (duration === null && speed) {
      const distance = Math.sqrt(inchesX * inchesX + inchesY * inchesY);
      duration = Math.max(1, Math.round((distance / speed) * 1000));
    }

    return await this.moveXY(stepsX, stepsY, duration);
  }

  /**
   * Relative XY move in mm
   * @param {number} mmX - X movement in mm
   * @param {number} mmY - Y movement in mm
   * @param {number} speed - Speed in mm/second (optional)
   */
  async moveXYMm(mmX, mmY, speed = null, durationOverride = null) {
    const inchesX = mmX / this.unitsPerInch;
    const inchesY = mmY / this.unitsPerInch;
    const speedInches = speed ? speed / this.unitsPerInch : null;
    return await this.moveXYInches(inchesX, inchesY, speedInches, durationOverride);
  }

  /**
   * Move using A/B axis (CoreXY) commands
   * For CoreXY: Motor1 = A+B, Motor2 = A-B
   * @param {number} deltaA - A axis movement
   * @param {number} deltaB - B axis movement
   * @param {number} duration - Duration in ms
   */
  async moveAB(deltaA, deltaB, duration) {
    await this.ebb.command(`XM,${duration},${Math.round(deltaA)},${Math.round(deltaB)}`);

    // Convert back to XY for position tracking
    // A = (X + Y) / 2, B = (X - Y) / 2
    // So: X = A + B, Y = A - B
    this.posX += deltaA + deltaB;
    this.posY += deltaA - deltaB;
  }

  /**
   * Low-level move with acceleration
   * @param {Object} params - Movement parameters
   */
  async lowLevelMove(params) {
    const {
      rate1, steps1, accel1,
      rate2, steps2, accel2,
      clear = 0
    } = params;

    if ((rate1 === 0 && accel1 === 0) || steps1 === 0) {
      if ((rate2 === 0 && accel2 === 0) || steps2 === 0) {
        return; // No movement
      }
    }

    const cmd = clear
      ? `LM,${rate1},${steps1},${accel1},${rate2},${steps2},${accel2},${clear}`
      : `LM,${rate1},${steps1},${accel1},${rate2},${steps2},${accel2}`;

    await this.ebb.command(cmd);
  }

  /**
   * Hardware pause
   * @param {number} ms - Duration in ms
   */
  async pause(ms) {
    // Use SM command with 0 steps for hardware timing
    while (ms > 0) {
      const delay = Math.min(750, ms);
      await this.ebb.command(`SM,${delay},0,0`);
      ms -= delay;
    }
  }

  /**
   * Query current step positions from EBB
   * @returns {Promise<{x: number, y: number}>}
   */
  async queryPosition() {
    const { motor1, motor2 } = await this.ebb.querySteps();
    // Motor1 = Y, Motor2 = X
    return { x: motor2, y: motor1 };
  }

  /**
   * Sync internal position with EBB
   */
  async syncPosition() {
    const pos = await this.queryPosition();
    this.posX = pos.x;
    this.posY = pos.y;
  }

  /**
   * Clear step position counters
   */
  async clearPosition() {
    await this.ebb.clearSteps();
    this.posX = 0;
    this.posY = 0;
  }

  /**
   * Emergency stop - halt all movement
   * @param {boolean} disableMotors - Also disable motors
   */
  async emergencyStop(disableMotors = true) {
    await this.ebb.emergencyStop(disableMotors);
    if (disableMotors) {
      this.motorsEnabled = false;
      this.motorResolution = MOTOR_RESOLUTION.DISABLED;
    }
    // Position is now unknown - sync from EBB
    await this.syncPosition();
  }

  /**
   * Get current position in various units
   * @returns {Object} Position information
   */
  getPosition() {
    return {
      steps: { x: this.posX, y: this.posY },
      inches: {
        x: this.stepsToInches(this.posX),
        y: this.stepsToInches(this.posY)
      },
      mm: {
        x: this.stepsToMm(this.posX),
        y: this.stepsToMm(this.posY)
      }
    };
  }

  /**
   * Get motion system status
   * @returns {Object} Status information
   */
  getStatus() {
    return {
      motorsEnabled: this.motorsEnabled,
      motorResolution: this.motorResolution,
      position: this.getPosition(),
      bounds: {
        steps: { maxX: this.maxX, maxY: this.maxY },
        inches: {
          maxX: this.stepsToInches(this.maxX),
          maxY: this.stepsToInches(this.maxY)
        },
        mm: {
          maxX: this.stepsToMm(this.maxX),
          maxY: this.stepsToMm(this.maxY)
        }
      },
      model: this.model.name,
      stepsPerInch: this.stepsPerInch,
      speed: {
        penDown: this.speedPenDown,
        penUp: this.speedPenUp
      }
    };
  }

  /**
   * Update speed settings
   * @param {Object} speeds - New speed settings
   */
  updateSpeeds(speeds) {
    if (speeds.penDown !== undefined) {
      this.speedPenDown = speeds.penDown;
    }
    if (speeds.penUp !== undefined) {
      this.speedPenUp = speeds.penUp;
    }
    if (speeds.acceleration !== undefined) {
      this.acceleration = speeds.acceleration;
    }
  }

  /**
   * Check if position is within bounds
   * @param {number} x - X position in steps
   * @param {number} y - Y position in steps
   * @returns {boolean}
   */
  isWithinBounds(x, y) {
    return x >= 0 && x <= this.maxX && y >= 0 && y <= this.maxY;
  }

  /**
   * Clamp position to bounds
   * @param {number} x - X position in steps
   * @param {number} y - Y position in steps
   * @returns {{x: number, y: number}}
   */
  clampToBounds(x, y) {
    return {
      x: Math.max(0, Math.min(this.maxX, x)),
      y: Math.max(0, Math.min(this.maxY, y))
    };
  }
}

export default EBBMotion;
