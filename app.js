// Primordia — rendering and interaction.
import { World, IN_LABELS, OUT_LABELS, NIN, NH, NOUT, NSECT } from './sim.js';

const $ = (id) => document.getElementById(id);
const TAU = Math.PI * 2;
const COL = { herb: '#199e70', pred: '#d95926', pos: '#3987e5', neg: '#d95926', mid: '#5c5c58',
  ink: '#f4f3ee', ink2: '#c3c2b7', ink3: '#8a8a84', grid: 'rgba(255,255,255,0.07)' };
const SPEEDS = [1, 2, 4, 8, 16];

const params = new URLSearchParams(location.search);
const world = new World({ seed: params.has('seed') ? +params.get('seed') : undefined });
window.world = world;

// ------------------------------------------------------------------ canvas & camera

const cv = $('world');
const ctx = cv.getContext('2d');
let dpr = 1, vw = 0, vh = 0;
const cam = { x: 0, y: 0, z: 1 };
let wipe = true;                      // full clear next frame (camera moved)

function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  vw = innerWidth; vh = innerHeight;
  cv.width = vw * dpr; cv.height = vh * dpr;
  fitCamera();
  for (const ch of charts) ch.resize();
  sizeBrain();
}

function fitCamera() {
  const { width: W, height: H } = world.cfg;
  const panelW = document.body.classList.contains('hide-ui') ? 0 : 350;
  const z = Math.min((vw - panelW - 40) / W, (vh - 40) / H);
  cam.z = z; cam.x = W / 2 - ((vw - panelW) / 2) / z; cam.y = H / 2 - (vh / 2) / z;
  wipe = true;
}

const toScreen = (x, y) => [(x - cam.x) * cam.z, (y - cam.y) * cam.z];
const toWorld = (sx, sy) => [sx / cam.z + cam.x, sy / cam.z + cam.y];

// ------------------------------------------------------------------ sprites

function glowSprite(h, s, l, size = 64) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grd.addColorStop(0, `hsla(${h},${s}%,${l}%,0.9)`);
  grd.addColorStop(0.25, `hsla(${h},${s}%,${l}%,0.35)`);
  grd.addColorStop(1, `hsla(${h},${s}%,${l}%,0)`);
  g.fillStyle = grd; g.fillRect(0, 0, size, size);
  return c;
}
const hueGlow = Array.from({ length: 36 }, (_, i) => glowSprite(i * 10, 85, 62));
const foodGlow = glowSprite(150, 80, 70, 32);
const gardenGlow = glowSprite(160, 70, 40, 256);
const whiteGlow = glowSprite(40, 100, 92, 64);

// ------------------------------------------------------------------ effects

const effects = [];
function pullEffects() {
  for (const e of world.fxq) {
    if (e.type === 'kill') {
      effects.push({ ...e, life: 26, max: 26 });
      for (let i = 0; i < 9; i++) {
        const a = Math.random() * TAU, v = 0.8 + Math.random() * 2.2;
        effects.push({ type: 'spark', x: e.x, y: e.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, hue: e.hue, life: 30, max: 30 });
      }
    } else if (e.type === 'meteor') effects.push({ ...e, life: 70, max: 70 });
    else effects.push({ ...e, life: e.type === 'birth' ? 28 : 40, max: e.type === 'birth' ? 28 : 40 });
  }
  world.fxq.length = 0;
  if (effects.length > 500) effects.splice(0, effects.length - 500);
}

// ------------------------------------------------------------------ drawing

const isPred = (c) => c.g.diet > 0.5;
let selected = null, following = false, family = new Set(), familyFor = null;

function draw() {
  const z = cam.z;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  if (wipe) { ctx.fillStyle = '#05080f'; ctx.fillRect(0, 0, vw, vh); wipe = false; }
  else { ctx.fillStyle = 'rgba(5,8,15,0.32)'; ctx.fillRect(0, 0, vw, vh); }   // motion trails

  const { width: W, height: H } = world.cfg;
  const [ox, oy] = toScreen(0, 0);

  // world plate
  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx.lineWidth = 1;
  ctx.strokeRect(ox, oy, W * z, H * z);

  ctx.globalCompositeOperation = 'lighter';

  // fertile gardens
  for (const [gx, gy] of world.gardenCenters()) {
    const [sx, sy] = toScreen(gx, gy), r = 330 * z;
    ctx.globalAlpha = 0.07;
    ctx.drawImage(gardenGlow, sx - r, sy - r, 2 * r, 2 * r);
  }

  // food
  ctx.globalAlpha = 0.42;
  const fs = Math.max(3.6 * z, 1.8);
  const { fx, fy } = world;
  for (let i = 0; i < fx.length; i++) {
    ctx.drawImage(foodGlow, (fx[i] - cam.x) * z - fs, (fy[i] - cam.y) * z - fs, fs * 2, fs * 2);
  }

  // creature glows
  for (const c of world.creatures) {
    const [sx, sy] = toScreen(c.x, c.y);
    if (sx < -40 || sy < -40 || sx > vw + 40 || sy > vh + 40) continue;
    const r = Math.max(c.g.size * z, 2) * (isPred(c) ? 4.2 : 3.4);
    const e = c.energy / world.cap(c.g);
    ctx.globalAlpha = 0.12 + 0.33 * e;
    ctx.drawImage(hueGlow[Math.floor(c.g.hue / 10) % 36], sx - r, sy - r, 2 * r, 2 * r);
    if (c.flash) {
      const fr = r * (0.8 + c.flash / 20);
      ctx.globalAlpha = c.flash / 30;
      ctx.drawImage(whiteGlow, sx - fr, sy - fr, 2 * fr, 2 * fr);
    }
  }

  // effects
  for (let i = effects.length - 1; i >= 0; i--) {
    const e = effects[i], k = e.life / e.max;
    const [sx, sy] = toScreen(e.x, e.y);
    if (e.type === 'spark') {
      e.x += e.vx; e.y += e.vy; e.vx *= 0.92; e.vy *= 0.92;
      const r = Math.max(3 * z, 1.5) * (0.6 + k);
      ctx.globalAlpha = k;
      ctx.drawImage(hueGlow[Math.floor(e.hue / 10) % 36], sx - r * 2, sy - r * 2, r * 4, r * 4);
    } else if (e.type === 'birth' || e.type === 'death' || e.type === 'kill') {
      const r = (e.type === 'kill' ? 26 : 14) * (1 - k) * z + 2;
      ctx.globalAlpha = k * (e.type === 'death' ? 0.35 : 0.7);
      ctx.strokeStyle = e.type === 'death' ? 'rgba(200,200,200,1)' : e.type === 'kill' ? '#ff9a6b' : `hsl(${e.hue},90%,75%)`;
      ctx.lineWidth = e.type === 'kill' ? 2 : 1.2;
      ctx.beginPath(); ctx.arc(sx, sy, r, 0, TAU); ctx.stroke();
    } else if (e.type === 'meteor') {
      const p = 1 - k, r = e.r * z * (0.2 + 1.3 * Math.sqrt(p));
      ctx.globalAlpha = k * 0.9;
      ctx.drawImage(whiteGlow, sx - r * 0.8, sy - r * 0.8, r * 1.6, r * 1.6);
      ctx.strokeStyle = '#ffd7a8'; ctx.lineWidth = 3 * k + 0.5;
      ctx.beginPath(); ctx.arc(sx, sy, r, 0, TAU); ctx.stroke();
    }
    if (--e.life <= 0) effects.splice(i, 1);
  }

  // selected creature's senses
  ctx.globalCompositeOperation = 'source-over';
  if (selected) drawSenses(selected);

  // bodies
  for (const c of world.creatures) {
    const [sx, sy] = toScreen(c.x, c.y);
    if (sx < -30 || sy < -30 || sx > vw + 30 || sy > vh + 30) continue;
    const dim = family.size && c !== selected && !family.has(c.id);
    ctx.globalAlpha = dim ? 0.18 : 1;
    drawBody(ctx, c, sx, sy, Math.max(c.g.size * z, 2.2));
    if (family.has(c.id)) {
      ctx.strokeStyle = `hsla(${c.g.hue},90%,80%,0.8)`; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(sx, sy, Math.max(c.g.size * z, 2) + 4, 0, TAU); ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;

  if (selected) {
    const [sx, sy] = toScreen(selected.x, selected.y);
    const r = Math.max(selected.g.size * z, 3) + 8 + Math.sin(performance.now() / 250) * 1.5;
    ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.arc(sx, sy, r, 0, TAU); ctx.stroke();
    ctx.setLineDash([]);
  }

  // tool cursor
  if (pointer.inside && tool !== 'inspect') {
    const r = tool === 'meteor' ? 140 * z : tool === 'feed' ? 60 * z : 14;
    ctx.strokeStyle = tool === 'meteor' ? 'rgba(255,190,140,0.6)' : 'rgba(189,245,223,0.55)';
    ctx.lineWidth = 1; ctx.setLineDash([3, 5]);
    ctx.beginPath(); ctx.arc(pointer.x, pointer.y, r, 0, TAU); ctx.stroke();
    ctx.setLineDash([]);
  }
}

function drawBody(g, c, sx, sy, r) {
  const h = c.g.hue, a = c.ang;
  g.save();
  g.translate(sx, sy); g.rotate(a);
  // wake: a short tail proportional to speed
  g.strokeStyle = `hsla(${h},70%,65%,0.45)`;
  g.lineWidth = Math.max(r * 0.35, 1);
  g.lineCap = 'round';
  g.beginPath(); g.moveTo(-r * 0.9, 0); g.lineTo(-r * (1.2 + c.speed * 1.3), 0); g.stroke();

  if (isPred(c)) {
    // hunter: an arrowhead with swept fins
    g.fillStyle = `hsl(${h},72%,58%)`;
    g.beginPath();
    g.moveTo(r * 1.6, 0);
    g.quadraticCurveTo(r * 0.2, r * 0.55, -r * 1.05, r * 1.05);
    g.lineTo(-r * 0.55, 0);
    g.lineTo(-r * 1.05, -r * 1.05);
    g.quadraticCurveTo(r * 0.2, -r * 0.55, r * 1.6, 0);
    g.fill();
    g.fillStyle = 'rgba(255,240,230,0.95)';
    g.beginPath(); g.arc(r * 0.55, 0, Math.max(r * 0.2, 0.8), 0, TAU); g.fill();
  } else {
    // grazer: a soft cell with a nucleus and a forward eye
    g.fillStyle = `hsl(${h},62%,60%)`;
    g.beginPath(); g.ellipse(0, 0, r * 1.15, r * 0.95, 0, 0, TAU); g.fill();
    g.fillStyle = `hsla(${h},70%,85%,0.55)`;
    g.beginPath(); g.arc(-r * 0.2, 0, r * 0.45, 0, TAU); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.95)';
    g.beginPath(); g.arc(r * 0.7, 0, Math.max(r * 0.22, 0.7), 0, TAU); g.fill();
  }
  g.restore();
}

function drawSenses(c) {
  const [sx, sy] = toScreen(c.x, c.y);
  const R = c.g.range * cam.z, fov = world.cfg.fov;
  const chans = [[0, '127,209,185'], [1, '240,180,41'], [2, '255,107,107']];
  for (let s = 0; s < NSECT; s++) {
    const a0 = c.ang - fov / 2 + (s / NSECT) * fov, a1 = a0 + fov / NSECT;
    // base wedge
    ctx.fillStyle = 'rgba(255,255,255,0.025)';
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.arc(sx, sy, R, a0, a1); ctx.closePath(); ctx.fill();
    // activation of each channel paints the wedge from the centre outwards
    for (const [ch, rgb] of chans) {
      const v = c.inp[ch * NSECT + s];
      if (v <= 0) continue;
      ctx.fillStyle = `rgba(${rgb},${0.08 + v * 0.22})`;
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.arc(sx, sy, R * (1 - v) + 4, a0, a1); ctx.closePath(); ctx.fill();
    }
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(sx, sy); ctx.arc(sx, sy, R, c.ang - fov / 2, c.ang + fov / 2); ctx.closePath(); ctx.stroke();
}

// ------------------------------------------------------------------ charts (shared hover crosshair)

let hoverFrac = null;
class Chart {
  constructor(id, tipId, series, fmt, smooth = 0) {
    this.smooth = smooth;
    this.cv = $(id); this.g = this.cv.getContext('2d'); this.tip = $(tipId);
    this.series = series; this.fmt = fmt;
    this.cv.addEventListener('mousemove', (e) => {
      const b = this.cv.getBoundingClientRect();
      hoverFrac = clampN((e.clientX - b.left) / b.width, 0, 1);
    });
    this.cv.addEventListener('mouseleave', () => { hoverFrac = null; });
  }
  resize() {
    const b = this.cv.getBoundingClientRect();
    this.w = b.width; this.h = b.height;
    this.cv.width = b.width * dpr; this.cv.height = b.height * dpr;
  }
  draw(raw) {
    const { g, w, h } = this;
    const hist = this.smooth ? smoothed(raw, this.series.map((k) => k.key), this.smooth) : raw;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    if (hist.length < 2) return;
    let max = 0;
    for (const s of hist) for (const k of this.series) if (s[k.key] != null) max = Math.max(max, s[k.key]);
    max = niceMax(max);
    const pad = { l: 26, r: 4, t: 6, b: 4 };
    const X = (i) => pad.l + (i / (hist.length - 1)) * (w - pad.l - pad.r);
    const Y = (v) => h - pad.b - (v / max) * (h - pad.t - pad.b);
    // recessive grid + axis labels
    g.font = '9.5px ui-sans-serif, system-ui'; g.fillStyle = COL.ink3; g.textAlign = 'right'; g.textBaseline = 'middle';
    for (const f of [0, 0.5, 1]) {
      const y = Y(max * f);
      g.strokeStyle = COL.grid; g.lineWidth = 1;
      g.beginPath(); g.moveTo(pad.l, y); g.lineTo(w - pad.r, y); g.stroke();
      g.fillText(this.fmt(max * f, true), pad.l - 5, y);
    }
    for (const k of this.series) {
      g.strokeStyle = k.color; g.lineWidth = 2; g.lineJoin = 'round';
      g.beginPath();
      let pen = false;
      hist.forEach((s, i) => {
        const v = s[k.key];
        if (v == null) { pen = false; return; }
        pen ? g.lineTo(X(i), Y(v)) : g.moveTo(X(i), Y(v));
        pen = true;
      });
      g.stroke();
    }
    if (hoverFrac != null) {
      const i = Math.round(hoverFrac * (hist.length - 1)), s = hist[i];
      g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 1;
      g.beginPath(); g.moveTo(X(i), pad.t); g.lineTo(X(i), h - pad.b); g.stroke();
      for (const k of this.series) {
        if (s[k.key] == null) continue;
        g.fillStyle = k.color; g.strokeStyle = '#0a0e18'; g.lineWidth = 2;
        g.beginPath(); g.arc(X(i), Y(s[k.key]), 4, 0, TAU); g.fill(); g.stroke();
      }
      this.tip.innerHTML = `day ${dayOf(s.t)} · ` + this.series.map((k) =>
        `<span style="color:${k.color}">●</span> ${s[k.key] == null ? '—' : this.fmt(s[k.key])}`).join('  ');
      this.tip.classList.add('on');
    } else this.tip.classList.remove('on');
  }
}
function smoothed(hist, keys, k) {
  return hist.map((s, i) => {
    const o = { t: s.t };
    for (const key of keys) {
      let sum = 0, n = 0;
      for (let j = Math.max(0, i - k); j <= i; j++) if (hist[j][key] != null) { sum += hist[j][key]; n++; }
      o[key] = n ? sum / n : null;
    }
    return o;
  });
}
const clampN = (v, a, b) => Math.max(a, Math.min(b, v));
const niceMax = (v) => { if (v <= 0) return 1; const p = 10 ** Math.floor(Math.log10(v)); return Math.ceil(v / p * 2) / 2 * p; };
const dayOf = (t) => Math.floor(t / 300);

const charts = [
  new Chart('c-pop', 'tip-pop', [{ key: 'herb', color: COL.herb }, { key: 'pred', color: COL.pred }], (v) => Math.round(v)),
  new Chart('c-size', 'tip-size', [{ key: 'herbSize', color: COL.herb }, { key: 'predSize', color: COL.pred }], (v, ax) => v.toFixed(ax ? 0 : 1)),
  new Chart('c-speed', 'tip-speed', [{ key: 'herbSpeed', color: COL.herb }, { key: 'predSpeed', color: COL.pred }], (v, ax) => v.toFixed(ax ? 1 : 2), 12),
];

// ------------------------------------------------------------------ inspector

const NAME_A = ['ka', 'lu', 'mi', 'zo', 'ri', 'ta', 'ne', 'vo', 'shi', 'ae', 'ul', 'ky', 'po', 'den', 'ira', 'sol'];
const NAME_B = ['rin', 'mo', 'thea', 'lix', 'dra', 'nu', 'vel', 'kai', 'sen', 'ora', 'pip', 'zar'];
function nameOf(c) {
  let x = c.id * 2654435761 >>> 0;
  const a = NAME_A[x % 16]; x = (x / 16) | 0;
  const b = NAME_A[x % 16]; x = (x / 16) | 0;
  const n = a + b + NAME_B[x % 12];
  return n[0].toUpperCase() + n.slice(1);
}

const brainCv = $('i-brain'), bg = brainCv.getContext('2d');
let bw = 0, bh = 0;
function sizeBrain() {
  const b = brainCv.getBoundingClientRect();
  bw = b.width || 308; bh = b.height || 200;
  brainCv.width = bw * dpr; brainCv.height = bh * dpr;
}

function divergent(v, alpha = 1) {
  // blue for positive, orange for negative, neutral grey at zero
  const t = Math.min(Math.abs(v), 1);
  const [r, g, b] = v >= 0 ? [57, 135, 229] : [217, 89, 38];
  const m = [92, 92, 88];
  return `rgba(${Math.round(m[0] + (r - m[0]) * t)},${Math.round(m[1] + (g - m[1]) * t)},${Math.round(m[2] + (b - m[2]) * t)},${alpha})`;
}

function drawBrain(c) {
  const g = bg, w = c.g.brain;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, bw, bh);
  const xi = 62, xh = bw * 0.55, xo = bw - 54;
  const yIn = (i) => 8 + i * ((bh - 16) / (NIN - 1)) + (i >= 15 ? 4 : 0) + Math.floor(Math.min(i, 15) / 5) * 0;
  const yH = (h) => 22 + h * ((bh - 44) / (NH - 1));
  const yO = (o) => bh / 2 - 45 + o * 30;
  // edges
  g.lineWidth = 1;
  for (let h = 0; h < NH; h++) for (let i = 0; i < NIN; i++) {
    const wt = w[h * NIN + i], a = Math.min(Math.abs(wt) * Math.abs(c.inp[i]) * 0.9, 0.85);
    if (a < 0.04) continue;
    g.strokeStyle = divergent(wt, a);
    g.beginPath(); g.moveTo(xi, yIn(i)); g.lineTo(xh, yH(h)); g.stroke();
  }
  const o2 = NIN * NH + NH;
  for (let o = 0; o < NOUT; o++) for (let h = 0; h < NH; h++) {
    const wt = w[o2 + o * NH + h], a = Math.min(Math.abs(wt) * Math.abs(c.hid[h]) * 0.8, 0.85);
    if (a < 0.04) continue;
    g.lineWidth = 1 + Math.min(Math.abs(wt), 2);
    g.strokeStyle = divergent(wt, a);
    g.beginPath(); g.moveTo(xh, yH(h)); g.lineTo(xo, yO(o)); g.stroke();
  }
  // nodes
  const node = (x, y, v, r) => {
    g.fillStyle = divergent(v); g.strokeStyle = 'rgba(5,8,15,0.9)'; g.lineWidth = 2;
    g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill(); g.stroke();
  };
  g.font = '9.5px ui-sans-serif, system-ui'; g.textBaseline = 'middle';
  for (let i = 0; i < NIN; i++) node(xi, yIn(i), c.inp[i], 3.2);
  for (let h = 0; h < NH; h++) node(xh, yH(h), c.hid[h], 5);
  for (let o = 0; o < NOUT; o++) node(xo, yO(o), c.out[o], 6);
  // labels: grouped inputs
  g.fillStyle = COL.ink3; g.textAlign = 'right';
  const groups = [['sees food', 0, 4], ['sees prey', 5, 9], ['sees threat', 10, 14], ['feels', 15, 19]];
  for (const [label, a, b] of groups) {
    g.fillText(label, xi - 10, (yIn(a) + yIn(b)) / 2);
    g.strokeStyle = 'rgba(255,255,255,0.12)'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(xi - 6, yIn(a)); g.lineTo(xi - 6, yIn(b)); g.stroke();
  }
  g.textAlign = 'left'; g.fillStyle = COL.ink2;
  OUT_LABELS.forEach((l, o) => g.fillText(l, xo + 10, yO(o)));
}

function drawAvatar(c) {
  const cv = $('i-avatar'), g = cv.getContext('2d');
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, 56, 56);
  g.globalCompositeOperation = 'lighter';
  g.globalAlpha = 0.8;
  g.drawImage(hueGlow[Math.floor(c.g.hue / 10) % 36], 0, 0, 56, 56);
  g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
  drawBody(g, { ...c, ang: -Math.PI / 4, speed: 0.6 }, 28, 28, 9);
}

function updateInspector() {
  const el = $('inspector');
  if (!selected) { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  const c = selected;
  $('i-name').textContent = nameOf(c);
  const pred = isPred(c);
  $('i-tag').innerHTML = `${pred ? 'Predator' : 'Herbivore'} · generation ${c.gen}` +
    (c.alive ? '' : ' · <span style="color:#f0b429">deceased</span>');
  $('i-energy').style.width = `${Math.max(0, c.energy / world.cap(c.g)) * 100}%`;
  const genes = [
    ['size', c.g.size.toFixed(1)], ['diet', pred ? `${Math.round(c.g.diet * 100)}% meat` : `${Math.round((1 - c.g.diet) * 100)}% plant`],
    ['vision', `${Math.round(c.g.range)} u`], ['age', `${Math.floor(c.age / 300)} d`],
    ['offspring', c.children], [pred ? 'kills' : 'meals', pred ? c.kills : c.eaten],
  ];
  $('i-genes').innerHTML = genes.map(([k, v]) => `<div class="gene"><span class="k">${k}</span><span class="v">${v}</span></div>`).join('');
  drawBrain(c);
}

function select(c) {
  selected = c; family = new Set(); familyFor = null;
  $('i-lineage').textContent = 'Show family';
  if (c) { drawAvatar(c); following = following && !!c; }
  else following = false;
  $('i-follow').textContent = following ? 'Unfollow' : 'Follow';
  updateInspector();
}

// ------------------------------------------------------------------ ticker

let lastEventCount = 0;
function updateTicker() {
  const evs = world.events;
  const fresh = evs.slice(Math.max(lastEventCount - (world.events.length >= 60 ? 1 : 0), 0));
  if (evs.length === lastEventCount && evs.length < 60) return;
  lastEventCount = evs.length;
  const tk = $('ticker');
  for (const e of fresh.slice(-3)) {
    if (tk.querySelector(`[data-key="${e.t}-${e.text}"]`)) continue;
    const d = document.createElement('div');
    d.className = `ev ${e.kind}`; d.dataset.key = `${e.t}-${e.text}`;
    d.textContent = `Day ${dayOf(e.t)} — ${e.text}`;
    tk.appendChild(d);
    setTimeout(() => { d.style.opacity = '0'; }, 7000);
    setTimeout(() => d.remove(), 8200);
  }
  while (tk.children.length > 4) tk.firstChild.remove();
}

// ------------------------------------------------------------------ input

let tool = 'inspect';
const pointer = { x: 0, y: 0, inside: false, down: false, panning: false, moved: 0, lx: 0, ly: 0 };

function setTool(t) {
  tool = t;
  document.querySelectorAll('.tools button').forEach((b) => b.classList.toggle('on', b.dataset.tool === t));
  document.body.className = document.body.className.replace(/tool-\w+/g, '').trim() + ` tool-${t}`;
}
document.querySelectorAll('.tools button').forEach((b) => b.addEventListener('click', () => setTool(b.dataset.tool)));

cv.addEventListener('pointerdown', (e) => {
  pointer.down = true; pointer.moved = 0; pointer.lx = e.clientX; pointer.ly = e.clientY;
  pointer.panning = e.button !== 0 || tool === 'inspect';
  cv.setPointerCapture(e.pointerId);
  const [wx, wy] = toWorld(e.clientX, e.clientY);
  if (e.button === 0 && tool === 'feed') world.feed(wx, wy);
  if (e.button === 0 && tool === 'predator') { select(world.dropPredator(wx, wy)); }
  if (e.button === 0 && tool === 'meteor') world.meteor(wx, wy);
});
cv.addEventListener('pointermove', (e) => {
  pointer.x = e.clientX; pointer.y = e.clientY; pointer.inside = true;
  if (!pointer.down) return;
  const dx = e.clientX - pointer.lx, dy = e.clientY - pointer.ly;
  pointer.moved += Math.abs(dx) + Math.abs(dy);
  pointer.lx = e.clientX; pointer.ly = e.clientY;
  if (pointer.panning && pointer.moved > 4) {
    document.body.classList.add('panning');
    cam.x -= dx / cam.z; cam.y -= dy / cam.z; following = false; wipe = true;
  } else if (tool === 'feed' && Math.random() < 0.5) {
    const [wx, wy] = toWorld(e.clientX, e.clientY); world.feed(wx, wy, 50, 10);
  }
});
cv.addEventListener('pointerup', (e) => {
  document.body.classList.remove('panning');
  if (tool === 'inspect' && pointer.moved < 5 && e.button === 0) {
    const [wx, wy] = toWorld(e.clientX, e.clientY);
    select(world.creatureAt(wx, wy, 14 / cam.z));
  }
  pointer.down = false;
});
cv.addEventListener('pointerleave', () => { pointer.inside = false; });
cv.addEventListener('contextmenu', (e) => e.preventDefault());
cv.addEventListener('wheel', (e) => {
  e.preventDefault();
  const [wx, wy] = toWorld(e.clientX, e.clientY);
  cam.z = clampN(cam.z * Math.exp(-e.deltaY * 0.0015), 0.25, 8);
  cam.x = wx - e.clientX / cam.z; cam.y = wy - e.clientY / cam.z;
  wipe = true;
}, { passive: false });

let paused = false, speedIdx = 1;
function togglePause() { paused = !paused; $('b-pause').innerHTML = `${paused ? 'Resume' : 'Pause'} <kbd>space</kbd>`; }
function newWorld() {
  world.reset((Math.random() * 1e9) | 0);
  select(null); effects.length = 0; lastEventCount = 0; $('ticker').innerHTML = ''; wipe = true;
  $('seed').textContent = world.seed;
}
$('b-pause').addEventListener('click', togglePause);
$('b-new').addEventListener('click', newWorld);
$('i-close').addEventListener('click', () => select(null));
$('i-follow').addEventListener('click', () => {
  following = !following; $('i-follow').textContent = following ? 'Unfollow' : 'Follow';
});
$('i-lineage').addEventListener('click', () => {
  if (!selected) return;
  if (familyFor === selected) { family = new Set(); familyFor = null; $('i-lineage').textContent = 'Show family'; return; }
  family = new Set(world.relatives(selected).map((c) => c.id)); familyFor = selected;
  $('i-lineage').textContent = `Hide family (${family.size})`;
});

const bindRange = (id, out, fn) => {
  const r = $(id);
  const apply = () => { $(out).textContent = fn(+r.value); };
  r.addEventListener('input', apply); apply();
};
bindRange('r-speed', 'o-speed', (v) => { speedIdx = v; return `×${SPEEDS[v]}`; });
bindRange('r-food', 'o-food', (v) => { world.cfg.foodRate = v; return v ? `${v}/tick` : 'famine'; });
bindRange('r-mut', 'o-mut', (v) => { world.cfg.mutation = v; return v ? `${v.toFixed(1)}×` : 'frozen'; });
const respawn = $('t-respawn');
if (params.get('respawn') === '1') respawn.checked = true;
const applyRespawn = () => { world.cfg.respawn = respawn.checked; };
respawn.addEventListener('change', () => {
  applyRespawn();
  world.log(`Spontaneous generation ${respawn.checked ? 'enabled' : 'disabled'}.`, 'user');
});
applyRespawn();

addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  const k = e.key.toLowerCase();
  if (k === ' ') { e.preventDefault(); togglePause(); }
  else if (k >= '1' && k <= '4') setTool(['inspect', 'feed', 'predator', 'meteor'][+k - 1]);
  else if (k === 'f' && selected) $('i-follow').click();
  else if (k === 'n') newWorld();
  else if (k === 'escape') select(null);
  else if (k === 'h') { document.body.classList.toggle('hide-ui'); }
});
addEventListener('resize', resize);
setTimeout(() => $('hint').classList.add('gone'), 9000);

// ------------------------------------------------------------------ loop

let frame = 0;
function loop() {
  if (!paused) for (let i = 0; i < SPEEDS[speedIdx]; i++) world.step();
  pullEffects();
  if (selected && !selected.alive && following) following = false;
  if (following && selected) {
    const tx = selected.x - (vw - 350) / 2 / cam.z, ty = selected.y - vh / 2 / cam.z;
    if (Math.abs(tx - cam.x) > world.cfg.width / 2 || Math.abs(ty - cam.y) > world.cfg.height / 2) { cam.x = tx; cam.y = ty; }
    cam.x += (tx - cam.x) * 0.12; cam.y += (ty - cam.y) * 0.12; wipe = true;
  }
  draw();
  if (frame % 6 === 0) {
    const h = world.history.at(-1) || { herb: 0, pred: 0 };
    $('s-pop').textContent = world.creatures.length;
    $('s-gen').textContent = world.stats.maxGen;
    $('s-clades').textContent = h.clades ? h.clades.toFixed(1) : '—';
    $('s-kills').textContent = world.stats.kills.toLocaleString();
    $('l-herb').textContent = h.herb; $('l-pred').textContent = h.pred;
    $('clock').textContent = `day ${dayOf(world.t)}`;
    for (const ch of charts) ch.draw(world.history);
    updateTicker();
  }
  if (selected && frame % 2 === 0) updateInspector();
  frame++;
  requestAnimationFrame(loop);
}

$('seed').textContent = world.seed;
setTool('inspect');
resize();
if (params.has('warm')) { for (let i = 0; i < +params.get('warm'); i++) world.step(); world.fxq.length = 0; }
window.primordia = { world, cam, select: (c) => select(c), toScreen };
requestAnimationFrame(loop);
