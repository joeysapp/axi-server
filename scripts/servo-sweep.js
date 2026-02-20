#!/usr/bin/env node
/**
 * Servo Sweep Test
 *
 * Sweeps through a wide range of pulse widths on both pins
 * to find if the servo responds to ANY position.
 */

import { SerialPort } from 'serialport';
import { ReadlineParser } from '@serialport/parser-readline';

const EBB_VID = '04D8';
const EBB_PID = 'FD92';

let port = null;
let pendingResolve = null;
let pendingTimer = null;

async function findEBB() {
  const ports = await SerialPort.list();
  const ebb = ports.find(p => `${p.vendorId}:${p.productId}`.toUpperCase() === `${EBB_VID}:${EBB_PID}`);
  return ebb ? ebb.path : null;
}

async function connect(portPath) {
  return new Promise((resolve, reject) => {
    port = new SerialPort({ path: portPath, baudRate: 9600, autoOpen: false });
    const parser = port.pipe(new ReadlineParser({ delimiter: '\r\n' }));
    parser.on('data', (data) => {
      if (pendingResolve) {
        clearTimeout(pendingTimer);
        const res = pendingResolve;
        pendingResolve = null;
        res(data);
      }
    });
    port.open((err) => {
      if (err) reject(err);
      else { port.flush(); setTimeout(() => resolve(), 200); }
    });
  });
}

async function send(cmd, timeout = 3000) {
  return new Promise((resolve, reject) => {
    pendingTimer = setTimeout(() => { pendingResolve = null; reject(new Error(`Timeout`)); }, timeout);
    pendingResolve = resolve;
    port.write(`${cmd}\r`, 'ascii');
  });
}

async function cmd(c, silent = false) {
  if (!silent) console.log(`>> ${c}`);
  const r = await send(c);
  return r;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const pin = process.argv[2] ? parseInt(process.argv[2]) : null;

  if (!pin || (pin !== 1 && pin !== 2)) {
    console.log('Usage: node servo-sweep.js <pin>');
    console.log('  pin 1 = Standard servo header (B1)');
    console.log('  pin 2 = Brushless servo header (B2)');
    console.log('');
    console.log('Example: node servo-sweep.js 2');
    process.exit(1);
  }

  console.log(`=== Servo Sweep Test - Pin ${pin} ===\n`);

  const portPath = await findEBB();
  if (!portPath) { console.log('No EBB found!'); process.exit(1); }

  await connect(portPath);
  console.log(`Connected to ${portPath}\n`);

  // Disable timeout
  await cmd('SR,0');

  // The S2 command directly sets servo position:
  // S2,Position,Pin,Rate,Delay
  // Position: servo pulse width in ~83.3ns units
  // - 1ms pulse = 12000
  // - 1.5ms pulse = 18000 (center for most servos)
  // - 2ms pulse = 24000

  // For narrow-band brushless (0.45-1.05ms):
  // - 0.45ms = 5400
  // - 0.75ms = 9000 (center)
  // - 1.05ms = 12600

  // For standard (0.82-2.32ms):
  // - 0.82ms = 9855
  // - 1.57ms = 18843 (center)
  // - 2.32ms = 27831

  console.log('This will sweep through various pulse widths.');
  console.log('Watch the servo and note which positions cause movement.\n');
  console.log('Press Ctrl+C to stop at any time.\n');

  await sleep(1000);

  // Sweep ranges to test
  const ranges = [
    { name: 'Narrow-band (brushless)', min: 5400, max: 12600 },
    { name: 'Standard servo', min: 9855, max: 27831 },
    { name: 'Extended range', min: 4000, max: 30000 },
  ];

  for (const range of ranges) {
    console.log(`\n--- Testing ${range.name} range (${range.min}-${range.max}) on Pin ${pin} ---`);
    console.log('Sweeping from min to max...\n');

    const steps = 10;
    const stepSize = (range.max - range.min) / steps;

    for (let i = 0; i <= steps; i++) {
      const pos = Math.round(range.min + i * stepSize);
      const pct = Math.round(i * 10);
      process.stdout.write(`  Position ${pos} (${pct}%)... `);

      // S2,Position,Pin,Rate,Delay
      // Rate of 400 gives reasonable speed
      // Delay of 100ms before returning
      await cmd(`S2,${pos},${pin},400,100`, true);
      await sleep(300);
      console.log('done');
    }

    console.log('\nSweeping back from max to min...\n');

    for (let i = steps; i >= 0; i--) {
      const pos = Math.round(range.min + i * stepSize);
      const pct = Math.round(i * 10);
      process.stdout.write(`  Position ${pos} (${pct}%)... `);
      await cmd(`S2,${pos},${pin},400,100`, true);
      await sleep(300);
      console.log('done');
    }

    console.log('\nDid the servo move during this range? (y/n)');
    await sleep(2000);
  }

  console.log('\n=== Test Complete ===');
  console.log('');
  console.log('If the servo moved:');
  console.log('  - Note which range worked');
  console.log('  - The servo configuration may need adjustment');
  console.log('');
  console.log('If the servo did NOT move at all:');
  console.log('  - Check physical cable connection');
  console.log('  - Try the other pin (1 or 2)');
  console.log('  - The servo may be defective');
  console.log('');

  port.close();
}

main().catch(e => { console.error(e); process.exit(1); });
