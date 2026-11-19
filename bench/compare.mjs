// A/B benchmark of two builds of sim.js, run in alternating child processes.
// usage: node bench/compare.mjs <base> <candidate> [rounds=7] [seeds=1,7,42] [warm=4000] [steps=1500]
//   <base>/<candidate> are file paths, or git:<ref> to take sim.js from a commit.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const [baseArg, candArg, rounds = '7', seeds = '1,7,42', warm = '4000', steps = '1500'] = process.argv.slice(2);
const tmp = mkdtempSync(join(tmpdir(), 'primordia-bench-'));
const resolveBuild = (arg, name) => {
  if (!arg.startsWith('git:')) return resolve(arg);
  const p = join(tmp, `${name}-sim.js`);
  writeFileSync(p, execFileSync('git', ['show', `${arg.slice(4)}:sim.js`]));
  return p;
};
const builds = { base: resolveBuild(baseArg, 'base'), cand: resolveBuild(candArg, 'cand') };
const run = (file) => JSON.parse(execFileSync('node', [new URL('./run.mjs', import.meta.url).pathname, file, seeds, warm, steps]).toString());

const res = { base: [], cand: [] };
for (let r = 0; r < +rounds; r++) {
  const order = r % 2 ? ['cand', 'base'] : ['base', 'cand'];   // alternate to cancel drift
  for (const k of order) res[k].push(run(builds[k]));
  process.stderr.write(`round ${r + 1}/${rounds}\n`);
}

const median = (a) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const seedList = seeds.split(',').map(Number);
// per round: geometric mean over seeds of base/cand time ratio
const ratios = res.base.map((b, r) => Math.exp(seedList.reduce((s, _, i) => s + Math.log(b[i].msPerStep / res.cand[r][i].msPerStep), 0) / seedList.length));
// bootstrap 95% CI of the median ratio
let rng = 12345; const rand = () => ((rng = (rng * 1103515245 + 12345) % 2147483648) / 2147483648);
const boots = Array.from({ length: 4000 }, () => median(ratios.map(() => ratios[(rand() * ratios.length) | 0]))).sort((a, b) => a - b);

console.log(`base: ${baseArg}   candidate: ${candArg}   rounds=${rounds} warm=${warm} steps=${steps}`);
for (const [i, seed] of seedList.entries()) {
  const b = median(res.base.map((x) => x[i].msPerStep)), c = median(res.cand.map((x) => x[i].msPerStep));
  const hb = res.base[0][i].hash, hc = res.cand[0][i].hash;
  console.log(`seed ${String(seed).padStart(3)}  base ${b.toFixed(3)} ms/step  cand ${c.toFixed(3)} ms/step  x${(b / c).toFixed(2)}  ` +
    `creatures ${res.base[0][i].creatures}  state ${hb === hc ? 'IDENTICAL' : `DIFFERS (${hb} vs ${hc})`}`);
}
console.log(`speedup (geo-mean over seeds): median x${median(ratios).toFixed(3)}  95% CI [x${boots[100].toFixed(3)}, x${boots[3899].toFixed(3)}]`);
console.log(`per-round: ${ratios.map((r) => r.toFixed(3)).join(' ')}`);
