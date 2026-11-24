import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import * as api from "../data/api";
import { PARTY_SORTS, type PartySort, useMain } from "../main-context";
import { periodColumns, routineKey } from "../lib/grid";
import { bossLabel, type Party, type PartyMember } from "../lib/model";
import { statusText } from "../lib/partyStatus";
import { DAY_MS, SLOT_MS, SLOTS_PER_DAY, dayLabel, range, rowLabel, weekStart } from "../lib/time";
import { useNow, useSubscription } from "../lib/useSubscription";
import { disablePush, enablePush, pushAvailability, type PushAvailability, pushEnabled } from "../lib/push";
import { Loading, useTheme, useToast } from "../ui/common";

// ---------- 내 캐릭터 ----------

export function CharactersTab() {
  const { characters } = useMain();
  const navigate = useNavigate();
  return (
    <div className="page with-tabs">
      <h1>내 캐릭터</h1>
      {characters === undefined && <Loading />}
      {characters?.length === 0 && <p>선택한 캐릭터가 없습니다.</p>}
      {characters?.map((c) => (
        <div key={c.id} className="card row">
          {c.imageUrl ? <img className="avatar" style={{ width: 72, height: 72 }} src={c.imageUrl} alt="" /> : <div className="avatar" />}
          <div className="grow">
            <strong>{c.name}</strong>
            <div>
              Lv.{c.level} · {c.job}
            </div>
            <div className="small muted">{[c.world, c.guild].filter(Boolean).join(" · ")}</div>
          </div>
        </div>
      ))}
      <button className="btn-outline full" onClick={() => navigate("/characters/select")}>
        캐릭터 다시 선택
      </button>
    </div>
  );
}

// ---------- 파티 ----------

export function PartiesTab() {
  const { uid, parties, statuses, todoCount, partyFilter, setPartyFilter, partySort, setPartySort } = useMain();
  const navigate = useNavigate();
  const list = parties ?? [];
  const mine = (party: Party): PartyMember | undefined => party.members[uid];

  // 내 파티에 들어가 있는 내 캐릭터들 (레벨 높은 순)과 캐릭터별 파티 수
  const myCharacters = useMemo(() => {
    const byId = new Map<string, PartyMember>();
    for (const party of list) {
      const me = party.members[uid];
      if (me && !byId.has(me.characterId)) byId.set(me.characterId, me);
    }
    return [...byId.values()].sort((a, b) => b.level - a.level || a.characterName.localeCompare(b.characterName, "ko"));
  }, [list, uid]);
  const partyCount = (characterId: string) => list.filter((p) => mine(p)?.characterId === characterId).length;

  // 고른 캐릭터의 파티가 없어졌으면(탈퇴 등) 전체로 돌아간다.
  const activeFilter = partyFilter && myCharacters.some((c) => c.characterId === partyFilter) ? partyFilter : null;
  useEffect(() => {
    if (parties && partyFilter && !activeFilter) setPartyFilter(null);
  }, [parties, partyFilter, activeFilter, setPartyFilter]);

  const byCharacter = (a: Party, b: Party) =>
    (mine(b)?.level ?? 0) - (mine(a)?.level ?? 0) ||
    (mine(a)?.characterName ?? "").localeCompare(mine(b)?.characterName ?? "", "ko") ||
    a.name.localeCompare(b.name, "ko");
  const shown = list
    .filter((p) => !activeFilter || mine(p)?.characterId === activeFilter)
    .sort((a, b) => {
      switch (partySort) {
        case "todo":
          return Number(statuses[b.id]?.needsAction ?? false) - Number(statuses[a.id]?.needsAction ?? false) || byCharacter(a, b);
        case "character":
          return byCharacter(a, b);
        case "name":
          return a.name.localeCompare(b.name, "ko");
        case "recent":
          return (mine(b)?.joinedAtMs ?? 0) - (mine(a)?.joinedAtMs ?? 0);
      }
    });

  return (
    <div className="page with-tabs">
      <h1>파티</h1>
      <InstallBanner />
      {todoCount > 0 && <h3 className="primary-text">할 일이 있는 파티 {todoCount}개</h3>}
      <div className="row">
        <button className="btn grow" onClick={() => navigate("/parties/new")}>
          파티 만들기
        </button>
        <button className="btn-outline grow" onClick={() => navigate("/parties/join")}>
          코드로 가입
        </button>
      </div>
      {parties === undefined ? (
        <Loading />
      ) : list.length === 0 ? (
        <p>아직 가입한 파티가 없습니다.</p>
      ) : (
        <div className="row">
          <select
            className="input grow"
            aria-label="캐릭터별로 보기"
            value={activeFilter ?? ""}
            onChange={(e) => setPartyFilter(e.target.value || null)}
          >
            <option value="">전체 캐릭터 ({list.length})</option>
            {myCharacters.map((c) => (
              <option key={c.characterId} value={c.characterId}>
                {c.characterName} · Lv.{c.level} ({partyCount(c.characterId)})
              </option>
            ))}
          </select>
          <select className="input" style={{ width: "auto" }} aria-label="정렬" value={partySort} onChange={(e) => setPartySort(e.target.value as PartySort)}>
            {PARTY_SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
      )}
      {shown.map((party) => {
        const status = statuses[party.id];
        const me = mine(party);
        return (
          <div key={party.id} className="card clickable stack" style={{ gap: 2 }} onClick={() => navigate(`/parties/${party.id}`)}>
            {status && statusText(status) && (
              <span>
                <span className={`badge ${status.needsAction ? "action" : "info"}`}>
                  {status.needsAction ? `할 일 · ${statusText(status)}` : statusText(status)}
                </span>
              </span>
            )}
            <strong>{party.name}</strong>
            <span>{bossLabel(party.bosses)}</span>
            <span className="small muted">
              {[party.cycle === "WEEKLY" ? "주간" : "월간", `${party.memberUids.length}명`, me && `내 캐릭터 ${me.characterName} (Lv.${me.level})`]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** 아이폰 Safari에서 홈 화면에 추가하지 않고 열었을 때만 보이는 안내 */
function InstallBanner() {
  const isIos = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem("installBannerDismissed") === "true";
    } catch {
      return false;
    }
  });
  if (!isIos || standalone || dismissed) return null;
  return (
    <div className="banner stack">
      <strong>홈 화면에 추가해서 쓰세요</strong>
      <span className="small">
        Safari 아래쪽의 공유 버튼(네모에 위쪽 화살표)을 누르고 "홈 화면에 추가"를 고르면 앱처럼 쓸 수 있습니다. 알림도 홈 화면에 추가한 앱에서만
        받을 수 있습니다(iOS 16.4 이상).
      </span>
      <button
        className="btn-text"
        style={{ alignSelf: "flex-end" }}
        onClick={() => {
          setDismissed(true);
          try {
            localStorage.setItem("installBannerDismissed", "true");
          } catch {
            // 다음에 다시 보일 뿐이다.
          }
        }}
      >
        닫기
      </button>
    </div>
  );
}

// ---------- 시간표 ----------

/** 고정 불가 시간을 설정하고, 이번 주(목~수)의 확정 일정과 고정 불가 시간을 한눈에 본다. */
export function TimetableTab() {
  const { uid } = useMain();
  const navigate = useNavigate();
  const now = useNow();
  const start = useMemo(() => weekStart(Date.now()), []);
  const raids = useSubscription(api.myRaids(uid, start), [uid, start]);
  const [routine, setRoutine] = useState<Set<string>>(new Set());
  useEffect(() => {
    api.loadRoutine(uid).then(setRoutine, () => setRoutine(new Set()));
  }, [uid]);

  const columns = useMemo(() => periodColumns(start, start + 7 * DAY_MS), [start]);
  // 이번 주 칸 번호(날 × 48 + 행) 중 레이드가 잡힌 칸
  const raidSlots = useMemo(() => {
    const slots = new Set<number>();
    for (const raid of raids ?? []) {
      const first = Math.floor((raid.startMs - start) / SLOT_MS);
      const last = Math.floor((raid.endMs - 1 - start) / SLOT_MS);
      for (let i = Math.max(first, 0); i <= last && i < 7 * SLOTS_PER_DAY; i++) slots.add(i);
    }
    return slots;
  }, [raids, start]);
  const nowSlot = Math.floor((now - start) / SLOT_MS);

  return (
    <div className="page with-tabs">
      <h1>시간표</h1>
      <button className="btn-outline full" onClick={() => navigate("/timetable/routine")}>
        고정 불가 시간 설정
      </button>
      <h2>확정된 일정</h2>
      {raids === undefined ? (
        <Loading />
      ) : raids.length === 0 ? (
        <p>이번 주 이후로 확정된 일정이 없습니다.</p>
      ) : (
        raids.map((raid) => (
          <div
            key={`${raid.partyId}-${raid.startMs}`}
            className="card clickable"
            style={{ opacity: raid.endMs <= now ? 0.5 : 1 }}
            onClick={() => navigate(`/parties/${raid.partyId}`)}
          >
            <strong>
              {range(raid.startMs, raid.endMs)}
              {raid.endMs <= now ? " · 지남" : ""}
            </strong>
            <div className="small muted">
              {raid.partyName} · {bossLabel(raid.bosses)}
            </div>
          </div>
        ))
      )}
      <h2>
        이번 주 ({dayLabel(start)} ~ {dayLabel(start + 7 * DAY_MS - 1)})
      </h2>
      <div className="row">
        <span className="legend">
          <i style={{ background: "var(--primary)" }} />
          확정 일정
        </span>
        <span className="legend">
          <i style={{ background: "var(--error-container)" }} />
          고정 불가 시간
        </span>
      </div>
      <div className="grid" style={{ gridTemplateColumns: "40px repeat(7, 1fr)" }}>
        <div className="head" />
        {columns.map((c) => (
          <div key={c.subtitle} className="head">
            {c.title}
            <br />
            {c.subtitle}
          </div>
        ))}
        {Array.from({ length: SLOTS_PER_DAY }, (_, row) => [
          <div key={`t${row}`} className="time">
            {row % 2 === 0 ? rowLabel(row) : ""}
          </div>,
          ...columns.map((c, day) => {
            const index = day * SLOTS_PER_DAY + row;
            const kind = raidSlots.has(index) ? "raid" : routine.has(routineKey(c.weekday, row)) ? "routine" : "";
            return <div key={`${day}-${row}`} className={`cell ${kind} ${index < nowSlot ? "past" : ""}`} style={{ height: 16 }} />;
          }),
        ])}
      </div>
    </div>
  );
}

// ---------- 설정 ----------

export function SettingsTab() {
  const { uid, profile } = useMain();
  const theme = useTheme();
  const navigate = useNavigate();
  const [signingOut, setSigningOut] = useState(false);
  return (
    <div className="page with-tabs">
      <h1>설정</h1>
      {profile.displayName && (
        <div>
          <div className="small muted">닉네임</div>
          <strong>{profile.displayName}</strong>
        </div>
      )}
      <label className="row">
        <span className="grow">
          <h3>다크 모드</h3>
          <span className="small muted">{theme.followsSystem ? "휴대폰 설정을 따르는 중" : "앱에서 직접 설정함"}</span>
        </span>
        <input type="checkbox" className="switch" checked={theme.dark} onChange={() => theme.setDark(!theme.dark)} />
      </label>
      {!theme.followsSystem && (
        <button className="btn-text" style={{ alignSelf: "flex-start" }} onClick={() => theme.setDark(null)}>
          휴대폰 설정 따르기
        </button>
      )}
      <PushSetting uid={uid} />
      <button className="btn-outline full" onClick={() => navigate("/settings/api-key")}>
        API Key 다시 등록
      </button>
      <button
        className="btn-outline full"
        disabled={signingOut}
        onClick={async () => {
          setSigningOut(true);
          // 로그아웃한 기기로 알림이 가지 않게 토큰부터 지운다.
          await disablePush(uid).catch(() => {});
          await api.signOut();
        }}
      >
        로그아웃
      </button>
      <p className="small muted">버전 {__APP_VERSION__} (웹)</p>
    </div>
  );
}

/** 알림 켜기·끄기. 아이폰은 홈 화면에 추가한 앱에서만 켤 수 있다. */
function PushSetting({ uid }: { uid: string }) {
  const toast = useToast();
  const [availability, setAvailability] = useState<PushAvailability | null>(null);
  const [enabled, setEnabled] = useState(pushEnabled);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    pushAvailability().then(setAvailability, () => setAvailability("unsupported"));
  }, []);

  async function toggle() {
    setBusy(true);
    try {
      if (enabled) {
        await disablePush(uid);
        setEnabled(false);
        toast("이 기기의 알림을 껐습니다");
      } else {
        await enablePush(uid);
        setEnabled(true);
        toast("이 기기에서 알림을 받습니다");
      }
    } catch (error) {
      toast(api.userMessage(error));
    } finally {
      setBusy(false);
    }
  }

  const note: Record<PushAvailability, string> = {
    available: enabled ? "일정이 열리거나 확정되면 이 기기로 알려 드립니다." : "일정 시작, 추천, 확정, 정산 소식을 이 기기로 받으려면 켜 주세요.",
    "needs-install": "아이폰은 Safari 공유 버튼 → '홈 화면에 추가'로 설치한 앱에서 열어야 알림을 켤 수 있습니다 (iOS 16.4 이상).",
    unsupported: "이 브라우저에서는 알림을 받을 수 없습니다.",
    "not-configured": "알림 설정이 아직 준비되지 않았습니다.",
  };
  return (
    <label className="row">
      <span className="grow">
        <h3>알림</h3>
        <span className="small muted">{availability ? note[availability] : "확인하는 중…"}</span>
      </span>
      <input
        type="checkbox"
        className="switch"
        aria-label="알림"
        checked={enabled && availability === "available"}
        disabled={availability !== "available" || busy}
        onChange={toggle}
      />
    </label>
  );
}
