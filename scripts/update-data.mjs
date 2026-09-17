// 사용법: npm run update  — data/draws.json 을 최신 회차까지 채운다.
import { fileURLToPath } from "node:url";
import { updateDrawsFile } from "../lib/dhlottery.mjs";

const DATA = fileURLToPath(new URL("../data/draws.json", import.meta.url));

const { added, latest } = await updateDrawsFile(DATA, { log: console.log });
console.log(added ? `${added}개 회차 추가 → 최신 ${latest}회` : `이미 최신입니다 (${latest}회)`);
