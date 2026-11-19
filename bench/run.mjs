// Measures one simulation build in this process. Prints one JSON line.
// usage: node bench/run.mjs <sim.js path> <seeds,comma,separated> <warm> <steps>
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const [file, seedArg = '1,7,42', warmArg = '4000', stepsArg = '1500'] = process.argv.slice(2);
const { World } = await import(pathToFileURL(file).href);
const warm = +warmArg, steps = +stepsArg;

// Fingerprint of the full simulation state: identical builds must give identical hashes.
function fingerprint(w) {
  const h = createHash('sha256');
  const f = new Float64Array(8);
  for (const c of w.creatures) {
    f.set([c.id, c.x, c.y, c.ang, c.speed, c.energy, c.age, c.g.size]);
    h.update(Buffer.from(f.buffer));
  }
  h.update(Buffer.from(new Float64Array(w.fx).buffer));
  h.update(Buffer.from(new Float64Array(w.fy).buffer));
  h.update(`${w.t}|${w.stats.births}|${w.stats.kills}|${w.stats.deaths}`);
  return h.digest('hex').slice(0, 16);
}

const out = [];
for (const seed of seedArg.split(',').map(Number)) {
  const w = new World({ seed });
  for (let i = 0; i < warm; i++) w.step();          // reach an evolved, busy state
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < steps; i++) w.step();
  const ms = Number(process.hrtime.bigint() - t0) / 1e6 / steps;
  out.push({ seed, msPerStep: ms, creatures: w.creatures.length, hash: fingerprint(w) });
}
console.log(JSON.stringify(out));
