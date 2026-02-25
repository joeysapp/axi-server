import AxiDraw from './src/lib/axidraw.js';

async function run() {
  const axi = new AxiDraw({ model: 'V2_V3' });
  await axi.connect();
  await axi.initialize();
  
  console.log('Starting fast moves via execute');
  const commands = [];
  for(let i=0; i<5; i++) {
    commands.push({ type: 'move', dx: 10, dy: 0, units: 'mm' });
    commands.push({ type: 'move', dx: 0, dy: 10, units: 'mm' });
    commands.push({ type: 'move', dx: -10, dy: 0, units: 'mm' });
    commands.push({ type: 'move', dx: 0, dy: -10, units: 'mm' });
  }

  const start = Date.now();
  
  for (let i = 0; i < commands.length; i++) {
    await axi.execute([commands[i]]);
    // Simulate updateProgress
    Math.round((i + 1) / commands.length * 100);
  }
  
  const end = Date.now();
  console.log(`Finished in ${end - start}ms`);
  
  await axi.disconnect();
}

run().catch(console.error);
