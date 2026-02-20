#!/usr/bin/env node
/**
 * AxiDraw Brushless Servo Diagnostic Script
 *
 * Tests various servo commands to diagnose why pen up/down isn't working.
 * For SE A4 with brushless servo upgrade (~2020).
 */

import { SerialPort } from 'serialport';
import { ReadlineParser } from '@serialport/parser-readline';

const EBB_VID = '04D8';
const EBB_PID = 'FD92';

let port = null;
let parser = null;
let pendingResolve = null;
let pendingReject = null;
let pendingTimer = null;

async function findEBB() {
  const ports = await SerialPort.list();
  console.log('\n=== Available Serial Ports ===');
  for (const p of ports) {
    console.log(`  ${p.path} - VID:${p.vendorId || 'n/a'} PID:${p.productId || 'n/a'} - ${p.manufacturer || 'unknown'}`);
  }

  const ebb = ports.find(p => {
    const vidPid = `${p.vendorId}:${p.productId}`.toUpperCase();
    return vidPid === `${EBB_VID}:${EBB_PID}`;
  });

  return ebb ? ebb.path : null;
}

async function connect(portPath) {
  return new Promise((resolve, reject) => {
    port = new SerialPort({
      path: portPath,
      baudRate: 9600,
      autoOpen: false
    });

    parser = port.pipe(new ReadlineParser({ delimiter: '\r\n' }));

    parser.on('data', (data) => {
      if (pendingResolve) {
        clearTimeout(pendingTimer);
        const res = pendingResolve;
        pendingResolve = null;
        pendingReject = null;
        res(data);
      } else {
        console.log(`  [unexpected data]: ${data}`);
      }
    });

    port.on('error', (err) => {
      console.error('Port error:', err);
    });

    port.open((err) => {
      if (err) reject(err);
      else {
        port.flush();
        setTimeout(() => resolve(), 200);
      }
    });
  });
}

async function send(cmd, timeout = 3000) {
  return new Promise((resolve, reject) => {
    pendingTimer = setTimeout(() => {
      pendingResolve = null;
      pendingReject = null;
      reject(new Error(`Timeout: ${cmd}`));
    }, timeout);

    pendingResolve = resolve;
    pendingReject = reject;

    console.log(`  >> ${cmd}`);
    port.write(`${cmd}\r`, 'ascii');
  });
}

async function query(cmd) {
  const response = await send(cmd);
  console.log(`  << ${response}`);
  return response;
}

async function command(cmd) {
  const response = await send(cmd);
  if (response.startsWith('Err')) {
    console.log(`  << ERROR: ${response}`);
  } else {
    console.log(`  << ${response}`);
  }
  return response;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  console.log('==============================================');
  console.log('AxiDraw Brushless Servo Diagnostic');
  console.log('==============================================');

  const portPath = await findEBB();

  if (!portPath) {
    console.log('\n❌ No EiBotBoard found!');
    console.log('   - Check USB connection');
    console.log('   - Try a different USB cable');
    console.log('   - Check if device shows in System Information > USB');
    process.exit(1);
  }

  console.log(`\n✓ Found EBB at: ${portPath}`);

  try {
    await connect(portPath);
    console.log('✓ Connected\n');

    // 1. Query firmware version
    console.log('=== Firmware Version ===');
    const version = await query('V');
    const vMatch = version.match(/(\d+\.\d+\.\d+)/);
    const fwVersion = vMatch ? vMatch[1] : 'unknown';
    console.log(`  Firmware: ${fwVersion}\n`);

    // 2. Query current status
    console.log('=== Current Status ===');
    const statusHex = await query('QG');
    const status = parseInt(statusHex, 16);
    console.log(`  Raw status: 0x${statusHex} (${status})`);
    console.log(`  - Pen state (QG bit 1): ${(status & 0x02) ? 'UP' : 'DOWN'}`);
    console.log(`  - Command executing: ${(status & 0x04) ? 'yes' : 'no'}`);
    console.log(`  - Motor 1 moving: ${(status & 0x08) ? 'yes' : 'no'}`);
    console.log(`  - Motor 2 moving: ${(status & 0x10) ? 'yes' : 'no'}\n`);

    // 3. Query servo power state
    console.log('=== Servo Power ===');
    try {
      const servoPower = await query('QR');
      console.log(`  Servo powered: ${servoPower.trim() === '1' ? 'YES' : 'NO'}\n`);
    } catch (e) {
      console.log(`  QR command failed (may not be supported): ${e.message}\n`);
    }

    // 4. Query pen position (legacy)
    console.log('=== Pen Position (QP) ===');
    try {
      const penPos = await query('QP');
      console.log(`  QP response: ${penPos} (1=up, 0=down)\n`);
    } catch (e) {
      console.log(`  QP failed: ${e.message}\n`);
    }

    // 5. Test standard servo commands (pin 1)
    console.log('=== Testing Standard Servo (Pin 1 - B1) ===');
    console.log('  Sending SC,4,16000 (pen-up position)...');
    await command('SC,4,16000');
    console.log('  Sending SC,5,12000 (pen-down position)...');
    await command('SC,5,12000');
    console.log('  Sending SC,10,65535 (max rate)...');
    await command('SC,10,65535');

    console.log('  Sending SP,1,500 (pen UP, pin 1 default)...');
    await command('SP,1,500');
    await sleep(600);

    console.log('  Sending SP,0,500 (pen DOWN, pin 1 default)...');
    await command('SP,0,500');
    await sleep(600);

    console.log('  Did the servo move? If yes, standard servo works.\n');

    // 6. Test brushless servo commands (pin 2)
    console.log('=== Testing Brushless Servo (Pin 2 - B2) ===');
    console.log('  For ~2020 brushless upgrade, servo is on Pin B2.');
    console.log('  Using narrow-band pulse range (5400-12600).\n');

    // Configure for narrow-band
    const posUp = 60;
    const posDown = 30;
    const upValue = 5400 + 72 * posUp;   // 9720
    const downValue = 5400 + 72 * posDown; // 7560

    console.log(`  Configuring: posUp=${posUp}% (${upValue}), posDown=${posDown}% (${downValue})`);
    console.log('  Sending SC,4,' + upValue + ' (pen-up position)...');
    await command(`SC,4,${upValue}`);
    console.log('  Sending SC,5,' + downValue + ' (pen-down position)...');
    await command(`SC,5,${downValue}`);
    console.log('  Sending SC,10,65535 (max rate)...');
    await command('SC,10,65535');
    console.log('  Sending SC,8,1 (single channel for narrow-band)...');
    await command('SC,8,1');

    console.log('\n  Testing pen UP on Pin 2...');
    console.log('  Sending SP,1,200,2 (pen UP, pin 2)...');
    await command('SP,1,200,2');
    await sleep(400);

    console.log('  Testing pen DOWN on Pin 2...');
    console.log('  Sending SP,0,200,2 (pen DOWN, pin 2)...');
    await command('SP,0,200,2');
    await sleep(400);

    console.log('\n  Did the servo move? If yes, brushless servo on pin 2 works.\n');

    // 7. Test S2 command for direct servo positioning
    console.log('=== Testing S2 Command (Direct Servo Position) ===');
    console.log('  S2 allows setting arbitrary servo positions.\n');

    console.log('  S2 on Pin 2, position 9720 (60%), rate 400...');
    await command('S2,9720,2,400,200');
    await sleep(400);

    console.log('  S2 on Pin 2, position 7560 (30%), rate 400...');
    await command('S2,7560,2,400,200');
    await sleep(400);

    // 8. Test wider pulse range (maybe servo needs recalibration?)
    console.log('\n=== Testing Wider Pulse Range ===');
    console.log('  If narrow-band range is wrong, try standard range on pin 2...\n');

    console.log('  Sending SC,4,20000 (wider up position)...');
    await command('SC,4,20000');
    console.log('  Sending SC,5,12000 (wider down position)...');
    await command('SC,5,12000');

    console.log('  Sending SP,1,500,2 (pen UP, pin 2, standard range)...');
    await command('SP,1,500,2');
    await sleep(600);

    console.log('  Sending SP,0,500,2 (pen DOWN, pin 2, standard range)...');
    await command('SP,0,500,2');
    await sleep(600);

    // 9. Summary
    console.log('\n==============================================');
    console.log('DIAGNOSTIC SUMMARY');
    console.log('==============================================');
    console.log(`Firmware: ${fwVersion}`);
    console.log('');
    console.log('If NOTHING moved:');
    console.log('  1. Check the servo cable connection to the EBB board');
    console.log('  2. Check that servo is plugged into the correct header (B1 or B2)');
    console.log('  3. Try swapping the servo to the other header');
    console.log('  4. Check if servo makes any sound/vibration when commands sent');
    console.log('  5. Try a different servo to rule out hardware failure');
    console.log('');
    console.log('If Pin 1 worked but not Pin 2:');
    console.log('  - Your servo is connected to B1, not B2');
    console.log('  - Either move the servo to B2, or configure software for standard servo');
    console.log('');
    console.log('If Pin 2 worked but not Pin 1:');
    console.log('  - Your servo is correctly on B2 (brushless upgrade)');
    console.log('  - Software needs AXIDRAW_NARROW_BAND=true');
    console.log('');
    console.log('If S2 worked but SP did not:');
    console.log('  - Firmware may have a bug with SP command');
    console.log('  - Consider firmware update');
    console.log('');

  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    if (port && port.isOpen) {
      port.close();
    }
  }
}

main();
