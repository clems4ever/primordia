import { World } from '../sim.js';
const seed = +process.argv[2] || 1, T = +process.argv[3] || 30000;
const w = new World({ seed });
const t0 = Date.now();
for (let i = 1; i <= T; i++) {
  w.step();
  if (i % 2500 === 0) {
    const h = w.history.at(-1);
    const preds = w.creatures.filter(c => c.g.diet > 0.5);
    const avg = (a, f) => a.length ? (a.reduce((s, c) => s + f(c), 0) / a.length).toFixed(2) : '-';
    console.log(`t=${i} herb=${h.herb} pred=${h.pred} food=${h.food} gen=${w.stats.maxGen} clades=${h.clades.toFixed(1)} size=${h.size.toFixed(2)} predSize=${avg(preds,c=>c.g.size)} spd=${avg(w.creatures,c=>c.speed)} kills=${w.stats.kills} ms/step=${((Date.now()-t0)/i).toFixed(2)}`);
  }
}
for (const e of w.events) console.log('  ev', e.t, e.text);
