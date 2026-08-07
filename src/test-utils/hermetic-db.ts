// hermetic DB(PGlite) seam — 권한·파기·돈·전이 그물을 CI(test:pure)에서 돌게 하는 dual-mode
// 테스트 DB. 배경·실측 근거·함정 목록 = ref/plans/2026-08-07-crm-ci-coverage-hermetic-db.md.
//
// dual-mode 계약:
//   - DATABASE_URL 있음(로컬 test:server) → 기존 그대로 실 master(getDefaultDb) — 회귀 0.
//   - 없음(CI test:pure — 러너가 env를 지운다) → in-memory PGlite에 catalog·public 미러
//     (pushSchema, 스키마 파일이 DDL SSOT) + crm 실 마이그레이션 53개를 적용해 반환.
//
// ⚠️ PGlite는 단일 세션이다 — 병렬 트랜잭션(Promise.all에 .transaction() 2개)은 BEGIN/COMMIT이
//    interleave돼 깨진다. 테스트는 순차 실행이 전제(기존 스위트 전부 해당).
// ⚠️ 여기 없는 것: 앱 팀 DB 트리거·RLS·pg_net — 그 행위 검증은 로컬 test:server 몫.
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { drizzle } from "drizzle-orm/pglite";

import * as catalogSchema from "../db/catalog";
import { type Db, getDefaultDb } from "../db/client";
import * as publicApp from "../db/public-app";
import * as schema from "../db/schema";

// close용 원시 핸들 — 닫지 않으면 0 fail이어도 프로세스가 exit 99가 된다(bunfig.toml 주석).
let rawClient: PGlite | null = null;

async function buildHermeticDb(): Promise<Db> {
  // drizzle-kit은 devDependency 무거운 모듈 — 실 DB 모드(test:server)에선 로드 자체를 피한다.
  const { pushSchema } = await import("drizzle-kit/api");

  const client = new PGlite({ extensions: { vector } });
  rawClient = client;
  await client.exec("CREATE EXTENSION IF NOT EXISTS vector; CREATE SCHEMA IF NOT EXISTS catalog;");
  // master에만 있는 앱 팀 함수 스텁(advisor_quotes.id DEFAULT) — 테스트에 v7 시간정렬 의미는 불필요.
  await client.exec(
    "CREATE OR REPLACE FUNCTION uuid_generate_v7() RETURNS uuid AS $$ SELECT gen_random_uuid() $$ LANGUAGE sql;",
  );

  // catalog·public 미러 — src/db/catalog.ts·public-app.ts에서 런타임 생성(수기 DDL 복제 금지).
  const { statementsToExecute } = await pushSchema(
    { ...catalogSchema, ...publicApp },
    drizzle(client) as never,
    ["catalog"],
  );
  for (const stmt of statementsToExecute) {
    let fixed = stmt
      // identity maxValue(bigint max)가 JS number 정밀도로 …776000으로 반올림돼 22003이 난다.
      .replaceAll("9223372036854776000", "9223372036854775807");
    // introspect 아티팩트: text 컬럼 인덱스에 int8_ops 등 잘못된 opclass → 기본 opclass로.
    if (fixed.startsWith("CREATE INDEX")) fixed = fixed.replace(/\s+\w+_ops\b/g, "");
    await client.exec(fixed);
  }

  // crm — 실 마이그레이션(배포 산물)을 그대로 적용. drizzle의 pglite migrator는 extended
  // protocol(단일문만 허용)이라 breakpoint 없는 다문장 파일(0014 등)에서 42601로 죽는다
  // → simple protocol(exec)로 파일 단위 BEGIN/COMMIT.
  const journal = (await Bun.file(new URL("../../drizzle/meta/_journal.json", import.meta.url)).json()) as {
    entries: { tag: string }[];
  };
  for (const { tag } of journal.entries) {
    const raw = await Bun.file(new URL(`../../drizzle/${tag}.sql`, import.meta.url)).text();
    const body = raw.replaceAll("--> statement-breakpoint", "");
    try {
      await client.exec(`BEGIN;\n${body}\nCOMMIT;`);
    } catch (e) {
      throw new Error(`hermetic DB 마이그레이션 실패: ${tag} — ${(e as Error).message}`, { cause: e });
    }
  }

  // hermetic 전용 시드 — 실 master에서는 "profiles 생성 금지 계약"(profiles-write-guard) 때문에
  // 전용 `상담사테스트` profile을 **빌려 읽기만** 하는데(quote-requests.confirm.test.ts),
  // 이 인스턴스는 그 계약의 대상(공유 master)이 아니다. 이 함수는 DATABASE_URL 부재 모드에서만
  // 실행되므로 실 profiles에 물리적으로 닿을 수 없다 — guard에는 명시 예외로 등록돼 있다.
  // `상담사테스트`는 정확히 1행이어야 한다(confirm 테스트가 단언). 나머지 2행은
  // anyUnlinkedProfileId(profiles-fixture.ts)용 여유분 — 연결 픽스처와의 경합을 줄인다.
  await client.exec(
    "INSERT INTO public.profiles (id, role, full_name) VALUES (gen_random_uuid(), 'user', '상담사테스트'), (gen_random_uuid(), 'user', '허메틱픽스처A'), (gen_random_uuid(), 'user', '허메틱픽스처B');",
  );
  // 최소 catalog 시드 — 실 master에서 "아무 트림"을 읽던 테스트(딜러 마스킹 등)의 hermetic 대응.
  // 확정 할인을 채워 두어 role 분기 대조(딜러 null ↔ admin 값)도 성립한다.
  await client.exec(`
    INSERT INTO catalog.brands (name, is_domestic) VALUES ('허메틱브랜드', true);
    INSERT INTO catalog.models (brand_id, name) SELECT id, '허메틱모델' FROM catalog.brands WHERE name = '허메틱브랜드';
    INSERT INTO catalog.trims (model_id, name, price, trim_name, financial_discount_amount, partner_discount_amount, cash_discount_amount, discount_updated_at)
      SELECT id, '허메틱트림', 50000000, '허메틱트림', 1000000, 500000, 300000, now() FROM catalog.models WHERE name = '허메틱모델';
  `);

  // 스키마 구성은 프로덕션 client.ts(allSchema = schema + catalog)와 동일하게 맞춘다.
  // 드라이버 타입(PgliteDatabase ↔ PostgresJsDatabase)만 다르고 쿼리 빌더 API는 동형 —
  // 캐스트는 레포 전체에서 이 한 곳에만 둔다. 단 `executor.execute()` 반환형은 드라이버별로
  // 다르다(postgres-js=배열, PGlite={rows}) — 그 경로를 지나는 파일은 이관 전에 정규화 필요
  // (plan 문서 "마찰면" 참조).
  return drizzle(client, { schema: { ...schema, ...catalogSchema } }) as unknown as Db;
}

let hermetic: Promise<Db> | null = null;

// dual-mode 진입점. 쿼리 테스트는 `const db = await getTestDb()`로 기존 getDefaultDb()를 대체하고,
// 라우트 테스트는 여기에 더해 beforeAll(() => setTestDb(db)) / afterAll(() => setTestDb(null))로
// dbMiddleware fallback에 배선한다(실 DB 모드에선 fallback 싱글톤과 동일 인스턴스라 무해).
export function getTestDb(): Promise<Db> {
  if (process.env.DATABASE_URL) return Promise.resolve(getDefaultDb());
  hermetic ??= buildHermeticDb();
  return hermetic;
}

// 전역 teardown(test-teardown.ts) 전용 — 테스트 본문에서 부르지 말 것(싱글톤이 파일 경계를 넘어
// 공유되므로, 중간에 닫으면 뒤 파일이 죽은 커넥션을 잡는다).
export async function closeHermeticDb(): Promise<void> {
  if (!rawClient) return;
  const client = rawClient;
  rawClient = null;
  hermetic = null;
  await client.close();
}
