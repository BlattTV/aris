/**
 * Leichtgewichtige Canvas-Charts (ohne externe Abhängigkeit, offline-fähig).
 */

export function barChart(canvas, labels, values, { color = "#22d3ee", colors = null, format = (v) => v } = {}) {
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth, H = canvas.clientHeight;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);

  const pad = { l: 8, r: 8, t: 18, b: 22 };
  const cw = (W - pad.l - pad.r) / values.length;
  const max = Math.max(...values, 1);

  ctx.font = "10px system-ui, sans-serif";
  ctx.textAlign = "center";

  values.forEach((v, i) => {
    const h = ((H - pad.t - pad.b) * v) / max;
    const x = pad.l + i * cw + cw * 0.15;
    const y = H - pad.b - h;
    ctx.fillStyle = colors ? colors[i] || color : color;
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.roundRect(x, y, cw * 0.7, h, 3);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#94a3b8";
    ctx.fillText(labels[i], pad.l + i * cw + cw / 2, H - 8);
    if (v === max || i === values.length - 1) {
      ctx.fillStyle = "#e2e8f0";
      ctx.fillText(format(v), pad.l + i * cw + cw / 2, y - 4);
    }
  });
}

export function donut(canvas, segments) {
  // segments: [{value, color, label}]
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth, H = canvas.clientHeight;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);

  const cx = H / 2, cy = H / 2, R = H / 2 - 6, r = R * 0.55;
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  let angle = -Math.PI / 2;

  for (const seg of segments) {
    const a2 = angle + (seg.value / total) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(cx, cy, R, angle, a2);
    ctx.arc(cx, cy, r, a2, angle, true);
    ctx.closePath();
    ctx.fillStyle = seg.color;
    ctx.fill();
    angle = a2;
  }

  // Legende rechts
  ctx.font = "11px system-ui, sans-serif";
  ctx.textAlign = "left";
  let ly = 14;
  for (const seg of segments.slice(0, 7)) {
    ctx.fillStyle = seg.color;
    ctx.fillRect(H + 8, ly - 8, 9, 9);
    ctx.fillStyle = "#cbd5e1";
    const pct = Math.round((seg.value / total) * 100);
    ctx.fillText(`${seg.label} (${pct}%)`, H + 22, ly);
    ly += 16;
  }
}
