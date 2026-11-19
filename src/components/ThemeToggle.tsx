import React from 'react';
import { Sun, Moon } from 'lucide-react';

export type ThemeMode = 'light' | 'dark';

interface ThemeToggleProps {
  theme: ThemeMode;
  onToggle: (next: ThemeMode) => void;
}

export const ThemeToggle: React.FC<ThemeToggleProps> = ({ theme, onToggle }) => {
  const isDark = theme === 'dark';

  return (
    <div
      role="group"
      aria-label="Theme switcher"
      className="inline-flex items-center p-0.5 rounded-full bg-[var(--sf)] border border-[var(--bd)] shadow-xs shrink-0"
    >
      <button
        type="button"
        onClick={() => onToggle('light')}
        aria-label="Day mode"
        aria-pressed={!isDark}
        title="Day mode"
        className={`w-7 h-7 rounded-full flex items-center justify-center transition-colors ${
          !isDark
            ? 'bg-[var(--rd)] text-white shadow-xs'
            : 'text-[var(--mu)] hover:text-[var(--tx)]'
        }`}
      >
        <Sun className="w-3.5 h-3.5" />
      </button>
      <button
        type="button"
        onClick={() => onToggle('dark')}
        aria-label="Night mode"
        aria-pressed={isDark}
        title="Night mode"
        className={`w-7 h-7 rounded-full flex items-center justify-center transition-colors ${
          isDark
            ? 'bg-[var(--rd)] text-white shadow-xs'
            : 'text-[var(--mu)] hover:text-[var(--tx)]'
        }`}
      >
        <Moon className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};
