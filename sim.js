// Primordia — simulation core. Pure logic, no DOM: runs in the browser and in Node.

export const NSECT = 5;                       // vision sectors across the field of view
export const IN_LABELS = [
  ...Array.from({ length: NSECT }, (_, i) => `food ${i + 1}`),
  ...Array.from({ length: NSECT }, (_, i) => `prey ${i + 1}`),
  ...Array.from({ length: NSECT }, (_, i) => `threat ${i + 1}`),
  'energy', 'clock', 'mem A', 'mem B', 'bias',
];
export const OUT_LABELS = ['turn', 'thrust', 'mem A', 'mem B'];
export const NIN = IN_LABELS.length;          // 20
export const NH = 10;
export const NOUT = OUT_LABELS.length;        // 4
export const NW = NIN * NH + NH + NH * NOUT + NOUT;
// Visual-only genes: they shape how a creature looks, never how it behaves.
export const MORPH = ['tail', 'fins', 'pattern', 'accent', 'stretch', 'spikes'];

export const DEFAULTS = {
  width: 2000, height: 1250,
  foodRate: 5,          // pellets spawned per tick
  maxFood: 2600,
  mutation: 1.0,        // multiplier on all mutation sizes
  pelletEnergy: 9,
  initialPop: 160,
  initialPredators: 14,
  respawn: false,       // spontaneous generation: re-seed when life nearly vanishes
  minPop: 12,           // ...below this population
  maxPop: 900,
  maxAge: 5000,
  fov: 2.6,
  gardens: 4,
};

const CELL = 60;
const TAU = Math.PI * 2;

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const wrapAngle = (a) => { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; };

export class World {
  constructor(opts = {}) {
    this.cfg = { ...DEFAULTS, ...opts };
    this.reset(opts.seed ?? (Math.random() * 1e9) | 0);
  }

  reset(seed) {
    const c = this.cfg;
    this.seed = seed;
    this.rand = mulberry32(seed);
    // a separate stream for visual genes, so looks can evolve without changing the simulation
    this.randLook = mulberry32(seed ^ 0x5bd1e995);
    this.t = 0;
    this.nextId = 1;
    this.secX = new Float64Array(NSECT + 1); this.secY = new Float64Array(NSECT + 1);
    this.vCell = new Int32Array(512); this.vOx = new Float64Array(512); this.vOy = new Float64Array(512);
    this.creatures = [];
    this.parentOf = new Map();                         // id -> parent id, for family trees
    this.fx = []; this.fy = []; this.fe = [];          // food pellets (struct of arrays)
    this.events = [];
    this.history = [];
    this.fxq = [];                                     // visual effects queue for the renderer
    this.stats = { births: 0, deaths: 0, kills: 0, maxGen: 0 };
    this.milestone = 10;
    this.hadPredators = false;
    this.extinct = false;
    this.gardenPhase = Array.from({ length: c.gardens }, () => [this.rand() * TAU, this.rand() * TAU,
      0.6 + this.rand() * 0.8, 0.6 + this.rand() * 0.8]);
    for (let i = 0; i < c.maxFood * 0.6; i++) this.spawnFood();
    for (let i = 0; i < c.initialPop; i++) this.addCreature(this.randomGenome(i < c.initialPredators));
    this.log('A new world begins.', 'info');
  }

  gauss() {
    let u = 0, v = 0;
    while (u === 0) u = this.rand();
    while (v === 0) v = this.rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v);
  }

  log(text, kind = 'info') {
    this.events.push({ t: this.t, text, kind });
    if (this.events.length > 60) this.events.shift();
  }

  // ------------------------------------------------------------------ food

  gardenCenters() {
    const { width: W, height: H } = this.cfg;
    const s = this.t * 0.00006;
    return this.gardenPhase.map(([p, q, a, b]) => [
      W / 2 + W * 0.36 * Math.sin(s * a + p),
      H / 2 + H * 0.34 * Math.sin(s * b * 1.3 + q),
    ]);
  }

  spawnFood(x, y) {
    const { width: W, height: H } = this.cfg;
    if (x === undefined) {
      if (this.rand() < 0.78) {
        const g = this.gardenCenters()[(this.rand() * this.cfg.gardens) | 0];
        x = g[0] + this.gauss() * 130; y = g[1] + this.gauss() * 130;
      } else { x = this.rand() * W; y = this.rand() * H; }
    }
    this.fx.push((x + W) % W); this.fy.push((y + H) % H); this.fe.push(1);
  }

  // ------------------------------------------------------------------ creatures

  randomGenome(predator = false) {
    const brain = new Float32Array(NW);
    for (let i = 0; i < NW; i++) brain[i] = this.gauss() * 0.6;
    // a nudge so the first generation moves forward and steers toward what it eats
    const ob = NIN * NH + NH + NH * NOUT;
    brain[ob + 1] = 0.8;
    return {
      brain,
      size: predator ? 6.5 + this.rand() * 2 : 4 + this.rand() * 2,
      hue: predator ? (340 + this.rand() * 40) % 360 : 90 + this.rand() * 140,
      diet: predator ? 0.75 + this.rand() * 0.2 : this.rand() * 0.2,
      range: 90 + this.rand() * 60,
      morph: Float32Array.from(MORPH, () => this.randLook()),
    };
  }

  mutate(g) {
    const m = this.cfg.mutation;
    const brain = new Float32Array(g.brain);
    const rate = 0.08;
    for (let i = 0; i < NW; i++) {
      if (this.rand() < rate) brain[i] += this.gauss() * 0.35 * m;
      if (this.rand() < 0.002 * m) brain[i] = this.gauss() * 0.8;   // rare large jump
    }
    return {
      brain,
      size: clamp(g.size + this.gauss() * 0.25 * m, 2.5, 14),
      hue: (g.hue + this.gauss() * 5 * m + 360) % 360,
      diet: clamp(g.diet + this.gauss() * 0.035 * m, 0, 1),
      range: clamp(g.range + this.gauss() * 6 * m, 30, 260),
      morph: g.morph.map((v) => {
        const r = this.randLook() + this.randLook() + this.randLook() - 1.5;   // ~N(0, 0.5)
        return clamp(v + r * 0.06 * m, 0, 1);
      }),
    };
  }

  addCreature(genome, x, y, parent = null) {
    const { width: W, height: H } = this.cfg;
    const c = {
      id: this.nextId++,
      g: genome,
      x: x ?? this.rand() * W, y: y ?? this.rand() * H,
      ang: this.rand() * TAU, speed: 0,
      energy: parent ? 0 : this.cap(genome) * 0.5,
      age: 0,
      gen: parent ? parent.gen + 1 : 0,
      parent: parent ? parent.id : 0,
      children: 0, kills: 0, eaten: 0,
      mem: [0, 0],
      inp: new Float32Array(NIN), hid: new Float32Array(NH), out: new Float32Array(NOUT),
      alive: true,
      flash: 0,
    };
    c.pow = this.power(c);
    this.creatures.push(c);
    if (parent) this.parentOf.set(c.id, parent.id);
    if (c.gen > this.stats.maxGen) this.stats.maxGen = c.gen;
    return c;
  }

  cap(g) { return 100 * (g.size / 5) ** 2; }
  power(c) { return c.g.size * (0.4 + c.g.diet); }
  isPredator(c) { return c.g.diet > 0.5; }
  canEat(a, b) { return a.g.diet > 0.5 && a.pow > b.pow * 1.15; }

  // ------------------------------------------------------------------ spatial hashing

  buildGrids() {
    const { width: W, height: H } = this.cfg;
    this.gw = Math.ceil(W / CELL); this.gh = Math.ceil(H / CELL);
    const n = this.gw * this.gh;
    this.foodGrid = Array.from({ length: n }, () => []);
    this.critGrid = Array.from({ length: n }, () => []);
    for (let i = 0; i < this.fx.length; i++) {
      this.foodGrid[((this.fy[i] / CELL) | 0) * this.gw + ((this.fx[i] / CELL) | 0)].push(i);
    }
    for (const c of this.creatures) {
      this.critGrid[((c.y / CELL) | 0) * this.gw + ((c.x / CELL) | 0)].push(c);
    }
  }

  // visit grid cells within radius r of (x, y) on the torus
  forCells(x, y, r, grid, fn) {
    const { width: W, height: H } = this.cfg;
    const cx = (x / CELL) | 0, cy = (y / CELL) | 0, k = Math.ceil(r / CELL);
    for (let dy = -k; dy <= k; dy++) {
      const gy = (cy + dy + this.gh) % this.gh;
      const oy = cy + dy < 0 ? -H : cy + dy >= this.gh ? H : 0;
      for (let dx = -k; dx <= k; dx++) {
        const gx = (cx + dx + this.gw) % this.gw;
        const ox = cx + dx < 0 ? -W : cx + dx >= this.gw ? W : 0;
        fn(grid[gy * this.gw + gx], ox, oy);
      }
    }
  }

  // Grid cells that may hold something c can see: within its vision radius and not wholly
  // behind either edge of its vision cone. The grid is built at the start of the tick and
  // creatures move during it (at most ~3.3 units), so the test keeps a 4-unit margin and
  // never drops an object that sense() would have counted. Needs secX/secY set for c.
  visibleCells(c) {
    const { width: W, height: H } = this.cfg;
    const M = 4, R = c.g.range, lim = (R + M) * (R + M);
    const bx = this.secX, by = this.secY, n = NSECT;
    const cx = (c.x / CELL) | 0, cy = (c.y / CELL) | 0, k = Math.ceil(R / CELL);
    let m = 0;
    for (let dy = -k; dy <= k; dy++) {
      const gy = (cy + dy + this.gh) % this.gh;
      const oy = cy + dy < 0 ? -H : cy + dy >= this.gh ? H : 0;
      const y0 = gy * CELL + oy - c.y, y1 = Math.min((gy + 1) * CELL, H) + oy - c.y;
      const ny = y0 > 0 ? y0 : y1 < 0 ? -y1 : 0;
      for (let dx = -k; dx <= k; dx++) {
        const gx = (cx + dx + this.gw) % this.gw;
        const ox = cx + dx < 0 ? -W : cx + dx >= this.gw ? W : 0;
        const x0 = gx * CELL + ox - c.x, x1 = Math.min((gx + 1) * CELL, W) + ox - c.x;
        const nx = x0 > 0 ? x0 : x1 < 0 ? -x1 : 0;
        if (nx * nx + ny * ny > lim) continue;
        let right = 0, left = 0;   // corners strictly outside the first / last cone edge
        for (let q = 0; q < 4; q++) {
          const X = q & 1 ? x1 : x0, Y = q & 2 ? y1 : y0;
          if (bx[0] * Y - by[0] * X < -M) right++;
          if (bx[n] * Y - by[n] * X > M) left++;
        }
        if (right === 4 || left === 4) continue;
        this.vCell[m] = gy * this.gw + gx; this.vOx[m] = ox; this.vOy[m] = oy; m++;
      }
    }
    return m;
  }

  // ------------------------------------------------------------------ step

  sense(c) {
    const inp = c.inp, fov = this.cfg.fov, R = c.g.range, R2 = R * R;
    inp.fill(0);
    // Sector boundary directions in world space. A point is at or past boundary k
    // when cross(b_k, d) >= 0; this avoids an atan2 per object (the cone is < 180°).
    const bx = this.secX, by = this.secY;
    for (let k = 0; k <= NSECT; k++) {
      const a = c.ang - fov / 2 + (k * fov) / NSECT;
      bx[k] = Math.cos(a); by[k] = Math.sin(a);
    }
    const put = (dx, dy, ch) => {
      const d2 = dx * dx + dy * dy;
      if (d2 > R2 || d2 < 1e-6) return;
      if (bx[0] * dy - by[0] * dx < 0 || bx[NSECT] * dy - by[NSECT] * dx >= 0) return;
      let s = 0;
      while (s < NSECT - 1 && bx[s + 1] * dy - by[s + 1] * dx >= 0) s++;
      const v = 1 - Math.sqrt(d2) / R;
      const k = ch * NSECT + s;
      if (v > inp[k]) inp[k] = v;
    };
    const m = this.visibleCells(c), fx = this.fx, fy = this.fy;
    for (let j = 0; j < m; j++) {
      // same operation order as before ((p + offset) - c), so results are bit-identical
      const cell = this.vCell[j], ox = this.vOx[j], oy = this.vOy[j];
      for (const i of this.foodGrid[cell]) put(fx[i] + ox - c.x, fy[i] + oy - c.y, 0);
      for (const o of this.critGrid[cell]) {
        if (o === c || !o.alive) continue;
        const dx = o.x + ox - c.x, dy = o.y + oy - c.y;
        if (this.canEat(c, o)) put(dx, dy, 1);
        else if (this.canEat(o, c)) put(dx, dy, 2);
      }
    }
    inp[15] = c.energy / this.cap(c.g);
    inp[16] = Math.sin(this.t * 0.02);
    inp[17] = c.mem[0]; inp[18] = c.mem[1];
    inp[19] = 1;
  }

  think(c) {
    const w = c.g.brain, inp = c.inp, hid = c.hid, out = c.out;
    let p = 0;
    for (let h = 0; h < NH; h++) {
      let s = 0;
      for (let i = 0; i < NIN; i++) s += w[p++] * inp[i];
      hid[h] = s;
    }
    for (let h = 0; h < NH; h++) hid[h] = Math.tanh(hid[h] + w[p++]);
    for (let o = 0; o < NOUT; o++) {
      let s = 0;
      for (let h = 0; h < NH; h++) s += w[p++] * hid[h];
      out[o] = s;
    }
    for (let o = 0; o < NOUT; o++) out[o] = Math.tanh(out[o] + w[p++]);
    c.mem[0] = out[2]; c.mem[1] = out[3];
  }

  step() {
    const cfg = this.cfg, { width: W, height: H } = cfg;
    this.t++;
    for (let k = 0; k < cfg.foodRate; k++) {
      if (this.fx.length < cfg.maxFood) this.spawnFood();
    }
    this.buildGrids();

    const born = [];
    for (const c of this.creatures) {
      if (!c.alive) continue;
      this.sense(c);
      this.think(c);
      const s5 = (c.g.size / 5) ** 2;
      const vmax = 2.6 * (5 / c.g.size) ** 0.35;
      c.ang = wrapAngle(c.ang + c.out[0] * 0.16);
      c.speed = c.speed * 0.8 + 0.2 * ((c.out[1] + 1) / 2) * vmax;
      c.x = (c.x + Math.cos(c.ang) * c.speed + W) % W;
      c.y = (c.y + Math.sin(c.ang) * c.speed + H) % H;
      c.energy -= 0.035 * s5 + 0.012 * c.speed * c.speed * s5 + 0.00012 * c.g.range + 0.006;
      c.age++;
      if (c.flash > 0) c.flash--;

      // graze
      const plantGain = cfg.pelletEnergy * (1 - c.g.diet) ** 1.5;
      if (plantGain > 0.3) {
        const reach = c.g.size + 2;
        this.forCells(c.x, c.y, reach, this.foodGrid, (cell, ox, oy) => {
          for (const i of cell) {
            if (this.fe[i] === 0) continue;
            const dx = this.fx[i] + ox - c.x, dy = this.fy[i] + oy - c.y;
            if (dx * dx + dy * dy < reach * reach) { this.fe[i] = 0; c.energy += plantGain; c.eaten++; }
          }
        });
      }

      // hunt
      if (c.g.diet > 0.5) {
        this.forCells(c.x, c.y, c.g.size + 14, this.critGrid, (cell, ox, oy) => {
          for (const o of cell) {
            if (o === c || !o.alive || !this.canEat(c, o)) continue;
            const dx = o.x + ox - c.x, dy = o.y + oy - c.y, rr = c.g.size + o.g.size;
            if (dx * dx + dy * dy < rr * rr) {
              const meat = (Math.max(o.energy, 0) * 0.6 + 40 * (o.g.size / 5) ** 2) * c.g.diet ** 1.5;
              c.energy += meat; c.kills++; c.flash = 12;
              this.kill(o, 'eaten');
              this.stats.kills++;
              this.fxq.push({ type: 'kill', x: o.x, y: o.y, hue: o.g.hue });
            }
          }
        });
      }

      const cap = this.cap(c.g);
      if (c.energy > cap) c.energy = cap;
      if (c.energy <= 0 || c.age > cfg.maxAge) { this.kill(c, c.energy <= 0 ? 'starved' : 'old'); continue; }

      // reproduce (asexual, with mutation)
      if (c.energy > cap * 0.72 && c.age > 120 && this.creatures.length + born.length < cfg.maxPop) {
        const child = { g: this.mutate(c.g), parent: c };
        const share = c.energy * 0.42;
        c.energy -= share * 1.2;
        child.energy = share;
        born.push(child);
        c.children++;
      }
    }

    for (const b of born) {
      const ang = this.rand() * TAU;
      const kid = this.addCreature(b.g, b.parent.x + Math.cos(ang) * 8, b.parent.y + Math.sin(ang) * 8, b.parent);
      kid.energy = b.energy;
      this.stats.births++;
      this.fxq.push({ type: 'birth', x: kid.x, y: kid.y, hue: kid.g.hue, size: kid.g.size });
      if (this.isPredator(kid) && !this.isPredator(b.parent)) {
        this.log(`A herbivore lineage crossed into predation (gen ${kid.gen}).`, 'evo');
      }
    }

    this.creatures = this.creatures.filter((c) => c.alive);
    if (this.fe.includes(0)) {
      const keep = [];
      for (let i = 0; i < this.fe.length; i++) if (this.fe[i]) keep.push(i);
      this.fx = keep.map((i) => this.fx[i]); this.fy = keep.map((i) => this.fy[i]); this.fe = keep.map(() => 1);
    }

    if (cfg.respawn && this.creatures.length < cfg.minPop) {
      for (let i = 0; i < 20; i++) this.addCreature(this.randomGenome(i < 2));
      this.log('Life nearly vanished — spontaneous generation re-seeded the world.', 'warn');
    }
    if (this.creatures.length === 0 && !this.extinct) {
      this.extinct = true;
      this.log('Extinction. Every lineage has ended.', 'warn');
    } else if (this.creatures.length > 0) this.extinct = false;
    if (this.stats.maxGen >= this.milestone) {
      this.log(`Generation ${this.milestone} reached.`, 'info');
      this.milestone = this.milestone < 100 ? this.milestone * 2 + (this.milestone === 10 ? 5 : 0) : this.milestone + 100;
    }
    if (this.t % 30 === 0) this.sample();
  }

  kill(c, cause) {
    if (!c.alive) return;
    c.alive = false;
    this.stats.deaths++;
    if (cause !== 'eaten') {
      // decomposition returns part of the body to the soil
      const n = Math.round((c.g.size / 5) ** 2 * 2);
      for (let i = 0; i < n; i++) this.spawnFood(c.x + this.gauss() * 10, c.y + this.gauss() * 10);
      this.fxq.push({ type: 'death', x: c.x, y: c.y, hue: c.g.hue });
    }
  }

  sample() {
    let herb = 0, pred = 0, size = 0;
    const acc = { hs: 0, ps: 0, hv: 0, pv: 0 };
    const bins = new Array(24).fill(0);
    for (const c of this.creatures) {
      if (this.isPredator(c)) { pred++; acc.ps += c.g.size; acc.pv += c.speed; }
      else { herb++; acc.hs += c.g.size; acc.hv += c.speed; }
      size += c.g.size;
      bins[(c.g.hue / 15) | 0]++;
    }
    const n = this.creatures.length || 1;
    const per = (v, k) => (k ? v / k : null);
    let H = 0;
    for (const b of bins) if (b) { const p = b / n; H -= p * Math.log(p); }
    const s = {
      t: this.t, herb, pred, food: this.fx.length, size: size / n, clades: Math.exp(H),
      herbSize: per(acc.hs, herb), predSize: per(acc.ps, pred),
      herbSpeed: per(acc.hv, herb), predSpeed: per(acc.pv, pred),
    };
    this.history.push(s);
    if (this.history.length > 1200) this.history.shift();

    if (pred > 0) this.hadPredators = true;
    if (pred === 0 && this.hadPredators) {
      this.hadPredators = false;
      this.log('The last predator has died. Herbivores inherit the world — for now.', 'warn');
    }
    const prev = this.history[this.history.length - 34];
    if (prev && herb + pred < (prev.herb + prev.pred) * 0.55 && prev.herb + prev.pred > 80
        && this.t - (this.lastCrash ?? -1e9) > 3000) {
      this.lastCrash = this.t;
      this.log(`Population crash: ${prev.herb + prev.pred} → ${herb + pred}.`, 'warn');
    }
  }

  // ------------------------------------------------------------------ interventions

  feed(x, y, r = 60, n = 40) {
    for (let i = 0; i < n; i++) {
      const a = this.rand() * TAU, d = Math.sqrt(this.rand()) * r;
      this.spawnFood(x + Math.cos(a) * d, y + Math.sin(a) * d);
    }
  }

  dropPredator(x, y) {
    const pred = this.creatures.filter((c) => this.isPredator(c));
    const best = pred.sort((a, b) => b.kills - a.kills)[0];
    const g = best ? this.mutate(best.g) : this.randomGenome(true);
    const c = this.addCreature(g, x, y);
    this.log(best ? 'You released a predator descended from the deadliest hunter alive.'
      : 'You released a fresh predator.', 'user');
    return c;
  }

  meteor(x, y, r = 140) {
    const { width: W, height: H } = this.cfg;
    let n = 0;
    const near = (px, py) => {
      const dx = Math.min(Math.abs(px - x), W - Math.abs(px - x));
      const dy = Math.min(Math.abs(py - y), H - Math.abs(py - y));
      return dx * dx + dy * dy < r * r;
    };
    for (const c of this.creatures) if (c.alive && near(c.x, c.y)) { c.alive = false; n++; this.stats.deaths++; }
    this.creatures = this.creatures.filter((c) => c.alive);
    const keep = [];
    for (let i = 0; i < this.fx.length; i++) if (!near(this.fx[i], this.fy[i])) keep.push(i);
    this.fx = keep.map((i) => this.fx[i]); this.fy = keep.map((i) => this.fy[i]); this.fe = keep.map(() => 1);
    this.fxq.push({ type: 'meteor', x, y, r });
    this.log(`A meteor struck, wiping out ${n} creature${n === 1 ? '' : 's'}.`, 'user');
  }

  // living creatures sharing an ancestor with c within `depth` generations
  relatives(c, depth = 5) {
    const up = (id) => { const a = [id]; for (let k = 0; k < depth; k++) { id = this.parentOf.get(id); if (!id) break; a.push(id); } return a; };
    const mine = new Set(up(c.id));
    return this.creatures.filter((o) => o !== c && up(o.id).some((id) => mine.has(id)));
  }

  creatureAt(x, y, slack = 10) {
    let best = null, bd = Infinity;
    for (const c of this.creatures) {
      const d = Math.hypot(c.x - x, c.y - y);
      if (d < c.g.size + slack && d < bd) { bd = d; best = c; }
    }
    return best;
  }
}
