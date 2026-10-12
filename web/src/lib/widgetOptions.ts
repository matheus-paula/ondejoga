// Helpers para ler `options` dos widgets de forma tipada (options é livre no contrato).

import type { WidgetOptions } from '../api/types';

export function optBool(options: WidgetOptions, key: string, fallback: boolean): boolean {
  const value = options[key];
  return typeof value === 'boolean' ? value : fallback;
}

export function optNumber(
  options: WidgetOptions,
  key: string,
  fallback: number,
  min = 1,
): number {
  const value = options[key];
  if (typeof value === 'number' && Number.isFinite(value) && value >= min) return value;
  return fallback;
}

export function optStringArray(options: WidgetOptions, key: string): string[] {
  const value = options[key];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.length > 0);
}

/** Chaves de métricas do widget `stats` (padrão: todas). */
export const STATS_METRIC_KEYS = [
  'position',
  'points',
  'played',
  'record',
  'goals_for',
  'goals_against',
  'goal_difference',
  'win_rate',
  'avg_goals',
  'clean_sheets',
] as const;

export type StatsMetricKey = (typeof STATS_METRIC_KEYS)[number];
