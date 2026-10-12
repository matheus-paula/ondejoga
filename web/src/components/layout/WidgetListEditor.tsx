import { useRef, useState } from 'react';
import { useLayout } from '../../context/LayoutContext';
import type { LayoutWidget, WidgetSize } from '../../api/types';
import { Switch } from '../ui/Switch';
import { Icon } from '../ui/Icon';
import { LoadingLabel } from '../ui/States';
import { WidgetOptionsEditor } from './WidgetOptionsEditor';
import { widgetTypeLabel } from '../../lib/labels';

const SIZES: WidgetSize[] = ['sm', 'md', 'lg', 'full'];
const SIZE_LABELS: Record<WidgetSize, string> = {
  sm: 'sm (1 coluna)',
  md: 'md (2 colunas)',
  lg: 'lg (2 colunas)',
  full: 'full (largura total)',
};

function WidgetRow({
  widget,
  index,
  total,
  expanded,
  onToggleExpanded,
  onDragStart,
  onDragEnter,
  onDrop,
  isDragOver,
}: {
  widget: LayoutWidget;
  index: number;
  total: number;
  expanded: boolean;
  onToggleExpanded: () => void;
  onDragStart: () => void;
  onDragEnter: () => void;
  onDrop: () => void;
  isDragOver: boolean;
}) {
  const { setWidgetVisible, setWidgetTitle, setWidgetSize, moveWidget } = useLayout();
  const optionsId = `${widget.id}-options`;

  return (
    <li
      className={`drawer-widget${isDragOver ? ' is-drag-over' : ''}`}
      draggable
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = 'move';
        onDragStart();
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragEnter={(event) => {
        event.preventDefault();
        onDragEnter();
      }}
      onDrop={(event) => {
        event.preventDefault();
        onDrop();
      }}
    >
      <div className="drawer-widget-row">
        <span className="drag-handle" aria-hidden="true" title="Arraste para reordenar">
          ⠿
        </span>
        <Switch
          checked={widget.visible}
          onChange={(value) => setWidgetVisible(widget.id, value)}
          label={`Exibir widget ${widget.title || widgetTypeLabel(widget.type)}`}
        />
        <div className="drawer-widget-fields">
          <label className="field field--inline">
            <span>Título</span>
            <input
              type="text"
              value={widget.title}
              aria-label={`Título do widget ${widgetTypeLabel(widget.type)}`}
              onChange={(event) => setWidgetTitle(widget.id, event.target.value)}
            />
          </label>
          <label className="field field--inline">
            <span>Tamanho</span>
            <select
              value={widget.size}
              aria-label={`Tamanho do widget ${widgetTypeLabel(widget.type)}`}
              onChange={(event) => setWidgetSize(widget.id, event.target.value as WidgetSize)}
            >
              {SIZES.map((size) => (
                <option key={size} value={size}>
                  {SIZE_LABELS[size]}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="drawer-widget-actions">
          <button
            type="button"
            className="btn btn--icon"
            aria-label={`Mover widget ${widget.title || widgetTypeLabel(widget.type)} para cima`}
            disabled={index === 0}
            onClick={() => moveWidget(widget.id, -1)}
          >
            <Icon name="chevronUp" size={16} />
          </button>
          <button
            type="button"
            className="btn btn--icon"
            aria-label={`Mover widget ${widget.title || widgetTypeLabel(widget.type)} para baixo`}
            disabled={index === total - 1}
            onClick={() => moveWidget(widget.id, 1)}
          >
            <Icon name="chevronDown" size={16} />
          </button>
          <button
            type="button"
            className="btn btn--ghost btn--small"
            aria-expanded={expanded}
            aria-controls={optionsId}
            onClick={onToggleExpanded}
          >
            Opções
          </button>
        </div>
      </div>
      <div id={optionsId} hidden={!expanded}>
        <WidgetOptionsEditor widget={widget} />
      </div>
    </li>
  );
}

/**
 * Lista de widgets do painel: visibilidade, título, tamanho, ordem (arrastar
 * ou setas) e opções de cada card. As alterações são otimistas no rascunho do
 * `LayoutContext` — quem salva é a tela de Configurações.
 */
export function WidgetListEditor() {
  const layout = useLayout();
  const dragIndexRef = useRef<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { draft } = layout;
  if (!draft) return <LoadingLabel text="Carregando widgets…" />;

  return (
    <ul className="drawer-widget-list" data-testid="widget-list">
      {draft.widgets.map((widget, index) => (
        <WidgetRow
          key={widget.id}
          widget={widget}
          index={index}
          total={draft.widgets.length}
          expanded={expandedId === widget.id}
          onToggleExpanded={() =>
            setExpandedId((current) => (current === widget.id ? null : widget.id))
          }
          onDragStart={() => {
            dragIndexRef.current = index;
          }}
          onDragEnter={() => setDragOverIndex(index)}
          onDrop={() => {
            const from = dragIndexRef.current;
            if (from != null && from !== index) layout.reorderWidgets(from, index);
            dragIndexRef.current = null;
            setDragOverIndex(null);
          }}
          isDragOver={dragOverIndex === index}
        />
      ))}
    </ul>
  );
}
