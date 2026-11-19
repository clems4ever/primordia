// Primordia — documentary mode. The director looks for drama (hunts, narrow escapes, record
// holders, elders, great parents) and frames one subject at a time, writing captions as the
// subject's story unfolds. It only decides *what* to film; app.js moves the camera.

const SHOT_MS = [9000, 14000];
const pick = (arr) => arr[(Math.random() * arr.length) | 0];
const days = (ticks) => Math.max(1, Math.round(ticks / 300));
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

export class Director {
  constructor(world, nameOf) {
    this.world = world;
    this.nameOf = nameOf;
    this.active = false;
    this.shot = null;          // { kind, subject, until, title, line, zoom }
    this.recent = [];          // ids filmed lately, to keep the cast fresh
    this.lastKind = null;
  }

  start() { this.active = true; this.shot = null; this.cut(); }
  stop() { this.active = false; this.shot = null; }

  // Called every frame. Returns the current shot (subject may be null for a wide shot).
  update(now) {
    if (!this.active) return null;
    const s = this.shot;
    if (!s || now > s.until) { this.cut(now); return this.shot; }
    const c = s.subject;
    if (c) {
      if (!c.alive && !s.ended) {
        s.ended = true;
        const kin = this.world.relatives(c).length;
        s.line = kin ? `${this.nameOf(c)} is gone. ${plural(kin, 'close relative')} carry its line.`
          : `${this.nameOf(c)} is gone, and its line ends with it.`;
        s.until = now + 3500;
        s.changed = true;
      } else if (c.alive) {
        if (c.kills > s.kills) {
          s.kills = c.kills;
          s.line = pick([`It strikes. Kill number ${c.kills}.`, `A clean kill — its ${ordinal(c.kills)}.`,
            'The chase is over.']);
          s.until = Math.max(s.until, now + 4000); s.changed = true;
        } else if (c.children > s.children) {
          s.children = c.children;
          s.line = pick([`A new life: offspring number ${c.children}.`, `It divides. ${c.children} offspring so far.`]);
          s.changed = true;
        } else if (c.g.diet <= 0.5 && !s.danger && maxIn(c, 10, 15) > 0.55) {
          s.danger = true;
          s.line = pick(['It senses a hunter.', 'Danger, close by.', 'Something is watching it.']);
          s.changed = true;
        }
      }
    }
    return s;
  }

  cut(now = performance.now()) {
    const w = this.world, alive = w.creatures.filter((c) => c.alive);
    const preds = alive.filter((c) => c.g.diet > 0.5), herbs = alive.filter((c) => c.g.diet <= 0.5);
    const fresh = (c) => !this.recent.includes(c.id);
    const best = (arr, f) => arr.filter(fresh).reduce((b, c) => (!b || f(c) > f(b) ? c : b), null);
    const options = [];

    const hunter = best(preds, (c) => maxIn(c, 5, 10) * (1 + c.speed));
    if (hunter && maxIn(hunter, 5, 10) > 0.35) options.push(['hunt', hunter, 4]);
    const prey = best(herbs, (c) => maxIn(c, 10, 15));
    if (prey && maxIn(prey, 10, 15) > 0.3) options.push(['prey', prey, 3]);
    const killer = best(preds, (c) => c.kills);
    if (killer && killer.kills >= 5) options.push(['record', killer, 2]);
    const elder = best(alive, (c) => c.age);
    if (elder) options.push(['elder', elder, 1.5]);
    const parent = best(alive, (c) => c.children);
    if (parent && parent.children >= 3) options.push(['parent', parent, 1.5]);
    if (preds.length > 0 && preds.length <= 3) options.push(['last', preds[0], 5]);
    if (alive.length) options.push(['wide', null, 1]);

    const pool = options.filter(([k]) => k !== this.lastKind);
    const total = pool.reduce((s, o) => s + o[2], 0);
    let r = Math.random() * total, choice = pool[0];
    for (const o of pool) { if ((r -= o[2]) <= 0) { choice = o; break; } }
    if (!choice) { this.shot = { kind: 'empty', subject: null, until: now + 5000, title: 'An empty world', line: 'Nothing moves. Food still grows.', zoom: 'wide', changed: true }; return; }

    const [kind, c] = choice;
    this.lastKind = kind;
    if (c) { this.recent.push(c.id); if (this.recent.length > 12) this.recent.shift(); }
    const name = c && this.nameOf(c), role = c && (c.g.diet > 0.5 ? 'hunter' : 'grazer');
    const story = {
      hunt: () => [`${name}, ${role} · generation ${c.gen}`,
        pick(['It has caught the scent of prey.', 'Something small and green has wandered into view.', 'It turns, and accelerates.'])],
      prey: () => [`${name}, ${role} · generation ${c.gen}`,
        pick(['A hunter is near. Every instinct says: run.', 'It has felt the shadow of a predator.'])],
      record: () => [`${name}, the deadliest hunter alive`,
        `${plural(c.kills, 'kill')} in ${plural(days(c.age), 'day')}. Its genes are spreading.`],
      elder: () => [`${name}, the eldest`,
        `${plural(days(c.age), 'day')} old, with ${plural(c.children, 'offspring')}. Few live this long.`],
      parent: () => [`${name}, a founder`,
        `${plural(c.children, 'offspring')} so far. Much of the next generation will carry its genes.`],
      last: () => [`${name}, one of the last hunters`,
        `Only ${plural(preds.length, 'predator')} remain. If they fail, the grazers inherit the world.`],
      wide: () => [`Day ${days(w.t)}`,
        `${alive.length} creatures, ${plural(w.stats.maxGen, 'generation')} of history, ${herbs.length} grazers and ${preds.length} hunters.`],
    }[kind]();
    const [lo, hi] = SHOT_MS;
    this.shot = {
      kind, subject: c, until: now + lo + Math.random() * (hi - lo),
      title: story[0], line: story[1], zoom: c ? 'close' : 'wide',
      kills: c?.kills ?? 0, children: c?.children ?? 0, changed: true,
    };
  }
}

function maxIn(c, a, b) { let m = 0; for (let i = a; i < b; i++) if (c.inp[i] > m) m = c.inp[i]; return m; }
function ordinal(n) { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }
