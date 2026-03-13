import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export type Language = 'en' | 'zh-CN';

interface I18nContextValue {
  language: Language;
  isChinese: boolean;
  setLanguage: (language: Language) => void;
}

const STORAGE_KEY = 'cli-run-ui.language';

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<Language>(() => detectInitialLanguage());

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, language);
    }
    document.documentElement.lang = language;
  }, [language]);

  const value = useMemo(
    () => ({
      language,
      isChinese: language === 'zh-CN',
      setLanguage,
    }),
    [language]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error('useI18n must be used within I18nProvider.');
  }
  return context;
}

export function formatCompactNumber(value: number, language: Language): string {
  return new Intl.NumberFormat(language, {
    notation: value >= 1000 ? 'compact' : 'standard',
    maximumFractionDigits: 1,
  }).format(value);
}

export function formatRelativeTime(timestampMs: number, language: Language): string {
  const diff = Date.now() - timestampMs;
  if (language === 'zh-CN') {
    if (diff < 60_000) return '刚刚';
    if (diff < 3_600_000) return `${Math.round(diff / 60_000)} 分钟前`;
    if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)} 小时前`;
    return `${Math.round(diff / 86_400_000)} 天前`;
  }

  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h ago`;
  return `${Math.round(diff / 86_400_000)}d ago`;
}

export function formatDateTime(timestampMs: number, language: Language): string {
  return new Intl.DateTimeFormat(language, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(timestampMs);
}

export function formatShortDateTime(timestampMs: number, language: Language): string {
  return new Intl.DateTimeFormat(language, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(timestampMs);
}

function detectInitialLanguage(): Language {
  if (typeof window === 'undefined') return 'en';

  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === 'en' || stored === 'zh-CN') {
    return stored;
  }

  const locale = window.navigator.language.toLowerCase();
  return locale.startsWith('zh') ? 'zh-CN' : 'en';
}
