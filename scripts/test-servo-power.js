#!/usr/bin/env node
/**
 * Test servo with explicit power enable
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
    pendingTimer = setTimeout(() => { pendingResolve = null; reject(new Error(`Timeout: ${cmd}`)); }, timeout);
    pendingResolve = resolve;
    console.log(`>> ${cmd}`);
    port.write(`${cmd}\r`, 'ascii');
  });
}

async function cmd(c) { const r = await send(c); console.log(`<< ${r}`); return r; }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  console.log('=== Servo Power Test ===\n');

  const portPath = await findEBB();
  if (!portPath) { console.log('No EBB found!'); process.exit(1); }

  await connect(portPath);
  console.log(`Connected to ${portPath}\n`);

  // Check current power state
  console.log('1. Checking servo power state...');
  const qr1 = await cmd('QR');
  console.log(`   Servo power: ${qr1.trim() === '1' ? 'ON' : 'OFF'}\n`);

  // The SR command sets the servo timeout in ms (0 = never timeout)
  // But more importantly, sending ANY servo command should power it on
  // Let's try the "enable servo" command sequence

  console.log('2. Sending SR,0 to disable timeout (keep servo always on)...');
  await cmd('SR,0');

  console.log('\n3. Setting up servo positions...');
  // Use standard servo range on Pin 1 first
  await cmd('SC,4,16000');  // pen up position
  await cmd('SC,5,12000');  // pen down position
  await cmd('SC,10,65535'); // max rate

  console.log('\n4. Sending SP,1,1000 (pen up with 1 second duration)...');
  await cmd('SP,1,1000');

  console.log('\n5. Checking servo power now...');
  await sleep(100);
  const qr2 = await cmd('QR');
  console.log(`   Servo power: ${qr2.trim() === '1' ? 'ON' : 'OFF'}\n`);

  console.log('6. Waiting 1.5 seconds for servo to finish moving...');
  await sleep(1500);

  console.log('\n7. Sending SP,0,1000 (pen down)...');
  await cmd('SP,0,1000');
  await sleep(1500);

  // Now try Pin 2 (brushless)
  console.log('\n8. Testing Pin 2 (brushless servo header)...');
  console.log('   Setting narrow-band range...');
  await cmd('SC,4,9720');   // 60% up position
  await cmd('SC,5,7560');   // 30% down position
  await cmd('SC,8,1');      // single channel mode

  console.log('\n9. SP,1,500,2 (pen up on pin 2)...');
  await cmd('SP,1,500,2');
  await sleep(700);

  console.log('\n10. SP,0,500,2 (pen down on pin 2)...');
  await cmd('SP,0,500,2');
  await sleep(700);

  // Check QR again
  console.log('\n11. Final servo power check...');
  const qr3 = await cmd('QR');
  console.log(`   Servo power: ${qr3.trim() === '1' ? 'ON' : 'OFF'}\n`);

  console.log('=== RESULTS ===');
  console.log('Did ANY of the above cause the servo to move?');
  console.log('');
  console.log('If Pin 1 (steps 4,7) worked: servo is on B1 header');
  console.log('If Pin 2 (steps 9,10) worked: servo is on B2 header (brushless)');
  console.log('If NOTHING worked: hardware issue or servo not connected');
  console.log('');

  port.close();
}

main().catch(e => { console.error(e); process.exit(1); });
