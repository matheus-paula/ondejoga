import { useId } from 'react';
import { useLayout } from '../../context/LayoutContext';
import type { LayoutWidget } from '../../api/types';
import { optBool, optNumber, optStringArray, STATS_METRIC_KEYS } from '../../lib/widgetOptions';
import { statsMetricLabel } from '../../lib/labels';

function FieldNumber({
  label,
  value,
  onChange,
  min = 0,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
}) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="number"
        min={min}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </div>
  );
}

function FieldText({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

function FieldCheck({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="field field--check">
      <input id={id} type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <label htmlFor={id}>{label}</label>
    </div>
  );
}

/** Editores de `options` por tipo de widget (conforme contrato). */
export function WidgetOptionsEditor({ widget }: { widget: LayoutWidget }) {
  const { setWidgetOption } = useLayout();
  const options = widget.options;

  switch (widget.type) {
    case 'standings':
      return (
        <div className="options-grid">
          <FieldNumber
            label="Máximo de linhas visíveis"
            value={optNumber(options, 'max_rows', 20)}
            onChange={(value) => setWidgetOption(widget.id, 'max_rows', value)}
          />
          <FieldCheck
            label="Ocultar competições em que o time foi eliminado"
            checked={optBool(options, 'hide_eliminated', true)}
            onChange={(value) => setWidgetOption(widget.id, 'hide_eliminated', value)}
          />
          <FieldText
            label="Competições (ids separadas por vírgula; vazio = todas)"
            value={optStringArray(options, 'competitions').join(', ')}
            placeholder="4351, 4332"
            onChange={(value) =>
              setWidgetOption(
                widget.id,
                'competitions',
                value
                  .split(',')
                  .map((item) => item.trim())
                  .filter(Boolean),
              )
            }
          />
        </div>
      );
    case 'news':
      return (
        <div className="options-grid">
          <FieldNumber
            label="Quantidade de notícias"
            value={optNumber(options, 'limit', 6)}
            onChange={(value) => setWidgetOption(widget.id, 'limit', value)}
          />
        </div>
      );
    case 'form':
      return (
        <div className="options-grid">
          <FieldNumber
            label="Quantidade de resultados"
            value={optNumber(options, 'limit', 5)}
            onChange={(value) => setWidgetOption(widget.id, 'limit', value)}
          />
        </div>
      );
    case 'next_match':
      return (
        <div className="options-grid">
          <FieldCheck
            label="Mostrar transmissões (TV/streaming)"
            checked={optBool(options, 'show_broadcasts', true)}
            onChange={(value) => setWidgetOption(widget.id, 'show_broadcasts', value)}
          />
          <FieldCheck
            label="Mostrar contagem regressiva"
            checked={optBool(options, 'show_countdown', true)}
            onChange={(value) => setWidgetOption(widget.id, 'show_countdown', value)}
          />
        </div>
      );
    case 'stats':
    case 'my_team': {
      const current = optStringArray(options, 'metrics');
      const selected = current.length > 0 ? current : [...STATS_METRIC_KEYS];
      const toggleMetric = (key: string, on: boolean) => {
        const next = on ? [...new Set([...selected, key])] : selected.filter((item) => item !== key);
        setWidgetOption(widget.id, 'metrics', next);
      };
      return (
        <div className="options-grid">
          <FieldCheck
            label="Mostrar gráfico de gols"
            checked={optBool(options, 'show_chart', true)}
            onChange={(value) => setWidgetOption(widget.id, 'show_chart', value)}
          />
          <FieldCheck
            label="Mostrar artilheiros"
            checked={optBool(options, 'show_top_scorers', true)}
            onChange={(value) => setWidgetOption(widget.id, 'show_top_scorers', value)}
          />
          <fieldset className="options-metrics">
            <legend>Métricas exibidas</legend>
            {STATS_METRIC_KEYS.map((key) => (
              <FieldCheck
                key={key}
                label={statsMetricLabel(key)}
                checked={selected.includes(key)}
                onChange={(on) => toggleMetric(key, on)}
              />
            ))}
          </fieldset>
        </div>
      );
    }
    case 'live_match':
      return (
        <div className="options-grid">
          <FieldCheck
            label="Mostrar período/cronômetro do jogo"
            checked={optBool(options, 'show_status', true)}
            onChange={(value) => setWidgetOption(widget.id, 'show_status', value)}
          />
          <FieldCheck
            label="Mostrar estádio"
            checked={optBool(options, 'show_venue', true)}
            onChange={(value) => setWidgetOption(widget.id, 'show_venue', value)}
          />
        </div>
      );
    default:
      return <p className="muted">Este widget não possui opções.</p>;
  }
}
