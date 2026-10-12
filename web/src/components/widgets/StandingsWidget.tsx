import { useMemo, useState } from 'react';
import { WidgetShell } from './WidgetShell';
import { EmptyState } from '../ui/States';
import { formLetter, isOurTeam, withAlpha } from '../../lib/format';
import { competitionKindLabel } from '../../lib/labels';
import { optBool, optNumber, optStringArray } from '../../lib/widgetOptions';
import type {
  BracketTie,
  MatchTeam,
  StandingRow,
  StandingsTable,
  TeamConfig,
} from '../../api/types';
import type { WidgetProps } from './types';

interface Column {
  key: string;
  short: string;
  full: string;
}

const COLUMNS: Column[] = [
  { key: 'played', short: 'J', full: 'Jogos' },
  { key: 'won', short: 'V', full: 'Vitórias' },
  { key: 'drawn', short: 'E', full: 'Empates' },
  { key: 'lost', short: 'D', full: 'Derrotas' },
  { key: 'goals_for', short: 'GP', full: 'Gols pró' },
  { key: 'goals_against', short: 'GC', full: 'Gols contra' },
  { key: 'goal_difference', short: 'SG', full: 'Saldo de gols' },
  { key: 'points', short: 'P', full: 'Pontos' },
];

const ROW_HEIGHT = 40;

function cellValue(row: StandingRow, key: string): number {
  switch (key) {
    case 'played':
      return row.played;
    case 'won':
      return row.won;
    case 'drawn':
      return row.drawn;
    case 'lost':
      return row.lost;
    case 'goals_for':
      return row.goals_for;
    case 'goals_against':
      return row.goals_against;
    case 'goal_difference':
      return row.goal_difference;
    case 'points':
      return row.points;
    default:
      return 0;
  }
}

function FormStrip({ form }: { form: string | null | undefined }) {
  if (!form) return <span className="muted">—</span>;
  const letters = form.split('').filter((letter) => letter.trim() !== '');
  if (letters.length === 0) return <span className="muted">—</span>;
  return (
    <span className="form-strip">
      {letters.map((letter, index) => {
        const result = formLetter(letter);
        const title =
          result === 'V'
            ? 'Vitória'
            : result === 'E'
              ? 'Empate'
              : result === 'D'
                ? 'Derrota'
                : letter;
        return (
          <span
            key={`${letter}-${index}`}
            className={`form-dot${result ? ` form-dot--${result.toLowerCase()}` : ' form-dot--unknown'}`}
            title={title}
          >
            {result ?? letter}
          </span>
        );
      })}
    </span>
  );
}

function isTeamRow(row: StandingRow, table: StandingsTable, team: TeamConfig): boolean {
  if (table.highlight_team_id) return String(row.team.id) === String(table.highlight_team_id);
  return isOurTeam(row.team, team);
}

function formatUpdated(iso: string, locale: string, timezone: string): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: timezone,
  }).format(new Date(iso));
}

/* -------------------------------------------------------------------------- */
/* Abas                                                                       */
/* -------------------------------------------------------------------------- */

function TabBar({
  label,
  items,
  activeKey,
  onSelect,
}: {
  label: string;
  items: [string, string][];
  activeKey: string;
  onSelect: (key: string) => void;
}) {
  if (items.length <= 1) return null;
  return (
    <div className="standings-tabs" role="tablist" aria-label={label}>
      {items.map(([key, text]) => {
        const selected = key === activeKey;
        return (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={selected}
            className={`standings-tab${selected ? ' is-active' : ''}`}
            onClick={() => onSelect(key)}
          >
            {text}
          </button>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Mata-mata                                                                  */
/* -------------------------------------------------------------------------- */

function BracketSide({
  team,
  align,
  highlight,
  winner,
}: {
  team: MatchTeam;
  align: 'left' | 'right';
  highlight: boolean;
  winner: boolean;
}) {
  return (
    <span
      className={`bracket-side bracket-side--${align}${highlight ? ' is-team' : ''}${winner ? ' is-winner' : ''}`}
    >
      {team.logo ? (
        <img src={team.logo} alt="" width={20} height={20} loading="lazy" />
      ) : null}
      <span className="bracket-team-name">{team.name}</span>
    </span>
  );
}

/** Uma linha de chave: equipe A × equipe B com placar agregado e pênaltis. */
function BracketRow({
  tie,
  team,
  highlightColor,
}: {
  tie: BracketTie;
  team: TeamConfig;
  highlightColor: string;
}) {
  const highlight = (side: MatchTeam) => isOurTeam(side, team);
  const score = tie.aggregate ?? '–';

  return (
    <li
      className={`bracket-tie${tie.decided ? ' is-decided' : ''}`}
      style={
        highlight(tie.home) || highlight(tie.away)
          ? { backgroundColor: withAlpha(highlightColor, 0.1) }
          : undefined
      }
    >
      {tie.label ? <span className="bracket-label">{tie.label}</span> : null}
      <BracketSide
        team={tie.home}
        align="left"
        highlight={highlight(tie.home)}
        winner={tie.winner === 'home'}
      />
      <span className="bracket-score">
        <strong>{score}</strong>
        {tie.penalties ? <small className="bracket-pens">({tie.penalties} p)</small> : null}
        {!tie.decided ? <small className="bracket-pending">a definir</small> : null}
      </span>
      <BracketSide
        team={tie.away}
        align="right"
        highlight={highlight(tie.away)}
        winner={tie.winner === 'away'}
      />
      {tie.legs && tie.legs.length > 0 ? (
        <span className="bracket-legs muted">{tie.legs.join(' · ')}</span>
      ) : null}
    </li>
  );
}

function BracketList({
  table,
  team,
  highlightColor,
}: {
  table: StandingsTable;
  team: TeamConfig;
  highlightColor: string;
}) {
  const ties = table.bracket ?? [];
  if (ties.length === 0) {
    return <EmptyState message="Confrontos ainda não divulgados." />;
  }
  return (
    <ul className="bracket">
      {ties.map((tie, index) => (
        <BracketRow
          key={`${tie.home.name}-${tie.away.name}-${index}`}
          tie={tie}
          team={team}
          highlightColor={highlightColor}
        />
      ))}
    </ul>
  );
}

/* -------------------------------------------------------------------------- */
/* Cabeçalho                                                                  */
/* -------------------------------------------------------------------------- */

/** Linha de detalhe do cabeçalho: grupo > fase > fase atual do time. */
function headerDetail(table: StandingsTable): string | null {
  if (table.group) return table.group;
  const stage = table.stage;
  const current = table.team_stage;
  if (stage && current && stage !== current) return `${stage} · fase atual: ${current}`;
  if (stage) return `Fase atual: ${stage}`;
  if (current) return `Fase atual: ${current}`;
  return null;
}

/** Cabeçalho descrevendo de qual competição/fase se trata a tabela. */
function TableHeader({ table }: { table: StandingsTable }) {
  const kind = competitionKindLabel(table.kind ?? table.competition.kind);
  const detail = headerDetail(table);

  return (
    <div className="standings-head">
      {table.competition.logo ? (
        <img
          src={table.competition.logo}
          alt=""
          width={26}
          height={26}
          className="standings-head-logo"
          loading="lazy"
        />
      ) : null}
      <div className="standings-head-text">
        <p className="standings-head-title">{table.competition.name}</p>
        <p className="standings-head-meta">
          {[kind, detail, table.season ? `temporada ${table.season}` : null]
            .filter(Boolean)
            .join(' · ')}
        </p>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Agrupamento das tabelas                                                    */
/* -------------------------------------------------------------------------- */

interface CompetitionEntry {
  key: string;
  tables: StandingsTable[];
}

function competitionKey(table: StandingsTable): string {
  return String(table.competition.id ?? table.competition.name);
}

/** Agrupa por competição, depois por fase, preservando a ordem do torneio. */
function byPhase(tables: StandingsTable[]): Map<string, StandingsTable[]> {
  const map = new Map<string, StandingsTable[]>();
  for (const table of tables) {
    const key = table.phase ?? '';
    const bucket = map.get(key);
    if (bucket) bucket.push(table);
    else map.set(key, [table]);
  }
  return new Map(
    [...map.entries()].sort((a, b) => {
      const orderA = a[1][0].phase_order;
      const orderB = b[1][0].phase_order;
      const rankA = orderA ?? Number.MAX_SAFE_INTEGER;
      const rankB = orderB ?? Number.MAX_SAFE_INTEGER;
      if (rankA !== rankB) return rankA - rankB;
      return a[0].localeCompare(b[0], 'pt-BR');
    }),
  );
}

/**
 * Widget "Tabelas".
 *
 * Navegação em três níveis: competição → fase (mata-mata) → grupo.
 * As competições em que o time já foi eliminado ficam ocultas por padrão
 * (`hide_eliminated`), e a fase ativa é sempre a fase atual do time.
 */
export function StandingsWidget({ widget, data, config }: WidgetProps) {
  const allowed = optStringArray(widget.options, 'competitions');
  const maxRows = optNumber(widget.options, 'max_rows', 20);
  const hideEliminated = optBool(widget.options, 'hide_eliminated', true);

  const [activeCompKey, setActiveCompKey] = useState<string | null>(null);
  const [activePhase, setActivePhase] = useState<string | null>(null);
  const [activeGroup, setActiveGroup] = useState<string | null>(null);

  const competitions: CompetitionEntry[] = useMemo(() => {
    const visible = (data.standings ?? []).filter(
      (table) =>
        (allowed.length === 0 || allowed.includes(String(table.competition.id))) &&
        (!hideEliminated || table.team_alive !== false),
    );
    const map = new Map<string, StandingsTable[]>();
    for (const table of visible) {
      const key = competitionKey(table);
      const bucket = map.get(key);
      if (bucket) bucket.push(table);
      else map.set(key, [table]);
    }
    return [...map.entries()].map(([key, tables]) => ({ key, tables }));
  }, [data.standings, allowed, hideEliminated]);

  const comp =
    competitions.find((entry) => entry.key === activeCompKey) ?? competitions[0] ?? null;

  const phaseMap = useMemo(() => (comp ? byPhase(comp.tables) : new Map<string, StandingsTable[]>()), [comp]);
  const phaseKeys = [...phaseMap.keys()];

  const currentPhaseKey =
    phaseKeys.find((key) => (phaseMap.get(key) ?? []).some((table) => table.is_current)) ??
    (phaseKeys.length > 0 ? phaseKeys[phaseKeys.length - 1] : '');
  const phaseKey =
    activePhase !== null && phaseMap.has(activePhase) ? activePhase : currentPhaseKey;
  const phaseTables = phaseMap.get(phaseKey) ?? [];

  // Dentro de uma fase com vários grupos, o padrão é o grupo do nosso time.
  const team = data.team ?? config.team;
  const groupTables = phaseTables.filter((table) => table.group);
  const defaultGroup =
    groupTables.find((table) => table.rows.some((row) => isTeamRow(row, table, team))) ??
    groupTables[0] ??
    null;
  const active =
    (activeGroup ? groupTables.find((table) => table.group === activeGroup) : null) ??
    defaultGroup ??
    phaseTables[0] ??
    null;

  const highlightColor = team.primary_color ?? '#0093EC';
  const hasBracket = Boolean(active && (active.bracket?.length ?? 0) > 0);
  const isEmptyCupStage = Boolean(active && active.rows.length === 0 && !hasBracket && active.stage);

  return (
    <WidgetShell title={widget.title || 'Tabelas'} className="standings">
      {!active ? (
        <EmptyState message="Nenhuma tabela disponível." />
      ) : (
        <>
          <TabBar
            label="Competições"
            items={competitions.map((entry) => [
              entry.key,
              entry.tables[0]?.competition.name ?? entry.key,
            ])}
            activeKey={comp ? comp.key : ''}
            onSelect={(key) => {
              setActiveCompKey(key);
              setActivePhase(null);
              setActiveGroup(null);
            }}
          />

          <TableHeader table={active} />

          <TabBar
            label="Fases"
            items={phaseKeys.map((key) => [key, key])}
            activeKey={phaseKey}
            onSelect={(key) => {
              setActivePhase(key);
              setActiveGroup(null);
            }}
          />

          <TabBar
            label="Grupos"
            items={groupTables.map((table) => [table.group ?? '', table.group ?? ''])}
            activeKey={active.group ?? ''}
            onSelect={(key) => setActiveGroup(key)}
          />

          {hasBracket ? (
            <BracketList table={active} team={team} highlightColor={highlightColor} />
          ) : isEmptyCupStage ? (
            <p className="standings-stage">
              <strong>{active.stage}</strong>
              <span className="muted"> — mata-mata: a fase é exibida porque não há tabela de classificação.</span>
            </p>
          ) : (
            <div
              className="standings-scroll"
              style={{ maxHeight: `${maxRows * ROW_HEIGHT + 44}px` }}
            >
              <table className="standings-table">
                <caption className="sr-only">
                  {active.description ?? `Classificação — ${active.competition.name}`}
                </caption>
                <thead>
                  <tr>
                    <th scope="col" title="Posição">
                      <span aria-hidden="true">Pos</span>
                      <span className="sr-only">Posição</span>
                    </th>
                    <th scope="col" className="col-team">
                      Time
                    </th>
                    {COLUMNS.map((column) => (
                      <th scope="col" key={column.key} title={column.full}>
                        <span aria-hidden="true">{column.short}</span>
                        <span className="sr-only">{column.full}</span>
                      </th>
                    ))}
                    <th scope="col" title="Últimos resultados">
                      <span aria-hidden="true">Últ.</span>
                      <span className="sr-only">Últimos resultados</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {active.rows.map((row) => {
                    const highlighted = isTeamRow(row, active, team);
                    return (
                      <tr
                        key={`${row.team.id ?? row.team.name}-${row.position}`}
                        className={highlighted ? 'standings-row is-team' : 'standings-row'}
                        style={
                          highlighted
                            ? { backgroundColor: withAlpha(highlightColor, 0.16) }
                            : undefined
                        }
                      >
                        <th scope="row" className="col-pos">
                          {row.position}
                        </th>
                        <td className="col-team">
                          {row.team.logo ? (
                            <img src={row.team.logo} alt="" width={20} height={20} loading="lazy" />
                          ) : null}
                          <span className="standings-team-name">{row.team.name}</span>
                          {row.note ? (
                            <small className="standings-note" title={row.note}>
                              •
                            </small>
                          ) : null}
                        </td>
                        {COLUMNS.map((column) => (
                          <td key={column.key} className={`col-${column.key}`}>
                            {cellValue(row, column.key)}
                          </td>
                        ))}
                        <td className="col-form">
                          <FormStrip form={row.form} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <p className="standings-footer muted">
            {active.rows.length > 0
              ? `${active.rows.length} time${active.rows.length === 1 ? '' : 's'}`
              : hasBracket
                ? `${active.bracket?.length ?? 0} confronto${(active.bracket?.length ?? 0) === 1 ? '' : 's'}`
                : 'Sem classificação'}
            {active.updated_at
              ? ` · dados de ${formatUpdated(active.updated_at, config.locale, config.timezone)}`
              : ''}
          </p>
        </>
      )}
    </WidgetShell>
  );
}
