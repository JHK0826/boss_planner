import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from "react";

export function Loading() {
  return (
    <div className="loading" role="status" aria-label="불러오는 중">
      <div className="spinner" />
    </div>
  );
}

// ---------- 결과 알림(토스트): 앱 전체에 하나 ----------

const ToastContext = createContext<(text: string) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<{ text: string; id: number } | null>(null);
  const show = useCallback((text: string) => setMessage({ text, id: Date.now() }), []);
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(null), 3500);
    return () => clearTimeout(timer);
  }, [message]);
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="toast-region" aria-live="polite">
        {message && (
          <div className="toast" key={message.id}>
            {message.text}
          </div>
        )}
      </div>
    </ToastContext.Provider>
  );
}

/** 화면 아래에 잠깐 결과를 보여 준다. */
export const useToast = () => useContext(ToastContext);

// ---------- 테마: 처음에는 휴대폰 설정을 따르고, 바꾸면 이 기기에 저장 ----------

interface ThemeSetting {
  dark: boolean;
  followsSystem: boolean;
  /** true/false = 직접 설정, null = 휴대폰 설정 따르기 */
  setDark: (value: boolean | null) => void;
}

const ThemeContext = createContext<ThemeSetting>({ dark: false, followsSystem: true, setDark: () => {} });
const THEME_KEY = "dark_mode";

function loadThemePreference(): boolean | null {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    return saved === null ? null : saved === "true";
  } catch {
    return null;
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [override, setOverride] = useState<boolean | null>(loadThemePreference);
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const [systemDark, setSystemDark] = useState(media.matches);
  useEffect(() => {
    const update = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [media]);

  const dark = override ?? systemDark;
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#141218" : "#5B4B8A");
  }, [dark]);

  const setDark = (value: boolean | null) => {
    setOverride(value);
    try {
      if (value === null) localStorage.removeItem(THEME_KEY);
      else localStorage.setItem(THEME_KEY, String(value));
    } catch {
      // 저장하지 못해도 지금 화면에는 반영된다.
    }
  };

  return <ThemeContext.Provider value={{ dark, followsSystem: override === null, setDark }}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);

// ---------- 확인 대화상자 ----------

/** @param wide 시간표처럼 넓은 내용을 보여 줄 때 화면을 거의 다 쓴다. */
export function Dialog({
  title,
  children,
  actions,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  actions: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className={`dialog ${wide ? "wide" : ""}`} role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <h2 style={{ margin: 0 }}>{title}</h2>
        {children}
        <div className="actions">{actions}</div>
      </div>
    </div>
  );
}

/** 고르는 버튼 묶음 (보스, 난이도, 수수료 등) */
export function Chips<T extends string | number>({
  options,
  selected,
  onSelect,
  disabled,
}: {
  options: { value: T; label: string; disabled?: boolean }[];
  selected: T | T[];
  onSelect: (value: T) => void;
  disabled?: boolean;
}) {
  const isSelected = (value: T) => (Array.isArray(selected) ? selected.includes(value) : selected === value);
  return (
    <div className="row wrap">
      {options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          className="chip"
          aria-pressed={isSelected(option.value)}
          disabled={disabled || option.disabled}
          onClick={() => onSelect(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
