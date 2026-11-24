import { type FormEvent, useState } from "react";
import * as api from "../data/api";
import { useToast } from "../ui/common";

export function AuthScreen() {
  const [signUpMode, setSignUpMode] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  const valid = email.trim() !== "" && password.length >= 6 && (!signUpMode || (displayName.trim().length >= 1 && displayName.trim().length <= 20));

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (signUpMode) await api.signUp(email.trim(), password, displayName.trim());
      else await api.signIn(email.trim(), password);
    } catch (err) {
      setError(api.authErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    if (!email.trim()) {
      setError("비밀번호를 재설정할 이메일을 먼저 입력해 주세요.");
      return;
    }
    try {
      await api.resetPassword(email.trim());
      toast("비밀번호 재설정 메일을 보냈습니다. 메일함을 확인해 주세요");
    } catch (err) {
      setError(api.authErrorMessage(err));
    }
  }

  return (
    <form className="page centered" onSubmit={submit}>
      <h1>보스 스케줄 매니저</h1>
      <p className="muted">{signUpMode ? "이메일로 가입합니다." : "이메일로 로그인합니다."}</p>
      {signUpMode && (
        <div className="field">
          <label htmlFor="name">닉네임 (파티원에게 보이는 이름)</label>
          <input id="name" className="input" value={displayName} maxLength={20} onChange={(e) => setDisplayName(e.target.value)} />
        </div>
      )}
      <div className="field">
        <label htmlFor="email">이메일</label>
        <input id="email" className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="password">비밀번호 (6자 이상)</label>
        <input
          id="password"
          className="input"
          type="password"
          autoComplete={signUpMode ? "new-password" : "current-password"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>
      {error && <p className="error">{error}</p>}
      <button className="btn full" type="submit" disabled={!valid || busy}>
        {busy ? "처리 중…" : signUpMode ? "가입하기" : "로그인"}
      </button>
      <button
        type="button"
        className="btn-text"
        disabled={busy}
        onClick={() => {
          setSignUpMode(!signUpMode);
          setError(null);
        }}
      >
        {signUpMode ? "이미 계정이 있습니다" : "처음이신가요? 회원가입"}
      </button>
      {!signUpMode && (
        <button type="button" className="btn-text" disabled={busy} onClick={reset}>
          비밀번호를 잊으셨나요?
        </button>
      )}
    </form>
  );
}
