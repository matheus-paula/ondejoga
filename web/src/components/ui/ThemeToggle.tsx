import { useId } from 'react';
import type { ThemePref } from '../../api/types';
import { useTheme } from '../../context/ThemeContext';
import { Icon, type IconName } from './Icon';

const OPTIONS: Array<{ value: ThemePref; label: string; icon: IconName }> = [
  { value: 'system', label: 'Sistema', icon: 'monitor' },
  { value: 'light', label: 'Claro', icon: 'sun' },
  { value: 'dark', label: 'Escuro', icon: 'moon' },
];

/* Controle segmentado: um `fieldset` de pílulas com o rádio escondido dentro
   de cada opção. O anel de foco vem do `:has`, porque o próprio rádio está
   invisível — sem isso quem navega por teclado não veria onde está. */
const OPTION_BASE =
  'relative inline-flex cursor-pointer items-center justify-center rounded-full ' +
  'px-3 py-[5px] text-[0.82rem] font-semibold transition-colors ' +
  '[&:has(input:focus-visible)]:outline-2 ' +
  '[&:has(input:focus-visible)]:outline-[var(--focus-ring)] ' +
  '[&:has(input:focus-visible)]:outline-offset-1';
const OPTION_ACTIVE = 'bg-surface text-ink shadow-[0_1px_2px_rgba(0,0,0,0.16)]';
const OPTION_IDLE = 'text-muted';

interface Props {
  /** Chamado além da aplicação imediata do tema (ex.: sincronizar o rascunho de layout). */
  onSelect?: (pref: ThemePref) => void;
}

export function ThemeToggle({ onSelect }: Props) {
  const { pref, setPref } = useTheme();
  // Uma instância por grupo: painel e Configurações podem existir ao mesmo
  // tempo na página e dois grupos com o mesmo `name` se misturariam.
  const groupName = `theme-preference-${useId()}`;

  return (
    <fieldset
      data-testid="theme-toggle"
      className="m-0 inline-flex rounded-full border border-line bg-surface-2 p-0.5"
    >
      <legend className="sr-only">Tema do painel</legend>
      {OPTIONS.map((option) => (
        <label
          key={option.value}
          className={`${OPTION_BASE} ${pref === option.value ? OPTION_ACTIVE : OPTION_IDLE}`}
        >
          <input
            type="radio"
            name={groupName}
            value={option.value}
            checked={pref === option.value}
            className="absolute inset-0 m-0 cursor-pointer opacity-0"
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
