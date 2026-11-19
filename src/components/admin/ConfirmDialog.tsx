import React, { useState, useEffect } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { useModalFocusTrap } from '../useModalFocusTrap';

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  description: string;
  previewText?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  /** If set (e.g. "RESET"), user must type this exact string before confirming */
  requiredKeyword?: string;
  busy?: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  isOpen,
  title,
  description,
  previewText,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
  requiredKeyword,
  busy = false,
  onConfirm,
  onCancel,
}) => {
  const [typed, setTyped] = useState('');
  const dialogRef = useModalFocusTrap(isOpen, onCancel);

  useEffect(() => {
    if (isOpen) {
      setTyped('');
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const keywordSatisfied = !requiredKeyword || typed.trim() === requiredKeyword;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-xs"
      style={{ backgroundColor: 'var(--overlay)' }}
      onClick={busy ? undefined : onCancel}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        className="w-full max-w-md rounded-2xl bg-[var(--sf)] border border-[var(--bd)] overflow-hidden"
        style={{ boxShadow: 'var(--card-shadow)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-[var(--bd)] flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div
              className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                danger
                  ? 'bg-[var(--rds)] text-[var(--rdt)]'
                  : 'bg-[var(--blu)] text-[var(--blut)]'
              }`}
            >
              <AlertTriangle className="w-4 h-4" strokeWidth={1.8} />
            </div>
            <h2
              id="confirm-dialog-title"
              className="text-sm font-bold text-[var(--tx)] truncate"
            >
              {title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            aria-label="Close confirmation dialog"
            className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl text-[var(--mu)] hover:text-[var(--tx)] hover:bg-[var(--sf-2)] transition-colors disabled:opacity-50"
          >
            <X className="w-4 h-4" strokeWidth={1.8} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <p className="text-xs leading-relaxed text-[var(--mu)]">{description}</p>

          {previewText && (
            <div className="p-3 rounded-xl bg-[var(--sf-2)] border border-[var(--bd)] text-xs font-mono text-[var(--tx)] max-h-40 overflow-auto whitespace-pre-wrap break-words">
              {previewText}
            </div>
          )}

          {requiredKeyword && (
            <div className="space-y-1.5">
              <label
                htmlFor="confirm-keyword-input"
                className="block text-xs font-semibold text-[var(--tx)]"
              >
                Type <span className="font-mono text-[var(--rdt)]">{requiredKeyword}</span> to confirm
              </label>
              <input
                id="confirm-keyword-input"
                type="text"
                autoComplete="off"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder={requiredKeyword}
                className="w-full min-h-[44px] px-3 rounded-xl bg-[var(--sf-2)] border border-[var(--bd)] text-xs font-mono text-[var(--tx)] placeholder-[var(--mu)] focus:border-[var(--rd)]"
              />
            </div>
          )}

          <div className="flex items-center justify-end gap-2.5 pt-2">
            <button
              type="button"
              onClick={onCancel}
              disabled={busy}
              className="min-h-[44px] px-4 rounded-xl bg-[var(--sf-2)] hover:bg-[var(--bd)]/40 border border-[var(--bd)] text-xs font-semibold text-[var(--tx)] transition-colors disabled:opacity-50"
            >
              {cancelLabel}
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={busy || !keywordSatisfied}
              className={`min-h-[44px] px-4 rounded-xl text-xs font-semibold text-white transition-opacity disabled:opacity-45 ${
                danger ? 'bg-[var(--rd)] hover:opacity-90' : 'bg-[var(--rd)] hover:opacity-90'
              }`}
            >
              {busy ? 'Processing...' : confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
