import type { DocumentData, Firestore, Timestamp } from "firebase-admin/firestore";
import { currentPeriod, type Cycle } from "../domain/time";
import { carryOverQuietly } from "./carryOver";
import { evaluateSchedule } from "./evaluate";
import { durationMinutesOf, newScheduleData } from "./model";

const ALREADY_EXISTS = 6;

/** 이 상태가 되면 이번 주기 레이드가 끝난 것으로 보고 다음 주기를 미리 연다. */
const FINISHED_STATES = new Set(["SETTLED", "SKIPPED", "EXPIRED"]);

/**
 * 주기 시작 시 해당 주기(주간/월간) 파티의 일정 문서를 만든다.
 * 이미 있으면 새로 만들지 않으므로 다시 실행해도 안전하다.
 * 미리 열어 둔 문서(preOpened)는 이제 이번 주기가 되었으므로 표시를 끈다(시작 알림이 이것으로 나간다).
 * 투표 없이 자동 지정하는 파티면, 전원이 미리 냈을 때 바로 점수 1위 시간으로 확정한다.
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
    const scheduleRef = party.ref.collection("schedules").doc(period.id);
    try {
      await scheduleRef.create(newScheduleData(period, durationMinutesOf(party.data())));
      created++;
      // 파티원이 같은 주기의 다른 파티에 이미 낸 불가 시간을 넣는다.
      await carryOverQuietly(db, party.id, period.id, (party.get("memberUids") as string[] | undefined) ?? []);
    } catch (error) {
      if ((error as { code?: number }).code !== ALREADY_EXISTS) throw error;
      const existing = await scheduleRef.get();
      if (existing.get("preOpened") === true) {
        await scheduleRef.update({ preOpened: false });
        // 한 파티가 실패해도 나머지 파티의 새 주기는 계속 연다.
        if (party.get("autoAssign") === true) {
          await evaluateSchedule(db, party.id, period.id, nowMs).catch((error) =>
            console.error("auto assign at period start failed", party.id, (error as Error).message),
          );
        }
      }
    }
    if (party.get("scheduleStarted") !== true) await party.ref.update({ scheduleStarted: true });
  }
  return created;
}

/**
 * 주간 파티의 이번 주기 레이드가 끝나면(클리어·미사용·종료) 다음 주기 일정을 미리 연다.
 * 파티원은 다음 주 불가 시간을 미리 내고, 전원이 내면 투표까지 미리 한다. 확정은 주기가 시작한 뒤에만 된다.
 * 다음 주기가 이미 시작했으면(목요일 00:00 정리에서 끝난 경우) 목요일 생성 작업이 맡으므로 만들지 않는다.
 *
 * @returns 새로 만든 다음 주기 ID. 만들지 않았으면 null
 */
export async function openNextPeriod(
  db: Firestore,
  partyId: string,
  schedule: DocumentData,
  nowMs: number,
): Promise<string | null> {
  if (schedule.cycle !== "WEEKLY" || !FINISHED_STATES.has(schedule.state as string)) return null;
  const nextStartMs = (schedule.periodEnd as Timestamp).toMillis();
  if (nextStartMs <= nowMs) return null;

  const partyRef = db.doc(`parties/${partyId}`);
  const party = (await partyRef.get()).data();
  if (!party || party.cycle !== "WEEKLY") return null;
  const next = currentPeriod("WEEKLY", nextStartMs);
  try {
    await partyRef
      .collection("schedules")
      .doc(next.id)
      .create({ ...newScheduleData(next, durationMinutesOf(party)), preOpened: true });
    // 다른 파티에 다음 주 불가 시간을 미리 낸 파티원은 다시 내지 않아도 되게 넣어 둔다.
    await carryOverQuietly(db, partyId, next.id, (party.memberUids as string[] | undefined) ?? []);
    return next.id;
  } catch (error) {
    if ((error as { code?: number }).code === ALREADY_EXISTS) return null;
    throw error;
  }
}
