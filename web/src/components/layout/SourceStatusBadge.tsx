import { capabilityLabel, statusLabel } from '../../lib/labels';
import type { MetaSource } from '../../api/types';
import { useEffect, useRef, useState } from 'react';

interface Props {
  sources: MetaSource[] | null | undefined;
}

/** Selo discreto "dados de fallback" quando alguma capacidade veio de fonte de backup/erro. */
export function SourceStatusBadge({ sources }: Props) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const problematic = (sources ?? []).filter((source) => source.status !== 'ok');

  useEffect(() => {
    if (!open) return undefined;
    const onMouseDown = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  if (problematic.length === 0) return null;

  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        className="badge badge--warn"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="badge-dot" aria-hidden="true" />
        dados de fallback
      </button>
      {open ? (
        <div
          className="popover w-[min(340px,86vw)] p-3.5"
          role="group"
          aria-label="Status das fontes de dados"
        >
          <h2 className="popover-title">Fontes de dados</h2>
          <ul className="popover-list">
            {problematic.map((source) => (
              <li key={`${source.capability}-${source.source}`} className="popover-item">
                <span className="popover-capability">{capabilityLabel(source.capability)}</span>
                <span className="popover-source">{source.source}</span>
                <span className={`chip chip--status-${source.status}`}>
                  {statusLabel(source.status)}
                </span>
                {source.error ? <span className="popover-error">{source.error}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
