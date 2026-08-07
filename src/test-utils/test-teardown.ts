// bun test 전역 teardown(bunfig.toml [test].preload) — 등록 배경은 bunfig.toml 주석 참조.
// preload에서 등록한 afterAll은 전체 테스트 런의 마지막에 1회 실행된다(파일 단위 아님 — 실측).
import { afterAll } from "bun:test";

import { closeHermeticDb } from "./hermetic-db";

afterAll(async () => {
  await closeHermeticDb();
});
