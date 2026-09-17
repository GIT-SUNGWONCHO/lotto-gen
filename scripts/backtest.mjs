// 사용법: npm run backtest  — 전략들이 정말 무작위보다 나은지 과거 데이터로 확인한다.
// 각 회차 직전까지의 데이터만 보고 번호 6개를 고른 뒤, 실제 당첨번호와 몇 개가 맞았는지 센다.
import { readFile } from "node:fs/promises";
import * as L from "../public/core/lotto.js";

const { draws } = JSON.parse(await readFile(new URL("../data/draws.json", import.meta.url), "utf8"));
const pad = (s, n) => String(s).padEnd(n, " ");
const padL = (s, n) => String(s).padStart(n, " ");
const signed = (v, d = 3) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(d)}`;

const popularity = L.fitPopularity(draws);
const rows = L.backtestStrategies(draws, { start: 100, popularity });
const n = rows[0].n;
const last = draws.at(-1).round;

console.log(`\n로또 6/45 전략 백테스트 — ${n}개 회차 (${last - n + 1}회 ~ ${last}회)`);
console.log(`무작위로 6개를 골라도 평균 ${L.HIT_MEAN.toFixed(3)}개는 맞는다. 이보다 확실히 높아야 전략이라 부를 수 있다.\n`);
console.log(`${pad("전략", 30)}${padL("평균 적중", 10)}${padL("무작위 대비", 13)}${padL("z", 8)}${padL("3개+ 적중", 11)}`);
console.log("─".repeat(72));
for (const r of rows) {
  console.log(`${pad(r.label, 30)}${padL(r.mean.toFixed(3), 10)}${padL(signed(r.mean - r.expected), 13)}${padL(signed(r.z, 2), 8)}${padL(`${r.threePlus}회`, 11)}`);
}

const worst = [...rows].sort((a, b) => Math.abs(b.z) - Math.abs(a.z))[0];
console.log("─".repeat(72));
console.log(
  Math.abs(worst.z) < 2
    ? `\n모든 전략이 우연 범위(|z| < 2) 안이다. 가장 벗어난 '${worst.label}'도 z = ${signed(worst.z, 2)}.\n` +
        `→ 과거 데이터로 다음 회차의 적중 수를 높일 수 있다는 근거는 없다.`
    : `\n'${worst.label}'이 z = ${signed(worst.z, 2)}로 우연 범위를 벗어났다.\n` +
        `→ 다만 ${rows.length}개 전략을 동시에 비교하면 이 정도는 우연히도 나온다.`,
);

// 1등 확률은 조합을 어떻게 고르든 같다는 것을 숫자로 확인한다.
console.log(`\n'1등 집중'(가장 덜 나온 번호 N개 안에서만 구매, 5게임 기준)`);
console.log(`${pad("후보 수", 10)}${padL("조합 수", 10)}${padL("후보 적중 확률", 18)}${padL("그때 1등", 10)}${padL("최종 1등 확률", 18)}`);
console.log("─".repeat(66));
for (const poolSize of [6, 7, 8, 10, 12]) {
  const o = L.jackpotOdds({ poolSize, count: 5 });
  console.log(
    `${pad(`${poolSize}개`, 10)}${padL(o.combos, 10)}${padL(`1 / ${Math.round(1 / o.poolHit).toLocaleString("en-US")}`, 18)}` +
      `${padL(`${o.bought}/${o.combos}`, 10)}${padL(`${o.bought} / ${L.TOTAL_COMBOS.toLocaleString("en-US")}`, 18)}`,
  );
}
console.log("─".repeat(66));
console.log("후보를 좁힐수록 '후보가 맞을 확률'은 낮아지고 '맞았을 때 1등일 확률'은 높아져, 곱은 항상 같다.\n");
