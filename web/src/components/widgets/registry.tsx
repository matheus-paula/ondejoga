import type { ComponentType } from 'react';
import type { WidgetType } from '../../api/types';
import { MyTeamWidget } from './MyTeamWidget';
import { TeamHeaderWidget } from './TeamHeaderWidget';
import { NextMatchWidget } from './NextMatchWidget';
import { LastMatchWidget } from './LastMatchWidget';
import { LiveMatchWidget } from './LiveMatchWidget';
import { StandingsWidget } from './StandingsWidget';
import { NewsWidget } from './NewsWidget';
import { StatsWidget } from './StatsWidget';
import { FormWidget } from './FormWidget';
import { WidgetShell } from './WidgetShell';
import { EmptyState } from '../ui/States';
import type { WidgetProps } from './types';

/** Registro: `type` do contrato -> componente. */
export const WIDGET_REGISTRY: Record<WidgetType, ComponentType<WidgetProps>> = {
  my_team: MyTeamWidget,
  team_header: TeamHeaderWidget, // legado (fundido em my_team)
  next_match: NextMatchWidget,
  last_match: LastMatchWidget,
  live_match: LiveMatchWidget,
  standings: StandingsWidget,
  news: NewsWidget,
  stats: StatsWidget, // legado (fundido em my_team)
  form: FormWidget,
};

export function UnknownWidget({ widget }: Pick<WidgetProps, 'widget'>) {
  return (
    <WidgetShell title={widget.title || widget.type}>
      <EmptyState message={`Widget desconhecido: ${widget.type}`} />
    </WidgetShell>
  );
}
