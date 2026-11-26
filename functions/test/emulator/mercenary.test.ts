import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp, type Firestore } from "firebase-admin/firestore";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getSchedulerState } from "../../src/earnings/service";
import type { NexonBossContent } from "../../src/nexon/client";
import { createParty, joinParty, leaveParty, startSchedule } from "../../src/party/service";
import { resolveRaidResult } from "../../src/schedule/clear";
import { confirmSchedule } from "../../src/schedule/confirm";
import { evaluateSchedule } from "../../src/schedule/evaluate";
import { addMercenary, removeMercenary, replaceWithMercenary } from "../../src/schedule/mercenary";
import { confirmReceived, markPaid, registerSettlement } from "../../src/settlement/service";

const PROJECT = "demo-boss-planner";
const kst = (iso: string) => Date.parse(`${iso}+09:00`);
// 2026-11-12(목) 10:00. 이번 주기는 11/12(목) ~ 11/18(수)
const THU = kst("2026-11-12T10:00:00");
const PERIOD = "W-20261112";
const WEEK = ["20261112", "20261113", "20261114", "20261115", "20261116", "20261117", "20261118"];

let db: Firestore;

async function addUser(uid: string) {
  await db.doc(`users/${uid}`).set({ displayName: uid, apiKeyRegistered: true, selectedCharacterIds: [`char-${uid}`] });
  await db.doc(`secrets/${uid}`).set({
    apiKey: `key-${uid}`,
    charactersFetchedAt: Timestamp.fromMillis(THU),
    characters: { [`char-${uid}`]: { ocid: `ocid-${uid}`, name: `캐릭-${uid}`, world: "스카니아", job: "비숍", level: 280 } },
  });
}

/** 토요일 20~22시만 가능 (후보 20:00, 21:00) */
const saturdayEvening = () => {
  const open = new Set(["20261114-2000", "20261114-2030", "20261114-2100", "20261114-2130"]);
  return WEEK.flatMap((d) => Array.from({ length: 48 }, (_, r) => `${d}-${String(Math.floor(r / 2)).padStart(2, "0")}${r % 2 ? "30" : "00"}`)).filter(
    (slot) => !open.has(slot),
  );
};
const RAID = kst("2026-11-14T20:00:00");

const ref = (partyId: string) => db.doc(`parties/${partyId}/schedules/${PERIOD}`);
const data = async (partyId: string) => (await ref(partyId).get()).data()!;
const submit = (partyId: string, uid: string) =>
  ref(partyId).collection("unavailable").doc(uid).set({ slots: saturdayEvening(), submitted: true, updatedAt: Timestamp.now() });
const vote = async (partyId: string, uid: string) =>
  ref(partyId).collection("votes").doc(uid).set({ agreed: [0], round: (await data(partyId)).round, updatedAt: Timestamp.now() });
const busy = async (uid: string) => (await db.collection(`users/${uid}/busy`).get()).docs.map((doc) => doc.id);
const args = (partyId: string, extra: Record<string, unknown> = {}) => ({ partyId, periodId: PERIOD, ...extra });

/** a(파티장)·b·c 3인 파티, 이번 주기 시작 */
async function party(members = ["b", "c"]) {
  const { partyId, inviteCode } = await createParty(db, "a", { name: "스우팟", bosses: [{ name: "스우", difficulty: "HARD" }], durationMinutes: 60, characterId: "char-a" }, THU);
  for (const uid of members) await joinParty(db, uid, { inviteCode, characterId: `char-${uid}` }, THU);
  await startSchedule(db, "a", { partyId }, THU);
  return partyId;
}

/** 참여자 전원이 내고 첫 후보에 동의한 뒤 확정한다 */
async function submitVoteConfirm(partyId: string, uids: string[]) {
  for (const uid of uids) await submit(partyId, uid);
  await evaluateSchedule(db, partyId, PERIOD, THU);
  for (const uid of uids) await vote(partyId, uid);
  await evaluateSchedule(db, partyId, PERIOD, THU);
  await confirmSchedule(db, "a", { partyId, periodId: PERIOD, candidateIndex: 0 }, THU);
}

beforeAll(() => {
  if (getApps().length === 0) initializeApp({ projectId: PROJECT });
  db = getFirestore();
});

beforeEach(async () => {
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, {
    method: "DELETE",
  });
  await Promise.all(["a", "b", "c", "d"].map(addUser));
});

describe("이번 주기 용병으로 대체", () => {
  it("확정 전: 대체한 사람 없이 추천·투표·확정이 되고, 그 사람에게는 일정이 잡히지 않는다", async () => {
    const partyId = await party();
    await submit(partyId, "a");
    await submit(partyId, "c");
    expect(await evaluateSchedule(db, partyId, PERIOD, THU)).toBe("waiting-inputs");

    // b가 대체하면 b 입력 없이 바로 후보가 나온다.
    await replaceWithMercenary(db, "b", args(partyId, { name: "길드원" }), THU);
    const replaced = await data(partyId);
    expect(replaced.mercenaries).toMatchObject([{ name: "길드원", replaces: "b", addedBy: "b" }]);
    expect(replaced.mercenaries[0].id).toMatch(/^merc_[0-9a-f]{8}$/);
    expect(replaced.candidates.map((c: { slotId: string }) => c.slotId)).toEqual(["20261114-2000", "20261114-2100"]);
    await expect(replaceWithMercenary(db, "b", args(partyId), THU)).rejects.toMatchObject({ details: { reason: "already-replaced" } });

    for (const uid of ["a", "c"]) await vote(partyId, uid);
    expect(await evaluateSchedule(db, partyId, PERIOD, THU)).toBe("unanimous");
    await confirmSchedule(db, "a", { partyId, periodId: PERIOD, candidateIndex: 0 }, THU);
    expect((await data(partyId)).confirmed.memberUids).toEqual(["a", "c"]);
    expect(await busy("b")).toEqual([]);
    expect(await busy("c")).toEqual(["20261114-2000", "20261114-2010", "20261114-2020", "20261114-2030", "20261114-2040", "20261114-2050"]);
  });

  it("확정 전에는 대체를 취소할 수 있고, 그러면 다시 그 사람 입력을 기다린다", async () => {
    const partyId = await party();
    await submit(partyId, "a");
    await submit(partyId, "c");
    const { mercenaryId } = await replaceWithMercenary(db, "b", args(partyId), THU);
    expect((await data(partyId)).candidates).toHaveLength(2);

    await expect(removeMercenary(db, "c", args(partyId, { mercenaryId }), THU)).rejects.toMatchObject({ details: { reason: "not-yours" } });
    await removeMercenary(db, "b", args(partyId, { mercenaryId }), THU);
    expect(await data(partyId)).toMatchObject({ mercenaries: [], candidates: [] });
  });

  it("확정 후: 확정 시간은 그대로 두고 대체한 사람의 일정만 푼다. 취소는 안 되고, 레이드가 시작되면 대체도 안 된다", async () => {
    const partyId = await party();
    await submitVoteConfirm(partyId, ["a", "b", "c"]);
    expect(await busy("b")).toEqual(["20261114-2000", "20261114-2010", "20261114-2020", "20261114-2030", "20261114-2040", "20261114-2050"]);

    const { mercenaryId } = await replaceWithMercenary(db, "b", args(partyId), THU);
    const locked = await data(partyId);
    expect(locked.state).toBe("LOCKED");
    expect(locked.confirmed.memberUids).toEqual(["a", "c"]);
    expect((locked.confirmed.start as Timestamp).toMillis()).toBe(RAID);
    expect(await busy("b")).toEqual([]);
    expect(await busy("a")).toHaveLength(6);

    await expect(removeMercenary(db, "b", args(partyId, { mercenaryId }), THU)).rejects.toMatchObject({ details: { reason: "locked" } });
    await expect(replaceWithMercenary(db, "c", args(partyId), RAID)).rejects.toMatchObject({ details: { reason: "not-editable" } });
  });

  it("참여 파티원이 한 명만 남으면 더 대체할 수 없다", async () => {
    const partyId = await party(["b"]);
    await replaceWithMercenary(db, "a", args(partyId), THU);
    await expect(replaceWithMercenary(db, "b", args(partyId), THU)).rejects.toMatchObject({ details: { reason: "last-member" } });
    await expect(replaceWithMercenary(db, "d", args(partyId), THU)).rejects.toMatchObject({ details: { reason: "not-member" } });
  });

  it("탈퇴하면 그 사람의 대체 용병도 지운다", async () => {
    const partyId = await party();
    await replaceWithMercenary(db, "b", args(partyId), THU);
    await leaveParty(db, "b", { partyId }, THU);
    expect((await data(partyId)).mercenaries).toEqual([]);
  });
});

describe("임시 용병 추가", () => {
  it("파티장만 추가·뺄 수 있고, 파티원과 합쳐 6명까지다", async () => {
    const partyId = await party();
    await expect(addMercenary(db, "b", args(partyId), THU)).rejects.toMatchObject({ details: { reason: "not-leader" } });
    for (let i = 0; i < 3; i++) await addMercenary(db, "a", args(partyId), THU);
    const mercs = (await data(partyId)).mercenaries as { id: string; name: string; replaces: null }[];
    expect(mercs.map((m) => [m.name, m.replaces])).toEqual([
      ["용병 1", null],
      ["용병 2", null],
      ["용병 3", null],
    ]);
    await expect(addMercenary(db, "a", args(partyId), THU)).rejects.toMatchObject({ details: { reason: "full" } });
    // 가입도 막힌다 (3명 + 용병 3명 = 6명)
    const { inviteCode } = (await db.doc(`parties/${partyId}`).get()).data() as { inviteCode: string };
    await expect(joinParty(db, "d", { inviteCode, characterId: "char-d" }, THU)).rejects.toMatchObject({ details: { reason: "full" } });

    await expect(removeMercenary(db, "b", args(partyId, { mercenaryId: mercs[1].id }), THU)).rejects.toMatchObject({
      details: { reason: "not-leader" },
    });
    await removeMercenary(db, "a", args(partyId, { mercenaryId: mercs[1].id }), THU);
    await addMercenary(db, "a", args(partyId, { name: "  " }), THU);
    expect(((await data(partyId)).mercenaries as { name: string }[]).map((m) => m.name)).toEqual(["용병 1", "용병 3", "용병 2"]);
  });

  it("결정석 인원수에 임시 용병이 더해진다", async () => {
    const partyId = await party(["b"]);
    await addMercenary(db, "a", args(partyId), THU);
    const contents: NexonBossContent[] = [
      { content_name: "스우", difficulty: "hard", cycle: "bossWeekly", registration_flag: "true", complete_flag: "false" },
    ];
    const makeClient = () => ({ getBossContents: vi.fn(async () => contents) });
    const result = await getSchedulerState(db, "a", {}, THU, makeClient, { "스우|HARD": 300_000_000 });
    expect(result.characters["char-a"].bosses).toMatchObject([{ name: "스우", partySize: 3, share: 100_000_000 }]);
  });
});

describe("용병 정산", () => {
  it("용병도 1인분을 받고, 판매자가 직접 지급함을 누르면 그 몫은 끝난다", async () => {
    const partyId = await party();
    await replaceWithMercenary(db, "b", args(partyId), THU);
    await addMercenary(db, "a", args(partyId), THU);
    await submitVoteConfirm(partyId, ["a", "c"]);
    await resolveRaidResult(db, ref(partyId), true, "MANUAL", RAID + 60 * 60 * 1000);
    expect((await data(partyId)).state).toBe("SETTLED");

    // 대체한 b는 참여자가 아니라 등록할 수 없다.
    const register = (uid: string) => registerSettlement(db, uid, args(partyId, { saleAmount: 30_000_000, feePercent: 5 }));
    await expect(register("b")).rejects.toMatchObject({ details: { reason: "not-member" } });
    expect(await register("a")).toEqual({ recipients: 3 });

    const settled = await data(partyId);
    const mercIds = (settled.mercenaries as { id: string }[]).map((m) => m.id);
    expect(Object.keys(settled.settlement.amounts).sort()).toEqual(["c", ...mercIds].sort());
    expect(new Set(Object.values(settled.settlement.amounts)).size).toBe(1);

    // 용병 몫: 직접 지급함 → 바로 수령 확인
    for (const id of mercIds) await markPaid(db, "a", args(partyId, { recipientUid: id }));
    const mercDoc = (await ref(partyId).collection("settlement").doc(mercIds[0]).get()).data();
    expect(mercDoc).toMatchObject({ status: "RECEIVED" });
    expect((await data(partyId)).settlement.completed).toBe(false);

    await markPaid(db, "a", args(partyId, { recipientUid: "c" }));
    expect(await confirmReceived(db, "c", args(partyId))).toEqual({ completed: true });
  });

  it("용병 몫을 마지막에 직접 지급하면 그때 정산이 끝난다", async () => {
    const partyId = await party(["b"]);
    await addMercenary(db, "a", args(partyId), THU);
    await submitVoteConfirm(partyId, ["a", "b"]);
    await resolveRaidResult(db, ref(partyId), true, "MANUAL", RAID + 60 * 60 * 1000);
    await registerSettlement(db, "a", args(partyId, { saleAmount: 30_000_000, feePercent: 5 }));
    await markPaid(db, "a", args(partyId, { recipientUid: "b" }));
    await confirmReceived(db, "b", args(partyId));
    const mercId = ((await data(partyId)).mercenaries as { id: string }[])[0].id;
    await markPaid(db, "a", args(partyId, { recipientUid: mercId }));
    expect((await data(partyId)).settlement).toMatchObject({ completed: true });
  });
});
