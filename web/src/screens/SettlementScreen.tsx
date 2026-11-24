// 분배금 정산과 채팅 (Android ui/SettlementScreen.kt와 같은 동작·문구).
// 금액 계산은 서버 코드(functions/src/settlement/calc.ts)를 그대로 써서 미리 보여 주고, 실제 금액은 서버가 같은 식으로 다시 계산한다.
import { FEE_PERCENTS, MAX_SALE_AMOUNT, MAX_WEIGHT, computeSettlement } from "@shared/settlement/calc";
import { FirebaseError } from "firebase/app";
import { useEffect, useRef, useState } from "react";
import * as api from "../data/api";
import { toJpeg } from "../lib/image";
import { type ChatMessage, type Party, type Schedule, type SettlementEntry, memberLabel } from "../lib/model";
import { korean, meso } from "../lib/money";
import { useSubscription } from "../lib/useSubscription";
import { dateTime, range } from "../lib/time";
import { Chips, Loading, useToast } from "../ui/common";

const nameOf = (party: Party, uid: string) => memberLabel(party.members[uid]);

/**
 * 클리어한 일정의 분배금 정산과 채팅. 파티 화면의 정산 탭 안에 들어간다.
 * 위쪽은 분배금 계산·상태(대기 → 지급함 → 수령 확인), 아래쪽은 수령 방법을 주고받는 채팅이다.
 */
export function SettlementContent({ uid, party, periodId }: { uid: string; party: Party; periodId: string }) {
  const partyId = party.id;
  const toast = useToast();
  const schedule = useSubscription(api.schedule(partyId, periodId), [partyId, periodId]);
  const entries = useSubscription(api.settlementEntries(partyId, periodId), [partyId, periodId]) ?? [];
  const messages = useSubscription(api.messages(partyId, periodId), [partyId, periodId]);
  const [busy, setBusy] = useState(false);

  if (schedule === undefined) return <Loading />;
  if (schedule === null) return <p>정산할 일정을 찾지 못했습니다.</p>;

  /** 서버에 보내고 결과를 화면 아래 알림으로 보여 준다. */
  async function run(success: string | null, action: () => Promise<unknown>): Promise<boolean> {
    setBusy(true);
    try {
      await action();
      if (success) toast(success);
      return true;
    } catch (error) {
      toast(
        error instanceof FirebaseError && error.code.startsWith("storage/")
          ? "이미지를 올리지 못했습니다. 네트워크 상태를 확인하고 다시 시도해 주세요."
          : error instanceof FirebaseError && !error.code.startsWith("functions/")
            ? "보내지 못했습니다. 다시 시도해 주세요."
            : api.userMessage(error),
      );
      return false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="settlement-content">
      {schedule.confirmed && (
        <span className="small muted">
          {range(schedule.confirmed.startMs, schedule.confirmed.endMs)} 레이드
        </span>
      )}

      <div className="settlement-status">
        <SettlementStatus
          uid={uid}
          party={party}
          schedule={schedule}
          entries={entries}
          busy={busy}
          onRegister={(sale, fee, weights) =>
            run("분배금을 등록했습니다. 파티원에게 알림을 보냈습니다", () => api.registerSettlement(partyId, periodId, sale, fee, weights))
          }
          onMarkPaid={(recipient) => run(`${nameOf(party, recipient)}님에게 지급함으로 표시했습니다`, () => api.markPaid(partyId, periodId, recipient))}
          onConfirmReceived={() => run("수령을 확인했습니다", () => api.confirmReceived(partyId, periodId))}
        />
      </div>

      <hr className="divider" />

      <Chat
        uid={uid}
        party={party}
        messages={messages}
        busy={busy}
        onSend={(text) => run(null, () => api.sendMessage(partyId, periodId, uid, text))}
        onSendImage={(file, text) =>
          run(null, async () => {
            const jpeg = await toJpeg(file);
            const url = await api.uploadChatImage(partyId, periodId, uid, jpeg);
            await api.sendMessage(partyId, periodId, uid, text, url);
          })
        }
      />
    </div>
  );
}

function SettlementStatus({
  uid,
  party,
  schedule,
  entries,
  busy,
  onRegister,
  onMarkPaid,
  onConfirmReceived,
}: {
  uid: string;
  party: Party;
  schedule: Schedule;
  entries: SettlementEntry[];
  busy: boolean;
  onRegister: (saleAmount: number, feePercent: number, weights: Record<string, number>) => Promise<boolean>;
  onMarkPaid: (recipientUid: string) => void;
  onConfirmReceived: () => void;
}) {
  const settlement = schedule.settlement;
  const isSeller = settlement?.sellerUid === uid;
  // 판매자는 아무에게도 지급하기 전까지 고쳐서 다시 등록할 수 있다.
  const canEdit = !settlement || (isSeller && entries.every((e) => e.status === "PENDING") && !settlement.completed);
  const [editing, setEditing] = useState(!settlement);
  // 등록되거나 바뀌면 입력 창을 닫는다 (Android의 remember(settlement)와 같음).
  const settlementKey = settlement ? `${settlement.sellerUid}:${settlement.saleAmount}:${settlement.feePercent}:${settlement.netAmount}` : "";
  useEffect(() => setEditing(!settlementKey), [settlementKey]);
  // 이 레이드에 참여한 사람 (확정 당시 파티원)
  const participants = schedule.confirmed?.memberUids.length ? schedule.confirmed.memberUids : party.memberUids;

  if (schedule.state !== "SETTLED") return <p>클리어한 일정에서만 정산할 수 있습니다.</p>;

  return (
    <div className="stack">
      {settlement && (
        <>
          <div className="card stack" style={{ gap: 2 }}>
            <span className="small muted">판매자 {nameOf(party, settlement.sellerUid)}</span>
            {settlement.saleAmount !== null && settlement.netAmount !== null && (
              <>
                <span className="small">
                  경매장 판매액 {meso(settlement.saleAmount)} · 수수료 {settlement.feePercent}%
                </span>
                <span style={{ fontSize: 18, fontWeight: 600 }}>실수령액 {meso(settlement.netAmount)}</span>
              </>
            )}
            {settlement.completed && <span className="primary-text">전원 수령 확인 · 정산 완료</span>}
          </div>
          {[...entries]
            .sort((a, b) => participants.indexOf(a.uid) - participants.indexOf(b.uid))
            .map((entry) => (
              <div key={entry.uid} className="row">
                <div className="grow stack" style={{ gap: 0 }}>
                  <span className="small">
                    {nameOf(party, entry.uid)}
                    {entry.uid === uid && " (나)"} 정산금
                  </span>
                  <span style={{ fontSize: 18, fontWeight: 600 }}>{meso(entry.amount)}</span>
                  <span className={`small ${entry.status === "RECEIVED" ? "primary-text" : "muted"}`}>
                    {entry.status === "PAID" ? "지급함 · 수령 확인 대기" : entry.status === "RECEIVED" ? "수령 확인" : "대기"}
                  </span>
                </div>
                {isSeller && entry.status === "PENDING" && (
                  <button className="btn" disabled={busy} onClick={() => onMarkPaid(entry.uid)}>
                    지급함
                  </button>
                )}
                {entry.uid === uid && entry.status === "PAID" && (
                  <button className="btn" disabled={busy} onClick={onConfirmReceived}>
                    수령 확인
                  </button>
                )}
              </div>
            ))}
          {!isSeller && entries.some((e) => e.uid === uid && e.status === "PENDING") && (
            <p className="small" style={{ margin: 0 }}>
              경매장에 물건을 내 정산금 가격으로 올리고, 아래 채팅으로 판매자에게 알려 주세요.
            </p>
          )}
        </>
      )}

      {canEdit && editing ? (
        <SettlementForm sellerUid={uid} party={party} participants={participants} registered={!!settlement} busy={busy} onRegister={onRegister} />
      ) : (
        canEdit && (
          <button className="btn-text" style={{ alignSelf: "flex-start" }} disabled={busy} onClick={() => setEditing(true)}>
            금액 고치기
          </button>
        )
      )}
    </div>
  );
}

/**
 * 분배금 계산·등록. 경매장 판매액과 수수료를 넣으면 실수령액과 파티원 정산금을 바로 보여 준다.
 * 등록하는 사람이 판매자다. 인원은 이 레이드에 참여한 파티원으로 고정이다.
 */
function SettlementForm({
  sellerUid,
  party,
  participants,
  registered,
  busy,
  onRegister,
}: {
  sellerUid: string;
  party: Party;
  participants: string[];
  registered: boolean;
  busy: boolean;
  onRegister: (saleAmount: number, feePercent: number, weights: Record<string, number>) => Promise<boolean>;
}) {
  const [input, setInput] = useState("");
  const [feePercent, setFeePercent] = useState<number>(FEE_PERCENTS[0]);
  const [detailed, setDetailed] = useState(false);
  // uid → 비율 입력값 (글자). 비어 있거나 범위를 벗어나면 등록할 수 없다.
  const [weightInputs, setWeightInputs] = useState<Record<string, string>>(() => Object.fromEntries(participants.map((u) => [u, "1"])));

  const parsed = Number(input);
  const saleAmount = input && parsed >= 1 && parsed <= MAX_SALE_AMOUNT ? parsed : null;
  const weightOf = (u: string) => Number(weightInputs[u] ?? "1");
  const weightValid = (u: string) => /^\d+$/.test(weightInputs[u] ?? "1") && weightOf(u) >= 1 && weightOf(u) <= MAX_WEIGHT;
  const weightsValid = !detailed || participants.every(weightValid);
  const usedWeights: Record<string, number> = detailed && weightsValid ? Object.fromEntries(participants.map((u) => [u, weightOf(u)])) : {};
  const result =
    saleAmount !== null && weightsValid ? computeSettlement({ saleAmount, feePercent, sellerUid, participants, weights: usedWeights }) : null;
  const recipients = participants.filter((u) => u !== sellerUid);
  const amounts = result ? recipients.map((u) => result.amounts[u] ?? 0) : [];

  return (
    <div className="stack">
      <p className="small" style={{ margin: 0 }}>
        {registered ? "고쳐서 다시 등록합니다." : "드롭 아이템을 판매한 분이 등록해 주세요. 등록한 사람이 판매자가 됩니다."}
      </p>
      <div className="field">
        <label htmlFor="sale-amount">경매장 판매액 (메소)</label>
        <input
          id="sale-amount"
          className="input"
          inputMode="numeric"
          value={input}
          disabled={busy}
          onChange={(e) => setInput(e.target.value.replace(/\D/g, "").slice(0, 13))}
        />
        {saleAmount !== null && <span className="small muted">{korean(saleAmount)} 메소</span>}
      </div>

      <div className="row">
        <h3>수수료</h3>
        <Chips options={FEE_PERCENTS.map((p) => ({ value: p as number, label: `${p}%` }))} selected={feePercent} onSelect={setFeePercent} disabled={busy} />
      </div>

      {result && (
        <div className="stack" style={{ gap: 0 }}>
          <span className="small muted">실수령액</span>
          <span style={{ fontSize: 18, fontWeight: 600 }}>
            {meso(result.netAmount)} ({korean(result.netAmount)})
          </span>
        </div>
      )}

      {recipients.length > 0 && (
        <label className="row" style={{ cursor: "pointer" }}>
          <h3 className="grow">상세 비율 설정</h3>
          <input type="checkbox" className="switch" checked={detailed} disabled={busy} onChange={() => setDetailed(!detailed)} />
        </label>
      )}
      {detailed && (
        <>
          <p className="small" style={{ margin: 0 }}>
            수수료를 뗀 뒤 실제로 받는 금액을 이 비율대로 나눕니다 (1~{MAX_WEIGHT}).
          </p>
          {participants.map((member) => (
            <label key={member} className="row">
              <span className="grow">
                {nameOf(party, member)}
                {member === sellerUid && " (판매자)"}
              </span>
              <input
                className="input"
                style={{ width: 88, borderColor: weightValid(member) ? undefined : "var(--error)" }}
                inputMode="numeric"
                aria-label={`${nameOf(party, member)} 비율`}
                value={weightInputs[member] ?? ""}
                disabled={busy}
                onChange={(e) => setWeightInputs({ ...weightInputs, [member]: e.target.value.replace(/\D/g, "").slice(0, 3) })}
              />
            </label>
          ))}
        </>
      )}

      {/* 결과: 받을 파티원의 정산금만 보여 준다. */}
      {result && recipients.length > 0 && (
        <div className="card stack" style={{ gap: 4 }}>
          {detailed ? (
            recipients.map((member) => (
              <div key={member} className="stack" style={{ gap: 0 }}>
                <span className="small muted">{nameOf(party, member)} 정산금</span>
                <span style={{ fontSize: 18, fontWeight: 600 }}>
                  {meso(result.amounts[member] ?? 0)} ({korean(result.amounts[member] ?? 0)})
                </span>
              </div>
            ))
          ) : (
            <>
              <span className="small muted">파티원 1인 정산금 ({recipients.length}명)</span>
              <span style={{ fontSize: 22, fontWeight: 600 }}>
                {meso(amounts[0])} ({korean(amounts[0])})
              </span>
            </>
          )}
          <span className="small">
            파티원이 경매장에 올릴 금액입니다. 수수료를 뗀 뒤 받는 금액이 맞도록 수수료를 포함했고, 100메소 단위로 내렸습니다.
          </span>
        </div>
      )}

      <button
        className="btn-outline full"
        disabled={saleAmount === null || !weightsValid || busy || (recipients.length > 0 && !amounts.every((a) => a > 0))}
        onClick={() => saleAmount !== null && onRegister(saleAmount, feePercent, usedWeights)}
      >
        {registered ? "다시 등록" : "분배금 등록"}
      </button>
    </div>
  );
}

function Chat({
  uid,
  party,
  messages,
  busy,
  onSend,
  onSendImage,
}: {
  uid: string;
  party: Party;
  messages: ChatMessage[] | undefined;
  busy: boolean;
  onSend: (text: string) => Promise<boolean>;
  onSendImage: (file: File, text: string) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState("");
  const [viewing, setViewing] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // 새 메시지가 오면 맨 아래로 내린다.
  const count = messages?.length ?? 0;
  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [count]);

  return (
    <div className="chat">
      <div className="chat-list" ref={listRef}>
        {messages === undefined ? (
          <Loading />
        ) : messages.length === 0 ? (
          <p className="small muted" style={{ textAlign: "center", margin: "auto 0" }}>
            수령 방법이나 정산 화면 캡처를 여기에 남겨 주세요.
          </p>
        ) : (
          messages.map((message) => {
            const mine = message.senderUid === uid;
            return (
              <div key={message.id} className={`chat-item ${mine ? "mine" : ""}`}>
                <span className="small muted">
                  {mine ? "나" : nameOf(party, message.senderUid)} · {dateTime(message.createdAtMs)}
                </span>
                <div className="bubble">
                  {message.imageUrl && (
                    <img src={message.imageUrl} alt="첨부 이미지" loading="lazy" onClick={() => setViewing(message.imageUrl)} />
                  )}
                  {message.text && <div className="text">{message.text}</div>}
                </div>
              </div>
            );
          })
        )}
      </div>
      <div className="row chat-input">
        {/* 사진을 고르면 지금 적어 둔 글과 함께 바로 보낸다. */}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          aria-label="사진 첨부"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            const text = draft.trim();
            if (await onSendImage(file, text)) setDraft("");
          }}
        />
        <button className="btn-text" disabled={busy} onClick={() => fileRef.current?.click()}>
          {busy ? "…" : "사진"}
        </button>
        <textarea
          className="input grow"
          rows={1}
          placeholder="메시지"
          aria-label="메시지"
          value={draft}
          maxLength={500}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button
          className="btn"
          disabled={!draft.trim() || busy}
          onClick={async () => {
            if (await onSend(draft.trim())) setDraft("");
          }}
        >
          보내기
        </button>
      </div>

      {/* 이미지를 누르면 크게 본다. */}
      {viewing && (
        <div className="dialog-backdrop" onClick={() => setViewing(null)}>
          <img src={viewing} alt="첨부 이미지" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
        </div>
      )}
    </div>
  );
}
