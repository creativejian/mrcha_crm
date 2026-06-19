import { initialCustomers } from "../client/src/data/customers";
import { getDefaultDb } from "../src/db/client";
import { customers, customerTasks } from "../src/db/schema";

// "2026-05-14 12:56"(절대) | "오늘 13:04" | "어제 19:10" | "5/10 16:30" 파싱.
// 기준일: 목업 최신 절대 시각(2026-05-14)을 "오늘"로 본다(결정적, Date.now 미사용).
const TODAY = "2026-05-14";
const YESTERDAY = "2026-05-13";
const YEAR = "2026";

// timestamptz 컬럼은 drizzle 기본 mode 'date' → Date 객체로 넣는다.
function toTimestamp(s: string): Date | null {
  if (!s) return null;
  const m = s.trim();
  // 절대: "2026-05-14 12:56"
  if (/^\d{4}-\d{2}-\d{2}/.test(m)) return new Date(`${m.replace(" ", "T")}:00+09:00`);
  // "오늘 HH:mm" / "어제 HH:mm"
  const rel = m.match(/^(오늘|어제)\s+(\d{1,2}):(\d{2})$/);
  if (rel) {
    const day = rel[1] === "오늘" ? TODAY : YESTERDAY;
    return new Date(`${day}T${rel[2].padStart(2, "0")}:${rel[3]}:00+09:00`);
  }
  // "M/D HH:mm"
  const md = m.match(/^(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})$/);
  if (md) {
    return new Date(`${YEAR}-${md[1].padStart(2, "0")}-${md[2].padStart(2, "0")}T${md[3].padStart(2, "0")}:${md[4]}:00+09:00`);
  }
  return null;
}

async function main() {
  const db = getDefaultDb();
  let inserted = 0;
  for (const c of initialCustomers) {
    const [row] = await db
      .insert(customers)
      .values({
        customerCode: c.customerId,
        name: c.name,
        phone: c.phone,
        customerType: c.customerType,
        customerTypeDetail: c.customerTypeDetail,
        team: c.team,
        source: c.source,
        statusGroup: c.statusGroup,
        status: c.status,
        priority: c.priority,
        aiSummary: c.aiSummary,
        needModel: c.vehicle,
        needMethod: c.method,
        receivedAt: toTimestamp(c.receivedAt),
        assignedAt: toTimestamp(c.assignedAt),
        lastActivityAt: toTimestamp(c.date),
      })
      .onConflictDoNothing({ target: customers.customerCode })
      .returning({ id: customers.id });
    if (!row) continue; // 이미 존재(멱등)
    inserted++;
    if (c.nextAction) {
      await db.insert(customerTasks).values({ customerId: row.id, body: c.nextAction, done: false });
    }
  }
  console.log(`seeded ${inserted} customers (skipped ${initialCustomers.length - inserted} existing)`);
  process.exit(0);
}

void main();
