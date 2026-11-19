// Primordia — creature artwork. Bodies are drawn from the genome: the behavioural genes
// (size, diet, hue) set the overall form, and the visual-only `morph` genes add tails,
// fins, patterns, accents, elongation and spikes. Related creatures therefore look alike,
// and lineages drift apart visibly over generations.

const TAU = Math.PI * 2;
const DETAIL_PX = 3.5;   // below this radius on screen, draw the cheap silhouette

export function looks(g) {
  const [tail, fins, pattern, accent, stretch, spikes] = g.morph;
  return {
    segments: 1 + Math.floor(tail * 3.999),           // 1–4 tail segments / streamers
    fin: 0.35 + fins * 0.9,                           // fin length, in body radii
    pattern: pattern < 0.33 ? 'plain' : pattern < 0.66 ? 'spots' : 'stripes',
    accentHue: (g.hue + (accent - 0.5) * 200 + 360) % 360,
    len: 1 + stretch * 0.75,                          // body length factor
    wid: 1 - stretch * 0.28,                          // body width factor
    spikes: Math.floor(spikes * 4.999),               // 0–4
    seedA: tail * 13.7 + fins * 7.1, seedB: pattern * 5.3 + accent * 11.9,
  };
}

// c: a creature-like object { g, ang, speed, id }. r: body radius in screen pixels.
export function drawCreature(ctx, c, sx, sy, r, time) {
  const pred = c.g.diet > 0.5;
  ctx.save();
  ctx.translate(sx, sy);
  ctx.rotate(c.ang);
  if (r < DETAIL_PX || !c.g.morph) simple(ctx, c, r, pred);
  else if (pred) hunter(ctx, c, r, time);
  else grazer(ctx, c, r, time);
  ctx.restore();
}

function simple(g, c, r, pred) {
  const h = c.g.hue;
  g.strokeStyle = `hsla(${h},70%,65%,0.45)`;
  g.lineWidth = Math.max(r * 0.35, 1);
  g.lineCap = 'round';
  g.beginPath(); g.moveTo(-r * 0.9, 0); g.lineTo(-r * (1.2 + c.speed * 1.3), 0); g.stroke();
  if (pred) {
    g.fillStyle = `hsl(${h},72%,58%)`;
    g.beginPath();
    g.moveTo(r * 1.6, 0);
    g.quadraticCurveTo(r * 0.2, r * 0.55, -r * 1.05, r * 1.05);
    g.lineTo(-r * 0.55, 0);
    g.lineTo(-r * 1.05, -r * 1.05);
    g.quadraticCurveTo(r * 0.2, -r * 0.55, r * 1.6, 0);
    g.fill();
  } else {
    g.fillStyle = `hsl(${h},62%,60%)`;
    g.beginPath(); g.ellipse(0, 0, r * 1.15, r * 0.95, 0, 0, TAU); g.fill();
  }
  g.fillStyle = 'rgba(255,255,255,0.95)';
  g.beginPath(); g.arc(r * (pred ? 0.55 : 0.7), 0, Math.max(r * 0.2, 0.7), 0, TAU); g.fill();
}

function grazer(g, c, r, time) {
  const L = looks(c.g), h = c.g.hue, a = L.accentHue;
  const phase = time * 0.008 * (1 + c.speed) + c.id * 1.7;
  const bl = r * 1.15 * L.len, bw = r * 0.95 * L.wid;

  // undulating tail: a chain of shrinking beads
  for (let i = L.segments; i >= 1; i--) {
    const k = i / (L.segments + 1);
    const x = -bl - r * 0.15 - i * r * 0.62;
    const y = Math.sin(phase - i * 0.9) * r * 0.28 * i;
    g.fillStyle = `hsla(${i % 2 ? a : h},60%,${58 - i * 3}%,${0.95 - k * 0.45})`;
    g.beginPath(); g.arc(x, y, r * (0.58 - k * 0.32), 0, TAU); g.fill();
  }

  // paired fins, flapping
  const flap = Math.sin(phase * 1.6) * 0.35;
  g.fillStyle = `hsla(${a},70%,62%,0.7)`;
  for (const side of [-1, 1]) {
    g.save();
    g.translate(-bl * 0.15, side * bw * 0.8);
    g.rotate(side * (2.2 + flap));
    g.beginPath(); g.ellipse(r * L.fin * 0.5, 0, r * L.fin * 0.55, r * 0.26, 0, 0, TAU); g.fill();
    g.restore();
  }

  // body
  g.fillStyle = `hsl(${h},62%,58%)`;
  g.beginPath(); g.ellipse(0, 0, bl, bw, 0, 0, TAU); g.fill();
  pattern(g, L, a, bl, bw, r);
  // sheen
  g.fillStyle = 'rgba(255,255,255,0.22)';
  g.beginPath(); g.ellipse(bl * 0.15, -bw * 0.38, bl * 0.45, bw * 0.22, 0, 0, TAU); g.fill();

  // antennae
  if (L.spikes >= 2) {
    g.strokeStyle = `hsla(${a},80%,75%,0.85)`; g.lineWidth = Math.max(r * 0.12, 0.8); g.lineCap = 'round';
    const wob = Math.sin(phase * 2) * 0.15;
    for (const side of [-1, 1]) {
      g.beginPath();
      g.moveTo(bl * 0.75, side * bw * 0.3);
      g.quadraticCurveTo(bl + r * 0.6, side * (bw * 0.5 + r * 0.2), bl + r * (0.9 + 0.15 * L.spikes), side * r * (0.75 + wob));
      g.stroke();
    }
  }

  eye(g, bl * 0.62, 0, r);
}

function hunter(g, c, r, time) {
  const L = looks(c.g), h = c.g.hue, a = L.accentHue;
  const phase = time * 0.01 * (1 + c.speed) + c.id * 1.3;
  const nose = r * 1.6 * L.len, back = r * 1.05, wing = r * (0.75 + L.fin * 0.45);

  // trailing streamers
  g.lineCap = 'round';
  for (let i = 0; i < L.segments; i++) {
    const off = (i - (L.segments - 1) / 2) * r * 0.32;
    const len = r * (1.4 + 0.5 * (L.segments - Math.abs(i - (L.segments - 1) / 2)));
    g.strokeStyle = `hsla(${a},80%,66%,0.75)`;
    g.lineWidth = Math.max(r * 0.16, 0.8);
    g.beginPath();
    g.moveTo(-back * 0.6, off);
    g.quadraticCurveTo(-back - len * 0.5, off + Math.sin(phase - i) * r * 0.5,
      -back - len, off + Math.sin(phase - i - 1.2) * r * 0.7);
    g.stroke();
  }

  // swept wings and body
  g.fillStyle = `hsl(${h},72%,56%)`;
  g.beginPath();
  g.moveTo(nose, 0);
  g.quadraticCurveTo(r * 0.2, r * 0.5, -back, wing);
  g.lineTo(-back * 0.5, 0);
  g.lineTo(-back, -wing);
  g.quadraticCurveTo(r * 0.2, -r * 0.5, nose, 0);
  g.fill();

  // spines along the wing edges
  if (L.spikes) {
    g.fillStyle = `hsl(${a},75%,68%)`;
    for (let i = 1; i <= L.spikes; i++) {
      const t = i / (L.spikes + 1);
      for (const side of [-1, 1]) {
        const x = nose + (-back - nose) * t, y = side * wing * t * t;
        g.beginPath();
        g.moveTo(x - r * 0.18, y);
        g.lineTo(x - r * 0.35, y + side * r * 0.42);
        g.lineTo(x + r * 0.1, y + side * r * 0.08);
        g.fill();
      }
    }
  }

  // markings: a chevron stripe, or a row of spots along the spine
  if (L.pattern === 'stripes') {
    g.strokeStyle = `hsla(${a},85%,72%,0.9)`; g.lineWidth = Math.max(r * 0.16, 0.8);
    for (let i = 0; i < 2; i++) {
      const x = r * (0.3 - i * 0.55);
      g.beginPath(); g.moveTo(x - r * 0.45, -r * 0.42); g.lineTo(x, 0); g.lineTo(x - r * 0.45, r * 0.42); g.stroke();
    }
  } else if (L.pattern === 'spots') {
    g.fillStyle = `hsla(${a},85%,72%,0.9)`;
    for (let i = 0; i < 3; i++) { g.beginPath(); g.arc(r * (0.5 - i * 0.45), 0, r * 0.13, 0, TAU); g.fill(); }
  }

  eye(g, r * 0.62 * L.len, 0, r, true);
}

function pattern(g, L, a, bl, bw, r) {
  if (L.pattern === 'plain') return;
  g.save();
  g.beginPath(); g.ellipse(0, 0, bl, bw, 0, 0, TAU); g.clip();
  g.fillStyle = `hsla(${a},75%,70%,0.75)`;
  if (L.pattern === 'spots') {
    for (let i = 0; i < 4; i++) {
      const x = (Math.sin(L.seedA + i * 2.4) * 0.6) * bl, y = (Math.cos(L.seedB + i * 1.9) * 0.55) * bw;
      g.beginPath(); g.arc(x, y, r * (0.16 + 0.06 * ((i + 1) % 3)), 0, TAU); g.fill();
    }
  } else {
    for (let i = 0; i < 3; i++) {
      const x = -bl * 0.55 + i * bl * 0.45;
      g.fillRect(x, -bw, r * 0.2, bw * 2);
    }
  }
  g.restore();
}

function eye(g, x, y, r, fierce = false) {
  const er = Math.max(r * 0.22, 0.8);
  g.fillStyle = 'rgba(255,255,255,0.97)';
  g.beginPath(); g.arc(x, y, er, 0, TAU); g.fill();
  g.fillStyle = fierce ? '#3a0d06' : '#0b1a24';
  g.beginPath();
  if (fierce) g.ellipse(x + er * 0.25, y, er * 0.22, er * 0.7, 0, 0, TAU);
  else g.arc(x + er * 0.3, y, er * 0.5, 0, TAU);
  g.fill();
}
