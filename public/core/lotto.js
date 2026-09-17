// 로또 6/45 통계·생성 로직. 브라우저와 Node(백테스트·테스트)에서 함께 쓰는 순수 함수 모음.

export const MAX = 45;
export const PICK = 6;
export const TOTAL_COMBOS = 8145060; // C(45,6)
/** 게임 1장이 각 등수에 당첨될 확률 */
export const PRIZE_PROB = {
  1: 1 / TOTAL_COMBOS,
  2: 6 / TOTAL_COMBOS, //      5개 + 보너스
  3: 228 / TOTAL_COMBOS, //    5개 (6 × 38)
  4: 11115 / TOTAL_COMBOS, //  4개 (C(6,4) × C(39,2))
  5: 182780 / TOTAL_COMBOS, // 3개 (C(6,3) × C(39,3))
};
const P_NUM = PICK / MAX; // 한 회차에 특정 번호가 뽑힐 확률
/** 무작위 6개로 당첨번호를 맞히는 개수의 기대값·분산(초기하분포) */
export const HIT_MEAN = (PICK * PICK) / MAX;
export const HIT_VAR = PICK * P_NUM * (1 - P_NUM) * ((MAX - PICK) / (MAX - 1));

const range = (n) => Array.from({ length: n }, (_, i) => i + 1);
export const NUMBERS = range(MAX);

// ───────────────────────── 난수 ─────────────────────────

/** 시드 고정 난수(mulberry32). 백테스트 재현용. */
export function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 가능하면 crypto 난수를 쓴다. */
export function secureRandom() {
  const c = globalThis.crypto;
  if (!c?.getRandomValues) return Math.random;
  const buf = new Uint32Array(1);
  return () => (c.getRandomValues(buf), buf[0] / 4294967296);
}

// ───────────────────────── 빈도 통계 ─────────────────────────

/** prefix[t][n] = 0..t-1 회차(배열 인덱스 기준)에서 번호 n이 나온 횟수 */
export function prefixCounts(draws) {
  const prefix = [new Int32Array(MAX + 1)];
  for (const d of draws) {
    const next = prefix.at(-1).slice();
    for (const n of d.numbers) next[n]++;
    prefix.push(next);
  }
  return prefix;
}

/** 각 번호가 마지막으로 나온 뒤 지난 회차 수 */
export function gapsAt(draws, t = draws.length) {
  const gap = new Int32Array(MAX + 1).fill(t);
  for (let i = t - 1, left = MAX; i >= 0 && left > 0; i--) {
    for (const n of draws[i].numbers) {
      if (gap[n] === t) {
        gap[n] = t - 1 - i;
        left--;
      }
    }
  }
  return gap;
}

/**
 * 번호별 출현 통계.
 * @param {number} [window] 최근 N회만 볼 때
 * z = (출현 − 기대) / 표준편차 — 음수일수록 '덜 나온(콜드)' 번호
 */
export function frequencyStats(draws, { window } = {}) {
  const from = window ? Math.max(0, draws.length - window) : 0;
  const rounds = draws.length - from;
  const counts = new Int32Array(MAX + 1);
  for (let i = from; i < draws.length; i++) for (const n of draws[i].numbers) counts[n]++;
  const expected = rounds * P_NUM;
  const sd = Math.sqrt(rounds * P_NUM * (1 - P_NUM)) || 1;
  const gaps = gapsAt(draws);
  const rows = NUMBERS.map((n) => ({
    n,
    count: counts[n],
    diff: counts[n] - expected,
    z: (counts[n] - expected) / sd,
    gap: gaps[n],
  }));
  return { rounds, expected, sd, rows, test: uniformityTest(counts, rounds) };
}

/**
 * 45개 번호가 고르게 나오는지 카이제곱 검정.
 * 한 회차에 6개를 비복원 추출하므로 일반 적합도 통계량에 44/39를 곱해야 χ²(44)를 따른다.
 */
export function uniformityTest(counts, rounds) {
  const expected = rounds * P_NUM;
  let ss = 0;
  for (let n = 1; n <= MAX; n++) ss += (counts[n] - expected) ** 2;
  const chi2 = (ss / expected) * ((MAX - 1) / (MAX - PICK));
  const df = MAX - 1;
  return { chi2, df, p: chiSquareSurvival(chi2, df) };
}

// 불완전 감마함수(Numerical Recipes)로 χ² 상단 꼬리확률 계산
function logGamma(x) {
  const c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let y = x;
  const tmp = x + 5.5 - (x + 0.5) * Math.log(x + 5.5);
  let ser = 1.000000000190015;
  for (const v of c) ser += v / ++y;
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}
function gammaQ(a, x) {
  if (x <= 0) return 1;
  const gln = logGamma(a);
  if (x < a + 1) {
    let sum = 1 / a;
    let del = sum;
    for (let ap = a; Math.abs(del) > Math.abs(sum) * 1e-12; ) {
      del *= x / ++ap;
      sum += del;
    }
    return 1 - sum * Math.exp(-x + a * Math.log(x) - gln);
  }
  let b = x + 1 - a;
  let c = 1 / 1e-300;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 300; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < 1e-300) d = 1e-300;
    c = b + an / c;
    if (Math.abs(c) < 1e-300) c = 1e-300;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-12) break;
  }
  return Math.exp(-x + a * Math.log(x) - gln) * h;
}
export const chiSquareSurvival = (x, df) => gammaQ(df / 2, x / 2);

/** 표준정규 누적분포 (Abramowitz–Stegun 7.1.26) */
export function normalCdf(z) {
  const t = 1 / (1 + (0.3275911 * Math.abs(z)) / Math.SQRT2);
  const poly = ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t;
  const erf = 1 - poly * Math.exp(-(z * z) / 2);
  return z >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}

// ───────────────────────── 인기도 모델 ─────────────────────────

/**
 * 당첨자 수로 '사람들이 많이 고르는 번호'를 추정한다.
 * 무작위 구매라면 5등(3개 일치) 당첨자 수 ≈ 판매 게임 수 × P(5등). 당첨번호에 인기 번호가 많으면 이보다 많아진다.
 * log(실제/기대)를 (5등, 4등 평균) 당첨번호 45개 지시변수에 릿지 회귀한 계수 = 번호별 인기도.
 */
export function fitPopularity(draws, { minRound = 100, lambda = 10, folds = 5 } = {}) {
  const X = [];
  const y = [];
  for (const d of draws) {
    if (d.round < minRound || !d.games || !d.winners?.[3] || !d.winners?.[4]) continue;
    const r4 = Math.log(d.winners[3] / (d.games * PRIZE_PROB[4]));
    const r5 = Math.log(d.winners[4] / (d.games * PRIZE_PROB[5]));
    X.push(d.numbers);
    y.push((r4 + r5) / 2);
  }
  if (X.length < 60) return null;

  const beta = ridgeOnSubsets(X, y, lambda);

  // 교차검증 R²: 이 모델이 새 회차의 당첨자 수를 얼마나 설명하는지
  const pred = new Float64Array(y.length);
  for (let f = 0; f < folds; f++) {
    const trainX = X.filter((_, i) => i % folds !== f);
    const trainY = y.filter((_, i) => i % folds !== f);
    const b = ridgeOnSubsets(trainX, trainY, lambda);
    for (let i = f; i < y.length; i += folds) pred[i] = b.intercept + sumOver(X[i], b.coef);
  }
  const mean = y.reduce((s, v) => s + v, 0) / y.length;
  let sse = 0;
  let sst = 0;
  y.forEach((v, i) => {
    sse += (v - pred[i]) ** 2;
    sst += (v - mean) ** 2;
  });

  const sd = Math.sqrt(beta.coef.slice(1).reduce((s, v) => s + v * v, 0) / MAX);
  return { coef: beta.coef, intercept: beta.intercept, sd, cvR2: 1 - sse / sst, samples: y.length };
}

const sumOver = (nums, arr) => nums.reduce((s, n) => s + arr[n], 0);

/** X의 각 행은 번호 6개(=45차원 0/1 벡터). 릿지 정규방정식을 가우스 소거로 푼다. */
function ridgeOnSubsets(rows, y, lambda) {
  const m = rows.length;
  const colMean = new Float64Array(MAX + 1);
  for (const r of rows) for (const n of r) colMean[n] += 1 / m;
  const yMean = y.reduce((s, v) => s + v, 0) / m;

  // A = Xcᵀ Xc + λI,  rhs = Xcᵀ yc   (Xc = X − 평균)
  const A = Array.from({ length: MAX }, () => new Float64Array(MAX + 1));
  const x = new Float64Array(MAX + 1);
  rows.forEach((r, k) => {
    x.fill(0);
    for (const n of r) x[n] = 1;
    const yc = y[k] - yMean;
    for (let i = 1; i <= MAX; i++) {
      const xi = x[i] - colMean[i];
      A[i - 1][MAX] += xi * yc;
      for (let j = i; j <= MAX; j++) A[i - 1][j - 1] += xi * (x[j] - colMean[j]);
    }
  });
  for (let i = 0; i < MAX; i++) {
    A[i][i] += lambda;
    for (let j = 0; j < i; j++) A[i][j] = A[j][i];
  }
  const sol = solve(A);
  const coef = new Float64Array(MAX + 1);
  for (let i = 1; i <= MAX; i++) coef[i] = sol[i - 1];
  return { coef, intercept: yMean - sumOver(NUMBERS, colMean.map((c, n) => c * coef[n])) };
}

function solve(aug) {
  const n = aug.length;
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(aug[r][c]) > Math.abs(aug[p][c])) p = r;
    [aug[c], aug[p]] = [aug[p], aug[c]];
    for (let r = c + 1; r < n; r++) {
      const f = aug[r][c] / aug[c][c];
      for (let k = c; k <= n; k++) aug[r][k] -= f * aug[c][k];
    }
  }
  const out = new Float64Array(n);
  for (let r = n - 1; r >= 0; r--) {
    let s = aug[r][n];
    for (let k = r + 1; k < n; k++) s -= aug[r][k] * out[k];
    out[r] = s / aug[r][r];
  }
  return out;
}

export const popularityScore = (combo, model) => sumOver(combo, model.coef);

/** 무작위 조합들의 인기도 점수 분포(오름차순). 백분위 계산용. */
export function popularityReference(model, samples = 20000, rng = seededRandom(45)) {
  const out = new Float64Array(samples);
  for (let i = 0; i < samples; i++) out[i] = popularityScore(randomCombo(rng), model);
  return out.sort();
}

/** 0 = 가장 비인기, 1 = 가장 인기 */
export function percentileOf(sorted, value) {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < value) lo = mid + 1;
    else hi = mid;
  }
  return lo / sorted.length;
}

/**
 * 인기도 점수 5분위별 1등 당첨자 수 배율(실제 ÷ 무작위 기대).
 * 점수는 교차적합(해당 회차를 뺀 모델)으로 계산해 과대평가를 막는다.
 */
export function payoutByPopularity(draws, { minRound = 100, folds = 5 } = {}) {
  const eligible = draws.filter((d) => d.round >= minRound && d.games);
  const scores = new Float64Array(eligible.length);
  for (let f = 0; f < folds; f++) {
    const hold = new Set(eligible.filter((_, i) => i % folds === f).map((d) => d.round));
    const model = fitPopularity(draws.filter((d) => !hold.has(d.round)), { minRound, folds: 2 });
    if (!model) return null;
    eligible.forEach((d, i) => {
      if (i % folds === f) scores[i] = popularityScore(d.numbers, model);
    });
  }
  const sorted = Float64Array.from(scores).sort();
  const cut = [0.2, 0.4, 0.6, 0.8].map((q) => sorted[Math.floor(q * sorted.length)]);
  const groups = Array.from({ length: 5 }, () => ({ rounds: 0, winners: 0, expected: 0 }));
  eligible.forEach((d, i) => {
    const g = groups[cut.filter((c) => scores[i] >= c).length];
    g.rounds++;
    g.winners += d.winners[0];
    g.expected += d.games * PRIZE_PROB[1];
  });
  return groups.map((g) => ({ ...g, ratio: g.winners / g.expected }));
}

// ───────────────────────── 패턴 필터 ─────────────────────────

export const FILTERS = [
  { id: "pastFirst", label: "역대 1등 조합과 같은 번호", hint: "그대로 다시 사는 사람이 많음" },
  { id: "run3", label: "3개 이상 연속 번호", hint: "예: 12·13·14" },
  { id: "birthday", label: "6개 모두 31 이하 (생일 조합)", hint: "날짜로 고르는 사람이 많음" },
  { id: "slipLine", label: "용지에서 한 줄(가로·세로·대각)에 4개 이상", hint: "용지에 모양을 그리는 구매 패턴" },
  { id: "arith", label: "5개 이상이 등차수열", hint: "예: 5·10·15·20·25" },
  { id: "sameEnding", label: "끝자리가 같은 번호 4개 이상", hint: "예: 3·13·23·33" },
];

// 로또 용지: 한 줄에 7개(1–7, 8–14, …, 43–45)
const slipPos = (n) => [Math.floor((n - 1) / 7), (n - 1) % 7];

export const comboKey = (nums) => nums.join("-");

/** 조합이 걸리는 패턴 id 목록 */
export function patternFlags(combo, { pastKeys } = {}) {
  const flags = [];
  const s = [...combo].sort((a, b) => a - b);

  if (pastKeys?.has(comboKey(s))) flags.push("pastFirst");

  let run = 1;
  for (let i = 1; i < s.length && run < 3; i++) run = s[i] === s[i - 1] + 1 ? run + 1 : 1;
  if (run >= 3) flags.push("run3");

  if (s[s.length - 1] <= 31) flags.push("birthday");

  const lines = new Map();
  for (const n of s) {
    const [r, c] = slipPos(n);
    for (const key of [`r${r}`, `c${c}`, `d${r - c}`, `a${r + c}`]) lines.set(key, (lines.get(key) ?? 0) + 1);
  }
  if (Math.max(...lines.values()) >= 4) flags.push("slipLine");

  if (longestArithmetic(s) >= 5) flags.push("arith");

  const endings = new Map();
  for (const n of s) endings.set(n % 10, (endings.get(n % 10) ?? 0) + 1);
  if (Math.max(...endings.values()) >= 4) flags.push("sameEnding");

  return flags;
}

/** 정렬된 배열에서 등차수열을 이루는 가장 긴 부분수열 길이 */
function longestArithmetic(s) {
  const set = new Set(s);
  let best = Math.min(2, s.length);
  for (let i = 0; i < s.length; i++) {
    for (let j = i + 1; j < s.length; j++) {
      const d = s[j] - s[i];
      let len = 2;
      for (let v = s[j] + d; set.has(v); v += d) len++;
      best = Math.max(best, len);
    }
  }
  return best;
}

// ───────────────────────── 생성 ─────────────────────────

export const STRATEGIES = {
  cold: { label: "안 나온 번호", desc: "기대보다 적게 나온 번호 우선, 출현 횟수가 같으면 비인기 번호 먼저" },
  jackpot: { label: "1등 집중", desc: "가장 안 나온 번호 몇 개만 후보로 두고, 그 안에서 겹치는 조합을 만듦" },
  unpopular: { label: "비인기 번호", desc: "다른 사람이 덜 고르는 번호 위주 → 당첨 시 나눠 갖는 사람이 적음" },
  random: { label: "완전 무작위", desc: "모든 번호를 같은 확률로" },
};
/** 없어진 전략 이름으로 저장된 설정을 받아 준다. */
export const STRATEGY_ALIAS = { mixed: "cold" };

/**
 * 인기도를 '후순위'로 만드는 축소 계수.
 * 출현 횟수가 같은 번호끼리 순서를 가르는 데만 쓰이도록, 인기도 점수 전체 폭이
 * 출현 1회 차이(z로 1/sd)보다 작아지게 눌러서 더한다.
 */
const TIE_MARGIN = 0.9;
export function tieBreakScale(freq, popularity) {
  if (!popularity) return 0;
  const u = NUMBERS.map((n) => -popularity.coef[n] / popularity.sd);
  const span = Math.max(...u) - Math.min(...u);
  return span > 0 ? (TIE_MARGIN * (1 / freq.sd)) / span : 0;
}

/** 번호별 점수(인덱스 1..45). 클수록 먼저 뽑힌다. */
export function numberScores({ strategy, freq, popularity }) {
  const tie = tieBreakScale(freq, popularity);
  const s = new Float64Array(MAX + 1);
  for (const { n, z } of freq.rows) {
    const unpop = popularity ? -popularity.coef[n] / popularity.sd : 0;
    s[n] = { random: 0, cold: -z + tie * unpop, jackpot: -z + tie * unpop, unpopular: unpop }[strategy];
  }
  return s;
}

/** 번호별 뽑힘 가중치(인덱스 1..45). strength 0이면 균등. */
export function buildWeights({ strategy, freq, popularity, strength = 0.6 }) {
  const scores = numberScores({ strategy, freq, popularity });
  const w = new Float64Array(MAX + 1);
  for (const n of NUMBERS) w[n] = Math.exp(strength * scores[n]);
  return w;
}

// ───────────────────────── 1등 집중 ─────────────────────────

/** 조합 수 C(n, k) */
export function choose(n, k) {
  if (k < 0 || k > n) return 0;
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return Math.round(r);
}

/**
 * '1등 집중'의 후보 번호 묶음. 가장 덜 나온 번호부터 size개.
 * @param {number[]} [o.include]  반드시 넣을 번호(고정수)
 * @param {number[]} [o.exclude]  뺄 번호
 */
export function coldPool(freq, { size = 8, popularity = null, include = [], exclude = [] } = {}) {
  if (size < PICK) throw new Error(`후보는 최소 ${PICK}개여야 합니다.`);
  const scores = numberScores({ strategy: "cold", freq, popularity });
  const drop = new Set(exclude);
  const pool = include.filter((n) => !drop.has(n));
  const rest = NUMBERS.filter((n) => !drop.has(n) && !pool.includes(n)).sort((a, b) => scores[b] - scores[a] || a - b);
  pool.push(...rest.slice(0, Math.max(0, size - pool.length)));
  if (pool.length < PICK) throw new Error("후보로 쓸 번호가 부족합니다. 제외수를 줄여 주세요.");
  return pool.sort((a, b) => a - b);
}

/**
 * 후보 size개 안에서 count게임을 살 때의 확률.
 * combos = 후보에서 만들 수 있는 조합 수, poolHit = 당첨번호 6개가 모두 후보 안에 들 확률,
 * coverage = 그 경우 내가 산 게임이 정답일 확률. 둘을 곱하면 결국 count / 8,145,060 으로 무작위와 같다.
 */
export function jackpotOdds({ poolSize, count }) {
  const combos = choose(poolSize, PICK);
  const bought = Math.min(count, combos);
  return { combos, bought, poolHit: combos / TOTAL_COMBOS, coverage: bought / combos, jackpot: bought / TOTAL_COMBOS };
}

export function randomCombo(rng) {
  const pool = NUMBERS.slice();
  for (let i = 0; i < PICK; i++) {
    const j = i + Math.floor(rng() * (MAX - i));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, PICK).sort((a, b) => a - b);
}

function weightedPick(weights, k, rng, taken) {
  const w = Float64Array.from(weights);
  for (const n of taken) w[n] = 0;
  const out = [];
  for (let i = 0; i < k; i++) {
    let total = 0;
    for (let n = 1; n <= MAX; n++) total += w[n];
    if (total <= 0) return null;
    let r = rng() * total;
    let n = 1;
    for (; n < MAX; n++) {
      r -= w[n];
      if (r < 0 && w[n] > 0) break;
    }
    if (w[n] <= 0) n = [...NUMBERS].reverse().find((v) => w[v] > 0);
    out.push(n);
    w[n] = 0;
  }
  return out;
}

/**
 * 게임 여러 장 생성.
 * @param {object} o
 * @param {Float64Array} o.weights  번호별 가중치
 * @param {number[]} [o.fixed]      반드시 넣을 번호(최대 5)
 * @param {number[]} [o.excluded]   뺄 번호
 * @param {string[]} [o.filters]    제외할 패턴 id
 * @param {number|null} [o.maxOverlap] 게임끼리 겹쳐도 되는 번호 수(고정수 제외). null이면 제한 없음
 * @param {boolean} [o.spread]      이미 쓴 번호의 가중치를 낮춰 여러 번호를 고루 커버
 */
export function generateTickets({ count, weights, rng, fixed = [], excluded = [], filters = [], maxOverlap = null, spread = false, pastKeys, maxTries = 4000 }) {
  if (fixed.length > PICK - 1) throw new Error("고정수는 최대 5개입니다.");
  const base = Float64Array.from(weights);
  for (const n of excluded) base[n] = 0;
  const available = NUMBERS.filter((n) => base[n] > 0 && !fixed.includes(n)).length;
  if (available < PICK - fixed.length) throw new Error("선택 가능한 번호가 부족합니다. 제외수를 줄여 주세요.");

  const tickets = [];
  const uses = new Int32Array(MAX + 1);
  const active = new Set(filters);
  // 조건을 만족하는 조합을 못 찾으면 겹침 제한 → 패턴 필터 순서로 완화한다.
  const stages = [{ overlap: maxOverlap !== null, filter: true, note: null }];
  if (maxOverlap !== null) stages.push({ overlap: false, filter: true, note: "겹침 제한" });
  if (active.size) stages.push({ overlap: false, filter: false, note: "패턴 필터" });

  for (let t = 0; t < count; t++) {
    const w = Float64Array.from(base);
    if (spread) for (let n = 1; n <= MAX; n++) w[n] *= 0.5 ** uses[n];

    let chosen = null;
    let stageIndex = 0;
    for (; stageIndex < stages.length && !chosen; stageIndex++) {
      const stage = stages[stageIndex];
      for (let i = 0; i < maxTries && !chosen; i++) {
        const picked = weightedPick(w, PICK - fixed.length, rng, fixed);
        if (!picked) break;
        const combo = [...fixed, ...picked].sort((a, b) => a - b);
        const key = comboKey(combo);
        if (tickets.some((x) => x.key === key)) continue;
        const flags = patternFlags(combo, { pastKeys });
        if (stage.filter && flags.some((f) => active.has(f))) continue;
        if (stage.overlap && tickets.some((x) => overlap(x.numbers, combo) - fixed.length > maxOverlap)) continue;
        chosen = { numbers: combo, key, flags };
      }
    }
    if (!chosen) throw new Error("조건에 맞는 조합을 만들지 못했습니다. 고정수·제외수를 조정해 주세요.");
    for (const n of chosen.numbers) uses[n]++;
    const relaxed = stages.slice(1, stageIndex).map((s) => s.note);
    tickets.push({ ...chosen, relaxed });
  }
  return tickets;
}

export const overlap = (a, b) => a.filter((n) => b.includes(n)).length;

/** 당첨 등수(없으면 0) */
export function prizeRank(combo, draw) {
  const hit = overlap(combo, draw.numbers);
  if (hit === 6) return 1;
  if (hit === 5) return combo.includes(draw.bonus) ? 2 : 3;
  if (hit === 4) return 4;
  if (hit === 3) return 5;
  return 0;
}

/**
 * 여러 장 중 '적어도 한 장이 5등 이상'일 정확한 확률.
 * 가능한 당첨 조합 8,145,060개를 전부 센다(3개 이상 일치 여부는 보너스와 무관).
 */
export function atLeastOneWinProbability(tickets) {
  const has = tickets.map((t) => {
    const a = new Uint8Array(MAX + 1);
    for (const n of t) a[n] = 1;
    return a;
  });
  const k = has.length;
  const m = Array.from({ length: 5 }, () => new Int8Array(k)); // 앞 5개 번호까지 일치 수
  let wins = 0;
  for (let a = 1; a <= 40; a++) {
    for (let i = 0; i < k; i++) m[0][i] = has[i][a];
    for (let b = a + 1; b <= 41; b++) {
      for (let i = 0; i < k; i++) m[1][i] = m[0][i] + has[i][b];
      for (let c = b + 1; c <= 42; c++) {
        for (let i = 0; i < k; i++) m[2][i] = m[1][i] + has[i][c];
        for (let d = c + 1; d <= 43; d++) {
          for (let i = 0; i < k; i++) m[3][i] = m[2][i] + has[i][d];
          for (let e = d + 1; e <= 44; e++) {
            const m4 = m[4];
            let any3 = false;
            let any2 = false;
            for (let i = 0; i < k; i++) {
              const v = m[3][i] + has[i][e];
              m4[i] = v;
              if (v >= 3) any3 = true;
              else if (v === 2) any2 = true;
            }
            if (any3) {
              wins += MAX - e;
              continue;
            }
            if (!any2) continue;
            for (let f = e + 1; f <= MAX; f++) {
              for (let i = 0; i < k; i++) {
                if (m4[i] === 2 && has[i][f]) {
                  wins++;
                  break;
                }
              }
            }
          }
        }
      }
    }
  }
  return wins / TOTAL_COMBOS;
}

export const independentWinProbability = (count) => {
  const p = PRIZE_PROB[1] + PRIZE_PROB[2] + PRIZE_PROB[3] + PRIZE_PROB[4] + PRIZE_PROB[5];
  return 1 - (1 - p) ** count;
};

// ───────────────────────── 백테스트 ─────────────────────────

/**
 * 각 회차 직전까지의 데이터만으로 번호 점수를 매기고, 점수 상위 topK개 중 실제 당첨번호가 몇 개였는지 센다.
 * 동점이 경계에 걸리면 무작위로 고른 것과 같은 기대값(분수)으로 계산한다.
 */
export function backtestStrategies(draws, { start = 100, topK = PICK, popularity = null, seed = 7 } = {}) {
  start = Math.max(start, 100); // 최근 100회 전략이 볼 데이터가 있어야 한다
  const prefix = prefixCounts(draws);
  const rng = seededRandom(seed);
  const lastSeen = new Int32Array(MAX + 1).fill(-1);
  const strategies = [
    { id: "cold", label: "안 나온 번호 (전체 기간)", score: (t) => (n) => -prefix[t][n] },
    { id: "cold100", label: "안 나온 번호 (최근 100회)", score: (t) => (n) => -(prefix[t][n] - prefix[t - 100][n]) },
    { id: "cold30", label: "안 나온 번호 (최근 30회)", score: (t) => (n) => -(prefix[t][n] - prefix[t - 30][n]) },
    { id: "gap", label: "오래 안 나온 번호 (미출현 기간)", score: (t) => (n) => t - lastSeen[n] },
    { id: "hot", label: "많이 나온 번호 (전체 기간)", score: (t) => (n) => prefix[t][n] },
    { id: "hot30", label: "많이 나온 번호 (최근 30회)", score: (t) => (n) => prefix[t][n] - prefix[t - 30][n] },
    ...(popularity ? [{ id: "unpopular", label: "비인기 번호 (고정 점수)", score: () => (n) => -popularity.coef[n] }] : []),
    { id: "random", label: "완전 무작위 (대조군)", score: () => () => rng() },
  ];
  const acc = strategies.map((s) => ({ id: s.id, label: s.label, n: 0, hits: 0, threePlus: 0 }));
  const scores = new Float64Array(MAX + 1);

  for (let t = 0; t < draws.length; t++) {
    if (t >= start) {
      const winning = draws[t].numbers;
      strategies.forEach((s, k) => {
        const f = s.score(t);
        for (let n = 1; n <= MAX; n++) scores[n] = f(n);
        const h = expectedTopKHits(scores, winning, topK);
        acc[k].n++;
        acc[k].hits += h;
        if (h >= 3) acc[k].threePlus++;
      });
    }
    for (const n of draws[t].numbers) lastSeen[n] = t;
  }

  const expected = (topK * PICK) / MAX;
  const variance = topK * P_NUM * (1 - P_NUM) * ((MAX - topK) / (MAX - 1));
  return acc.map((a) => {
    const mean = a.hits / a.n;
    const se = Math.sqrt(variance / a.n);
    return { ...a, mean, se, expected, z: (mean - expected) / se };
  });
}

function expectedTopKHits(scores, winning, k) {
  const sorted = Array.from(scores.subarray(1)).sort((a, b) => b - a);
  const cutoff = sorted[k - 1];
  const above = sorted.filter((v) => v > cutoff).length;
  const ties = sorted.filter((v) => v === cutoff).length;
  let h = 0;
  for (const n of winning) {
    if (scores[n] > cutoff) h += 1;
    else if (scores[n] === cutoff) h += (k - above) / ties;
  }
  return h;
}

// ───────────────────────── 기타 ─────────────────────────

export function nextDraw(draws) {
  const last = draws.at(-1);
  const d = new Date(`${last.date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 7);
  return { round: last.round + 1, date: d.toISOString().slice(0, 10) };
}
