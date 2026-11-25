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
/** 파티 화면 하단 탭 */
const tab = (page, name) => page.getByRole("navigation", { name: "파티 메뉴" }).getByRole("link", { name }).click();
/** 파티 화면 하단 탭의 할 일 점 */
const dot = (page, name) => page.getByRole("navigation", { name: "파티 메뉴" }).getByRole("link", { name }).locator(".dot");

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

  // ---------- 파티 화면: 하단 탭 4개 (파티 / 투표 / 정산 / 설정) ----------
  await a.getByText("스우팟").click();
  // 할 일이 없으면 파티 탭부터 연다.
  await a.waitForURL(/\/parties\/[^/]+\/info$/);
  await a.getByText("파티원 2명").waitFor();
  await a.getByText(partyDoc.get("inviteCode")).waitFor();
  await a.getByRole("button", { name: "비숍 시간표 보기" }).click();
  await a.getByRole("dialog", { name: "비숍님의 불가 시간" }).getByText("이번 주기 일정이 아직 시작되지 않아", { exact: false }).waitFor();
  await a.getByRole("button", { name: "닫기" }).click();
  await shot(a, "03-party-info");
  step("파티 탭: 초대 코드와 파티원, 파티원마다 '시간표 보기' 버튼");

  // 설정 탭: 파티장은 추천 설정을 바꾸고 위임할 수 있다. 첫 일정 전이라 위임은 언제든 된다.
  await tab(a, "설정");
  await a.getByRole("button", { name: "6시간" }).click();
  await a.getByRole("button", { name: "저장" }).click();
  await a.getByText("추천 설정을 저장했습니다").waitFor();
  assert.equal((await partyDoc.ref.get()).get("minLeadMinutes"), 360);
  await a.getByLabel("파티장을 넘길 파티원").selectOption({ label: "비숍 (비숍짱)" });
  await a.getByRole("button", { name: "위임" }).click();
  await a.getByRole("dialog", { name: "파티장 위임" }).getByRole("button", { name: "위임" }).click();
  await a.getByText("비숍님에게 파티장을 넘겼습니다").waitFor();
  await a.getByText("추천 설정은 파티장만 바꿀 수 있습니다.").waitFor();
  assert.equal((await partyDoc.ref.get()).get("leaderUid"), uidB);
  await tab(b, "설정");
  await b.getByLabel("파티장을 넘길 파티원").selectOption({ label: "파티장 (루시드짱)" });
  await b.getByRole("button", { name: "위임" }).click();
  await b.getByRole("dialog", { name: "파티장 위임" }).getByRole("button", { name: "위임" }).click();
  await b.getByText("파티장님에게 파티장을 넘겼습니다").waitFor();
  await b.getByText("추천 설정은 파티장만 바꿀 수 있습니다.").waitFor();
  await b.getByRole("button", { name: "파티 탈퇴" }).click();
  await b.getByRole("dialog", { name: "파티 탈퇴" }).getByRole("button", { name: "취소" }).click();
  assert.equal((await partyDoc.ref.get()).get("leaderUid"), uidA);
  await shot(b, "04-party-settings");
  step("설정 탭: 파티장은 추천 설정 저장·위임, 파티원은 읽기 전용, 탈퇴는 확인 창을 거친다");

  // 투표 탭: 파티장이 일정을 연다.
  await tab(a, "투표");
  await a.getByRole("button", { name: "이번 주기 지금 시작" }).click();
  await a.getByRole("dialog", { name: "이번 주기 지금 시작" }).getByRole("button", { name: "시작" }).click();
  await a.getByText("이번 주기 일정을 시작했습니다").waitFor();
  await a.getByText("불가 시간 제출 0/2명", { exact: false }).waitFor();
  await dot(a, "투표").waitFor();
  step("투표 탭에서 '이번 주기 지금 시작'으로 일정을 열면 투표 탭에 할 일 점이 붙는다");

  // 실행 시각에 따라 이번 주기가 거의 끝나 있을 수 있어서, 남은 기간이 3일보다 짧으면 주기 끝을 한 주 늘려 추천 후보가 늘 나오게 한다.
  // 시작은 그대로 둔다(확정은 주기가 시작한 뒤에만 된다).
  const scheduleRef = (await db.collection(`parties/${partyDoc.id}/schedules`).get()).docs[0].ref;
  const DAY = 24 * 60 * 60 * 1000;
  const KST = 9 * 60 * 60 * 1000;
  const original = (await scheduleRef.get()).data();
  const periodStart = original.periodStart.toMillis();
  const periodEnd = original.periodEnd.toMillis() - Date.now() < 3 * DAY ? original.periodEnd.toMillis() + 7 * DAY : original.periodEnd.toMillis();
  await scheduleRef.update({ periodEnd: Timestamp.fromMillis(periodEnd) });
  // 고정 불가 시간(평일 00:00~18:00 = 하루 36칸)이 이 주기에 채워지는 칸 수
  let weekdays = 0;
  for (let t = periodStart; t < periodEnd; t += DAY) if (new Date(t + KST).getUTCDay() % 6 !== 0) weekdays++;
  const routineCount = weekdays * 36;

  await a.getByRole("button", { name: "← 파티 목록" }).click();
  await a.getByText("할 일 · 불가 시간 입력").waitFor();
  await a.getByText("할 일이 있는 파티 1개").waitFor();
  assert.equal(await a.locator(".tabs .count").textContent(), "1");
  await shot(a, "05-parties-todo");
  step("파티 목록에 할 일(불가 시간 입력)과 하단 숫자가 보인다");

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
  await shot(a, "06-timetable");
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
  step("다크 모드를 켜면 바로 바뀌고 새로고침해도 유지된다");

  // ---------- 불가 시간 제출 (고정 불가 시간으로 미리 채워짐) ----------
  await a.getByText("스우팟").click();
  // 투표 탭에 할 일이 있으면 투표 탭부터 연다.
  await a.waitForURL(/\/vote$/);
  await a.getByRole("button", { name: "불가 시간 입력" }).click();
  await a.getByText("고정 불가 시간으로 채워 두었습니다.", { exact: false }).waitFor();
  await shot(a, "07-unavailable");
  await a.getByRole("button", { name: `제출 (불가 ${routineCount}칸)` }).click();
  await a.getByText("불가 시간을 제출했습니다").waitFor();
  // 제출하면 투표 탭으로 돌아온다.
  await a.waitForURL(/\/vote$/);
  await a.getByText("불가 시간 제출 1/2명", { exact: false }).waitFor();
  await dot(a, "투표").waitFor({ state: "detached" });
  assert.equal((await scheduleRef.collection("unavailable").doc(uidA).get()).get("slots").length, routineCount);
  step("불가 시간을 제출하면 투표 탭으로 돌아오고 할 일 점이 사라진다");

  await b.getByText("스우팟").click();
  await b.waitForURL(/\/vote$/);
  await b.getByRole("button", { name: "불가 시간 입력" }).click();
  await b.getByRole("button", { name: "제출 (불가 0칸)" }).click();
  await b.getByText("불가 시간을 제출했습니다").waitFor();
  step("안 되는 시간이 없는 파티원도 제출한다 → 서버가 추천 시간을 낸다");

  // ---------- 투표 → 확정 ----------
  await b.getByRole("button", { name: "모두 가능" }).click();
  await b.getByRole("button", { name: "투표하기" }).click();
  await b.getByText("투표했습니다").waitFor();
  await b.getByRole("button", { name: "투표 바꾸기" }).waitFor();

  await dot(a, "투표").waitFor();
  await a.getByRole("button", { name: "모두 가능" }).click();
  await a.getByRole("button", { name: "모두 해제" }).waitFor();
  await a.getByRole("button", { name: "투표하기" }).click();
  await a.getByText("전원이 동의한 시간 중 하나를 확정해 주세요.").waitFor();
  await shot(a, "08-voting");
  step("요일별로 묶인 후보에 '모두 가능'으로 투표하면 전원 동의가 된다");

  await tab(a, "파티");
  await a.locator("[data-member]", { hasText: "비숍짱" }).getByText("투표 완료").waitFor();
  await a.getByRole("button", { name: "비숍 시간표 보기" }).click();
  const timetable = a.getByRole("dialog", { name: "비숍님의 불가 시간" });
  await timetable.getByText("제출함", { exact: false }).waitFor();
  await shot(a, "09-member-timetable");
  await timetable.getByRole("button", { name: "닫기" }).click();
  step("파티 탭에서 파티원의 진행 상태와 불가 시간표를 본다");

  await tab(a, "투표");
  // 변경 요청은 레이드 시작 4시간 전까지라, 넉넉하게 가장 늦은 후보를 확정한다.
  await a.getByRole("button", { name: "확정", exact: true }).last().click();
  await a.getByRole("dialog", { name: "일정 확정" }).getByRole("button", { name: "확정" }).click();
  await a.getByText("일정을 확정했습니다").waitFor();
  await a.getByText("확정된 시간").waitFor();
  assert.equal((await scheduleRef.get()).get("state"), "LOCKED");
  await shot(a, "10-locked");
  step("파티장이 전원 동의 시간을 확정한다");

  // ---------- 변경 요청 → 거절 ----------
  await b.getByRole("button", { name: "일정 변경 요청" }).click();
  const changeDialog = b.getByRole("dialog", { name: "일정 변경 요청" });
  await changeDialog.getByLabel("사유 (선택)").fill("개인 사정");
  await changeDialog.getByRole("button", { name: "요청" }).click();
  await b.getByText("변경을 요청했습니다. 파티장의 승인을 기다립니다").waitFor();
  await a.getByText("사유: 개인 사정", { exact: false }).waitFor();
  await dot(a, "투표").waitFor();
  await a.getByRole("button", { name: "거절" }).click();
  await a.getByText("변경 요청을 거절했습니다").waitFor();
  await b.getByText("변경 요청이 거절되었습니다.").waitFor();
  step("파티원이 변경을 요청하면 파티장의 투표 탭에 할 일 점이 붙고, 파티장이 거절한다");

  // ---------- 레이드 후 클리어 기록 ----------
  // 확정 시간을 이미 지난 시간으로 옮긴다 (기록은 레이드가 시작된 뒤에만 받는다).
  const confirmed = (await scheduleRef.get()).get("confirmed");
  await scheduleRef.update({
    confirmed: { ...confirmed, start: Timestamp.fromMillis(Date.now() - 60 * 60 * 1000), end: Timestamp.fromMillis(Date.now() - 20 * 60 * 1000) },
  });
  await a.reload();
  await a.getByText("레이드가 끝났나요? 결과를 기록해 주세요.").waitFor();
  await a.getByRole("button", { name: "클리어", exact: true }).click();
  await a.getByRole("dialog", { name: "클리어 기록" }).getByRole("button", { name: "기록" }).click();
  await a.getByText("클리어로 기록했습니다").waitFor();
  await a.getByText("분배금은 정산 탭에서 정산합니다.").waitFor();
  assert.equal((await scheduleRef.get()).get("state"), "SETTLED");
  step("레이드가 끝나면 클리어를 기록한다");

  // ---------- 정산 탭 ----------
  await tab(a, "정산");
  await a.getByLabel("경매장 판매액 (메소)").fill("100000000");
  await a.getByText("1억 메소").waitFor();
  // 실수령 9500만 ÷ (0.95 + 1명) = 48,717,948 → 100메소 단위로 내림 (서버 calc.ts와 같은 식)
  await a.getByText("48,717,900메소 (4871만 7900)").waitFor();
  await shot(a, "11-settlement-form");
  await a.getByRole("button", { name: "분배금 등록" }).click();
  await a.getByText("분배금을 등록했습니다. 파티원에게 알림을 보냈습니다").waitFor();
  await a.getByText("비숍 정산금").waitFor();
  await dot(a, "정산").waitFor();
  assert.equal((await scheduleRef.collection("settlement").doc(uidB).get()).get("amount"), 48717900);
  step("정산 탭: 판매액으로 정산금을 미리 계산하고 등록한다. 지급할 판매자의 정산 탭에 점이 붙는다");

  await b.getByRole("button", { name: "← 파티 목록" }).click();
  await b.getByText("스우팟").click();
  // 클리어하면 다음 주 일정이 미리 열려, 할 일(다음 주 불가 시간 입력)이 있는 투표 탭부터 열린다.
  await b.waitForURL(/\/vote$/);
  await tab(b, "정산");
  await b.getByText("경매장에 물건을 내 정산금 가격으로 올리고", { exact: false }).waitFor();
  await b.getByLabel("메시지").fill("경매장에 올렸어요");
  await b.getByRole("button", { name: "보내기" }).click();
  await a.getByText("경매장에 올렸어요").waitFor();
  step("정산 채팅으로 메시지를 주고받는다");

  // 사진 첨부: 큰 이미지를 긴 쪽 1600px JPEG로 줄여 Storage에 올린다.
  const upload = await a.evaluate(async ({ partyId, periodId, uid }) => {
    const canvas = document.createElement("canvas");
    canvas.width = 3000;
    canvas.height = 2000;
    canvas.getContext("2d").fillRect(0, 0, 3000, 2000);
    const png = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    const { toJpeg } = await import("/src/lib/image.ts");
    const api = await import("/src/data/api.ts");
    const jpeg = await toJpeg(png);
    const bitmap = await createImageBitmap(jpeg);
    const url = await api.uploadChatImage(partyId, periodId, uid, jpeg);
    const fetched = await fetch(url);
    return { type: jpeg.type, width: bitmap.width, height: bitmap.height, status: fetched.status };
  }, { partyId: partyDoc.id, periodId: scheduleRef.id, uid: uidA });
  assert.deepEqual(upload, { type: "image/jpeg", width: 1600, height: 1067, status: 200 });
  step("첨부 사진은 긴 쪽 1600px JPEG로 줄여 Storage에 올린다");

  await a.getByRole("button", { name: "지급함" }).click();
  await a.getByText("비숍님에게 지급함으로 표시했습니다").waitFor();
  await dot(a, "정산").waitFor({ state: "detached" });
  await dot(b, "정산").waitFor();
  await b.getByRole("button", { name: "수령 확인" }).click();
  await b.getByText("수령을 확인했습니다").waitFor();
  await a.getByText("전원 수령 확인 · 정산 완료").waitFor();
  await dot(b, "정산").waitFor({ state: "detached" });
  await shot(b, "12-settlement-done");
  step("판매자가 지급함을 누르면 받을 사람의 정산 탭에 점이 붙고, 수령을 확인하면 정산이 끝난다");

  // ---------- 내 캐릭터 탭: 게임 스케줄러 보스와 수익 ----------
  // NEXON API를 부를 수 없으니 서버가 저장해 두는 스케줄러 캐시를 방금 받은 것처럼 넣는다(10분 안이면 서버가 그대로 쓴다).
  await db.doc(`users/${uidA}/scheduler/${CHAR_A}`).set({
    bosses: [
      { name: "스우", difficulty: "EXTREME", cycle: "WEEKLY", cleared: true },
      { name: "데미안", difficulty: "HARD", cycle: "WEEKLY", cleared: false },
      { name: "검은 마법사", difficulty: "HARD", cycle: "MONTHLY", cleared: false },
    ],
    fetchedAt: Timestamp.now(),
  });
  await a.getByRole("button", { name: "← 파티 목록" }).click();
  await a.getByRole("link", { name: "내 캐릭터" }).click();
  const card = a.locator(`[data-character="${CHAR_A}"]`);
  // 스우·데미안은 앱의 2인 파티(스우팟)로 가므로 /2, 검은 마법사는 혼자
  await card.getByLabel("스우 EX/2 클리어").waitFor();
  await card.getByLabel("데미안 H/2", { exact: true }).waitFor();
  await card.getByLabel("검은 마법사 H", { exact: true }).waitFor();
  await card.getByText("주간 2 · 월간 1").waitFor();
  // 이름 글씨 대신 보스 이미지
  await card.getByLabel("스우 EX/2 클리어").locator("img.boss-img").waitFor();
  assert.ok(
    await card.getByLabel("검은 마법사 H", { exact: true }).locator("img.boss-img").evaluate((img) =>
      img.complete ? img.naturalWidth > 0 : new Promise((resolve) => img.addEventListener("load", () => resolve(img.naturalWidth > 0))),
    ),
  );
  await a.getByRole("button", { name: "새로고침" }).click();
  await card.getByLabel("스우 EX/2 클리어").waitFor();
  await shot(a, "13-characters");
  step("내 캐릭터 탭: 스케줄러에 등록한 보스를 칩으로, 클리어 체크와 파티 인원수(H/2)를 함께 보여 준다");

  await card.getByRole("button", { name: "수익 보기" }).click();
  await a.getByRole("heading", { name: "루시드짱 수익" }).waitFor();
  // 예상 = 익스트림 스우 5억 4500만 ÷ 2 + 하드 데미안 4640만 ÷ 2 + (이번 달 아직 안 잡은) 하드 검은 마법사 4억 6500만
  await a.getByRole("region", { name: "이번 주 예상 수익" }).getByText("7억 6070만 메소").waitFor();
  assert.equal(await a.getByText("가격 미등록", { exact: false }).count(), 0);
  // 이번 주 = 클리어한 익스트림 스우 2억 7250만 + 판매자(파티장) 몫 46,282,100 (실수령 9500만 - 48,717,900)
  const thisWeek = a.getByRole("region", { name: "이번 주에 번 돈" });
  await thisWeek.getByText("3억 1878만 2100 메소").waitFor();
  await thisWeek.getByText("272,500,000메소").waitFor();
  await thisWeek.getByText("46,282,100메소").first().waitFor();
  await thisWeek.getByText("스우팟", { exact: false }).waitFor();
  await a.locator(".month-row", { hasText: "46,282,100메소" }).waitFor();
  await shot(a, "14-earnings");
  step("수익 보기: 이번 주 예상 수익, 이번 주에 번 돈(정산금 포함), 월별 지표");

  // ---------- 알림 설정 (에뮬레이터에서는 웹 푸시 키가 없음) ----------
  await a.getByRole("button", { name: "← 내 캐릭터" }).click();
  await a.getByRole("link", { name: "설정" }).click();
  await a.getByText("알림 설정이 아직 준비되지 않았습니다.").waitFor();
  assert.equal(await a.getByLabel("알림").isDisabled(), true);
  step("웹 푸시 키가 없으면 알림 스위치를 막고 안내한다");

  // ---------- 다음 주 일정 미리 조율 ----------
  // 이번 주를 클리어해서 서버가 다음 주 일정을 미리 열어 두었다.
  await a.getByRole("link", { name: "파티" }).click();
  await a.getByText("할 일 · 다음 주 불가 시간 입력").waitFor();
  await a.getByText("스우팟").click();
  await a.waitForURL(/\/vote$/);
  await a.getByText("이번 주 클리어 완료", { exact: false }).waitFor();
  await a.getByText("미리 조율", { exact: false }).first().waitFor();
  await a.getByRole("button", { name: "다음 주 불가 시간 입력" }).click();
  await a.getByRole("heading", { name: "다음 주 불가 시간 입력" }).waitFor();
  await a.getByRole("button", { name: "제출 (불가 180칸)" }).click();
  await a.getByText("불가 시간을 제출했습니다").waitFor();
  await a.waitForURL(/\/vote$/);

  await tab(b, "투표");
  await b.getByRole("button", { name: "다음 주 불가 시간 입력" }).click();
  await b.getByRole("button", { name: "제출 (불가 0칸)" }).click();
  await b.getByText("불가 시간을 제출했습니다").waitFor();
  step("이번 주를 클리어하면 다음 주 일정이 미리 열리고, 파티원이 다음 주 불가 시간을 미리 낸다");

  await b.getByRole("button", { name: "모두 가능" }).click();
  await b.getByRole("button", { name: "투표하기" }).click();
  await b.getByText("투표했습니다").waitFor();
  await a.getByRole("button", { name: "모두 가능" }).click();
  await a.getByRole("button", { name: "투표하기" }).click();
  await a.getByText("목요일 00:00부터 파티장이 확정할 수 있습니다.").waitFor();
  assert.equal(await a.getByRole("button", { name: "확정", exact: true }).count(), 0);
  await shot(a, "15-next-week");
  step("전원이 미리 내면 다음 주 투표도 미리 하고, 확정은 목요일부터라 확정 버튼 대신 안내가 보인다");

  // ---------- 이번 주기 용병 ----------
  const nextRef = (await db.collection(`parties/${partyDoc.id}/schedules`).where("preOpened", "==", true).get()).docs[0].ref;
  await tab(b, "파티");
  await b.getByText("다음 주 용병", { exact: true }).waitFor();
  await b.getByRole("button", { name: "다음 주 용병으로 대체" }).click();
  const replaceDialog = b.getByRole("dialog", { name: "다음 주 용병으로 대체" });
  await replaceDialog.getByRole("button", { name: "대체", exact: true }).click();
  await b.getByText("다음 주를 용병으로 대체했습니다").waitFor();
  assert.deepEqual(
    ((await nextRef.get()).get("mercenaries") ?? []).map((m) => [m.name, m.replaces]),
    [["용병", uidB]],
  );
  await b.getByRole("button", { name: "대체 취소" }).waitFor();

  await tab(a, "파티");
  await a.getByRole("heading", { name: "파티원 2명 · 용병 1명" }).waitFor();
  await a.getByText("용병 (비숍 대신)").waitFor();
  await a.locator(`[data-member="${uidB}"]`).getByText("다음 주 용병으로 대체").waitFor();
  step("파티원이 다음 주를 용병으로 대체하면 파티 탭에 대체 용병이 보인다");

  await a.getByRole("button", { name: "임시 용병 추가" }).click();
  await a.getByRole("dialog", { name: "임시 용병 추가" }).getByRole("button", { name: "추가", exact: true }).click();
  await a.getByText("임시 용병을 추가했습니다").waitFor();
  await a.getByRole("heading", { name: "파티원 2명 · 용병 2명" }).waitFor();
  await shot(a, "16-mercenary");
  await a.getByRole("button", { name: "용병 1 빼기" }).click();
  await a.getByRole("dialog", { name: "임시 용병 빼기" }).getByRole("button", { name: "빼기", exact: true }).click();
  await a.getByText("임시 용병을 뺐습니다").waitFor();
  await a.getByRole("heading", { name: "파티원 2명 · 용병 1명" }).waitFor();
  step("파티장이 임시 용병을 추가하고 뺀다");

  await b.getByRole("button", { name: "대체 취소" }).click();
  await b.getByRole("dialog", { name: "용병 대체 취소" }).getByRole("button", { name: "대체 취소", exact: true }).click();
  await b.getByText("대체를 취소했습니다", { exact: false }).waitFor();
  assert.deepEqual((await nextRef.get()).get("mercenaries"), []);
  await a.getByRole("heading", { name: "파티원 2명" }).waitFor();
  step("확정 전에는 대체를 취소할 수 있다");

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
