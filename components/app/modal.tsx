'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { Button } from '@/components/ui/primitives';

/** Diálogo nativo (<dialog>): foco preso, Esc fecha, acessível por padrão e sem dependências. */
export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => { if (e.target === ref.current) onClose(); }}
      aria-labelledby="modal-title"
      className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-lg border border-border bg-card p-0 text-foreground shadow-xl backdrop:bg-black/50"
    >
      {open ? (
        <div className="space-y-4 p-5">
          <div className="flex items-start justify-between gap-3">
            <h2 id="modal-title" className="text-base font-semibold">{title}</h2>
            <Button type="button" variant="ghost" onClick={onClose} aria-label="Fechar">✕</Button>
          </div>
          {children}
        </div>
      ) : null}
    </dialog>
  );
}
