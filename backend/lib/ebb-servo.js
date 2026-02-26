/**
 * EBB Servo/Pen Control Module
 *
 * Handles pen lift servo control for both standard and narrow-band (brushless) servos.
 * Implements proper timing calculations matching the pyaxidraw implementation.
 *
 * Reference: https://evil-mad.github.io/EggBot/ebb.html#SC
 *
 * Servo Configurations:
 * - Standard (penlift=2): Pin B1, 0.82-2.32ms pulse, 200ms sweep
 * - Narrow-band (penlift=3): Pin B2, 0.45-1.05ms pulse, 70ms sweep
 */

/**
 * Servo configuration presets
 */
export const SERVO_CONFIGS = {
  // Standard servo (default position, pin B1)
  standard: {
    pin: 1,
    min: 9855,      // 0% position: ~0.82ms (9855 * 83.3ns)
    max: 27831,     // 100% position: ~2.32ms
    sweepTime: 200, // Time to sweep full range at 100% rate (ms)
    moveMin: 45,    // Minimum move time for non-zero distance (ms)
    moveSlope: 2.69, // Additional ms per % of travel
    pwmPeriod: 0.24, // 24ms for 8 channels at 3ms each (divided by 100)
    channels: 8     // Number of PWM channels
  },
  // Narrow-band brushless servo (pin B2, upgraded lift motor)
  narrowBand: {
    pin: 2,
    min: 5400,      // 0% position - base for formula: 5400 + 72 * percent
    max: 12600,     // 100% position (5400 + 72*100)
    sweepTime: 70,  // Time to sweep full range at 100% rate (ms)
   moveMin: 20,    // Minimum move time for non-zero servo up/down distance (ms)
    moveSlope: 1.28, // Additional ms per % of travel
    pwmPeriod: 0.3, // Single channel PWM period
    channels: 1     // Single channel for narrow-band
  }
};

/**
 * Default pen positions and rates
 */
export const PEN_DEFAULTS = {
  posUp: 60,        // Height when raised (0-100%)
  posDown: 30,      // Height when lowered (0-100%)
  rateRaise: 75,    // Speed of raising (1-100%)
  rateLower: 50,    // Speed of lowering (1-100%)
  delayUp: 0,       // Extra delay after raising (ms)
  delayDown: 0      // Extra delay after lowering (ms)
};

/**
 * EBBServo - Manages pen lift servo control
 */
export class EBBServo {
  constructor(ebb, options = {}) {
    this.ebb = ebb;
    this.config = options.narrowBand ? SERVO_CONFIGS.narrowBand : SERVO_CONFIGS.standard;
    this.isNarrowBand = options.narrowBand || false;

    // Current positions and rates
    this.posUp = options.posUp ?? PEN_DEFAULTS.posUp;
    this.posDown = options.posDown ?? PEN_DEFAULTS.posDown;
    this.rateRaise = options.rateRaise ?? PEN_DEFAULTS.rateRaise;
    this.rateLower = options.rateLower ?? PEN_DEFAULTS.rateLower;
    this.delayUp = options.delayUp ?? PEN_DEFAULTS.delayUp;
    this.delayDown = options.delayDown ?? PEN_DEFAULTS.delayDown;

    // Current state
    this.isUp = null; // null = unknown, true = up, false = down
    this.initialized = false;
    this.servoTimeout = options.servoTimeout ?? 60000; // ms before servo power-down
  }

  /**
   * Calculate servo position value from percentage
   * @param {number} percent - Position (0-100)
   * @returns {number} Servo position value for SC command
   */
  _positionToValue(percent) {
    const range = this.config.max - this.config.min;
    const slope = range / 100.0;
    return Math.round(this.config.min + slope * percent);
  }

  /**
   * Calculate servo rate value for SC,11/SC,12 commands
   * @param {number} rate - Rate percentage (1-100)
   * @returns {number} Rate value
   */
  _rateToValue(rate) {
    const range = this.config.max - this.config.min;
    const rateScale = (range * this.config.pwmPeriod) / this.config.sweepTime;
    return Math.round(rateScale * rate);
  }

  /**
   * Calculate time required for pen movement
   * Uses 4th power average blend between fast sweep and slow sweep timing
   * @param {number} distance - Vertical distance in % (0-100)
   * @param {number} rate - Movement rate (1-100)
   * @param {number} extraDelay - Additional delay (ms)
   * @returns {number} Total time in ms
   */
  _calculateMoveTime(distance, rate, extraDelay = 0) {
    if (distance < 0.9) {
      return Math.max(0, extraDelay); // No movement needed
    }

    // Fast sweep time: linear relationship
    const fastTime = this.config.moveSlope * distance + this.config.moveMin;

    // Slow sweep time: rate-dependent
    const slowTime = (this.config.sweepTime * distance) / rate;

    // 4th power average for smooth blend
    const blendedTime = Math.pow(
      Math.pow(fastTime, 4) + Math.pow(slowTime, 4),
      0.25
    );

    return Math.max(0, Math.round(blendedTime) + extraDelay);
  }

  /**
   * Initialize servo configuration
   * Sets position limits and PWM channels
   *
   * For narrow-band brushless servo: Based on working setPenlift(3) in modified axidraw.js:
   * 1. Set positions (SC,5, SC,4) using formula: 5400 + 72 * percent
   * 2. Set max servo rate (SC,10,65535)
   * 3. Configure single PWM channel (SC,8,1)
   */
  async initialize() {
    console.log(`[Servo] Initializing - narrowBand: ${this.isNarrowBand}, pin: ${this.config.pin}`);
    console.log(`[Servo] Config: min=${this.config.min}, max=${this.config.max}, channels=${this.config.channels}`);
    console.log(`[Servo] Positions: up=${this.posUp}% (${this._positionToValue(this.posUp)}), down=${this.posDown}% (${this._positionToValue(this.posDown)})`);

    // Set pen-down position (SC,5)
    console.log(`[Servo] Sending: SC,5,${this._positionToValue(this.posDown)}`);
    await this.ebb.command(`SC,5,${this._positionToValue(this.posDown)}`);

    // Set pen-up position (SC,4)
    console.log(`[Servo] Sending: SC,4,${this._positionToValue(this.posUp)}`);
    await this.ebb.command(`SC,4,${this._positionToValue(this.posUp)}`);

    // Set maximum servo rate (SC,10,65535)
    console.log(`[Servo] Sending: SC,10,65535`);
    await this.ebb.command('SC,10,65535');

    // Configure PWM channels (SC,8)
      console.log(`[Servo] Sending: SC,8,${this.config.channels}`);
      await this.ebb.command(`SC,8,${this.config.channels}`);

    // For standard servo only: set rates and timeout
    if (!this.isNarrowBand) {
      console.log(`[Servo] Sending: SC,12,${this._rateToValue(this.rateLower)}`);
      await this.ebb.command(`SC,12,${this._rateToValue(this.rateLower)}`);
      console.log(`[Servo] Sending: SC,11,${this._rateToValue(this.rateRaise)}`);
      await this.ebb.command(`SC,11,${this._rateToValue(this.rateRaise)}`);

      if (this.ebb.minVersion('2.6.0')) {
        await this.ebb.command(`SR,${this.servoTimeout}`);
      }
    }

    // Detect initial pen state
    await this._detectPenState();

    this.initialized = true;
  }

  /**
   * Detect current pen state from EBB
   * Uses EBBLV (layer variable) to track pen state across sessions
   */
  async _detectPenState() {
    try {
      // Query layer variable
      const ebblv = await this.ebb.queryVariable(0);

      // Calculate expected layer code for current config
      const layerCode = this.isNarrowBand
        ? 71 + Math.floor(this.posUp / 2) // Range 71-121 for narrow-band
        : 1 + Math.floor(this.posUp / 2);  // Range 1-51 for standard

      if (ebblv && ebblv === layerCode) {
        // EBB was previously configured with same settings
        await this.queryHardwareState();
      } else {
        // EBB not configured or different settings - state unknown
        this.isUp = null;
      }
    } catch (e) {
      this.isUp = null;
    }
  }

  /**
   * Query actual pen state from hardware
   * @returns {Promise<boolean|null>} True if pen is up, false if down, null if error
   */
  async queryHardwareState() {
    try {
      const status = await this.ebb.queryGeneral();
      // Bit 1 is pen state: 1 = up, 0 = down
      this.isUp = !!(status & 0x02);
      return this.isUp;
    } catch (e) {
      console.error('[Servo] Failed to query hardware pen state:', e.message);
      return null;
    }
  }

  /**
   * Store pen state in EBB layer variable
   */
  async _storePenState() {
    const layerCode = this.isNarrowBand
      ? 71 + Math.floor(this.posUp / 2)
      : 1 + Math.floor(this.posUp / 2);
    await this.ebb.setVariable(layerCode, 0);
  }

  /**
   * Raise the pen
   * @param {Object} options - Optional overrides
   * @returns {Promise<number>} Time taken in ms
   */
  async penUp(options = {}) {
    // If state unknown, query hardware first
    if (this.isUp === null || options.sync) {
      await this.queryHardwareState();
    }

    // Skip if already up
    if (this.isUp === true && !options.force) {
      return 0;
    }

    const distance = Math.abs(this.posUp - this.posDown);
    const delay = this._calculateMoveTime(distance, this.rateRaise, this.delayUp);

    // SP command with pin parameter for narrow-band (pin 2 is required)
    console.log(`[Servo] penUp: SP,1,${delay},${this.config.pin}`);
    await this.ebb.command(`SP,1,${delay},${this.config.pin}`);

    // Wait for movement to complete
    const waitTime = Math.max(0, delay);
    if (waitTime > 0) {
      await this._sleep(waitTime);
    }

    // Verify state from hardware for reliability
    await this.queryHardwareState();
    
    return delay;
  }

  /**
   * Lower the pen
   * @param {Object} options - Optional overrides
   * @returns {Promise<number>} Time taken in ms
   */
  async penDown(options = {}) {
    // If state unknown, query hardware first
    if (this.isUp === null || options.sync) {
      await this.queryHardwareState();
    }

    // Skip if already down
    if (this.isUp === false && !options.force) {
      return 0;
    }

    const distance = Math.abs(this.posUp - this.posDown);
    const delay = this._calculateMoveTime(distance, this.rateLower, this.delayDown);

    // SP command with pin parameter for narrow-band (pin 2 is required)
    console.log(`[Servo] penDown: SP,0,${delay},${this.config.pin}`);
    await this.ebb.command(`SP,0,${delay},${this.config.pin}`);

    // Wait for movement to complete
    const waitTime = Math.max(0, delay);
    if (waitTime > 0) {
      await this._sleep(waitTime);
    }

    // Verify state from hardware for reliability
    await this.queryHardwareState();

    return delay;
  }

  /**
   * Toggle pen state
   * @returns {Promise<number>} Time taken in ms
   */
  async toggle() {
    // Always query hardware before toggling to ensure we are in sync
    await this.queryHardwareState();
    
    if (this.isUp === false) {
      return this.penUp();
    } else {
      return this.penDown();
    }
  }

  /**
   * Move pen to specific height (bypassing normal up/down positions)
   * @param {number} percent - Target position (0-100)
   * @param {number} rate - Movement rate (1-100)
   * @returns {Promise<number>} Time taken in ms
   */
  async moveTo(percent, rate = 50) {
    // Calculate current position (approximate)
    const currentPos = this.isUp === true ? this.posUp :
                       this.isUp === false ? this.posDown : 50;
    const distance = Math.abs(percent - currentPos);
    const delay = this._calculateMoveTime(distance, rate, 0);

    // Use S2 command for arbitrary servo position
    const position = this._positionToValue(percent);
    const rateValue = this._rateToValue(rate);

    await this.ebb.command(`S2,${position},${this.config.pin},${rateValue},${delay}`);

    if (delay > 50) {
      await this._sleep(delay - 30);
    }

    // Update state based on position relative to thresholds
    if (percent >= this.posUp - 5) {
      this.isUp = true;
    } else if (percent <= this.posDown + 5) {
      this.isUp = false;
    } else {
      this.isUp = null; // Unknown/intermediate
    }

    return delay;
  }

  /**
   * Update configuration
   * @param {Object} newConfig - New configuration values
   */
  async updateConfig(newConfig) {
    let needsReinit = false;

    if (newConfig.posUp !== undefined && newConfig.posUp !== this.posUp) {
      this.posUp = newConfig.posUp;
      needsReinit = true;
    }
    if (newConfig.posDown !== undefined && newConfig.posDown !== this.posDown) {
      this.posDown = newConfig.posDown;
      needsReinit = true;
    }
    if (newConfig.rateRaise !== undefined && newConfig.rateRaise !== this.rateRaise) {
      this.rateRaise = newConfig.rateRaise;
      needsReinit = true;
    }
    if (newConfig.rateLower !== undefined && newConfig.rateLower !== this.rateLower) {
      this.rateLower = newConfig.rateLower;
      needsReinit = true;
    }
    if (newConfig.delayUp !== undefined) {
      this.delayUp = newConfig.delayUp;
    }
    if (newConfig.delayDown !== undefined) {
      this.delayDown = newConfig.delayDown;
    }

    if (needsReinit && this.initialized) {
      // Re-send position and rate configurations
      await this.ebb.command(`SC,4,${this._positionToValue(this.posUp)}`);
      await this.ebb.command(`SC,5,${this._positionToValue(this.posDown)}`);
      await this.ebb.command(`SC,11,${this._rateToValue(this.rateRaise)}`);
      await this.ebb.command(`SC,12,${this._rateToValue(this.rateLower)}`);

      // If pen is currently down and posDown changed, move to new position
      if (this.isUp === false && newConfig.posDown !== undefined) {
        await this.penDown({ force: true });
      }
      // If pen is currently up and posUp changed, move to new position
      if (this.isUp === true && newConfig.posUp !== undefined) {
        await this.penUp({ force: true });
      }
    }
  }

  /**
   * Get current servo status
   * @returns {Object} Status information
   */
  getStatus() {
    return {
      initialized: this.initialized,
      isUp: this.isUp,
      isNarrowBand: this.isNarrowBand,
      config: {
        posUp: this.posUp,
        posDown: this.posDown,
        rateRaise: this.rateRaise,
        rateLower: this.rateLower,
        delayUp: this.delayUp,
        delayDown: this.delayDown,
        pin: this.config.pin,
        servoTimeout: this.servoTimeout
      },
      timing: {
        raiseTime: this._calculateMoveTime(Math.abs(this.posUp - this.posDown), this.rateRaise, this.delayUp),
        lowerTime: this._calculateMoveTime(Math.abs(this.posUp - this.posDown), this.rateLower, this.delayDown)
      }
    };
  }

  /**
   * Sleep helper
   * @param {number} ms - Milliseconds to sleep
   */
  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export default EBBServo;
