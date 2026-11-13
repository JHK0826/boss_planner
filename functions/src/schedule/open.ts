import type { Firestore } from "firebase-admin/firestore";
import { currentPeriod, type Cycle } from "../domain/time";
import { durationMinutesOf, newScheduleData } from "./model";

const ALREADY_EXISTS = 6;

/**
 * 주기 시작 시 해당 주기(주간/월간) 파티의 일정 문서를 만든다.
 * 이미 있으면 건드리지 않으므로 다시 실행해도 안전하다.
 */
export async function openSchedules(db: Firestore, cycle: Cycle, nowMs: number): Promise<number> {
  const period = currentPeriod(cycle, nowMs);
  const parties = await db.collection("parties").where("cycle", "==", cycle).get();
  let created = 0;
  for (const party of parties.docs) {
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
