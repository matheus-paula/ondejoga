import type { ThemePref } from '../../api/types';
import { useTheme } from '../../context/ThemeContext';
import { Icon, type IconName } from './Icon';

const OPTIONS: Array<{ value: ThemePref; label: string; icon: IconName }> = [
  { value: 'system', label: 'Sistema', icon: 'monitor' },
  { value: 'light', label: 'Claro', icon: 'sun' },
  { value: 'dark', label: 'Escuro', icon: 'moon' },
];

interface Props {
  /** Chamado além da aplicação imediata do tema (ex.: sincronizar o rascunho de layout). */
  onSelect?: (pref: ThemePref) => void;
}

export function ThemeToggle({ onSelect }: Props) {
  const { pref, setPref } = useTheme();

  return (
    <fieldset className="theme-toggle">
      <legend className="sr-only">Tema do painel</legend>
      {OPTIONS.map((option) => (
        <label
          key={option.value}
          className={`theme-toggle-option${pref === option.value ? ' is-active' : ''}`}
        >
          <input
            type="radio"
            name="theme-preference"
            value={option.value}
            checked={pref === option.value}
            onChange={() => {
              setPref(option.value);
              onSelect?.(option.value);
            }}
          />
          <Icon name={option.icon} size={14} />
          {option.label}
        </label>
      ))}
    </fieldset>
  );
}
