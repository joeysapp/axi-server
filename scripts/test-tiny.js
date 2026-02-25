import AxiDraw from './src/lib/axidraw.js';

async function run() {
  const axi = new AxiDraw({ model: 'V2_V3' });
  await axi.connect();
  await axi.initialize();
  
  console.log('Starting 20 tiny moves (0.1mm)');
  const start = Date.now();
  for(let i=0; i<20; i++) {
    await axi.move(0.1, 0, 'mm');
  }
  const end = Date.now();
  console.log(`Finished in ${end - start}ms`);
  
  await axi.disconnect();
}

run().catch(console.error);
