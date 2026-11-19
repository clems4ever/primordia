import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { World, NIN, NH, NOUT, NW, NSECT, IN_LABELS, OUT_LABELS } from '../sim.js';

// An empty world: no creatures, no food, nothing growing. Tests add exactly what they need.
function emptyWorld(opts = {}) {
  return new World({ seed: 1, initialPop: 0, maxFood: 0, foodRate: 0, ...opts });
}

// A genome whose brain is all zeros: it neither turns nor thrusts.
function inertGenome(world, overrides = {}) {
  return { ...world.randomGenome(false), brain: new Float32Array(NW), ...overrides };
}

describe('brain layout', () => {
  test('weight count matches the layer sizes', () => {
    assert.equal(NIN, IN_LABELS.length);
    assert.equal(NOUT, OUT_LABELS.length);
    assert.equal(NW, NIN * NH + NH + NH * NOUT + NOUT);
  });

  test('outputs stay in [-1, 1] and feed the memory inputs', () => {
    const w = emptyWorld();
    const c = w.addCreature(w.randomGenome(), 100, 100);
    c.inp.fill(1);
    w.think(c);
    for (const v of c.out) assert.ok(v >= -1 && v <= 1, `output ${v} out of range`);
    assert.deepEqual(c.mem, [c.out[2], c.out[3]]);
  });
});

describe('determinism', () => {
  test('the same seed replays the same history', () => {
    const run = () => {
      const w = new World({ seed: 42 });
      for (let i = 0; i < 1500; i++) w.step();
      return { n: w.creatures.length, x: w.creatures.reduce((s, c) => s + c.x, 0), births: w.stats.births };
    };
    assert.deepEqual(run(), run());
  });

  test('different seeds diverge', () => {
    const a = new World({ seed: 1 }), b = new World({ seed: 2 });
    for (let i = 0; i < 300; i++) { a.step(); b.step(); }
    assert.notEqual(a.creatures.reduce((s, c) => s + c.x, 0), b.creatures.reduce((s, c) => s + c.x, 0));
  });
});

describe('senses', () => {
  test('food straight ahead lights the middle sector, food behind is invisible', () => {
    const w = emptyWorld();
    const c = w.addCreature(inertGenome(w, { range: 100 }), 500, 500);
    c.ang = 0;
    w.spawnFood(550, 500);   // 50 units ahead
    w.spawnFood(450, 500);   // 50 units behind
    w.buildGrids();
    w.sense(c);
    const mid = Math.floor(NSECT / 2);
    for (let s = 0; s < NSECT; s++) {
      assert.equal(c.inp[s], s === mid ? 0.5 : 0, `food sector ${s}`);
    }
  });

  test('a stronger predator registers as a threat, a weaker herbivore as prey', () => {
    const w = emptyWorld();
    const me = w.addCreature(inertGenome(w, { size: 6, diet: 0.8, range: 200 }), 500, 500);
    me.ang = 0;
    w.addCreature(inertGenome(w, { size: 3, diet: 0 }), 560, 500);    // ahead: prey
    w.addCreature(inertGenome(w, { size: 13, diet: 1 }), 540, 460);   // 45° to the left: threat
    w.buildGrids();
    w.sense(me);
    const prey = me.inp.slice(NSECT, 2 * NSECT), threat = me.inp.slice(2 * NSECT, 3 * NSECT);
    assert.ok(prey[Math.floor(NSECT / 2)] > 0, 'prey seen ahead');
    assert.ok(threat.some((v) => v > 0), 'threat seen');
    assert.equal(prey.filter((v) => v > 0).length, 1);
  });

  test('vision wraps around the edges of the world', () => {
    const w = emptyWorld();
    const c = w.addCreature(inertGenome(w, { range: 100 }), w.cfg.width - 10, 500);
    c.ang = 0;
    w.spawnFood(30, 500);    // 40 units ahead, across the seam
    w.buildGrids();
    w.sense(c);
    assert.ok(c.inp[Math.floor(NSECT / 2)] > 0);
  });
});

describe('feeding', () => {
  test('herbivores graze food they touch', () => {
    const w = emptyWorld();
    const c = w.addCreature(inertGenome(w, { diet: 0 }), 500, 500);
    const e0 = c.energy;
    w.spawnFood(501, 500);
    w.step();
    assert.equal(w.fx.length, 0);
    assert.equal(c.eaten, 1);
    assert.ok(c.energy > e0 + w.cfg.pelletEnergy * 0.9, 'gained roughly a pellet of energy');
  });

  test('pure carnivores cannot graze', () => {
    const w = emptyWorld();
    const c = w.addCreature(inertGenome(w, { diet: 1 }), 500, 500);
    w.spawnFood(501, 500);
    w.step();
    assert.equal(w.fx.length, 1);
    assert.equal(c.eaten, 0);
  });

  test('predation needs carnivory and 15% more power', () => {
    const w = emptyWorld();
    const pred = w.addCreature(inertGenome(w, { size: 8, diet: 0.9 }), 0, 0);
    const herb = w.addCreature(inertGenome(w, { size: 4, diet: 0.1 }), 0, 0);
    const twin = w.addCreature(inertGenome(w, { size: 8, diet: 0.9 }), 0, 0);
    assert.ok(w.canEat(pred, herb));
    assert.ok(!w.canEat(herb, pred), 'herbivores never hunt');
    assert.ok(!w.canEat(pred, twin), 'equal power is not enough');
  });

  test('a predator that touches its prey kills and eats it', () => {
    const w = emptyWorld();
    const pred = w.addCreature(inertGenome(w, { size: 8, diet: 0.9 }), 500, 500);
    const herb = w.addCreature(inertGenome(w, { size: 4, diet: 0 }), 505, 500);
    const e0 = pred.energy;
    w.step();
    assert.equal(herb.alive, false);
    assert.equal(pred.kills, 1);
    assert.equal(w.stats.kills, 1);
    assert.ok(pred.energy > e0);
    assert.deepEqual(w.creatures, [pred]);
  });
});

describe('life cycle', () => {
  test('a well-fed adult splits its energy with a mutated child', () => {
    const w = emptyWorld();
    const p = w.addCreature(inertGenome(w), 500, 500);
    p.age = 200;
    p.energy = w.cap(p.g) * 0.9;
    w.step();
    assert.equal(w.creatures.length, 2);
    const kid = w.creatures.find((c) => c !== p);
    assert.equal(kid.gen, 1);
    assert.equal(kid.parent, p.id);
    assert.equal(p.children, 1);
    assert.ok(kid.energy < p.energy + 1, 'child gets no more than the parent keeps');
    assert.notEqual(kid.g, p.g);
  });

  test('young creatures do not reproduce', () => {
    const w = emptyWorld();
    const p = w.addCreature(inertGenome(w), 500, 500);
    p.energy = w.cap(p.g) * 0.9;
    w.step();
    assert.equal(w.creatures.length, 1);
  });

  test('creatures starve when energy runs out', () => {
    const w = emptyWorld();
    const c = w.addCreature(inertGenome(w), 500, 500);
    c.energy = 0.001;
    w.step();
    assert.equal(w.creatures.length, 0);
    assert.ok(w.fx.length > 0, 'the body decomposes into food');
  });

  test('mutation keeps every gene inside its bounds', () => {
    const w = new World({ seed: 3, mutation: 3 });
    let g = w.randomGenome(true);
    for (let i = 0; i < 3000; i++) {
      g = w.mutate(g);
      assert.ok(g.size >= 2.5 && g.size <= 14);
      assert.ok(g.diet >= 0 && g.diet <= 1);
      assert.ok(g.range >= 30 && g.range <= 260);
      assert.ok(g.hue >= 0 && g.hue < 360);
      assert.equal(g.brain.length, NW);
    }
  });

  test('relatives share a recent ancestor; strangers do not', () => {
    const w = emptyWorld();
    const p = w.addCreature(inertGenome(w), 100, 100);
    const kid = w.addCreature(w.mutate(p.g), 120, 100, p);
    const grandkid = w.addCreature(w.mutate(kid.g), 140, 100, kid);
    const stranger = w.addCreature(inertGenome(w), 900, 900);
    const fam = w.relatives(kid);
    assert.ok(fam.includes(p) && fam.includes(grandkid));
    assert.ok(!fam.includes(stranger));
  });
});

describe('extinction and spontaneous generation', () => {
  const doomed = (respawn) => {
    const w = new World({ seed: 5, foodRate: 0, maxFood: 0, respawn });
    for (const c of w.creatures) c.energy = 0.001;
    w.step();
    return w;
  };

  test('with respawn off, extinction is permanent and announced once', () => {
    const w = doomed(false);
    for (let i = 0; i < 300; i++) w.step();
    assert.equal(w.creatures.length, 0);
    assert.equal(w.events.filter((e) => e.text.startsWith('Extinction')).length, 1);
  });

  test('with respawn on, the world is re-seeded', () => {
    const w = doomed(true);
    assert.equal(w.creatures.length, 20);
    assert.ok(w.events.some((e) => e.text.includes('spontaneous generation')));
  });

  test('respawn is off by default', () => {
    assert.equal(new World({ seed: 1 }).cfg.respawn, false);
  });
});

describe('interventions', () => {
  test('a meteor only destroys what is inside its radius', () => {
    const w = emptyWorld();
    const near = w.addCreature(inertGenome(w), 500, 500);
    const far = w.addCreature(inertGenome(w), 1200, 900);
    w.spawnFood(520, 500);
    w.spawnFood(1200, 950);
    w.meteor(500, 500, 100);
    assert.equal(near.alive, false);
    assert.deepEqual(w.creatures, [far]);
    assert.equal(w.fx.length, 1);
  });

  test('feeding drops pellets around the brush', () => {
    const w = emptyWorld();
    w.feed(300, 300, 40, 25);
    assert.equal(w.fx.length, 25);
    for (let i = 0; i < 25; i++) assert.ok(Math.hypot(w.fx[i] - 300, w.fy[i] - 300) <= 40 + 1e-9);
  });

  test('a released predator is carnivorous', () => {
    const w = emptyWorld();
    const c = w.dropPredator(100, 100);
    assert.ok(w.isPredator(c));
  });
});

describe('long run', () => {
  test('a full ecosystem stays valid over 4,000 ticks', () => {
    const w = new World({ seed: 7 });
    const { width: W, height: H } = w.cfg;
    for (let i = 0; i < 4000; i++) w.step();
    assert.ok(w.creatures.length > 0, 'life persists under default settings');
    for (const c of w.creatures) {
      assert.ok(c.x >= 0 && c.x < W && c.y >= 0 && c.y < H, 'positions wrap inside the world');
      assert.ok(Number.isFinite(c.energy) && c.energy <= w.cap(c.g) + 1e-9);
    }
    assert.ok(w.history.length > 0);
    assert.ok(w.stats.maxGen > 0, 'evolution happened');
  });
});

describe('performance optimizations preserve behaviour', () => {
  // Reference sensing: the original algorithm, scanning every object with atan2.
  function referenceSense(w, c) {
    const { width: W, height: H, fov } = w.cfg, R = c.g.range, inp = new Float64Array(3 * NSECT);
    const near = (d, L) => (d > L / 2 ? d - L : d < -L / 2 ? d + L : d);
    const put = (dx, dy, ch) => {
      const d2 = dx * dx + dy * dy;
      if (d2 > R * R || d2 < 1e-6) return;
      let a = Math.atan2(dy, dx) - c.ang;
      while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI;
      if (a < -fov / 2 || a >= fov / 2) return;
      const k = ch * NSECT + (((a + fov / 2) / fov * NSECT) | 0);
      inp[k] = Math.max(inp[k], 1 - Math.sqrt(d2) / R);
    };
    for (let i = 0; i < w.fx.length; i++) put(near(w.fx[i] - c.x, W), near(w.fy[i] - c.y, H), 0);
    for (const o of w.creatures) {
      if (o === c) continue;
      const dx = near(o.x - c.x, W), dy = near(o.y - c.y, H);
      if (w.canEat(c, o)) put(dx, dy, 1); else if (w.canEat(o, c)) put(dx, dy, 2);
    }
    return inp;
  }

  test('grid-culled sensing matches a brute-force scan of every object', () => {
    const w = new World({ seed: 11, initialPop: 300, initialPredators: 60 });
    w.buildGrids();
    for (const c of w.creatures) {
      w.sense(c);
      const ref = referenceSense(w, c);
      for (let k = 0; k < 3 * NSECT; k++) {
        // inputs are stored as float32, so compare at float32 precision
        assert.ok(Math.abs(c.inp[k] - ref[k]) < 1e-6, `creature ${c.id} input ${k}: ${c.inp[k]} vs ${ref[k]}`);
      }
    }
  });

  test('a fixed seed reproduces a known state (update only for intentional rule changes)', async () => {
    const { createHash } = await import('node:crypto');
    const w = new World({ seed: 7 });
    for (let i = 0; i < 1500; i++) w.step();
    const h = createHash('sha256');
    for (const c of w.creatures) {
      h.update(Buffer.from(new Float64Array([c.id, c.x, c.y, c.ang, c.speed, c.energy, c.age, c.g.size]).buffer));
    }
    h.update(Buffer.from(new Float64Array(w.fx).buffer));
    h.update(Buffer.from(new Float64Array(w.fy).buffer));
    h.update(`${w.t}|${w.stats.births}|${w.stats.kills}|${w.stats.deaths}`);
    assert.equal(h.digest('hex').slice(0, 16), 'b53c05117c2c1770');
  });
});
