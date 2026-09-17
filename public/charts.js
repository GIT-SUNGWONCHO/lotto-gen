// 의존성 없는 SVG 차트: 기준선에서 위/아래로 뻗는 막대(발산형), 오차막대가 있는 점 그래프.
const NS = "http://www.w3.org/2000/svg";
const RADIUS = 4;

function el(name, attrs = {}, parent) {
  const node = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  parent?.appendChild(node);
  return node;
}

function niceTicks(lo, hi, count = 5) {
  const span = hi - lo || 1;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw);
  const ticks = [];
  for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + step * 1e-9; v += step) ticks.push(Math.round(v / step) * step);
  return { ticks, step };
}

// ── 툴팁 (문서에 하나만) ──
let tip;
function tooltip() {
  if (!tip) {
    tip = document.createElement("div");
    tip.className = "viz-tip";
    tip.hidden = true;
    tip.setAttribute("role", "status");
    document.body.appendChild(tip);
  }
  return tip;
}
function showTip(evt, html) {
  const t = tooltip();
  t.innerHTML = html;
  t.hidden = false;
  const pad = 14;
  const { innerWidth: vw, innerHeight: vh } = window;
  const r = t.getBoundingClientRect();
  let x = evt.clientX + pad;
  let y = evt.clientY + pad;
  if (x + r.width > vw - 8) x = evt.clientX - r.width - pad;
  if (y + r.height > vh - 8) y = evt.clientY - r.height - pad;
  t.style.left = `${Math.max(8, x)}px`;
  t.style.top = `${Math.max(8, y)}px`;
}
const hideTip = () => tip && (tip.hidden = true);

/** 컨테이너 너비가 바뀌면 다시 그린다. */
function responsive(container, draw) {
  container._viz?.disconnect();
  let lastWidth = 0;
  const render = () => {
    const w = Math.max(container.clientWidth, container._minWidth ?? 0);
    if (w === lastWidth) return;
    lastWidth = w;
    container.replaceChildren();
    draw(w);
  };
  const ro = new ResizeObserver(render);
  ro.observe(container);
  container._viz = ro;
  render();
}

/** 끝(기준선 반대쪽)만 둥근 막대 경로 */
function barPath(x, w, y0, y1) {
  const up = y1 < y0;
  const h = Math.abs(y1 - y0);
  const r = Math.min(RADIUS, w / 2, h);
  if (h < 0.5) return "";
  if (up) {
    return `M${x},${y0}V${y1 + r}Q${x},${y1} ${x + r},${y1}H${x + w - r}Q${x + w},${y1} ${x + w},${y1 + r}V${y0}Z`;
  }
  return `M${x},${y0}V${y1 - r}Q${x},${y1} ${x + r},${y1}H${x + w - r}Q${x + w},${y1} ${x + w},${y1 - r}V${y0}Z`;
}

/**
 * 기준선(baseline)을 중심으로 위/아래로 뻗는 세로 막대.
 * @param {HTMLElement} container
 * @param {object} o
 * @param {{label:string,value:number}[]} o.items
 * @param {number} [o.baseline=0]
 * @param {[number,number]} [o.band]  기준선 주변 음영(예: ±2σ)
 * @param {(v:number)=>string} o.format   축 눈금 형식
 * @param {(item, i)=>string} o.tip       툴팁 HTML
 * @param {(item, i)=>boolean} [o.showTick] x축 라벨 표시 여부
 * @param {number[]} [o.labelIndices]     막대 끝에 값을 적을 항목
 * @param {string} o.ariaLabel
 */
export function divergingColumns(container, o) {
  container._minWidth = o.minWidth ?? 0;
  responsive(container, (width) => {
    const height = o.height ?? 240;
    const m = { top: 18, right: 8, bottom: 26, left: 46 };
    const base = o.baseline ?? 0;
    const values = o.items.map((d) => d.value);
    let lo = Math.min(base, ...values, o.band?.[0] ?? base);
    let hi = Math.max(base, ...values, o.band?.[1] ?? base);
    const padY = (hi - lo) * 0.08;
    const { ticks } = niceTicks(lo - padY, hi + padY, 4);
    lo = Math.min(lo - padY, ticks[0]);
    hi = Math.max(hi + padY, ticks.at(-1));

    const svg = el("svg", { width, height, viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": o.ariaLabel, class: "viz" }, container);
    const pw = width - m.left - m.right;
    const ph = height - m.top - m.bottom;
    const y = (v) => m.top + ((hi - v) / (hi - lo)) * ph;
    const slot = pw / o.items.length;
    const bw = Math.max(2, Math.min(24, slot * 0.62));

    for (const t of ticks) {
      el("line", { x1: m.left, x2: width - m.right, y1: y(t), y2: y(t), class: "grid" }, svg);
      el("text", { x: m.left - 8, y: y(t), class: "tick", "text-anchor": "end", "dominant-baseline": "middle" }, svg).textContent = o.format(t);
    }
    if (o.band) {
      el("rect", { x: m.left, width: pw, y: y(o.band[1]), height: y(o.band[0]) - y(o.band[1]), class: "band" }, svg);
    }

    const bars = [];
    o.items.forEach((d, i) => {
      const x = m.left + i * slot + (slot - bw) / 2;
      const p = el("path", { d: barPath(x, bw, y(base), y(d.value)), class: d.value >= base ? "bar pos" : "bar neg" }, svg);
      bars.push(p);
      if (!o.showTick || o.showTick(d, i)) {
        el("text", { x: x + bw / 2, y: height - 8, class: "tick", "text-anchor": "middle" }, svg).textContent = d.label;
      }
      if (o.labelIndices?.includes(i)) {
        const above = d.value >= base;
        el("text", { x: x + bw / 2, y: y(d.value) + (above ? -6 : 14), class: "vlabel", "text-anchor": "middle" }, svg).textContent = d.valueLabel ?? d.label;
      }
    });
    el("line", { x1: m.left, x2: width - m.right, y1: y(base), y2: y(base), class: "baseline" }, svg);

    // 막대보다 넓은 투명 히트 영역
    o.items.forEach((d, i) => {
      const hit = el("rect", { x: m.left + i * slot, y: m.top, width: slot, height: ph, class: "hit", tabindex: -1 }, svg);
      const on = (e) => {
        bars.forEach((b, k) => b.classList.toggle("dim", k !== i));
        showTip(e, o.tip(d, i));
      };
      hit.addEventListener("pointerenter", on);
      hit.addEventListener("pointermove", on);
      hit.addEventListener("pointerleave", () => {
        bars.forEach((b) => b.classList.remove("dim"));
        hideTip();
      });
    });
  });
}

/**
 * 가로 점 그래프 + 95% 구간. 기준값에 세로선.
 * @param {{label:string,mean:number,lo:number,hi:number}[]} o.items
 */
export function dotPlot(container, o) {
  container._minWidth = o.minWidth ?? 0;
  responsive(container, (width) => {
    const row = 34;
    const m = { top: 30, right: 56, bottom: 26, left: Math.min(210, width * 0.42) };
    const height = m.top + m.bottom + row * o.items.length;
    const lo0 = Math.min(o.reference, ...o.items.map((d) => d.lo));
    const hi0 = Math.max(o.reference, ...o.items.map((d) => d.hi));
    const pad = (hi0 - lo0) * 0.1;
    const { ticks } = niceTicks(lo0 - pad, hi0 + pad, 4);
    const lo = Math.min(lo0 - pad, ticks[0]);
    const hi = Math.max(hi0 + pad, ticks.at(-1));

    const svg = el("svg", { width, height, viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": o.ariaLabel, class: "viz" }, container);
    const x = (v) => m.left + ((v - lo) / (hi - lo)) * (width - m.left - m.right);

    for (const t of ticks) {
      el("line", { x1: x(t), x2: x(t), y1: m.top - 6, y2: height - m.bottom, class: "grid" }, svg);
      el("text", { x: x(t), y: height - 8, class: "tick", "text-anchor": "middle" }, svg).textContent = o.format(t);
    }
    el("line", { x1: x(o.reference), x2: x(o.reference), y1: m.top - 10, y2: height - m.bottom, class: "ref" }, svg);
    el("text", { x: x(o.reference), y: m.top - 16, class: "ref-label", "text-anchor": "middle" }, svg).textContent = o.referenceLabel;

    o.items.forEach((d, i) => {
      const cy = m.top + i * row + row / 2;
      const g = el("g", { class: d.highlight ? "dot-row hl" : "dot-row" }, svg);
      el("text", { x: m.left - 12, y: cy, class: "row-label", "text-anchor": "end", "dominant-baseline": "middle" }, g).textContent = d.label;
      el("line", { x1: x(d.lo), x2: x(d.hi), y1: cy, y2: cy, class: "whisker" }, g);
      el("circle", { cx: x(d.mean), cy, r: 5, class: "dot" }, g);
      el("text", { x: width - 6, y: cy, class: "row-value", "text-anchor": "end", "dominant-baseline": "middle" }, g).textContent = o.format(d.mean, true);
      const hit = el("rect", { x: 0, y: cy - row / 2, width, height: row, class: "hit" }, g);
      const on = (e) => showTip(e, o.tip(d, i));
      hit.addEventListener("pointerenter", on);
      hit.addEventListener("pointermove", on);
      hit.addEventListener("pointerleave", hideTip);
    });
  });
}
