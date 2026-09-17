// 핵심 계산이 맞는지 확인한다. 실행: npm test
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as L from "../public/core/lotto.js";

const { draws } = JSON.parse(await readFile(new URL("../data/draws.json", import.meta.url), "utf8"));
const approx = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b} (오차 ${Math.abs(a - b)})`);

/** 회차 fixture: 당첨번호만 있으면 되는 테스트용 */
const mk = (round, numbers, bonus = 45) => ({ round, date: "2020-01-04", numbers, bonus });

test("조합 수와 등수별 확률", () => {
  assert.equal(L.choose(45, 6), L.TOTAL_COMBOS);
  assert.equal(L.choose(8, 6), 28);
  assert.equal(L.choose(6, 6), 1);
  assert.equal(L.choose(5, 6), 0);
  // 각 등수의 경우의 수 = 확률 × 전체 조합 수
  const cases = (rank) => Math.round(L.PRIZE_PROB[rank] * L.TOTAL_COMBOS);
  assert.equal(cases(1), 1);
  assert.equal(cases(2), 6); // 5개 일치 + 보너스
  assert.equal(cases(3), L.choose(6, 5) * (45 - 6 - 1)); // 5개 일치, 보너스 아님
  assert.equal(cases(4), L.choose(6, 4) * L.choose(39, 2));
  assert.equal(cases(5), L.choose(6, 3) * L.choose(39, 3));
});

test("당첨 등수 판정", () => {
  const draw = { numbers: [1, 2, 3, 4, 5, 6], bonus: 7 };
  assert.equal(L.prizeRank([1, 2, 3, 4, 5, 6], draw), 1);
  assert.equal(L.prizeRank([1, 2, 3, 4, 5, 7], draw), 2); // 5개 + 보너스
  assert.equal(L.prizeRank([1, 2, 3, 4, 5, 8], draw), 3);
  assert.equal(L.prizeRank([1, 2, 3, 4, 8, 9], draw), 4);
  assert.equal(L.prizeRank([1, 2, 3, 8, 9, 10], draw), 5);
  assert.equal(L.prizeRank([1, 2, 8, 9, 10, 11], draw), 0);
  assert.equal(L.prizeRank([8, 9, 10, 11, 12, 13], draw), 0);
});

test("'적어도 한 장 5등 이상' 확률", () => {
  const p5plus = L.PRIZE_PROB[1] + L.PRIZE_PROB[2] + L.PRIZE_PROB[3] + L.PRIZE_PROB[4] + L.PRIZE_PROB[5];
  // 한 장이면 그 장이 5등 이상일 확률과 같아야 한다.
  approx(L.atLeastOneWinProbability([[1, 2, 3, 4, 5, 6]]), p5plus, 1e-12);
  // 같은 번호를 여러 장 사도 확률은 그대로다.
  approx(L.atLeastOneWinProbability([[1, 2, 3, 4, 5, 6], [1, 2, 3, 4, 5, 6]]), p5plus, 1e-12);
  // 번호가 전혀 겹치지 않으면 독립에 가깝고(겹침이 없어 서로 배타적이지 않음) 한 장보다 크다.
  const spread = L.atLeastOneWinProbability([
    [1, 2, 3, 4, 5, 6],
    [7, 8, 9, 10, 11, 12],
    [13, 14, 15, 16, 17, 18],
  ]);
  assert.ok(spread > p5plus && spread < 3 * p5plus);
  // 후보를 좁혀 겹치게 만들면 '적어도 한 장'은 오히려 낮아진다 — 1등 집중의 대가.
  const packed = L.atLeastOneWinProbability([
    [1, 2, 3, 4, 5, 6],
    [1, 2, 3, 4, 5, 7],
    [1, 2, 3, 4, 6, 7],
  ]);
  assert.ok(packed < spread);
});

test("균등성 검정", () => {
  const rounds = 1500; // 1500 × 6 ÷ 45 = 200회씩 딱 떨어진다
  const flat = new Int32Array(L.MAX + 1).fill((rounds * L.PICK) / L.MAX);
  flat[0] = 0;
  const even = L.uniformityTest(flat, rounds);
  approx(even.chi2, 0, 1e-9);
  approx(even.p, 1, 1e-9);
  assert.equal(even.df, 44);

  // 한 번호에만 몰리면 p가 0에 가까워야 한다.
  const skewed = new Int32Array(L.MAX + 1).fill(195);
  skewed[0] = 0;
  skewed[7] = 600;
  assert.ok(L.uniformityTest(skewed, rounds).p < 1e-6);
});

test("분포 함수", () => {
  approx(L.chiSquareSurvival(3.841459, 1), 0.05, 1e-4); // 카이제곱 표
  approx(L.chiSquareSurvival(9.487729, 4), 0.05, 1e-4);
  approx(L.normalCdf(0), 0.5, 1e-6);
  approx(L.normalCdf(1.959964), 0.975, 1e-3);
  approx(L.normalCdf(-1.959964), 0.025, 1e-3);
});

test("출현 횟수·미출현 기간", () => {
  const fixture = [mk(1, [1, 2, 3, 4, 5, 6]), mk(2, [1, 2, 3, 4, 5, 7]), mk(3, [8, 9, 10, 11, 12, 13])];
  const prefix = L.prefixCounts(fixture);
  assert.equal(prefix[0][1], 0);
  assert.equal(prefix[2][1], 2);
  assert.equal(prefix[3][6], 1);
  const gaps = L.gapsAt(fixture);
  assert.equal(gaps[8], 0); // 마지막 회차에 나옴
  assert.equal(gaps[1], 1); // 한 회차 전
  assert.equal(gaps[6], 2);
  assert.equal(gaps[45], 3); // 한 번도 안 나옴 = 전체 회차 수
});

test("frequencyStats 의 기간 옵션", () => {
  const all = L.frequencyStats(draws);
  assert.equal(all.rounds, draws.length);
  approx(all.expected, (draws.length * L.PICK) / L.MAX, 1e-9);
  assert.equal(all.rows.length, 45);
  assert.equal(all.rows.reduce((s, r) => s + r.count, 0), draws.length * L.PICK);

  const recent = L.frequencyStats(draws, { window: 100 });
  assert.equal(recent.rounds, 100);
  assert.equal(recent.rows.reduce((s, r) => s + r.count, 0), 600);
});

test("인기도는 출현 횟수를 뒤집지 못한다(후순위 동점 처리)", () => {
  const freq = L.frequencyStats(draws);
  const popularity = L.fitPopularity(draws);
  assert.ok(popularity, "인기도 모델이 만들어져야 한다");
  const scores = L.numberScores({ strategy: "cold", freq, popularity });
  const byCount = [...freq.rows].sort((a, b) => a.count - b.count || a.n - b.n);
  for (let i = 0; i < byCount.length; i++) {
    for (let j = i + 1; j < byCount.length; j++) {
      if (byCount[i].count === byCount[j].count) continue; // 동점은 인기도가 가른다
      assert.ok(scores[byCount[i].n] > scores[byCount[j].n], `${byCount[i].n}번(${byCount[i].count}회)이 ${byCount[j].n}번(${byCount[j].count}회)보다 앞서야 한다`);
    }
  }
});

test("coldPool: 가장 덜 나온 번호 묶음", () => {
  const freq = L.frequencyStats(draws);
  const popularity = L.fitPopularity(draws);
  const pool = L.coldPool(freq, { size: 8, popularity });
  assert.equal(pool.length, 8);
  assert.deepEqual(pool, [...pool].sort((a, b) => a - b));
  // 후보의 출현 횟수는 후보 밖 어떤 번호보다도 많지 않아야 한다.
  const count = new Map(freq.rows.map((r) => [r.n, r.count]));
  const outside = L.NUMBERS.filter((n) => !pool.includes(n));
  assert.ok(Math.max(...pool.map((n) => count.get(n))) <= Math.min(...outside.map((n) => count.get(n))));

  // 고정수는 반드시 들어가고 제외수는 빠진다.
  const picked = L.coldPool(freq, { size: 8, popularity, include: [7, 44], exclude: [9] });
  assert.equal(picked.length, 8);
  assert.ok(picked.includes(7) && picked.includes(44) && !picked.includes(9));

  assert.throws(() => L.coldPool(freq, { size: 5 }), /최소/);
});

test("jackpotOdds: 몰아 사도 1등 확률은 그대로", () => {
  for (const poolSize of [7, 8, 9, 10, 12]) {
    for (const count of [1, 5, 10]) {
      const o = L.jackpotOdds({ poolSize, count });
      assert.equal(o.combos, L.choose(poolSize, L.PICK));
      assert.equal(o.bought, Math.min(count, o.combos)); // 조합 수보다 많이 살 수는 없다
      approx(o.poolHit * o.coverage, o.bought / L.TOTAL_COMBOS, 1e-15);
      approx(o.jackpot, o.bought / L.TOTAL_COMBOS, 1e-15);
    }
  }
  // 조합 수보다 많이 살 수는 없다.
  assert.equal(L.jackpotOdds({ poolSize: 7, count: 100 }).bought, 7);
});

test("패턴 판정", () => {
  const flags = (c, o) => L.patternFlags(c, o);
  assert.ok(flags([12, 13, 14, 20, 30, 40]).includes("run3"));
  assert.ok(!flags([12, 13, 20, 30, 40, 44]).includes("run3"));
  assert.ok(flags([1, 5, 9, 14, 20, 31]).includes("birthday"));
  assert.ok(!flags([1, 5, 9, 14, 20, 32]).includes("birthday"));
  assert.ok(flags([5, 10, 15, 20, 25, 44]).includes("arith"));
  assert.ok(flags([3, 13, 23, 33, 40, 44]).includes("sameEnding"));
  assert.ok(flags([1, 2, 3, 4, 5, 6], { pastKeys: new Set(["1-2-3-4-5-6"]) }).includes("pastFirst"));
  assert.ok(flags([1, 2, 3, 4, 30, 40]).includes("slipLine")); // 용지 첫 줄 1~7
});

test("generateTickets: 조건을 지킨다", () => {
  const freq = L.frequencyStats(draws);
  const weights = L.buildWeights({ strategy: "cold", freq, popularity: null, strength: 0.6 });
  const rng = L.seededRandom(11);
  const tickets = L.generateTickets({ count: 5, weights, rng, fixed: [7], excluded: [1, 2, 3], maxOverlap: 2, spread: true });
  assert.equal(tickets.length, 5);
  assert.equal(new Set(tickets.map((t) => t.key)).size, 5, "중복 게임이 없어야 한다");
  for (const t of tickets) {
    assert.equal(t.numbers.length, 6);
    assert.deepEqual(t.numbers, [...t.numbers].sort((a, b) => a - b));
    assert.ok(t.numbers.includes(7), "고정수가 들어가야 한다");
    assert.ok(t.numbers.every((n) => ![1, 2, 3].includes(n)), "제외수가 빠져야 한다");
  }
  // 고정수를 뺀 겹침이 2개 이하
  for (let i = 0; i < tickets.length; i++) {
    for (let j = i + 1; j < tickets.length; j++) {
      assert.ok(L.overlap(tickets[i].numbers, tickets[j].numbers) - 1 <= 2);
    }
  }
  assert.throws(() => L.generateTickets({ count: 1, weights, rng, fixed: [1, 2, 3, 4, 5, 6] }), /고정수/);
  assert.throws(() => L.generateTickets({ count: 1, weights, rng, excluded: L.NUMBERS.slice(0, 41) }), /부족/);
});

test("1등 집중: 모든 게임이 후보 안에서 나온다", () => {
  const freq = L.frequencyStats(draws);
  const pool = L.coldPool(freq, { size: 8, popularity: L.fitPopularity(draws) });
  const weights = Float64Array.from({ length: L.MAX + 1 }, (_, n) => (pool.includes(n) ? 1 : 0));
  const tickets = L.generateTickets({ count: 5, weights, rng: L.seededRandom(3), maxOverlap: null, spread: true });
  assert.equal(tickets.length, 5);
  assert.equal(new Set(tickets.map((t) => t.key)).size, 5);
  for (const t of tickets) assert.ok(t.numbers.every((n) => pool.includes(n)), `${t.numbers} 는 후보 ${pool} 안이어야 한다`);
  // 후보 8개에서 5게임이면 모든 후보 번호가 최소 한 번은 쓰인다(spread 로 고르게 퍼뜨리므로).
  const used = new Set(tickets.flatMap((t) => t.numbers));
  assert.equal(used.size, pool.length);
});

test("전략 목록과 이전 이름", () => {
  for (const id of ["cold", "jackpot", "unpopular", "random"]) assert.ok(L.STRATEGIES[id]?.label);
  assert.equal(L.STRATEGY_ALIAS.mixed, "cold");
});

test("백테스트는 무작위 대조군과 같은 수준", () => {
  const bt = L.backtestStrategies(draws, { start: 100 });
  const control = bt.find((b) => b.id === "random");
  assert.ok(control.n > 1000);
  approx(control.expected, (L.PICK * L.PICK) / L.MAX, 1e-12);
  for (const b of bt) assert.ok(Math.abs(b.z) < 3, `${b.label} 이 z=${b.z.toFixed(2)} 로 크게 벗어났다`);
});

test("다음 추첨 회차", () => {
  const next = L.nextDraw([mk(1240, [1, 2, 3, 4, 5, 6]), { round: 1241, date: "2026-09-12", numbers: [1, 2, 3, 4, 5, 6], bonus: 7 }]);
  assert.equal(next.round, 1242);
  assert.equal(next.date, "2026-09-19");
});

test("실제 데이터가 온전하다", () => {
  assert.ok(draws.length > 1000);
  draws.forEach((d, i) => {
    assert.equal(d.round, i + 1, "회차가 1부터 빠짐없이 이어져야 한다");
    assert.equal(d.numbers.length, 6);
    assert.equal(new Set(d.numbers).size, 6);
    assert.deepEqual(d.numbers, [...d.numbers].sort((a, b) => a - b));
    assert.ok(d.numbers.every((n) => n >= 1 && n <= 45));
    assert.ok(d.bonus >= 1 && d.bonus <= 45 && !d.numbers.includes(d.bonus));
  });
});
