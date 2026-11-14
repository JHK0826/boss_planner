import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, setDoc } from "firebase/firestore";
import { getBytes, ref, uploadBytes } from "firebase/storage";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

let env: RulesTestEnvironment;

const MEMBER = "member";
const OTHER_MEMBER = "leader";
const OUTSIDER = "outsider";
// 테스트마다 다른 폴더를 써서 앞 테스트가 올린 파일의 영향을 받지 않게 한다.
let run = 0;
const path = (uid: string, file = "a.jpg") => `parties/p1/schedules/W-${run}/chat/${uid}/${file}`;
const storage = (uid: string) => env.authenticatedContext(uid).storage();
const image = { contentType: "image/jpeg" };
const bytes = (size = 16) => new Uint8Array(size);

beforeAll(async () => {
  const root = resolve(__dirname, "../../..");
  env = await initializeTestEnvironment({
    projectId: "demo-boss-planner",
    firestore: { rules: readFileSync(resolve(root, "firestore.rules"), "utf8") },
    storage: { rules: readFileSync(resolve(root, "storage.rules"), "utf8") },
  });
});

afterAll(async () => {
  await env.cleanup();
});

beforeEach(async () => {
  run++;
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "parties/p1"), { leaderUid: OTHER_MEMBER, memberUids: [OTHER_MEMBER, MEMBER] });
  });
});

describe("정산 채팅 이미지", () => {
  it("파티원은 자기 폴더에 이미지를 올리고, 다른 파티원이 볼 수 있다", async () => {
    await assertSucceeds(uploadBytes(ref(storage(MEMBER), path(MEMBER)), bytes(), image));
    await assertSucceeds(getBytes(ref(storage(OTHER_MEMBER), path(MEMBER))));
  });

  it("파티원이 아니면 올리거나 볼 수 없다", async () => {
    await assertSucceeds(uploadBytes(ref(storage(MEMBER), path(MEMBER)), bytes(), image));
    await assertFails(getBytes(ref(storage(OUTSIDER), path(MEMBER))));
    await assertFails(uploadBytes(ref(storage(OUTSIDER), path(OUTSIDER)), bytes(), image));
  });

  it("남의 폴더, 이미지가 아닌 파일, 5MB 이상은 올릴 수 없다", async () => {
    await assertFails(uploadBytes(ref(storage(MEMBER), path(OTHER_MEMBER)), bytes(), image));
    await assertFails(uploadBytes(ref(storage(MEMBER), path(MEMBER, "a.txt")), bytes(), { contentType: "text/plain" }));
    await assertFails(uploadBytes(ref(storage(MEMBER), path(MEMBER, "big.jpg")), bytes(5 * 1024 * 1024), image));
  });

  it("올린 이미지는 덮어쓸 수 없고, 정해진 경로 밖에는 올릴 수 없다", async () => {
    await assertSucceeds(uploadBytes(ref(storage(MEMBER), path(MEMBER)), bytes(), image));
    await assertFails(uploadBytes(ref(storage(MEMBER), path(MEMBER)), bytes(8), image));
    await assertFails(uploadBytes(ref(storage(MEMBER), `parties/p1/other/${MEMBER}.jpg`), bytes(), image));
  });
});
