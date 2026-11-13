/**
 * 어떤 변화에 누구에게 무슨 알림을 보낼지 정한다 (순수 함수).
 * 실제 발송은 send.ts가 한다.
 */

import type { DocumentData, Timestamp } from "firebase-admin/firestore";

export interface Push {
  uids: string[];
  title: string;
  body: string;
  partyId: string;
}

export interface PartyInfo {
  id: string;
  name: string;
  leaderUid: string;
  memberUids: string[];
  members?: Record<string, { displayName?: string; characterName?: string }>;
}

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const pad = (n: number) => String(n).padStart(2, "0");

/** "11/14(토) 20:00" (KST) */
export function formatKst(ms: number): string {
  const d = new Date(ms + KST_OFFSET_MS);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${WEEKDAYS[d.getUTCDay()]}) ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

export function formatMeso(amount: number): string {
  return `${amount.toLocaleString("en-US")}메소`;
}

export function memberName(party: PartyInfo, uid: string): string {
  const member = party.members?.[uid];
  return member?.displayName || member?.characterName || "파티원";
}

const isOpen = (state: unknown) => state === "OPEN" || state === "RETRY";

/** 일정 문서가 바뀌었을 때 보낼 알림 */
export function scheduleNotifications(
  party: PartyInfo,
  before: DocumentData | undefined,
  after: DocumentData | undefined,
): Push[] {
  if (!after) return [];
  const everyone = party.memberUids;
  const push = (uids: string[], body: string): Push => ({ uids, title: party.name, body, partyId: party.id });
  const pushes: Push[] = [];

  // 주기 시작
  if (!before) {
    if (after.state === "OPEN") pushes.push(push(everyone, "새 주기 일정 조율이 시작됐습니다. 불가 시간을 입력해 주세요."));
    return pushes;
  }

  const stateChanged = before.state !== after.state;
  const confirmedAt = (after.confirmed?.start as Timestamp | undefined)?.toMillis();

  if (stateChanged) {
    switch (after.state) {
      case "LOCKED":
        if (confirmedAt) pushes.push(push(everyone, `일정이 확정됐습니다: ${formatKst(confirmedAt)}`));
        break;
      case "VERIFYING":
        pushes.push(push(everyone, "레이드가 끝났나요? 클리어 여부를 기록해 주세요."));
        break;
      case "SETTLED":
        pushes.push(push(everyone, "클리어 완료! 아이템을 판매한 분은 분배금을 등록해 주세요."));
        break;
      case "RETRY":
        pushes.push(push(everyone, "미클리어로 기록됐습니다. 남은 기간 안에서 다시 조율합니다."));
        break;
      case "SKIPPED":
        pushes.push(
          push(
            everyone,
            after.skippedReason === "PERIOD_ENDED"
              ? "일정을 확정하지 못한 채 주기가 끝났습니다."
              : "전원이 가능한 시간이 없어 이번 주기는 진행하지 않습니다.",
          ),
        );
        break;
      case "EXPIRED":
        pushes.push(push(everyone, "이번 주기 일정이 종료됐습니다."));
        break;
      case "OPEN":
        // LOCKED → OPEN은 변경 요청 승인이다. 아래 changeRequest에서 알린다.
        break;
    }
  }

  // 새 추천 후보
  const candidates = (after.candidates as unknown[] | undefined) ?? [];
  if (isOpen(after.state) && candidates.length > 0 && before.round !== after.round) {
    const nextRound = !stateChanged && ((before.candidates as unknown[] | undefined) ?? []).length > 0 && before.inputsKey === after.inputsKey;
    pushes.push(
      push(
        everyone,
        nextRound ? "전원이 동의한 시간이 없어 다음 후보가 나왔습니다. 다시 투표해 주세요." : "추천 시간이 나왔습니다. 투표해 주세요.",
      ),
    );
  }

  // 전원 동의 → 파티장에게 확정 요청
  const hadUnanimous = ((before.unanimous as unknown[] | undefined) ?? []).length > 0;
  const hasUnanimous = ((after.unanimous as unknown[] | undefined) ?? []).length > 0;
  if (isOpen(after.state) && hasUnanimous && !hadUnanimous) {
    pushes.push(push([party.leaderUid], "전원이 동의한 시간이 있습니다. 일정을 확정해 주세요."));
  }

  // 변경 요청
  const request = after.changeRequest;
  if (request && before.changeRequest?.status !== request.status) {
    const requester = memberName(party, request.requestedBy);
    if (request.status === "PENDING") {
      const reason = request.reason ? ` (${request.reason})` : "";
      pushes.push(push([party.leaderUid], `${requester}님이 일정 변경을 요청했습니다${reason}.`));
    } else if (request.status === "APPROVED") {
      pushes.push(
        push(
          everyone,
          `일정 변경이 승인되어 다시 조율합니다. ${requester}님이 불가 시간을 다시 제출하면 새 추천이 나옵니다.`,
        ),
      );
    } else if (request.status === "REJECTED") {
      pushes.push(push([request.requestedBy], "일정 변경 요청이 거절됐습니다."));
    }
  }

  // 정산
  const settlement = after.settlement;
  if (settlement) {
    const previous = before.settlement;
    if (!previous || previous.amountPerPerson !== settlement.amountPerPerson) {
      const recipients = everyone.filter((uid) => uid !== settlement.sellerUid);
      pushes.push(
        push(
          recipients,
          `${memberName(party, settlement.sellerUid)}님이 분배금 1인 ${formatMeso(settlement.amountPerPerson)}를 등록했습니다. 채팅으로 수령 방법을 알려 주세요.`,
        ),
      );
    }
    if (settlement.completed && !previous?.completed) {
      pushes.push(push(everyone, "전원이 수령을 확인해 정산이 완료됐습니다."));
    }
  }

  return pushes.filter((p) => p.uids.length > 0);
}

/** 분배금 문서(settlement/{uid})가 바뀌었을 때 보낼 알림 */
export function settlementNotifications(
  party: PartyInfo,
  sellerUid: string,
  recipientUid: string,
  before: DocumentData | undefined,
  after: DocumentData | undefined,
): Push[] {
  if (!before || !after || before.status === after.status) return [];
  const push = (uid: string, body: string): Push => ({ uids: [uid], title: party.name, body, partyId: party.id });
  if (after.status === "PAID") {
    return [push(recipientUid, `분배금 ${formatMeso(after.amount)}를 지급했다고 합니다. 받으셨으면 수령 확인을 눌러 주세요.`)];
  }
  if (after.status === "RECEIVED") {
    return [push(sellerUid, `${memberName(party, recipientUid)}님이 분배금 수령을 확인했습니다.`)];
  }
  return [];
}

/** 정산 채팅 메시지 알림: 보낸 사람을 뺀 나머지에게 */
export function messageNotification(party: PartyInfo, senderUid: string, text: string): Push[] {
  const uids = party.memberUids.filter((uid) => uid !== senderUid);
  if (uids.length === 0) return [];
  const preview = text.length > 80 ? `${text.slice(0, 80)}…` : text;
  return [{ uids, title: party.name, body: `${memberName(party, senderUid)}: ${preview}`, partyId: party.id }];
}

/** 입력 마감이 지났는데 제출하지 않은 사람이 있을 때 */
export function missingInputNotifications(party: PartyInfo, missingUids: string[]): Push[] {
  if (missingUids.length === 0) return [];
  const pushes: Push[] = [
    { uids: missingUids, title: party.name, body: "불가 시간을 아직 입력하지 않았습니다. 입력하고 제출해 주세요.", partyId: party.id },
  ];
  // 파티장에게는 다른 파티원이 미입력일 때 알린다.
  if (missingUids.some((uid) => uid !== party.leaderUid)) {
    pushes.push({ uids: [party.leaderUid], title: party.name, body: "미입력 파티원이 존재합니다.", partyId: party.id });
  }
  return pushes;
}
