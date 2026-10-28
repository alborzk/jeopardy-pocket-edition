import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';

/**
 * A themed modal on the native <dialog> element. `showModal()` puts it in the top layer above
 * everything, makes the rest of the page inert, keeps focus inside, closes on Escape, and hands
 * focus back to whatever opened it. Clicking the backdrop closes it too.
 *
 * It's real DOM, unlike window.confirm, which some embedded browsers (the Claude app's preview
 * among them) silently answer "no" without showing.
 */
export function Modal({
  open,
  title,
  onClose,
  actions,
  alert = false,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  /** The buttons along the bottom. Put the safe choice first: it gets focus when the modal opens. */
  actions: ReactNode;
  /** For a question that needs an answer before going on, such as a confirm. */
  alert?: boolean;
  children?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      role={alert ? 'alertdialog' : undefined}
      aria-labelledby={titleId}
      className="modal"
      onCancel={(event) => {
        // Escape: let React's state decide, so `open` stays the single source of truth.
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        // The panel fills the dialog, so a click on the dialog itself landed on the backdrop.
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="modal-panel card flex flex-col gap-5">
        <h2
          id={titleId}
          className="font-pixel text-lg uppercase leading-snug text-bulb chroma-text-sm"
        >
          {title}
        </h2>
        {children ? <div className="text-xl leading-snug text-white/85">{children}</div> : null}
        <div className="grid grid-cols-2 gap-3">{actions}</div>
      </div>
    </dialog>
  );
}

export interface ConfirmOptions {
  title: string;
  message?: ReactNode;
  /** The label on the button that goes ahead. */
  confirmLabel: string;
  cancelLabel?: string;
  /** `danger` turns the go-ahead button red, for things that can't be undone. */
  tone?: 'primary' | 'danger';
}

interface ModalApi {
  /** Asks a yes-or-no question in a modal. Resolves to true when the user goes ahead. */
  confirm: (options: ConfirmOptions) => Promise<boolean>;
}

const ModalContext = createContext<ModalApi | null>(null);

type Pending = ConfirmOptions & { resolve: (ok: boolean) => void };

/** Hosts the app's shared modal. Wrap the app in it once; screens then call `useModal()`. */
export function ModalProvider({ children }: { children: ReactNode }) {
  // A queue, so a second question asked while one is showing waits its turn.
  const [queue, setQueue] = useState<Pending[]>([]);
  const current = queue[0];

  const confirm = useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) =>
        setQueue((waiting) => [...waiting, { ...options, resolve }]),
      ),
    [],
  );
  const api = useMemo(() => ({ confirm }), [confirm]);

  const settle = (ok: boolean) => {
    if (!current) return;
    current.resolve(ok);
    setQueue((waiting) => waiting.slice(1));
  };

  return (
    <ModalContext.Provider value={api}>
      {children}
      <Modal
        alert
        open={current !== undefined}
        title={current?.title ?? ''}
        onClose={() => settle(false)}
        actions={
          <>
            <button type="button" className="btn-secondary" onClick={() => settle(false)}>
              {current?.cancelLabel ?? 'Cancel'}
            </button>
            <button
              type="button"
              className={current?.tone === 'danger' ? 'btn-bad' : 'btn-primary'}
              onClick={() => settle(true)}
            >
              {current?.confirmLabel}
            </button>
          </>
        }
      >
        {current?.message}
      </Modal>
    </ModalContext.Provider>
  );
}

export function useModal(): ModalApi {
  const api = useContext(ModalContext);
  if (!api) throw new Error('useModal() needs a <ModalProvider> above it');
  return api;
}
