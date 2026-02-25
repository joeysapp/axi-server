/**
 * EBB Serial Communication Module
 *
 * Low-level serial communication with EiBotBoard (EBB) devices.
 * Implements the EBB protocol: https://evil-mad.github.io/EggBot/ebb.html
 *
 * Supports firmware v2.5.5+ features including device naming (ST/QT commands).
 */

import { SerialPort } from 'serialport';
import { ReadlineParser } from '@serialport/parser-readline';

// EBB USB identifiers
const EBB_VID = '04D8';
const EBB_PID = 'FD92';

/**
 * EBBSerial - Manages serial connection to an EiBotBoard
 */
export class EBBSerial {
  constructor(options = {}) {
    this.port = null;
    this.parser = null;
    this.portPath = options.portPath || null;
    this.baudRate = options.baudRate || 9600;
    this.timeout = options.timeout || 5000; // Increased timeout for servo commands
    this.connected = false;
    this.responseQueue = [];
    this.pendingCommand = null;
    this.firmwareVersion = null;
    this.nickname = null;

    // Error recovery
    this._lastError = null;
    this._lastErrorTime = 0;
    this._reconnectBackoffMs = 1000; // Initial backoff

    // Callback for command errors (allows higher layers to reset state)
    this.onCommandError = options.onCommandError || null;
  }

  /**
   * Find all connected EiBotBoard devices
   * @returns {Promise<Array>} List of port info objects
   */
  static async listPorts() {
    const ports = await SerialPort.list();
    return ports.filter(port => {
      const vidPid = `${port.vendorId}:${port.productId}`.toUpperCase();
      return vidPid === `${EBB_VID}:${EBB_PID}` ||
             (port.manufacturer && port.manufacturer.includes('EiBotBoard'));
    });
  }

  /**
   * Find first available EiBotBoard
   * @returns {Promise<string|null>} Port path or null
   */
  static async findPort() {
    const ports = await EBBSerial.listPorts();
    return ports.length > 0 ? ports[0].path : null;
  }

  /**
   * Find EBB by name tag or port path
   * @param {string} nameOrPath - Device name or port path
   * @returns {Promise<string|null>} Port path or null
   */
  static async findNamedPort(nameOrPath) {
    if (!nameOrPath) return null;

    const ports = await SerialPort.list();
    const needle = nameOrPath.toLowerCase();

    for (const port of ports) {
      // Check direct path match
      if (port.path.toLowerCase() === needle ||
          port.path.toLowerCase().includes(needle)) {
        return port.path;
      }

      // Check serial number (name tag)
      if (port.serialNumber &&
          port.serialNumber.toLowerCase().includes(needle)) {
        return port.path;
      }
    }

    return null;
  }

  /**
   * Check if we should wait before reconnecting (backoff)
   * @returns {number} Milliseconds to wait, or 0 if ready
   */
  getReconnectDelay() {
    if (!this._lastErrorTime) return 0;
    const elapsed = Date.now() - this._lastErrorTime;
    const waitTime = this._reconnectBackoffMs - elapsed;
    return Math.max(0, waitTime);
  }

  /**
   * Record an error and increase backoff
   */
  _recordError(error) {
    this._lastError = error;
    this._lastErrorTime = Date.now();
    // Exponential backoff up to 10 seconds
    this._reconnectBackoffMs = Math.min(10000, this._reconnectBackoffMs * 2);
  }

  /**
   * Reset error state after successful operation
   */
  _clearErrors() {
    this._lastError = null;
    this._lastErrorTime = 0;
    this._reconnectBackoffMs = 1000;
  }

  /**
   * Connect to the EBB
   * @param {string} portPath - Optional specific port to connect to
   * @returns {Promise<boolean>} Success status
   */
  async connect(portPath = null) {
    if (this.connected) {
      return true;
    }

    // Check backoff
    const delay = this.getReconnectDelay();
    if (delay > 0) {
      console.log(`[Serial] Waiting ${delay}ms before reconnect (backoff)`);
      await new Promise(r => setTimeout(r, delay));
    }

    const targetPort = portPath || this.portPath || await EBBSerial.findPort();

    if (!targetPort) {
      throw new Error('No EiBotBoard found');
    }

    return new Promise((resolve, reject) => {
      this.port = new SerialPort({
        path: targetPort,
        baudRate: this.baudRate,
        autoOpen: false
      });

      this.parser = this.port.pipe(new ReadlineParser({ delimiter: '\r\n' }));

      this.parser.on('data', (data) => {
        this._handleResponse(data);
      });

      this.port.on('error', (err) => {
        console.error('Serial port error:', err);
        this.connected = false;
      });

      this.port.on('close', () => {
        this.connected = false;
      });

      this.port.open(async (err) => {
        if (err) {
          reject(new Error(`Failed to open port ${targetPort}: ${err.message}`));
          return;
        }

        this.portPath = targetPort;
        this.connected = true;

        // Flush input buffer
        this.port.flush();

        // Query version to verify connection
        try {
          const version = await this.queryVersion();
          if (version && version.startsWith('EBB')) {
            this.firmwareVersion = this._parseVersion(version);
            this._clearErrors(); // Success - reset backoff
            resolve(true);
          } else {
            // Retry once
            const version2 = await this.queryVersion();
            if (version2 && version2.startsWith('EBB')) {
              this.firmwareVersion = this._parseVersion(version2);
              this._clearErrors(); // Success - reset backoff
              resolve(true);
            } else {
              await this.disconnect();
              this._recordError(new Error('Device is not an EiBotBoard'));
              reject(new Error('Device is not an EiBotBoard'));
            }
          }
        } catch (e) {
          await this.disconnect();
          this._recordError(e);
          reject(e);
        }
      });
    });
  }

  /**
   * Disconnect from the EBB
   * @param {boolean} force - Force close even if commands pending
   */
  async disconnect(force = false) {
    // Clear any pending commands to prevent hangs
    if (this.pendingCommand) {
      const { reject, timer } = this.pendingCommand;
      clearTimeout(timer);
      if (reject) {
        reject(new Error('Disconnected'));
      }
      this.pendingCommand = null;
    }

    if (this.port && this.port.isOpen) {
      return new Promise((resolve) => {
        const closeTimeout = setTimeout(() => {
          // Force destroy if close doesn't complete
          console.log('[Serial] Force destroying port');
          try {
            this.port.destroy();
          } catch (e) {
            // Ignore
          }
          this.connected = false;
          this.port = null;
          this.parser = null;
          resolve();
        }, 1000);

        this.port.close((err) => {
          clearTimeout(closeTimeout);
          if (err) {
            console.log('[Serial] Close error:', err.message);
          }
          this.connected = false;
          this.port = null;
          this.parser = null;
          resolve();
        });
      });
    }
    this.connected = false;
    this.port = null;
    this.parser = null;
  }

  /**
   * Handle incoming serial data
   */
  _handleResponse(data) {
    if (!this.pendingCommand) {
      return;
    }

    const { resolve, reject, timer, expectOK, isQuery, needsOK, cmd } = this.pendingCommand;

    // Check for error response (!xx Err: or Err:)
    if (data.includes('Err:') || data.startsWith('!')) {
      clearTimeout(timer);
      this.pendingCommand = null;
      const error = new Error(`EBB Error: ${data} (Command: ${cmd})`);
      this._recordError(error);
      if (this.onCommandError) {
        this.onCommandError(error, cmd);
      }
      reject(error);
      return;
    }

    // For queries, we get data first, then potentially OK
    if (isQuery) {
      if (data === 'OK') {
        if (needsOK && this.pendingCommand.responseData !== undefined) {
          clearTimeout(timer);
          const res = this.pendingCommand.responseData;
          this.pendingCommand = null;
          resolve(res);
        } else if (!needsOK) {
          // Received unexpected OK, ignore
        } else {
          // Got OK before data? Resolve with empty string.
          clearTimeout(timer);
          this.pendingCommand = null;
          resolve('');
        }
        return;
      }

      if (needsOK) {
        this.pendingCommand.responseData = data;
      } else {
        clearTimeout(timer);
        this.pendingCommand = null;
        resolve(data);
      }
      return;
    }

    // For commands expecting OK
    if (expectOK) {
      if (data.startsWith('OK')) {
        clearTimeout(timer);
        this.pendingCommand = null;
        resolve(data);
      } else {
        // Might be additional data, wait for OK
        this.responseQueue.push(data);
      }
      return;
    }

    // Default
    clearTimeout(timer);
    this.pendingCommand = null;
    resolve(data);
  }

  async _processQueue() {
    if (this.isProcessingQueue || !this.commandQueue || this.commandQueue.length === 0) return;
    this.isProcessingQueue = true;

    while (this.commandQueue.length > 0) {
      const task = this.commandQueue[0];
      try {
        const result = await this._executeCommand(task);
        task.resolve(result);
      } catch (err) {
        task.reject(err);
      }
      this.commandQueue.shift();
    }

    this.isProcessingQueue = false;
  }

  async _executeCommand(task) {
    const { cmd, timeout, isQuery, needsOK } = task;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingCommand = null;
        const error = new Error(`Command timeout: ${cmd} (${timeout}ms)`);
        this._recordError(error);
        if (this.onCommandError) {
          this.onCommandError(error, cmd);
        }
        reject(error);
      }, timeout);

      this.pendingCommand = { resolve, reject, timer, expectOK: !isQuery, isQuery, needsOK, cmd };

      this.port.write(`${cmd}\r`, 'ascii', (err) => {
        if (err) {
          clearTimeout(timer);
          this.pendingCommand = null;
          const error = new Error(`Write error: ${err.message}`);
          this._recordError(error);
          if (this.onCommandError) {
            this.onCommandError(error, cmd);
          }
          reject(error);
        }
      });
    });
  }

  /**
   * Send a command and wait for OK response
   * @param {string} cmd - Command string (without \r)
   * @param {number} timeoutOverride - Optional timeout override in ms
   * @returns {Promise<string>} Response
   */
  async command(cmd, timeoutOverride = null) {
    if (!this.connected || !this.port) {
      throw new Error('Not connected to EBB');
    }

    if (!this.commandQueue) this.commandQueue = [];

    return new Promise((resolve, reject) => {
      this.commandQueue.push({ 
        cmd, 
        timeout: timeoutOverride || this.timeout, 
        isQuery: false, 
        needsOK: true, 
        resolve, 
        reject 
      });
      this._processQueue();
    });
  }

  /**
   * Send a query and get response data
   * @param {string} cmd - Query command (without \r)
   * @param {number} timeoutOverride - Optional timeout override in ms
   * @returns {Promise<string>} Response data
   */
  async query(cmd, timeoutOverride = null) {
    if (!this.connected || !this.port) {
      throw new Error('Not connected to EBB');
    }

    if (!this.commandQueue) this.commandQueue = [];

    // Commands that don't return trailing OK
    const noOKCommands = ['A', 'I', 'MR', 'PI', 'QM', 'QG', 'V'];
    const cmdBase = cmd.split(',')[0].trim().toUpperCase();
    const needsOK = !noOKCommands.includes(cmdBase);

    return new Promise((resolve, reject) => {
      this.commandQueue.push({ 
        cmd, 
        timeout: timeoutOverride || this.timeout, 
        isQuery: true, 
        needsOK, 
        resolve, 
        reject 
      });
      this._processQueue();
    });
  }

  /**
   * Send raw data without waiting for response (e.g., bootloader)
   * @param {string} data - Raw data to send
   */
  async writeRaw(data) {
    if (!this.connected || !this.port) {
      throw new Error('Not connected to EBB');
    }

    return new Promise((resolve, reject) => {
      this.port.write(data, 'ascii', (err) => {
        if (err) {
          reject(new Error(`Write error: ${err.message}`));
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * Parse firmware version string
   */
  _parseVersion(versionString) {
    const match = versionString.match(/Firmware Version (\d+\.\d+\.\d+)/);
    return match ? match[1] : null;
  }

  /**
   * Check if firmware version meets minimum requirement
   * @param {string} minVersion - Minimum version string (e.g., "2.5.5")
   * @returns {boolean}
   */
  minVersion(minVersion) {
    if (!this.firmwareVersion) return false;

    const current = this.firmwareVersion.split('.').map(Number);
    const required = minVersion.split('.').map(Number);

    for (let i = 0; i < 3; i++) {
      if (current[i] > required[i]) return true;
      if (current[i] < required[i]) return false;
    }
    return true;
  }

  // ==================== Basic Queries ====================

  /**
   * Query firmware version (V command)
   * @returns {Promise<string>} Version string
   */
  async queryVersion() {
    return this.query('V');
  }

  /**
   * Query general status (QG command) - returns hex status byte
   * Bits: 0=PRG button, 1=pen state, 2=command executing, 3=motor1, 4=motor2, 5=FIFO empty, 6=GPIO, 7=power
   * @returns {Promise<number>} Status byte
   */
  async queryGeneral() {
    const response = await this.query('QG');
    return parseInt(response, 16);
  }

  /**
   * Wait for all motors to stop and FIFO to empty
   * @param {number} maxWaitMs - Maximum wait time in ms (default 60000)
   * @param {number} pollIntervalMs - Poll interval in ms (default 50)
   * @returns {Promise<boolean>} True if idle, false if timeout
   */
  async waitForIdle(maxWaitMs = 60000, pollIntervalMs = 50) {
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitMs) {
      try {
        const status = await this.queryGeneral();
        // Check bits 2 (command executing), 3 (motor1), 4 (motor2)
        // Bit 5 (FIFO empty) should be 1 when idle
        const commandExecuting = !!(status & 0x04);
        const motor1Moving = !!(status & 0x08);
        const motor2Moving = !!(status & 0x10);
        const fifoEmpty = !!(status & 0x20);

        if (!commandExecuting && !motor1Moving && !motor2Moving && fifoEmpty) {
          return true; // Idle
        }
      } catch (e) {
        // Query failed, wait and retry
      }

      await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    }

    return false; // Timeout
  }

  /**
   * Query pen state (QP command) - DEPRECATED in v3.0, use QG
   * @returns {Promise<boolean>} True if pen is up
   */
  async queryPenUp() {
    const response = await this.query('QP');
    return response.trim() === '1';
  }

  /**
   * Query step positions (QS command)
   * @returns {Promise<{motor1: number, motor2: number}>}
   */
  async querySteps() {
    const response = await this.query('QS');
    const [m1, m2] = response.split(',').map(s => parseInt(s.trim()));
    return { motor1: m1, motor2: m2 };
  }

  /**
   * Query motor enable states (QE command)
   * @returns {Promise<{motor1: number, motor2: number}>} Resolution modes (0=disabled, 1-5=enabled)
   */
  async queryMotors() {
    const response = await this.query('QE');
    const [m1, m2] = response.split(',').map(s => parseInt(s.trim()));
    return { motor1: m1, motor2: m2 };
  }

  /**
   * Query EBB layer variable (QL command) - 8-bit storage
   * @param {number} index - Variable index (0-31)
   * @returns {Promise<number>}
   */
  async queryVariable(index = 0) {
    const response = await this.query(`QL,${index}`);
    return parseInt(response.trim());
  }

  /**
   * Query voltage (QC command)
   * @returns {Promise<{current: number, voltage: number}>} ADC values
   */
  async queryVoltage() {
    const response = await this.query('QC');
    const [current, voltage] = response.split(',').map(s => parseInt(s.trim()));
    return { current, voltage };
  }

  /**
   * Query nickname (QT command) - requires v2.5.5+
   * @returns {Promise<string|null>}
   */
  async queryNickname() {
    if (!this.minVersion('2.5.5')) return null;
    const response = await this.query('QT');
    const name = response.trim();
    this.nickname = name || null;
    return this.nickname;
  }

  /**
   * Query RC servo power state (QR command)
   * @returns {Promise<boolean>} True if powered
   */
  async queryServoPower() {
    const response = await this.query('QR');
    return response.trim() === '1';
  }

  /**
   * Query PRG button state (QB command) - DEPRECATED in v3.0, use QG
   * @returns {Promise<boolean>} True if pressed
   */
  async queryButton() {
    const response = await this.query('QB');
    return response.trim() === '1';
  }

  // ==================== System Commands ====================

  /**
   * Reset EBB to default state (R command)
   */
  async reset() {
    return this.command('R');
  }

  /**
   * Reboot EBB (RB command) - requires v2.5.5+
   */
  async reboot() {
    if (!this.minVersion('2.5.5')) {
      throw new Error('Reboot requires firmware v2.5.5+');
    }
    try {
      await this.writeRaw('RB\r');
    } catch (e) {
      // Expected - device will disconnect
    }
    this.connected = false;
  }

  /**
   * Enter bootloader mode (BL command)
   */
  async bootload() {
    try {
      await this.writeRaw('BL\r');
    } catch (e) {
      // Expected - device will disconnect
    }
    this.connected = false;
  }

  /**
   * Set nickname (ST command) - requires v2.5.5+
   * @param {string} name - Nickname (3-16 characters)
   */
  async setNickname(name) {
    if (!this.minVersion('2.5.5')) {
      throw new Error('Naming requires firmware v2.5.5+');
    }
    if (name.length < 3 || name.length > 16) {
      throw new Error('Nickname must be 3-16 characters');
    }
    await this.command(`ST,${name}`);
    this.nickname = name;
  }

  /**
   * Set layer variable (SL command) - 8-bit storage
   * @param {number} value - Value (0-255)
   * @param {number} index - Variable index (0-31)
   */
  async setVariable(value, index = 0) {
    return this.command(`SL,${value},${index}`);
  }

  /**
   * Clear step positions (CS command)
   */
  async clearSteps() {
    return this.command('CS');
  }

  /**
   * Emergency stop (ES command)
   * @param {boolean} disableMotors - Also disable motors
   */
  async emergencyStop(disableMotors = false) {
    return this.command(`ES${disableMotors ? ',1' : ''}`);
  }

  // ==================== Connection Info ====================

  /**
   * Get connection status info
   * @returns {Object} Connection information
   */
  getInfo() {
    return {
      connected: this.connected,
      portPath: this.portPath,
      firmwareVersion: this.firmwareVersion,
      nickname: this.nickname
    };
  }
}

export default EBBSerial;
