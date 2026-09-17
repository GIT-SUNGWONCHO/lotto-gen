// 동행복권 로또 6/45 당첨 결과 수집기.
// 2025년 사이트 개편 이후 예전 API(common.do?method=getLottoNumber)는 홈으로 302 리다이렉트되므로
// 결과 페이지(/lt645/result)가 쓰는 JSON 엔드포인트를 사용한다. 한 번 호출에 최대 10개 회차가 온다.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

const ENDPOINT = "https://www.dhlottery.co.kr/lt645/selectPstLt645InfoNew.do";
const HEADERS = {
  "User-Agent": "Mozilla/5.0 (lotto-gen personal stats app)",
  Accept: "application/json",
  "X-Requested-With": "XMLHttpRequest",
  Referer: "https://www.dhlottery.co.kr/lt645/result",
};
// 1회 추첨: 2002-12-07(토) 20:45 KST 전후. 이후 매주 토요일.
const FIRST_DRAW_UTC = Date.UTC(2002, 11, 7, 12, 0); // 21:00 KST
const WEEK_MS = 7 * 24 * 3600 * 1000;
const REQUEST_GAP_MS = 250;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchList(params) {
  const url = `${ENDPOINT}?${new URLSearchParams(params)}`;
  const res = await fetch(url, { headers: HEADERS, redirect: "manual" });
  if (res.status !== 200) throw new Error(`동행복권 응답 오류 HTTP ${res.status} (${url})`);
  const body = await res.json();
  return body?.data?.list ?? [];
}

const toIsoDate = (ymd) => `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`;

export function normalizeDraw(x) {
  const round = Number(x.ltEpsd);
  // 2004년 8월(88회) 이전에는 한 게임이 2,000원이었다.
  const price = round <= 87 ? 2000 : 1000;
  // wholEpsdSumNtslAmt 가 실제 총 판매액이다(5등 당첨자 수로 검증: 기대값 대비 비율 ≈ 1.0).
  const sales = Number(x.wholEpsdSumNtslAmt);
  return {
    round,
    date: toIsoDate(String(x.ltRflYmd)),
    numbers: [x.tm1WnNo, x.tm2WnNo, x.tm3WnNo, x.tm4WnNo, x.tm5WnNo, x.tm6WnNo].map(Number).sort((a, b) => a - b),
    bonus: Number(x.bnsWnNo),
    sales,
    games: Math.round(sales / price),
    winners: [x.rnk1WnNope, x.rnk2WnNope, x.rnk3WnNope, x.rnk4WnNope, x.rnk5WnNope].map(Number),
    prizes: [x.rnk1WnAmt, x.rnk2WnAmt, x.rnk3WnAmt, x.rnk4WnAmt, x.rnk5WnAmt].map(Number),
  };
}

/** 날짜 기준으로 이미 추첨이 끝났어야 하는 마지막 회차(추정치). */
export function estimateLatestRound(now = Date.now()) {
  return Math.floor((now - FIRST_DRAW_UTC) / WEEK_MS) + 1;
}

/**
 * knownMax 이후의 모든 회차를 받아온다.
 * @returns {Promise<object[]>} 새로 받은 회차(정규화, 오름차순)
 */
export async function fetchDrawsAfter(knownMax = 0, { now = Date.now(), log = () => {} } = {}) {
  const found = new Map();
  const estimate = estimateLatestRound(now);
  if (estimate <= knownMax) return [];

  // 추정 회차부터 내려가며 실제로 존재하는 최신 회차를 찾는다(발표 전/휴무 대비).
  for (let r = estimate; r > Math.max(knownMax, estimate - 6); r--) {
    const list = await fetchList({ srchDir: "center", srchLtEpsd: String(r) });
    for (const x of list) found.set(Number(x.ltEpsd), x);
    if (list.length) break;
    await sleep(REQUEST_GAP_MS);
  }
  if (!found.size) return [];

  let cursor = Math.min(...found.keys());
  while (cursor > knownMax + 1) {
    await sleep(REQUEST_GAP_MS);
    const list = await fetchList({ srchDir: "older", srchCursorLtEpsd: String(cursor) });
    if (!list.length) break;
    for (const x of list) found.set(Number(x.ltEpsd), x);
    cursor = Math.min(...list.map((x) => Number(x.ltEpsd)));
    log(`  ...${cursor}회까지 수신`);
  }

  return [...found.values()]
    .map(normalizeDraw)
    .filter((d) => d.round > knownMax)
    .sort((a, b) => a.round - b.round);
}

export async function readDraws(path) {
  try {
    const json = JSON.parse(await readFile(path, "utf8"));
    return Array.isArray(json.draws) ? json : { draws: [] };
  } catch (err) {
    if (err.code === "ENOENT") return { draws: [] };
    throw err;
  }
}

/** data 파일을 증분 업데이트한다. 회차가 비어 있으면 1회부터 전부 받는다. */
export async function updateDrawsFile(path, { log = () => {} } = {}) {
  const current = await readDraws(path);
  const knownMax = current.draws.at(-1)?.round ?? 0;
  const added = await fetchDrawsAfter(knownMax, { log });
  const draws = [...current.draws, ...added];

  // 중간 누락이 있으면 저장하지 않는다(잘못된 통계를 막기 위해).
  draws.forEach((d, i) => {
    if (d.round !== i + 1) throw new Error(`회차 누락: ${i + 1}회 자리에 ${d.round}회`);
  });

  const out = { source: ENDPOINT, updatedAt: new Date().toISOString(), draws };
  if (added.length || !current.updatedAt) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(out));
  }
  return { added: added.length, latest: draws.at(-1)?.round ?? 0, data: added.length ? out : { ...current, draws } };
}
