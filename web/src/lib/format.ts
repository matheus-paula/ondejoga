// Helpers de formatação (datas em pt-BR com timezone configurável) e utilitários de time.

import type { MatchTeam, TeamConfig } from '../api/types';

export const DEFAULT_LOCALE = 'pt-BR';
export const DEFAULT_TIMEZONE = 'America/Sao_Paulo';

function safeDate(iso?: string | null): Date | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDate(
  iso: string | null | undefined,
  locale = DEFAULT_LOCALE,
  timezone = DEFAULT_TIMEZONE,
  options: Intl.DateTimeFormatOptions = { dateStyle: 'long' },
): string {
  const date = safeDate(iso);
  if (!date) return 'Data a definir';
  return new Intl.DateTimeFormat(locale, { ...options, timeZone: timezone }).format(date);
}

export function formatShortDate(
  iso: string | null | undefined,
  locale = DEFAULT_LOCALE,
  timezone = DEFAULT_TIMEZONE,
): string {
  return formatDate(iso, locale, timezone, { day: '2-digit', month: 'short' });
}

export function formatTime(
  iso: string | null | undefined,
  locale = DEFAULT_LOCALE,
  timezone = DEFAULT_TIMEZONE,
): string {
  return formatDate(iso, locale, timezone, { timeStyle: 'short' });
}

export function formatDateTime(
  iso: string | null | undefined,
  locale = DEFAULT_LOCALE,
  timezone = DEFAULT_TIMEZONE,
): string {
  const date = safeDate(iso);
  if (!date) return 'Data a definir';
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: timezone,
  }).format(date);
}

/** "há 2 horas" / "daqui a 3 dias" — pt-BR por padrão. */
export function relativeTime(
  iso: string | null | undefined,
  locale = DEFAULT_LOCALE,
  now: number = Date.now(),
): string {
  const date = safeDate(iso);
  if (!date) return '';
  const diffSeconds = Math.round((date.getTime() - now) / 1000);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['year', 60 * 60 * 24 * 365],
    ['month', 60 * 60 * 24 * 30],
    ['day', 60 * 60 * 24],
    ['hour', 60 * 60],
    ['minute', 60],
    ['second', 1],
  ];
  for (const [unit, seconds] of units) {
    if (Math.abs(diffSeconds) >= seconds || unit === 'second') {
      return rtf.format(Math.round(diffSeconds / seconds), unit);
    }
  }
  return '';
}

/** Contagem regressiva curta: "faltam 2d 3h", "faltam 45min", "faltam 8s". */
export function countdownLabel(iso: string | null | undefined, now: number = Date.now()): string {
  const date = safeDate(iso);
  if (!date) return '';
  const diff = date.getTime() - now;
  if (diff <= 0) return 'começou agora';
  const totalMinutes = Math.floor(diff / 60000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `faltam ${days}d ${hours}h`;
  if (hours > 0) return `faltam ${hours}h ${minutes}min`;
  if (minutes > 0) return `faltam ${minutes}min`;
  return `faltam ${Math.max(0, Math.floor(diff / 1000))}s`;
}

/** "atualizado há 12s" — usado no header. */
export function updatedAgoLabel(timestamp: number | null, now: number = Date.now()): string {
  if (!timestamp) return '';
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
  if (seconds < 60) return `atualizado há ${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `atualizado há ${minutes}min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `atualizado há ${hours}h`;
  return `atualizado há ${Math.floor(hours / 24)}d`;
}

/* ---------- time ---------- */

function normalizeName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/gi, '')
    .toLowerCase();
}

/** Confronta um lado de jogo com o time configurado (por id conhecido ou nome). */
export function isOurTeam(side: MatchTeam | null | undefined, team: TeamConfig): boolean {
  if (!side) return false;
  const ids = team.ids ?? {};
  const sideId = side.id ? String(side.id) : '';
  if (sideId && Object.values(ids).some((value) => value && String(value) === sideId)) return true;
  const names = [team.name, team.short_name]
    .filter((value): value is string => Boolean(value))
    .map(normalizeName);
  return names.includes(normalizeName(side.name));
}

/** Resultado do ponto de vista do time: 'V' | 'E' | 'D' (null quando não é nosso jogo). */
export function resultFromOurPerspective(
  home: MatchTeam | null | undefined,
  away: MatchTeam | null | undefined,
  team: TeamConfig,
): 'V' | 'E' | 'D' | null {
  if (!home || !away || home.score == null || away.score == null) return null;
  const weAreHome = isOurTeam(home, team);
  if (!weAreHome && !isOurTeam(away, team)) return null;
  const our = weAreHome ? home.score : away.score;
  const their = weAreHome ? away.score : home.score;
  if (our > their) return 'V';
  if (our < their) return 'D';
  return 'E';
}

export const RESULT_LABEL: Record<'V' | 'E' | 'D', string> = {
  V: 'Vitória',
  E: 'Empate',
  D: 'Derrota',
};

/** Converte letras de sequência (W/D/L, usadas pela API) em V/E/D. */
export function formLetter(letter: string): 'V' | 'E' | 'D' | null {
  const upper = letter.trim().toUpperCase();
  if (upper === 'W' || upper === 'V') return 'V';
  if (upper === 'D' || upper === 'E') return 'E';
  if (upper === 'L' || upper === 'P') return 'D';
  return null;
}

export function ordinalPosition(position: number | null | undefined): string {
  if (position == null || Number.isNaN(position)) return '—';
  return `${position}º`;
}

export function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

/** Adiciona alpha a uma cor hex (#RRGGBB) de forma simples para destaques. */
export function withAlpha(hex: string, alpha: number): string {
  const clean = hex.replace('#', '');
  if (clean.length !== 6) return hex;
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  if ([r, g, b].some((v) => Number.isNaN(v))) return hex;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Formata um JSON para exibição no painel de administração. */
export function prettyJson(value: unknown): string {
  if (value == null) return '—';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
