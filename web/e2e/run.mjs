// 웹앱 E2E 테스트: Firebase 에뮬레이터(로그인·Firestore·Functions·Storage)에 웹앱을 붙여 브라우저로 실제 흐름을 돌린다.
//   npm --prefix web run e2e  (functions 빌드 → 에뮬레이터 시작 → 이 스크립트 실행)
// NEXON API를 부르는 단계(API Key 등록)는 관리자 SDK로 데이터를 넣어 건너뛴다.
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));
const webDir = fileURLToPath(new URL("..", import.meta.url));
const shots = fileURLToPath(new URL("./screenshots/", import.meta.url));
mkdirSync(shots, { recursive: true });

const requireWeb = createRequire(new URL("../package.json", import.meta.url));
const requireFunctions = createRequire(`${root}functions/package.json`);
const { chromium } = requireWeb("playwright");
const { createServer } = await import(requireWeb.resolve("vite"));
const { initializeApp } = requireFunctions("firebase-admin/app");
const { getAuth } = requireFunctions("firebase-admin/auth");
const { getFirestore, Timestamp } = requireFunctions("firebase-admin/firestore");

const PROJECT = "demo-boss-planner";
// 캐릭터 ID는 서버 규칙대로 ocid 해시(16진수 24자리)여야 한다.
const CHAR_A = "a".repeat(24);
const CHAR_B = "b".repeat(24);
initializeApp({ projectId: PROJECT });
const adminAuth = getAuth();
const db = getFirestore();

// ---------- 준비 ----------

/** NEXON API Key 등록과 캐릭터 정보 캐시를 대신 넣는다. */
async function seedApiKey(uid, characterId, name, level) {
  const now = Timestamp.now();
  await db.doc(`secrets/${uid}`).set({
    apiKey: "test-key",
    charactersFetchedAt: now,
    characters: { [characterId]: { ocid: `ocid-${characterId}`, name, world: "스카니아", job: "비숍", level } },
  });
  await db.doc(`users/${uid}/characters/${characterId}`).set({ name, world: "스카니아", job: "비숍", level, imageUrl: null, guild: null, fetchedAt: now });
  await db.doc(`users/${uid}`).set({ apiKeyRegistered: true }, { merge: true });
}

/** callable을 그 사용자 이름으로 부른다 (아직 웹 화면이 없는 동작용). */
async function callAs(email, password, name, data) {
  const signIn = await fetch("http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  }).then((r) => r.json());
  const response = await fetch(`http://127.0.0.1:5001/${PROJECT}/asia-northeast3/${name}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${signIn.idToken}` },
    body: JSON.stringify({ data }),
  }).then((r) => r.json());
  if (response.error) throw new Error(`${name}: ${response.error.message}`);
  return response.result;
}

process.env.VITE_USE_EMULATORS = "true";
const server = await createServer({ root: webDir, logLevel: "error", server: { port: 5173, strictPort: true } });
await server.listen();
const browser = await chromium.launch();
const errors = [];

async function newPhone() {
  // 아이폰 크기 화면. 스크린샷은 사람이 보는 용도라 2배율.
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: "ko-KR", timezoneId: "Asia/Seoul" });
  const page = await context.newPage();
  pages.push(page);
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && !m.text().includes("Failed to load resource") && errors.push(`console: ${m.text()}`));
  return page;
}
const shot = (page, name) => page.screenshot({ path: `${shots}${name}.png`, fullPage: true });
const pages = [];
const step = (label) => console.log(`- ${label}`);

try {
  // ---------- 파티장 A: 화면으로 가입 → (API Key 대신 넣기) → 캐릭터 선택 ----------
  const a = await newPhone();
  await a.goto("http://127.0.0.1:5173/");
  await a.getByRole("button", { name: "처음이신가요? 회원가입" }).click();
  await a.getByLabel("닉네임 (파티원에게 보이는 이름)").fill("파티장");
  await a.getByLabel("이메일").fill("a@test.com");
  await a.getByLabel("비밀번호 (6자 이상)").fill("password1");
  await a.getByRole("button", { name: "가입하기" }).click();
  await a.getByRole("heading", { name: "NEXON Open API Key 등록" }).waitFor();
  step("가입하면 API Key 등록 화면이 나온다");
  await shot(a, "01-api-key");

  const uidA = (await adminAuth.getUserByEmail("a@test.com")).uid;
  await seedApiKey(uidA, CHAR_A, "루시드짱", 285);
  await a.getByRole("heading", { name: "보스에 참여할 캐릭터 선택" }).waitFor();
  await a.getByText("루시드짱").click();
  await a.getByRole("button", { name: "선택 완료 (1)" }).click();
  await a.getByRole("heading", { name: "파티" }).waitFor();
  await a.getByText("아직 가입한 파티가 없습니다.").waitFor();
  step("캐릭터를 고르면 파티 탭으로 들어간다");

  // ---------- 파티 만들기 ----------
  await a.getByRole("button", { name: "파티 만들기" }).click();
  await a.getByRole("heading", { name: "고정 파티 만들기" }).waitFor();
  await a.getByLabel("파티 이름").fill("스우팟");
  await a.getByRole("button", { name: "스우", exact: true }).click();
  await a.getByRole("button", { name: "데미안", exact: true }).click();
  await a.getByText("40분").waitFor(); // 보스 2개 × 20분
  await shot(a, "02-create-party");
  await a.getByRole("button", { name: "파티 만들기" }).click();
  await a.getByText("파티를 만들었습니다").waitFor();
  const partyDoc = (await db.collection("parties").where("memberUids", "array-contains", uidA).get()).docs[0];
  assert.deepEqual(partyDoc.get("bosses"), [{ name: "스우", difficulty: "EXTREME" }, { name: "데미안", difficulty: "HARD" }]);
  assert.equal(partyDoc.get("durationMinutes"), 40);
  step("보스 두 개를 묶은 파티를 만든다 (난이도 기본값은 가장 높은 것)");

  await a.getByRole("button", { name: "← 파티 목록" }).click();
  await a.getByText("일정 시작 전").waitFor();
  step("목록에 '일정 시작 전'이 보인다");

  // ---------- 파티원 B: 로그인 → 코드로 가입 ----------
  await adminAuth.createUser({ email: "b@test.com", password: "password1" });
  const uidB = (await adminAuth.getUserByEmail("b@test.com")).uid;
  await db.doc(`users/${uidB}`).set({ displayName: "비숍", selectedCharacterIds: [CHAR_B] });
  await seedApiKey(uidB, CHAR_B, "비숍짱", 270);

  const b = await newPhone();
  await b.goto("http://127.0.0.1:5173/");
  await b.getByLabel("이메일").fill("b@test.com");
  await b.getByLabel("비밀번호 (6자 이상)").fill("password1");
  await b.getByRole("button", { name: "로그인" }).click();
  await b.getByRole("heading", { name: "파티" }).waitFor();
  await b.getByRole("button", { name: "코드로 가입" }).click();
  // 잘못된 코드: 서버가 보낸 한국어 문구가 그대로 보여야 한다.
  await b.getByLabel("초대 코드").fill("ZZZZZZ");
  await b.getByRole("button", { name: "가입하기" }).click();
  await b.getByText("초대 코드에 해당하는 파티가 없습니다.", { exact: true }).waitFor();
  await b.getByLabel("초대 코드").fill(partyDoc.get("inviteCode").toLowerCase());
  await b.getByRole("button", { name: "가입하기" }).click();
  await b.getByText("파티에 가입했습니다").waitFor();
  step("초대 코드(소문자로 입력해도 됨)로 가입한다");

  // ---------- 일정 시작 → 할 일 표시 ----------
  await callAs("a@test.com", "password1", "startSchedule", { partyId: partyDoc.id });
  await a.getByText("할 일 · 불가 시간 입력").waitFor();
  await a.getByText("할 일이 있는 파티 1개").waitFor();
  assert.equal(await a.locator(".tabs .count").textContent(), "1");
  await shot(a, "03-parties-todo");
  step("일정이 열리면 할 일(불가 시간 입력)과 하단 숫자가 보인다");

  await b.getByRole("button", { name: "← 파티 목록" }).click();
  await b.getByText("내 캐릭터 비숍짱 (Lv.270)").waitFor();
  step("파티원 목록 카드에 내 캐릭터가 보인다");

  // ---------- 시간표·고정 불가 시간 ----------
  await a.getByRole("link", { name: "시간표" }).click();
  await a.getByRole("button", { name: "고정 불가 시간 설정" }).click();
  await a.getByRole("button", { name: "불가로 채우기" }).click(); // 기본: 평일 00:00~18:00
  await a.getByRole("button", { name: "저장 (불가 180칸)" }).click();
  await a.getByText("고정 불가 시간을 저장했습니다").waitFor();
  assert.equal((await db.doc(`users/${uidA}/private/routine`).get()).get("slots").length, 180);
  await shot(a, "04-timetable");
  step("고정 불가 시간을 한 번에 채워 저장한다 (평일 18시간 × 5일 = 180칸)");

  // ---------- 다크 모드 ----------
  await a.getByRole("link", { name: "설정" }).click();
  await a.getByText("휴대폰 설정을 따르는 중").waitFor();
  await a.locator("label:has-text('다크 모드') input").click();
  assert.equal(await a.evaluate(() => document.documentElement.dataset.theme), "dark");
  await a.reload();
  await a.getByRole("heading", { name: "설정" }).waitFor();
  assert.equal(await a.evaluate(() => document.documentElement.dataset.theme), "dark");
  await a.getByRole("link", { name: "파티" }).click();
  await a.getByText("할 일 · 불가 시간 입력").waitFor();
  await shot(a, "05-dark");
  step("다크 모드를 켜면 바로 바뀌고 새로고침해도 유지된다");

  assert.deepEqual(errors, [], `브라우저 오류:\n${errors.join("\n")}`);
  console.log("E2E 통과");
} catch (error) {
  // 실패한 순간의 화면과 글자를 남긴다.
  for (const [i, page] of pages.entries()) {
    await shot(page, `failure-${i}`).catch(() => {});
    console.log(`--- page ${i} text:\n${(await page.locator("body").innerText().catch(() => "")).slice(0, 1500)}`);
  }
  console.log(errors.join("\n"));
  throw error;
} finally {
  await browser.close();
  await server.close();
}
