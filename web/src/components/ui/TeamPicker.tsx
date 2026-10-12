import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { api, ApiError } from '../../api/client';
import type { AppConfig, TeamCandidate } from '../../api/types';
import { Icon } from './Icon';

/** Espera antes de consultar a API enquanto o usuário digita. */
const DEBOUNCE_MS = 350;
/** Sempre com 2+ letras (mesma regra do backend). */
const MIN_QUERY = 2;

interface TeamPickerProps {
  /** Depois que o time foi escolhido e salvo (a config devolvida vem pronta). */
  onSaved: (config: AppConfig) => void;
  /** Foca o campo de busca ao montar (usado no onboarding). */
  autoFocus?: boolean;
  /** Rótulo do botão de confirmação (padrão: "Usar este time"). */
  confirmLabel?: string;
  /** Enquanto salva, o botão fica ocupado e o rótulo muda. */
  savingLabel?: string;
}

/**
 * Busca e seleciona o time do usuário (onboarding + Configurações → Time).
 *
 * Passos: digitar → escolher na lista → confirmar. O backend salva a config
 * particular do usuário (e o nome do time na conta) e devolve tudo pronto.
 */
export function TeamPicker({
  onSaved,
  autoFocus = false,
  confirmLabel = 'Usar este time',
  savingLabel = 'Salvando…',
}: TeamPickerProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<TeamCandidate[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<TeamCandidate | null>(null);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoFocus) {
      const timer = window.setTimeout(() => inputRef.current?.focus(), 0);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [autoFocus]);

  useEffect(() => {
    const term = query.trim();
    if (term.length < MIN_QUERY) {
      setResults([]);
      setSearching(false);
      setError(null);
      return undefined;
    }
    let active = true;
    setSearching(true);
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const { results: found } = await api.searchTeams(term);
          if (!active) return;
          setResults(found);
          setError(null);
        } catch (err) {
          if (!active) return;
          setResults([]);
          setError(err instanceof ApiError ? err.detail : 'Erro inesperado na busca.');
        } finally {
          if (active) setSearching(false);
        }
      })();
    }, DEBOUNCE_MS);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [query]);

  const confirm = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      if (!selected || saving) return;
      setSaving(true);
      setError(null);
      try {
        const config = await api.setMyTeam(selected.provider, selected.id);
        onSaved(config);
      } catch (err) {
        setError(err instanceof ApiError ? err.detail : 'Erro inesperado ao salvar o time.');
      } finally {
        setSaving(false);
      }
    },
    [onSaved, saving, selected],
  );

  const term = query.trim();

  return (
    <form className="team-picker" data-testid="team-picker" onSubmit={(e) => void confirm(e)}>
      <label className="field" htmlFor="team-search">
        <span>Buscar time</span>
        <input
          id="team-search"
          ref={inputRef}
          data-testid="team-search"
          type="search"
          autoComplete="off"
          placeholder="Ex.: Cruzeiro, Flamengo, Real Madrid…"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setSelected(null);
          }}
        />
      </label>

      <div className="team-picker-status" aria-live="polite">
        {searching ? 'Buscando times…' : null}
        {!searching && term.length < MIN_QUERY
          ? 'Digite ao menos 2 letras para procurar.'
          : null}
        {!searching && term.length >= MIN_QUERY && results.length === 0 && !error
          ? 'Nenhum time encontrado.'
          : null}
        {!searching && results.length > 0 && !selected
          ? `${results.length} time(s) — escolha um.`
          : null}
        {selected ? `Selecionado: ${selected.name}` : null}
      </div>

      {error ? (
        <p className="auth-error" role="alert">
          {error}
        </p>
      ) : null}

      {results.length > 0 ? (
        <ul className="team-picker-list" data-testid="team-results">
          {results.map((team) => {
            const isSelected = selected?.provider === team.provider && selected?.id === team.id;
            return (
              <li key={`${team.provider}:${team.id}`}>
                <button
                  type="button"
                  className={`team-picker-item${isSelected ? ' is-selected' : ''}`}
                  aria-pressed={isSelected}
                  data-testid="team-result"
                  onClick={() => setSelected(team)}
                >
                  {team.logo ? (
                    <img src={team.logo} alt="" className="team-picker-badge" loading="lazy" />
                  ) : (
                    <span className="team-picker-badge team-picker-badge--placeholder" aria-hidden="true" />
                  )}
                  <span className="team-picker-name">
                    <strong>{team.name}</strong>
                    {[team.country, team.league].filter(Boolean).join(' · ')}
                  </span>
                  {isSelected ? <Icon name="check" size={16} /> : null}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}

      <button
        type="submit"
        className="btn btn--primary btn--large team-picker-confirm"
        data-testid="team-confirm"
        disabled={!selected || saving}
      >
        <Icon name="trophy" size={16} />
        {saving ? savingLabel : confirmLabel}
      </button>
    </form>
  );
}
