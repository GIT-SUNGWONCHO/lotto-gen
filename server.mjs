// 로컬 서버: public/ 정적 파일 + 당첨 데이터 API.
// 브라우저에서 동행복권을 직접 부를 수 없으므로(CORS) 서버가 대신 받아서 data/draws.json 에 캐시한다.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { readDraws, updateDrawsFile, estimateLatestRound } from "./lib/dhlottery.mjs";

const PORT = Number(process.env.PORT) || 4545;
const ROOT = fileURLToPath(new URL("./public/", import.meta.url));
const DATA = fileURLToPath(new URL("./data/draws.json", import.meta.url));
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".json": "application/json" };
const RETRY_MS = 10 * 60 * 1000;

let updating = null;
let lastAttempt = 0;

/** 새 회차가 나왔을 시간이면 증분 업데이트를 시도한다(동시 요청은 하나로 합친다). */
async function ensureFresh(force = false) {
  const current = await readDraws(DATA);
  const latest = current.draws.at(-1)?.round ?? 0;
  const stale = estimateLatestRound() > latest;
  if (!force && (!stale || Date.now() - lastAttempt < RETRY_MS)) return { data: current, added: 0, error: null };
  if (!updating) {
    lastAttempt = Date.now();
    updating = updateDrawsFile(DATA)
      .then((r) => ({ ...r, error: null }))
      .catch((err) => ({ data: current, added: 0, error: err.message }))
      .finally(() => (updating = null));
  }
  return updating;
}

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  try {
    if (url.pathname === "/api/draws" && req.method === "GET") {
      const { data, added, error } = await ensureFresh();
      return sendJson(res, 200, { ...data, added, error });
    }
    if (url.pathname === "/api/update" && req.method === "POST") {
      const { data, added, error } = await ensureFresh(true);
      return sendJson(res, error ? 502 : 200, { latest: data.draws.at(-1)?.round ?? 0, added, error });
    }

    const rel = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname).replace(/^\/+/, "");
    const file = normalize(join(ROOT, rel));
    if (!file.startsWith(ROOT)) return sendJson(res, 403, { error: "forbidden" });
    const body = await readFile(file);
    res.writeHead(200, { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream", "Cache-Control": "no-cache" });
    res.end(body);
  } catch (err) {
    if (err.code === "ENOENT" || err.code === "EISDIR") return sendJson(res, 404, { error: "not found" });
    console.error(err);
    sendJson(res, 500, { error: err.message });
  }
});

server.listen(PORT, () => console.log(`로또 번호 생성기: http://localhost:${PORT}`));
