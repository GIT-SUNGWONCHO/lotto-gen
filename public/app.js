import * as L from "./core/lotto.js";
import { divergingColumns, dotPlot } from "./charts.js";

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const num = new Intl.NumberFormat("ko-KR");
const SAVE_KEY = "lotto-gen:saved";
const PREF_KEY = "lotto-gen:prefs";
const STRATEGY_ORDER = ["mixed", "cold", "unpopular", "random"];
const FLAG_SHORT = { pastFirst: "역대 1등 조합", run3: "3연속", birthday: "생일 조합", slipLine: "용지 일직선", arith: "등차수열", sameEnding: "끝수 반복" };

const state = {
  draws: [],
  pastKeys: new Set(),
  freqCache: new Map(),
  popularity: null,
  popRef: null,
  pick: new Map(), // 번호 → "fixed" | "excluded"
  tickets: [],
  ticketMeta: null,
  rendered: new Set(),
  oddsToken: 0,
};
const rng = L.secureRandom();

// ───────────── 공통 ─────────────

const store = {
  get(key, fallback) {
    try {
      return JSON.parse(localStorage.getItem(key)) ?? fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* 저장소를 못 쓰는 환경이면 무시 */
    }
  },
};

const ballClass = (n) => `r${Math.min(5, Math.ceil(n / 10))}`;
const ball = (n, extra = "") => `<span class="ball ${ballClass(n)} ${extra}">${n}</span>`;
const pct = (p, digits = 2) => `${(p * 100).toFixed(digits)}%`;
const signed = (v, digits = 1) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(digits)}`;
const won = (v) => (v >= 1e8 ? `${(v / 1e8).toFixed(1)}억원` : `${num.format(v)}원`);
const DOW = "일월화수목금토";
function dateKo(iso, withYear = true) {
  const d = new Date(`${iso}T00:00:00Z`);
  const y = withYear ? `${d.getUTCFullYear()}년 ` : "";
  return `${y}${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일(${DOW[d.getUTCDay()]})`;
}
const tipRows = (rows) => rows.map(([k, v]) => `<div class="row"><span>${k}</span><span>${v}</span></div>`).join("");

let toastTimer;
function toast(msg) {
  let t = $(".toast");
  if (!t) {
    t = document.createElement("div");
    t.className = "toast";
    t.setAttribute("role", "status");
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 2600);
}

function table(headers, rows) {
  return `<table><thead><tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows
    .map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`)
    .join("")}</tbody></table>`;
}

function freq(window = 0) {
  if (!state.freqCache.has(window)) state.freqCache.set(window, L.frequencyStats(state.draws, { window: window || undefined }));
  return state.freqCache.get(window);
}

// ───────────── 데이터 ─────────────

async function loadData() {
  let json;
  try {
    const res = await fetch("/api/draws");
    json = await res.json();
  } catch {
    $("#dataInfo").textContent = "데이터를 불러오지 못했습니다. 터미널에서 npm start 를 실행한 뒤 http://localhost:4545 로 접속하세요.";
    return;
  }
  if (!json.draws?.length) {
    $("#dataInfo").textContent = `데이터가 없습니다. ${json.error ?? ""}`;
    return;
  }
  setData(json);
  if (json.error) toast(`최신 회차 확인 실패: ${json.error}`);
}

function setData(json) {
  state.draws = json.draws;
  state.pastKeys = new Set(json.draws.map((d) => L.comboKey(d.numbers)));
  state.freqCache.clear();
  state.rendered.clear();
  state.popularity = L.fitPopularity(state.draws);
  state.popRef = state.popularity ? L.popularityReference(state.popularity) : null;

  const first = state.draws[0];
  const last = state.draws.at(-1);
  const updated = json.updatedAt ? new Date(json.updatedAt).toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" }) : "-";
  $("#dataInfo").textContent = `역대 ${num.format(state.draws.length)}회 당첨 데이터 (${first.date} ~ ${last.date}) · 수집 ${updated}`;
  renderLatest();
  renderSaved();
  if (state.ticketMeta) state.ticketMeta.round = L.nextDraw(state.draws).round;
  renderActiveTab();
}

async function checkUpdate() {
  const btn = $("#btnUpdate");
  btn.disabled = true;
  btn.textContent = "확인 중…";
  try {
    const res = await fetch("/api/update", { method: "POST" });
    const r = await res.json();
    if (r.error) toast(`업데이트 실패: ${r.error}`);
    else if (r.added) {
      toast(`${r.added}개 회차를 추가했습니다 (최신 ${r.latest}회)`);
      await loadData();
    } else toast(`이미 최신입니다 (${r.latest}회)`);
  } catch {
    toast("서버에 연결하지 못했습니다.");
  } finally {
    btn.disabled = false;
    btn.textContent = "최신 회차 확인";
  }
}

// ───────────── 상단 ─────────────

function renderLatest() {
  const last = state.draws.at(-1);
  const next = L.nextDraw(state.draws);
  $("#latest").innerHTML = `
    <div>
      <span class="eyebrow">${last.round}회 당첨번호 · ${dateKo(last.date)}</span>
      <div class="balls">${last.numbers.map((n) => ball(n)).join("")}<span class="plus">+</span>${ball(last.bonus)}</div>
      <div class="money">1등 ${num.format(last.winners[0])}명 · 1인당 ${won(last.prizes[0])}</div>
    </div>
    <div class="next">
      <span class="eyebrow">다음 추첨</span>
      <strong>${next.round}회</strong>
      <span class="muted">${dateKo(next.date)} 저녁</span>
    </div>`;
}

// ───────────── 탭 ─────────────

const TABS = ["gen", "stats", "backtest", "story"];
function selectTab(id, focus = false) {
  for (const t of TABS) {
    const on = t === id;
    const btn = $(`#t-${t}`);
    btn.setAttribute("aria-selected", String(on));
    btn.tabIndex = on ? 0 : -1;
    $(`#tab-${t}`).hidden = !on;
    if (on && focus) btn.focus();
  }
  store.set(`${PREF_KEY}:tab`, id);
  renderActiveTab();
}
function activeTab() {
  return TABS.find((t) => $(`#t-${t}`).getAttribute("aria-selected") === "true");
}
function renderActiveTab() {
  if (!state.draws.length) return;
  const id = activeTab();
  if (state.rendered.has(id)) return;
  state.rendered.add(id);
  ({ stats: renderStats, backtest: renderBacktest, story: renderStory })[id]?.();
}

// ───────────── 번호 생성 ─────────────

function buildControls() {
  $("#strategies").innerHTML = STRATEGY_ORDER.map((id) => {
    const s = L.STRATEGIES[id];
    const badge = id === "mixed" ? '<span class="badge">기본</span>' : "";
    return `<label class="strategy"><input type="radio" name="strategy" value="${id}"><b>${s.label}${badge}</b><small>${s.desc}</small></label>`;
  }).join("");
  $("#filters").innerHTML = L.FILTERS.map(
    (f) => `<label class="check"><input type="checkbox" name="filter" value="${f.id}"><span>${f.label}<small class="muted">${f.hint}</small></span></label>`,
  ).join("");
  $("#numGrid").innerHTML = L.NUMBERS.map((n) => `<button type="button" data-n="${n}" aria-pressed="false" aria-label="${n}번">${n}</button>`).join("");

  const prefs = store.get(PREF_KEY, {});
  const form = $("#genForm");
  form.strategy.value = prefs.strategy ?? "mixed";
  form.window.value = String(prefs.window ?? 0);
  form.count.value = String(prefs.count ?? 5);
  form.strength.value = String(prefs.strength ?? 0.6);
  form.spread.checked = prefs.spread ?? true;
  const filters = new Set(prefs.filters ?? L.FILTERS.map((f) => f.id));
  for (const cb of $$('input[name="filter"]', form)) cb.checked = filters.has(cb.value);
  for (const [n, s] of prefs.pick ?? []) state.pick.set(n, s);
  syncControls();
  renderPicker();

  form.addEventListener("input", () => {
    syncControls();
    savePrefs();
  });
  form.addEventListener("submit", onGenerate);
  $("#numGrid").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-n]");
    if (!b) return;
    const n = Number(b.dataset.n);
    const cur = state.pick.get(n);
    const fixedCount = [...state.pick.values()].filter((v) => v === "fixed").length;
    if (!cur) state.pick.set(n, fixedCount >= 5 ? "excluded" : "fixed");
    else if (cur === "fixed") state.pick.set(n, "excluded");
    else state.pick.delete(n);
    if (!cur && fixedCount >= 5) toast("고정은 최대 5개라서 제외로 표시했습니다.");
    renderPicker();
    savePrefs();
  });
  $("#btnClearPick").addEventListener("click", () => {
    state.pick.clear();
    renderPicker();
    savePrefs();
  });
  $("#btnCopy").addEventListener("click", copyTickets);
  $("#btnSave").addEventListener("click", saveTickets);
}

function formValues() {
  const form = $("#genForm");
  return {
    strategy: form.strategy.value,
    window: Number(form.window.value),
    count: Number(form.count.value),
    strength: Number(form.strength.value),
    spread: form.spread.checked,
    filters: $$('input[name="filter"]:checked', form).map((c) => c.value),
  };
}

function syncControls() {
  const v = formValues();
  const form = $("#genForm");
  form.strengthOut.value = v.strength.toFixed(1);
  $("#windowField").hidden = !["cold", "mixed"].includes(v.strategy);
  $("#strengthField").hidden = v.strategy === "random";
}

function savePrefs() {
  store.set(PREF_KEY, { ...formValues(), pick: [...state.pick] });
}

function renderPicker() {
  let fixed = 0;
  let excluded = 0;
  for (const b of $$("#numGrid button")) {
    const s = state.pick.get(Number(b.dataset.n)) ?? "";
    b.dataset.state = s;
    b.setAttribute("aria-pressed", String(Boolean(s)));
    b.title = s === "fixed" ? "고정" : s === "excluded" ? "제외" : "";
    if (s === "fixed") fixed++;
    if (s === "excluded") excluded++;
  }
  $("#pickSummary").textContent = fixed || excluded ? `— 고정 ${fixed} · 제외 ${excluded}` : "";
}

function onGenerate(e) {
  e.preventDefault();
  if (!state.draws.length) return toast("데이터를 아직 불러오지 못했습니다.");
  const v = formValues();
  const f = freq(v.window);
  const weights = L.buildWeights({ strategy: v.strategy, freq: f, popularity: state.popularity, strength: v.strength });
  const fixed = [...state.pick].filter(([, s]) => s === "fixed").map(([n]) => n);
  const excluded = [...state.pick].filter(([, s]) => s === "excluded").map(([n]) => n);
  try {
    state.tickets = L.generateTickets({
      count: v.count,
      weights,
      rng,
      fixed,
      excluded,
      filters: v.filters,
      maxOverlap: v.spread ? 2 : null,
      spread: v.spread,
      pastKeys: state.pastKeys,
    });
  } catch (err) {
    return toast(err.message);
  }
  state.ticketMeta = { round: L.nextDraw(state.draws).round, strategy: v.strategy, freq: f };
  renderTickets();
}

function renderTickets() {
  const { round, strategy, freq: f } = state.ticketMeta;
  const zOf = new Map(f.rows.map((r) => [r.n, r.z]));
  $("#resultTitle").textContent = `${round}회 추천 번호 · ${L.STRATEGIES[strategy].label}`;
  $("#tickets").innerHTML = state.tickets
    .map((t, i) => {
      const chips = [];
      if (state.popularity) {
        const p = L.percentileOf(state.popRef, L.popularityScore(t.numbers, state.popularity));
        const text = p < 0.5 ? `인기도 하위 ${Math.max(1, Math.round(p * 100))}%` : `인기도 상위 ${Math.max(1, Math.round((1 - p) * 100))}%`;
        const cls = p < 0.35 ? "good" : p > 0.65 ? "warn" : "";
        chips.push(`<span class="chip ${cls}" title="무작위 조합 2만 개와 비교한 인기도. 하위일수록 다른 사람과 겹칠 가능성이 낮습니다.">${text}</span>`);
      }
      const z = t.numbers.reduce((s, n) => s + zOf.get(n), 0) / t.numbers.length;
      chips.push(`<span class="chip" title="6개 번호의 평균 출현 편차(${f.rounds}회 기준). 음수 = 기대보다 덜 나온 번호">출현 ${signed(z)}σ</span>`);
      const sum = t.numbers.reduce((s, n) => s + n, 0);
      const odd = t.numbers.filter((n) => n % 2).length;
      chips.push(`<span class="chip">합 ${sum}</span><span class="chip">홀짝 ${odd}:${6 - odd}</span>`);
      for (const flag of t.flags) chips.push(`<span class="chip warn">${FLAG_SHORT[flag]}</span>`);
      if (t.relaxed.length) chips.push(`<span class="chip warn" title="조건을 모두 만족하는 조합이 부족해 일부 조건을 풀었습니다">${t.relaxed.join("·")} 완화</span>`);
      return `<li class="ticket"><span class="tag">${String.fromCharCode(65 + i)}</span><div class="balls">${t.numbers
        .map((n) => ball(n))
        .join("")}</div><div class="meta">${chips.join("")}</div></li>`;
    })
    .join("");
  $("#btnCopy").disabled = false;
  $("#btnSave").disabled = false;
  renderOdds();
}

function renderOdds() {
  const box = $("#odds");
  const nums = state.tickets.map((t) => t.numbers);
  const token = ++state.oddsToken;
  box.hidden = false;
  box.innerHTML = '<span class="muted">당첨 확률 계산 중…</span>';
  setTimeout(() => {
    if (token !== state.oddsToken) return;
    const p = L.atLeastOneWinProbability(nums);
    const n = nums.length;
    const compare =
      n > 1
        ? `같은 번호로 ${n}게임을 사면 ${pct(L.independentWinProbability(1))}에 그칩니다. `
        : "";
    box.innerHTML = `${n > 1 ? `이 ${n}게임 중 <b>적어도 한 게임이 5등 이상</b>` : "이 게임이 <b>5등 이상</b>"}일 확률
      <strong>${pct(p)}</strong><br><span class="muted">${compare}1등 확률은 어떤 번호든 게임당 1 / 8,145,060으로 같습니다.</span>`;
  }, 30);
}

function copyTickets() {
  const text = state.tickets.map((t, i) => `${String.fromCharCode(65 + i)}  ${t.numbers.map((n) => String(n).padStart(2, " ")).join("  ")}`).join("\n");
  navigator.clipboard?.writeText(`${state.ticketMeta.round}회\n${text}`).then(
    () => toast("복사했습니다"),
    () => toast("복사하지 못했습니다"),
  );
}

function saveTickets() {
  const saved = store.get(SAVE_KEY, []);
  const { round, strategy } = state.ticketMeta;
  const keys = new Set(saved.filter((s) => s.round === round).map((s) => L.comboKey(s.numbers)));
  const fresh = state.tickets.filter((t) => !keys.has(t.key));
  saved.push(...fresh.map((t) => ({ round, numbers: t.numbers, strategy, savedAt: Date.now() })));
  store.set(SAVE_KEY, saved);
  renderSaved();
  toast(fresh.length ? `${round}회 번호 ${fresh.length}게임을 저장했습니다` : "이미 저장된 번호입니다");
}

function renderSaved() {
  const saved = store.get(SAVE_KEY, []);
  const box = $("#saved");
  if (!saved.length) {
    box.innerHTML = '<p class="muted">저장한 번호가 없습니다. 추첨이 끝나면 자동으로 당첨 여부를 확인합니다.</p>';
    return;
  }
  const rounds = [...new Set(saved.map((s) => s.round))].sort((a, b) => b - a);
  box.innerHTML = rounds
    .map((round) => {
      const draw = state.draws[round - 1]?.round === round ? state.draws[round - 1] : null;
      const rows = saved
        .filter((s) => s.round === round)
        .map((s) => {
          const balls = s.numbers.map((n) => ball(n, `sm ${draw && !draw.numbers.includes(n) ? "miss" : ""}`)).join("");
          let result = '<span class="muted small">추첨 전</span>';
          if (draw) {
            const rank = L.prizeRank(s.numbers, draw);
            const hit = L.overlap(s.numbers, draw.numbers);
            result = rank ? `<span class="result win">${rank}등 · ${hit}개 일치</span>` : `<span class="result muted">낙첨 · ${hit}개 일치</span>`;
          }
          return `<div class="saved-row"><div class="balls">${balls}</div>${result}</div>`;
        })
        .join("");
      const head = draw ? `${round}회 <span class="muted small">${dateKo(draw.date, false)} 추첨</span>` : `${round}회 <span class="muted small">추첨 전</span>`;
      return `<section class="saved-round"><header><b>${head}</b><button type="button" class="btn link small" data-del="${round}">삭제</button></header>${rows}</section>`;
    })
    .join("");
}

function onSavedClick(e) {
  const b = e.target.closest("[data-del]");
  if (!b) return;
  const round = Number(b.dataset.del);
  if (!confirm(`${round}회 저장 번호를 삭제할까요?`)) return;
  store.set(SAVE_KEY, store.get(SAVE_KEY, []).filter((s) => s.round !== round));
  renderSaved();
}

// ───────────── 번호 통계 ─────────────

function renderStats() {
  const window = Number($("#freqWindow").value);
  const f = freq(window);
  const byCount = [...f.rows].sort((a, b) => a.count - b.count || a.n - b.n);
  const low = byCount[0];
  const high = byCount.at(-1);
  const first = state.draws[state.draws.length - f.rounds];
  const last = state.draws.at(-1);
  const p = f.test.p;

  $("#tiles").innerHTML = [
    ["분석 회차", `${num.format(f.rounds)}회`, `${first.round}회 ~ ${last.round}회`],
    ["가장 많이 나온 번호", `${high.n}번`, `${high.count}회 · 기대 ${f.expected.toFixed(1)}회`],
    ["가장 적게 나온 번호", `${low.n}번`, `${low.count}회 · 기대 ${f.expected.toFixed(1)}회`],
    ["균등성 검정", `p = ${p.toFixed(2)}`, p > 0.05 ? "우연으로 설명되는 수준" : "우연 범위보다 치우침"],
  ]
    .map(([label, value, sub]) => `<div class="tile"><div class="label">${label}</div><div class="value">${value}</div><div class="sub">${sub}</div></div>`)
    .join("");

  const minZ = Math.min(...f.rows.map((r) => r.z));
  const maxZ = Math.max(...f.rows.map((r) => r.z));
  const extreme = Math.max(-minZ, maxZ);
  const pAny = 1 - (1 - 2 * (1 - L.normalCdf(extreme))) ** 45;
  const idxMin = f.rows.findIndex((r) => r.z === minZ);
  const idxMax = f.rows.findIndex((r) => r.z === maxZ);
  divergingColumns($("#freqChart"), {
    ariaLabel: `번호별 출현 횟수와 기대값의 차이, 최근 ${f.rounds}회`,
    minWidth: 600,
    items: f.rows.map((r) => ({ label: String(r.n), value: r.diff, valueLabel: `${r.n}번`, row: r })),
    band: [-2 * f.sd, 2 * f.sd],
    format: (v) => (v === 0 ? "0" : signed(v, Math.abs(v) < 10 && !Number.isInteger(v) ? 1 : 0)),
    showTick: (d) => d.row.n === 1 || d.row.n % 5 === 0,
    labelIndices: [idxMin, idxMax],
    tip: ({ row: r }) =>
      `<b>${r.n}번</b>${tipRows([
        ["출현", `${r.count}회`],
        ["기대값", `${f.expected.toFixed(1)}회`],
        ["차이", `${signed(r.diff)}회 (${signed(r.z, 2)}σ)`],
        ["마지막 출현", r.gap === 0 ? "최근 회차" : `${r.gap}회째 안 나옴`],
      ])}`,
  });
  $("#freqVerdict").innerHTML =
    `χ² = ${f.test.chi2.toFixed(1)} (자유도 ${f.test.df}), <b>p = ${p.toFixed(2)}</b>. ` +
    (p > 0.05
      ? `번호별 차이는 순수한 우연으로 충분히 설명됩니다. 가장 치우친 번호(${signed(extreme * (maxZ >= -minZ ? 1 : -1), 2)}σ) 정도의 편차는 45개 번호 중 하나쯤 나올 확률이 약 ${Math.round(pAny * 100)}%로 흔한 일입니다.`
      : `이 기간에는 번호별 차이가 우연 범위보다 큽니다. 다만 기간을 여러 개 바꿔 보다 보면 이런 결과가 우연히 나오기도 하니, 전략 검증 탭에서 실제 예측력을 확인해 보세요.`);
  $("#freqTable").innerHTML = table(
    ["번호", "출현", "기대", "차이", "z", "미출현"],
    f.rows.map((r) => [r.n, r.count, f.expected.toFixed(1), signed(r.diff), signed(r.z, 2), r.gap === 0 ? "-" : `${r.gap}회`]),
  );

  renderPopularity();
}

function renderPopularity() {
  const m = state.popularity;
  if (!m) {
    $("#popVerdict").textContent = "인기도를 추정할 데이터가 부족합니다.";
    return;
  }
  const effect = (n) => (Math.exp(m.coef[n]) - 1) * 100;
  const rows = L.NUMBERS.map((n) => ({ n, e: effect(n) }));
  const sorted = [...rows].sort((a, b) => b.e - a.e);
  const idxMax = sorted[0].n - 1;
  const idxMin = sorted.at(-1).n - 1;
  divergingColumns($("#popChart"), {
    ariaLabel: "번호별 인기도 추정치",
    minWidth: 600,
    items: rows.map((r) => ({ label: String(r.n), value: r.e, valueLabel: `${r.n}번`, row: r })),
    format: (v) => `${signed(v, Number.isInteger(v) ? 0 : 1)}%`,
    showTick: (d) => d.row.n === 1 || d.row.n % 5 === 0,
    labelIndices: [idxMin, idxMax],
    tip: ({ row: r }) =>
      `<b>${r.n}번</b>${tipRows([
        ["인기도", `${signed(r.e, 2)}%`],
        ["순위", `${sorted.findIndex((s) => s.n === r.n) + 1}위 / 45`],
      ])}<div class="muted small">이 번호가 당첨번호에 있으면 3·4개 일치 당첨자가 평균보다 이만큼 많거나 적었습니다.</div>`,
  });
  const avg = (a) => a.reduce((s, r) => s + r.e, 0) / a.length;
  $("#popVerdict").innerHTML =
    `가장 많이 고르는 번호: <b>${sorted.slice(0, 6).map((r) => r.n).join(", ")}</b> · 가장 덜 고르는 번호: <b>${sorted.slice(-6).reverse().map((r) => r.n).join(", ")}</b>. ` +
    `1~31번 평균 ${signed(avg(rows.slice(0, 31)), 2)}%, 32~45번 평균 ${signed(avg(rows.slice(31)), 2)}% — 생일·날짜로 번호를 고르는 사람이 많다는 흔적입니다. ` +
    `이 모델은 새 회차의 당첨자 수 변동을 ${Math.round(m.cvR2 * 100)}% 설명합니다(교차검증, ${num.format(m.samples)}개 회차).`;
  $("#popTable").innerHTML = table(
    ["번호", "인기도", "순위"],
    rows.map((r) => [r.n, `${signed(r.e, 2)}%`, sorted.findIndex((s) => s.n === r.n) + 1]),
  );
}

// ───────────── 전략 검증 ─────────────

function renderBacktest() {
  const bt = L.backtestStrategies(state.draws, { popularity: state.popularity });
  const n = bt[0].n;
  const last = state.draws.at(-1).round;
  $("#btMethod").innerHTML =
    `${num.format(n)}개 회차(${last - n + 1}회 ~ ${last}회) 각각에 대해 <b>그 회차 직전까지의 데이터만</b> 보고 전략 점수가 가장 높은 번호 6개를 골랐을 때, 실제 당첨번호와 몇 개가 맞았는지 평균을 냈습니다. ` +
    `아무렇게나 6개를 골라도 기대값은 <b>0.80개</b>입니다. 가로선은 95% 신뢰구간입니다.`;
  dotPlot($("#btChart"), {
    ariaLabel: "전략별 평균 적중 개수",
    minWidth: 460,
    reference: L.HIT_MEAN,
    referenceLabel: "무작위 기대값 0.80",
    items: bt.map((b) => ({ label: b.label, mean: b.mean, lo: b.mean - 1.96 * b.se, hi: b.mean + 1.96 * b.se, highlight: b.id.startsWith("cold"), b })),
    format: (v, precise) => v.toFixed(precise ? 3 : 2),
    tip: ({ b }) =>
      `<b>${b.label}</b>${tipRows([
        ["평균 적중", `${b.mean.toFixed(3)}개`],
        ["무작위 대비", `${signed(b.mean - b.expected, 3)}개`],
        ["표준점수", signed(b.z, 2)],
        ["3개 이상 적중", `${b.threePlus}회 / ${num.format(b.n)}회`],
      ])}`,
  });
  const worst = [...bt].sort((a, b) => Math.abs(b.z) - Math.abs(a.z))[0];
  const cold = bt.find((b) => b.id === "cold");
  $("#btVerdict").innerHTML =
    Math.abs(worst.z) < 2
      ? `모든 전략이 무작위 기대값과 통계적으로 구분되지 않습니다. '안 나온 번호' 전략은 평균 <b>${cold.mean.toFixed(3)}개</b>로 무작위(0.800개)와 같습니다. 가장 차이가 큰 '${worst.label}'도 z = ${signed(worst.z, 2)}로 우연 범위(±2) 안입니다.`
      : `'${worst.label}'이 z = ${signed(worst.z, 2)}로 가장 크게 벗어났지만, ${bt.length}개 전략을 동시에 비교하면 이 정도는 우연히 나올 수 있습니다. '안 나온 번호' 전략은 평균 <b>${cold.mean.toFixed(3)}개</b>입니다.`;
  $("#btTable").innerHTML = table(
    ["전략", "평균 적중", "무작위 대비", "z", "3개+ 적중", "회차 수"],
    bt.map((b) => [b.label, b.mean.toFixed(3), signed(b.mean - b.expected, 3), signed(b.z, 2), b.threePlus, num.format(b.n)]),
  );

  const pay = L.payoutByPopularity(state.draws);
  if (!pay) return;
  const names = ["1구간 (가장 비인기)", "2구간", "3구간", "4구간", "5구간 (가장 인기)"];
  divergingColumns($("#payChart"), {
    ariaLabel: "조합 인기도 구간별 1등 당첨자 수 배율",
    height: 220,
    baseline: 1,
    items: pay.map((g, i) => ({ label: names[i].replace(/ \(.+\)/, ""), value: g.ratio, valueLabel: `×${g.ratio.toFixed(2)}`, g, name: names[i] })),
    format: (v) => `×${v.toFixed(2)}`,
    labelIndices: [0, 4],
    tip: ({ g, name }) =>
      `<b>${name}</b>${tipRows([
        ["회차 수", `${g.rounds}회`],
        ["실제 1등 당첨자", `${num.format(g.winners)}명`],
        ["무작위 기대", `${g.expected.toFixed(0)}명`],
        ["배율", `×${g.ratio.toFixed(2)}`],
      ])}`,
  });
  const q1 = pay[0].ratio;
  const q5 = pay[4].ratio;
  $("#payVerdict").innerHTML =
    `가장 비인기 구간은 1등이 기대의 <b>×${q1.toFixed(2)}</b>, 가장 인기 구간은 <b>×${q5.toFixed(2)}</b>였습니다. ` +
    `같은 1등이라도 비인기 조합이면 당첨금을 나눠 갖는 사람이 약 <b>${Math.round((1 - q1 / q5) * 100)}% 적었다</b>는 뜻입니다. 당첨 확률 자체는 같습니다.`;
  $("#payTable").innerHTML = table(
    ["구간", "회차 수", "실제 1등", "무작위 기대", "배율"],
    pay.map((g, i) => [names[i], g.rounds, num.format(g.winners), g.expected.toFixed(1), `×${g.ratio.toFixed(2)}`]),
  );
}

// ───────────── 확률 이야기 ─────────────

function renderStory() {
  const f = freq(0);
  const R = f.rounds;
  const cold = [...f.rows].sort((a, b) => a.z - b.z)[0];
  const more = 1000;
  const p = L.PICK / L.MAX;
  const futureCount = cold.count + more * p;
  const crowd = state.draws
    .filter((d) => d.games && d.round >= 100)
    .map((d) => ({ d, ratio: d.winners[0] / (d.games * L.PRIZE_PROB[1]) }))
    .sort((a, b) => b.ratio - a.ratio)
    .slice(0, 3);
  const same5 = L.independentWinProbability(1);

  $("#story").innerHTML = `
    <h2>1. 모든 조합의 당첨 확률은 같습니다</h2>
    <p>1등 확률은 어떤 6개 번호든 <b>1 / 8,145,060</b>입니다. 1·2·3·4·5·6도, 지난주 당첨번호도 똑같습니다. 추첨기의 공은 지난 회차를 기억하지 못하기 때문에, 과거 데이터로 다음 번호의 확률을 바꿀 수는 없습니다.</p>

    <h2>2. "회차가 쌓이면 평균에 수렴한다"의 함정</h2>
    <p>대수의 법칙은 맞습니다. 다만 수렴하는 것은 <b>비율</b>이고, 부족한 <b>횟수</b>가 메워지는 것은 아닙니다. 지금까지 가장 적게 나온 ${cold.n}번으로 계산해 보면 이렇습니다.</p>
    <div class="table-wrap">${table(
      ["", `지금 (${num.format(R)}회)`, `${num.format(more)}회 더 추첨한 뒤 (기대)`],
      [
        [`${cold.n}번 출현`, `${cold.count}회`, `${futureCount.toFixed(1)}회`],
        ["기대값과의 차이", `${signed(cold.diff)}회`, `${signed(cold.diff)}회 <span class="muted">(그대로)</span>`],
        ["출현 비율", pct(cold.count / R), `${pct(futureCount / (R + more))} <span class="muted">(기대 ${pct(p)}에 접근)</span>`],
      ],
    )}</div>
    <p>차이는 줄지 않는데 비율은 기대값에 가까워집니다. 부족분이 채워져서가 아니라 <b>분모가 커져서 희석</b>되기 때문입니다. 그래서 '안 나온 번호가 곧 나온다'는 기대는 성립하지 않고, 실제로 <b>전략 검증</b> 탭에서 과거 ${num.format(R - 100)}개 회차에 적용해 봐도 무작위와 차이가 없습니다.</p>
    <div class="callout">그렇다고 '안 나온 번호' 전략이 손해인 것도 아닙니다. 모든 번호의 확률이 같으니 불리해질 이유도 없습니다. 이 앱의 기본값에 이 전략을 남겨 둔 이유입니다. 다만 <b>확률을 올려 주지는 않습니다.</b></div>

    <h2>3. 실제로 효과가 있는 것 ① 남들이 안 고르는 조합</h2>
    <p>1등 당첨금은 당첨자끼리 나눕니다. 당첨 확률은 못 바꿔도 <b>당첨됐을 때 받는 금액</b>은 바꿀 수 있습니다. 이 앱은 회차별 4·5등 당첨자 수로 사람들이 많이 고르는 번호를 추정합니다. 생일로 고르기 쉬운 31 이하, 7처럼 '행운의 숫자', 용지에 모양을 그리는 패턴에 사람이 몰립니다.</p>
    <ul>${crowd
      .map(({ d, ratio }) => `<li>${d.round}회 (${d.numbers.join(", ")}): 1등 <b>${d.winners[0]}명</b> — 무작위라면 ${(d.games * L.PRIZE_PROB[1]).toFixed(1)}명 정도였을 회차 (×${ratio.toFixed(1)})</li>`)
      .join("")}</ul>
    <p>이런 조합에 당첨되면 1인당 금액이 몇 분의 1로 줄어듭니다. '번호 생성'의 <b>비인기 번호</b> 전략과 패턴 필터가 이것을 피합니다.</p>

    <h2>4. 실제로 효과가 있는 것 ② 여러 게임이면 번호를 겹치지 않게</h2>
    <p>5게임을 산다면 1등 확률은 어떻게 사든 5 / 8,145,060입니다. 하지만 <b>'적어도 하나는 당첨'</b>될 확률은 번호 배치에 따라 달라집니다. 같은 번호 5장은 ${pct(same5)}, 번호를 고르게 퍼뜨린 5장은 약 ${pct(L.independentWinProbability(5), 1)}입니다. 이 앱은 게임끼리 겹치는 번호를 2개로 제한하고 정확한 확률을 계산해서 보여 줍니다.</p>

    <h2>5. 냉정한 기대값</h2>
    <p>판매액의 약 50%가 당첨금으로 돌아갑니다. 1,000원어치를 사면 평균 약 500원이 돌아온다는 뜻이고, 어떤 전략도 이 사실을 뒤집지 못합니다. 이 앱이 할 수 있는 일은 <b>같은 운이 따랐을 때 조금 더 많이 받도록</b> 번호를 고르는 것까지입니다. 즐길 만큼만 구매하세요.</p>

    <h2>이 앱의 계산 방법</h2>
    <ul>
      <li><b>안 나온 번호:</b> 번호별 z = (출현 − 기대) ÷ 표준편차, 가중치 = e<sup>−강도 × z</sup></li>
      <li><b>비인기 번호:</b> log(실제 당첨자 ÷ 무작위 기대 당첨자)를 4·5등에 대해 구해 당첨번호 45개에 릿지 회귀 → 번호별 인기도 계수, 가중치 = e<sup>−강도 × 인기도/표준편차</sup></li>
      <li><b>혼합:</b> 두 점수의 평균</li>
      <li><b>패턴 필터:</b> 역대 1등 조합, 3연속, 생일 조합, 용지 일직선, 등차수열, 같은 끝수를 뺍니다</li>
      <li><b>균등성 검정:</b> 한 회차에 6개를 비복원 추출하므로 카이제곱 통계량에 44/39를 곱해 보정합니다</li>
    </ul>`;
}

// ───────────── 시작 ─────────────

function init() {
  buildControls();
  $("#btnUpdate").addEventListener("click", checkUpdate);
  $("#saved").addEventListener("click", onSavedClick);
  $("#freqWindow").addEventListener("change", renderStats);
  const tablist = $(".tabs");
  tablist.addEventListener("click", (e) => {
    const b = e.target.closest('[role="tab"]');
    if (b) selectTab(b.id.slice(2));
  });
  tablist.addEventListener("keydown", (e) => {
    if (!["ArrowLeft", "ArrowRight"].includes(e.key)) return;
    const i = TABS.indexOf(activeTab());
    selectTab(TABS[(i + (e.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length], true);
  });
  const savedTab = store.get(`${PREF_KEY}:tab`, "gen");
  selectTab(TABS.includes(savedTab) ? savedTab : "gen");
  loadData();
}

init();
