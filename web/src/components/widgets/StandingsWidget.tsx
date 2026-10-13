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

/* --------------------------------------------------------------------------
   Cabeçalho e corpo da tabela.

   O cabeçalho gruda no topo do rolagem (`sticky`) e o corpo herda o resto.
   A coluna do time é a exceção: vira flex para escudo e nome caberem na mesma
   célula, e por isso tem alinhamento e quebra próprios.
   -------------------------------------------------------------------------- */

const HEAD_BASE =
  'sticky top-0 z-[1] bg-surface-2 border-b border-line px-1.5 py-2 ' +
  'text-[0.74rem] uppercase tracking-[0.04em] text-muted whitespace-nowrap';
const HEAD_CELL = `${HEAD_BASE} text-center`;
const HEAD_TEAM = `${HEAD_BASE} text-left`;

const CELL = 'px-1.5 py-2 border-b border-line text-center whitespace-nowrap';
const TEAM_CELL =
  'px-1.5 py-2 border-b border-line flex items-center gap-2 ' +
  'whitespace-normal font-semibold text-left';

/** A tabela cuida do que se repete em toda linha: hover e o fio da última. */
const TABLE =
  'w-full border-collapse text-[0.88rem] tabular-nums ' +
  '[&_tbody_tr:hover]:bg-row-hover ' +
  '[&_tbody_tr:last-child>*]:border-b-0';

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

/** Bolinha de resultado da coluna "Últ.". Tom e texto juntos, para não brigar. */
const DOT_TONE: Record<string, string> = {
  v: 'bg-[#1c9c6d] text-white',
  e: 'bg-[#8a94a6] text-white',
  d: 'bg-[#cf4438] text-white',
};

function FormStrip({ form }: { form: string | null | undefined }) {
  if (!form) return <span className="text-muted">—</span>;
  const letters = form.split('').filter((letter) => letter.trim() !== '');
  if (letters.length === 0) return <span className="text-muted">—</span>;
  return (
    <span className="inline-flex gap-[3px]">
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
        const tone = result
          ? DOT_TONE[result.toLowerCase()] ?? 'bg-muted text-white'
          : 'bg-line text-muted';
        return (
          <span
            key={`${letter}-${index}`}
            title={title}
            data-result={result?.toLowerCase() ?? 'unknown'}
            className={`inline-flex h-[17px] w-[17px] items-center justify-center rounded-full text-[0.62rem] font-extrabold ${tone}`}
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
    <div className="flex flex-wrap gap-1.5" role="tablist" aria-label={label}>
      {items.map(([key, text]) => {
        const selected = key === activeKey;
        return (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={selected}
            className={
              selected
                ? 'rounded-full border border-accent bg-accent px-3 py-[5px] text-[0.85rem] font-semibold text-white [font:inherit]'
                : 'cursor-pointer rounded-full border border-line bg-surface-2 px-3 py-[5px] text-[0.85rem] font-semibold text-muted [font:inherit]'
            }
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
      data-testid="bracket-side"
      data-self={highlight ? '' : undefined}
      data-winner={winner ? '' : undefined}
      className={
        'flex min-w-0 flex-1 basis-0 items-center gap-1.5 text-[0.88rem] ' +
        (align === 'right' ? 'flex-row-reverse text-right ' : '') +
        (highlight ? 'font-extrabold ' : 'font-semibold ')
      }
    >
      {team.logo ? (
        <img
          src={team.logo}
          alt=""
          width={20}
          height={20}
          loading="lazy"
          className="h-5 w-5 flex-none object-contain"
        />
      ) : null}
      <span
        data-testid="bracket-team-name"
        className={`truncate ${winner ? 'font-extrabold' : ''}`}
      >
        {team.name}
      </span>
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
      data-testid="bracket-tie"
      data-decided={tie.decided ? '' : undefined}
      className={
        'flex flex-wrap items-center gap-x-2.5 gap-y-1.5 border border-line rounded-ctl px-2.5 py-2 ' +
        (tie.decided ? 'bg-surface' : 'bg-surface-2')
      }
      style={
        highlight(tie.home) || highlight(tie.away)
          ? { backgroundColor: withAlpha(highlightColor, 0.1) }
          : undefined
      }
    >
      {tie.label ? (
        <span className="min-w-[2.6em] flex-none text-[0.7rem] font-extrabold uppercase tracking-[0.06em] text-muted">
          {tie.label}
        </span>
      ) : null}
      <BracketSide
        team={tie.home}
        align="left"
        highlight={highlight(tie.home)}
        winner={tie.winner === 'home'}
      />
      <span className="flex flex-none flex-col items-center leading-[1.15] tabular-nums">
        <strong className="text-[0.95rem]">{score}</strong>
        {tie.penalties ? (
          <small className="text-[0.7rem] text-muted">({tie.penalties} p)</small>
        ) : null}
        {!tie.decided ? <small className="text-[0.7rem] text-muted">a definir</small> : null}
      </span>
      <BracketSide
        team={tie.away}
        align="right"
        highlight={highlight(tie.away)}
        winner={tie.winner === 'away'}
      />
      {tie.legs && tie.legs.length > 0 ? (
        <span className="basis-full text-[0.72rem] text-muted">{tie.legs.join(' · ')}</span>
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
    <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
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
    <div className="flex items-center gap-2.5 px-0.5 py-1">
      {table.competition.logo ? (
        <img
          src={table.competition.logo}
          alt=""
          width={26}
          height={26}
          loading="lazy"
          className="flex-none rounded-md object-contain"
        />
      ) : null}
      <div className="min-w-0">
        <p data-testid="standings-title" className="m-0 text-[0.95rem] font-bold text-ink">
          {table.competition.name}
        </p>
        <p data-testid="standings-meta" className="m-0 text-[0.78rem] text-muted">
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
    <WidgetShell title={widget.title || 'Tabelas'} widget="standings">
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
            <p className="mt-2 border border-line rounded-ctl bg-surface-2 p-3 text-[0.92rem]">
              <strong>{active.stage}</strong>
              <span className="text-muted">
                {' '}
                — mata-mata: a fase é exibida porque não há tabela de classificação.
              </span>
            </p>
          ) : (
            <div
              data-testid="standings-scroll"
              className="overflow-auto rounded-ctl border border-line"
              style={{ maxHeight: `${maxRows * ROW_HEIGHT + 44}px` }}
            >
              <table data-testid="standings-table" className={TABLE}>
                <caption className="sr-only">
                  {active.description ?? `Classificação — ${active.competition.name}`}
                </caption>
                <thead>
                  <tr>
                    <th scope="col" title="Posição" className={HEAD_CELL}>
                      <span aria-hidden="true">Pos</span>
                      <span className="sr-only">Posição</span>
                    </th>
                    <th scope="col" className={HEAD_TEAM}>
                      Time
                    </th>
                    {COLUMNS.map((column) => (
                      <th scope="col" key={column.key} title={column.full} className={HEAD_CELL}>
                        <span aria-hidden="true">{column.short}</span>
                        <span className="sr-only">{column.full}</span>
                      </th>
                    ))}
                    <th scope="col" title="Últimos resultados" className={HEAD_CELL}>
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
                        // O realce é da linha inteira, por isso o descendente.
                        data-self={highlighted ? '' : undefined}
                        className={highlighted ? '[&>*]:font-extrabold' : undefined}
                        style={
                          highlighted
                            ? { backgroundColor: withAlpha(highlightColor, 0.16) }
                            : undefined
                        }
                      >
                        <th scope="row" className={CELL}>
                          {row.position}
                        </th>
                        <td className={TEAM_CELL}>
                          {row.team.logo ? (
                            <img
                              src={row.team.logo}
                              alt=""
                              width={20}
                              height={20}
                              loading="lazy"
                              className="h-5 w-5 flex-none object-contain"
                            />
                          ) : null}
                          <span>{row.team.name}</span>
                          {row.note ? (
                            <small className="cursor-help text-muted" title={row.note}>
                              •
                            </small>
                          ) : null}
                        </td>
                        {COLUMNS.map((column) => (
                          <td key={column.key} className={CELL}>
                            {cellValue(row, column.key)}
                          </td>
                        ))}
                        <td className={CELL}>
                          <FormStrip form={row.form} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <p data-testid="standings-footer" className="text-[0.78rem] text-muted">
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
