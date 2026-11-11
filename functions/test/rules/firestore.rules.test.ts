import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { collection, doc, getDoc, getDocs, query, serverTimestamp, setDoc, updateDoc, where } from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

let env: RulesTestEnvironment;

const LEADER = "leader";
const MEMBER = "member";
const OUTSIDER = "outsider";
const SCHEDULE = "parties/p1/schedules/2026-W46";

const db = (uid: string) => env.authenticatedContext(uid).firestore();

async function seed(state: string) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const admin = ctx.firestore();
    await setDoc(doc(admin, "parties/p1"), { leaderUid: LEADER, memberUids: [LEADER, MEMBER], inviteCode: "ABC123" });
    await setDoc(doc(admin, SCHEDULE), { state });
    await setDoc(doc(admin, `${SCHEDULE}/votes/${LEADER}`), { agreed: [0], round: 1 });
    await setDoc(doc(admin, `secrets/${MEMBER}`), { apiKey: "k", characters: {} });
    await setDoc(doc(admin, `users/${MEMBER}`), { displayName: "멤버", apiKeyRegistered: true });
    await setDoc(doc(admin, `users/${MEMBER}/busy/20261112-2030`), { partyId: "p1" });
  });
}

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-boss-planner",
    firestore: { rules: readFileSync(resolve(__dirname, "../../../firestore.rules"), "utf8") },
  });
});

afterAll(async () => {
  await env.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  await seed("OPEN");
});

describe("secrets", () => {
  it("본인도 읽거나 쓸 수 없다", async () => {
    await assertFails(getDoc(doc(db(MEMBER), `secrets/${MEMBER}`)));
    await assertFails(setDoc(doc(db(MEMBER), `secrets/${MEMBER}`), { apiKey: "x" }));
  });
});

describe("users", () => {
  it("자기 프로필은 허용된 필드만 고칠 수 있다", async () => {
    await assertSucceeds(updateDoc(doc(db(MEMBER), `users/${MEMBER}`), { selectedCharacterIds: ["a"] }));
    await assertFails(updateDoc(doc(db(MEMBER), `users/${MEMBER}`), { apiKeyRegistered: false }));
    await assertFails(updateDoc(doc(db(LEADER), `users/${MEMBER}`), { displayName: "해킹" }));
  });

  it("busy는 본인만 읽고 아무도 쓸 수 없다", async () => {
    await assertSucceeds(getDoc(doc(db(MEMBER), `users/${MEMBER}/busy/20261112-2030`)));
    await assertFails(getDoc(doc(db(LEADER), `users/${MEMBER}/busy/20261112-2030`)));
    await assertFails(setDoc(doc(db(MEMBER), `users/${MEMBER}/busy/20261113-2030`), { partyId: "p1" }));
  });

  it("FCM 토큰은 본인만 접근한다", async () => {
    await assertSucceeds(setDoc(doc(db(MEMBER), `users/${MEMBER}/devices/d1`), { token: "t" }));
    await assertFails(getDoc(doc(db(LEADER), `users/${MEMBER}/devices/d1`)));
  });
});

describe("parties", () => {
  it("파티원만 읽을 수 있고, 파티장도 직접 쓸 수 없다", async () => {
    await assertSucceeds(getDoc(doc(db(MEMBER), "parties/p1")));
    await assertFails(getDoc(doc(db(OUTSIDER), "parties/p1")));
    await assertFails(updateDoc(doc(db(MEMBER), "parties/p1"), { leaderUid: MEMBER }));
    await assertFails(updateDoc(doc(db(LEADER), "parties/p1"), { memberUids: [LEADER] }));
  });

  it("초대 코드 문서는 읽을 수 없다", async () => {
    await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), "inviteCodes/ABC123"), { partyId: "p1" }));
    await assertFails(getDoc(doc(db(LEADER), "inviteCodes/ABC123")));
    await assertFails(getDoc(doc(db(OUTSIDER), "inviteCodes/ABC123")));
  });

  it("내가 속한 파티만 목록으로 조회할 수 있다", async () => {
    const mine = (uid: string) => query(collection(db(uid), "parties"), where("memberUids", "array-contains", uid));
    await assertSucceeds(getDocs(mine(MEMBER)));
    await assertFails(getDocs(collection(db(MEMBER), "parties")));
  });

  it("일정 상태는 파티장도 직접 바꿀 수 없다", async () => {
    await assertSucceeds(getDoc(doc(db(MEMBER), SCHEDULE)));
    await assertFails(getDoc(doc(db(OUTSIDER), SCHEDULE)));
    await assertFails(updateDoc(doc(db(LEADER), SCHEDULE), { state: "LOCKED" }));
  });
});

describe("unavailable", () => {
  const mine = { slots: ["20261112-2030"], submitted: true, updatedAt: serverTimestamp() };

  it("OPEN일 때 자기 불가 시간만 제출할 수 있다", async () => {
    await assertSucceeds(setDoc(doc(db(MEMBER), `${SCHEDULE}/unavailable/${MEMBER}`), mine));
    await assertFails(setDoc(doc(db(MEMBER), `${SCHEDULE}/unavailable/${LEADER}`), mine));
    await assertFails(setDoc(doc(db(OUTSIDER), `${SCHEDULE}/unavailable/${OUTSIDER}`), mine));
  });

  it("LOCKED가 되면 고칠 수 없다", async () => {
    await seed("LOCKED");
    await assertFails(setDoc(doc(db(MEMBER), `${SCHEDULE}/unavailable/${MEMBER}`), mine));
  });
});

describe("votes", () => {
  const vote = { agreed: [0, 2], round: 1, updatedAt: serverTimestamp() };

  it("자기 투표는 쓸 수 있고 남의 투표는 바꿀 수 없다", async () => {
    await assertSucceeds(setDoc(doc(db(MEMBER), `${SCHEDULE}/votes/${MEMBER}`), vote));
    await assertFails(setDoc(doc(db(MEMBER), `${SCHEDULE}/votes/${LEADER}`), vote));
    await assertFails(updateDoc(doc(db(MEMBER), `${SCHEDULE}/votes/${LEADER}`), { agreed: [] }));
    await assertSucceeds(getDoc(doc(db(MEMBER), `${SCHEDULE}/votes/${LEADER}`)));
  });
});

describe("clears", () => {
  const clear = (result: string) => ({ result, recordedAt: serverTimestamp() });

  it("확정된 뒤에만 클리어·미클리어를 기록할 수 있다", async () => {
    await assertFails(setDoc(doc(db(MEMBER), `${SCHEDULE}/clears/${MEMBER}`), clear("CLEARED")));
    await seed("VERIFYING");
    await assertSucceeds(setDoc(doc(db(MEMBER), `${SCHEDULE}/clears/${MEMBER}`), clear("NOT_CLEARED")));
    await assertFails(setDoc(doc(db(MEMBER), `${SCHEDULE}/clears/${MEMBER}`), clear("MAYBE")));
    await assertFails(setDoc(doc(db(MEMBER), `${SCHEDULE}/clears/${LEADER}`), clear("CLEARED")));
  });
});

describe("settlement, messages", () => {
  it("정산 상태는 직접 쓸 수 없다", async () => {
    await assertFails(setDoc(doc(db(MEMBER), `${SCHEDULE}/settlement/${MEMBER}`), { status: "RECEIVED" }));
  });

  it("채팅은 자기 이름으로만 보낼 수 있다", async () => {
    const message = (senderUid: string) => ({ senderUid, text: "계좌로 주세요", createdAt: serverTimestamp() });
    await assertSucceeds(setDoc(doc(db(MEMBER), `${SCHEDULE}/messages/m1`), message(MEMBER)));
    await assertFails(setDoc(doc(db(MEMBER), `${SCHEDULE}/messages/m2`), message(LEADER)));
    await assertFails(setDoc(doc(db(OUTSIDER), `${SCHEDULE}/messages/m3`), message(OUTSIDER)));
    await assertFails(updateDoc(doc(db(MEMBER), `${SCHEDULE}/messages/m1`), { text: "수정" }));
  });
});
