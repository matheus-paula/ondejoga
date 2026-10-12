import { useEffect, useRef, useState } from 'react';
import { ACCENT_AUTO, useLayout } from '../../context/LayoutContext';
import { useTheme } from '../../context/ThemeContext';
import type { LayoutWidget, WidgetSize } from '../../api/types';
import { Switch } from '../ui/Switch';
import { ThemeToggle } from '../ui/ThemeToggle';
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

interface DrawerProps {
  open: boolean;
  onClose: () => void;
}

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

/** Drawer lateral "Personalizar": widgets, tema, cor de destaque e intervalo de atualização. */
export function SettingsDrawer({ open, onClose }: DrawerProps) {
  const layout = useLayout();
  const { accent, setAccent, clearAccent } = useTheme();
  const dialogRef = useRef<HTMLElement>(null);
  const dragIndexRef = useRef<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    if (open) dialogRef.current?.focus();
  }, [open]);

  if (!open) return null;

  const { draft, saving, dirty } = layout;

  const handleSave = () => {
    void layout.save().then((ok) => {
      if (ok) onClose();
    });
  };

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} aria-hidden="true" />
      <aside
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="drawer-title"
        tabIndex={-1}
        ref={dialogRef}
      >
        <header className="drawer-header">
          <h2 id="drawer-title">Personalizar</h2>
          <button
            type="button"
            className="btn btn--icon"
            aria-label="Fechar personalização"
            onClick={() => {
              layout.revert();
              onClose();
            }}
          >
            <Icon name="x" size={16} />
          </button>
        </header>

        {!draft ? (
          <div className="drawer-body">
            <LoadingLabel text="Carregando personalização…" />
          </div>
        ) : (
          <>
            <div className="drawer-body">
              <section className="drawer-section" aria-labelledby="drawer-widgets-title">
                <h3 id="drawer-widgets-title">Widgets</h3>
                <ul className="drawer-widget-list">
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
              </section>

              <section className="drawer-section" aria-labelledby="drawer-appearance-title">
                <h3 id="drawer-appearance-title">Aparência</h3>
                <p className="drawer-hint">
                  O tema acompanha automaticamente a cor do time selecionado, nos modos
                  claro e escuro. A cor de destaque abaixo é opcional.
                </p>
                <ThemeToggle onSelect={layout.setThemeDefault} />
                <div className="field field--inline">
                  <label htmlFor="accent-color">Cor de destaque</label>
                  <div className="accent-picker">
                    <label className="accent-auto">
                      <input
                        type="radio"
                        name="accent-mode"
                        checked={!layout.draft?.theme?.accent || layout.draft.theme.accent === ACCENT_AUTO}
                        onChange={() => {
                          layout.setAccent(ACCENT_AUTO);
                          clearAccent();
                        }}
                      />
                      <span>Automática (cor do time)</span>
                    </label>
                    <input
                      id="accent-color"
                      type="color"
                      value={accent}
                      onChange={(event) => {
                        setAccent(event.target.value);
                        layout.setAccent(event.target.value);
                      }}
                    />
                  </div>
                </div>
              </section>

              <section className="drawer-section" aria-labelledby="drawer-refresh-title">
                <h3 id="drawer-refresh-title">Atualização</h3>
                <div className="field">
                  <label htmlFor="refresh-interval">Intervalo de atualização (segundos)</label>
                  <input
                    id="refresh-interval"
                    type="number"
                    min={10}
                    value={draft.refresh_interval_seconds}
                    onChange={(event) => layout.setRefreshInterval(Number(event.target.value))}
                  />
                </div>
              </section>
            </div>

            <footer className="drawer-footer">
              <button
                type="button"
                className="btn"
                onClick={() => {
                  layout.revert();
                  onClose();
                }}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn"
                disabled={saving}
                onClick={() => void layout.reset()}
              >
                Restaurar padrão
              </button>
              <button
                type="button"
                className="btn btn--primary"
                disabled={saving || !dirty}
                onClick={handleSave}
              >
                {saving ? 'Salvando…' : 'Salvar'}
              </button>
            </footer>
          </>
        )}
      </aside>
    </>
  );
}
