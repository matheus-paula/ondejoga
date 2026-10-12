import { useEffect } from 'react';
import { Icon } from './Icon';

export interface Notice {
  id?: number;
  tone: 'success' | 'error' | 'info';
  message: string;
}

const TONE_CLASS: Record<Notice['tone'], string> = {
  success: 'toast--success',
  error: 'toast--error',
  info: 'toast--info',
};

export function Toast({ notice, onClose }: { notice: Notice | null; onClose: () => void }) {
  useEffect(() => {
    if (!notice) return undefined;
    const timer = window.setTimeout(onClose, 5000);
    return () => window.clearTimeout(timer);
  }, [notice, onClose]);

  if (!notice) return null;

  return (
    <div className={`toast ${TONE_CLASS[notice.tone]}`} role="status">
      <span className="toast-message">{notice.message}</span>
      <button
        type="button"
        className="toast-close"
        aria-label="Fechar aviso"
        onClick={onClose}
      >
        <Icon name="x" size={15} />
      </button>
    </div>
  );
}
