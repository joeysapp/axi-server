import AxiDraw from './src/lib/axidraw.js';

async function run() {
  const axi = new AxiDraw({ model: 'V2_V3' });
  await axi.connect();
  await axi.initialize();
  
  console.log('Starting fast moves');
  const start = Date.now();
  for(let i=0; i<5; i++) {
    await axi.move(10, 0, 'mm');
    await axi.move(0, 10, 'mm');
    await axi.move(-10, 0, 'mm');
    await axi.move(0, -10, 'mm');
  }
  const end = Date.now();
  console.log(`Finished in ${end - start}ms`);
  
  await axi.disconnect();
}

run().catch(console.error);
