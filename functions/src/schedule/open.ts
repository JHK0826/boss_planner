import type { Firestore, Timestamp } from "firebase-admin/firestore";
import { currentPeriod, type Cycle } from "../domain/time";
import { durationMinutesOf, newScheduleData } from "./model";

const ALREADY_EXISTS = 6;

/**
 * 주기 시작 시 해당 주기(주간/월간) 파티의 일정 문서를 만든다.
 * 이미 있으면 건드리지 않으므로 다시 실행해도 안전하다.
 *
 * 이번 주기에 만들어졌고 아직 시작하지 않은 파티는 건너뛴다. 만든 주기에는 파티장이 직접 시작해야 한다.
 * (예약 작업이 늦게 돌아 주기 시작 직후에 만든 파티를 만나는 경우를 막는다.)
 */
export async function openSchedules(db: Firestore, cycle: Cycle, nowMs: number): Promise<number> {
  const period = currentPeriod(cycle, nowMs);
  const parties = await db.collection("parties").where("cycle", "==", cycle).get();
  let created = 0;
  for (const party of parties.docs) {
    const createdAt = party.get("createdAt") as Timestamp | undefined;
    if (party.get("scheduleStarted") !== true && createdAt && createdAt.toMillis() >= period.startMs) continue;
    try {
      await party.ref
        .collection("schedules")
        .doc(period.id)
        .create(newScheduleData(period, durationMinutesOf(party.data())));
      created++;
    } catch (error) {
      if ((error as { code?: number }).code !== ALREADY_EXISTS) throw error;
    }
    if (party.get("scheduleStarted") !== true) await party.ref.update({ scheduleStarted: true });
  }
  return created;
}
