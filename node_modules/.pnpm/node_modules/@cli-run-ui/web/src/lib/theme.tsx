import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export type ThemeId = 'ocean' | 'ember' | 'forest' | 'rose';

export interface ThemeOption {
  id: ThemeId;
  label: string;
  swatch: string;
}

interface ThemeContextValue {
  theme: ThemeId;
  setTheme: (theme: ThemeId) => void;
  themes: ThemeOption[];
}

const STORAGE_KEY = 'cli-run-ui.theme';

const THEME_OPTIONS: ThemeOption[] = [
  { id: 'ocean', label: 'Ocean', swatch: 'linear-gradient(135deg,#67e8f9,#22d3ee)' },
  { id: 'ember', label: 'Ember', swatch: 'linear-gradient(135deg,#fb7185,#f59e0b)' },
  { id: 'forest', label: 'Forest', swatch: 'linear-gradient(135deg,#4ade80,#14b8a6)' },
  { id: 'rose', label: 'Rose', swatch: 'linear-gradient(135deg,#f472b6,#a78bfa)' },
];

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<ThemeId>(() => detectInitialTheme());

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, theme);
    }
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const value = useMemo(
    () => ({
      theme,
      setTheme,
      themes: THEME_OPTIONS,
    }),
    [theme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within ThemeProvider.');
  }
  return context;
}

function detectInitialTheme(): ThemeId {
  if (typeof window === 'undefined') return 'ocean';

  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === 'ocean' || stored === 'ember' || stored === 'forest' || stored === 'rose') {
    return stored;
  }

  return 'ocean';
}
