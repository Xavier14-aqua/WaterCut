import { useLayoutEffect, useRef, type ReactNode } from 'react';

const inertLocks = new WeakMap<
  HTMLElement,
  { count: number; previous: boolean }
>();
const focusableSelector =
  'button, input, select, textarea, a[href], [tabindex]';

/** Shared dialog behavior; feature components retain their own save/cancel rules. */
export function Modal({
  label,
  onClose,
  canDismiss = true,
  children,
}: {
  label: string;
  onClose: () => void;
  canDismiss?: boolean;
  children: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  const dismissible = useRef(canDismiss);
  close.current = onClose;
  dismissible.current = canDismiss;

  useLayoutEffect(() => {
    const dialog = root.current!;
    const previousFocus = document.activeElement;
    const shell = dialog.closest('.app-shell') ?? document.body;
    const background = [...shell.children].filter(
      (element): element is HTMLElement =>
        element instanceof HTMLElement && !element.contains(dialog),
    );
    for (const element of background) {
      const lock = inertLocks.get(element) ?? {
        count: 0,
        previous: element.inert,
      };
      lock.count++;
      inertLocks.set(element, lock);
      element.inert = true;
    }
    const focusable = () =>
      [...dialog.querySelectorAll<HTMLElement>(focusableSelector)].filter(
        (element) =>
          element.tabIndex >= 0 &&
          !element.matches(':disabled') &&
          !element.closest('[inert]') &&
          element.getClientRects().length > 0,
      );
    const focusFirst = () =>
      (focusable()[0] ?? dialog).focus({ preventScroll: true });
    function keydown(event: KeyboardEvent) {
      if (dialog.inert) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        if (dismissible.current) close.current();
      } else if (event.key === 'Tab') {
        const items = focusable();
        const first = items[0],
          last = items.at(-1);
        if (
          !first ||
          (event.shiftKey &&
            (document.activeElement === first ||
              document.activeElement === dialog)) ||
          (!event.shiftKey && document.activeElement === last)
        ) {
          event.preventDefault();
          event.stopPropagation();
          (event.shiftKey ? (last ?? dialog) : (first ?? dialog)).focus();
        }
      }
    }
    function containFocus(event: FocusEvent) {
      if (
        !dialog.inert &&
        event.target instanceof Node &&
        !dialog.contains(event.target)
      )
        focusFirst();
    }
    document.addEventListener('keydown', keydown, true);
    document.addEventListener('focusin', containFocus);
    focusFirst();
    return () => {
      document.removeEventListener('keydown', keydown, true);
      document.removeEventListener('focusin', containFocus);
      for (const element of background) {
        const lock = inertLocks.get(element)!;
        if (--lock.count === 0) {
          element.inert = lock.previous;
          inertLocks.delete(element);
        }
      }
      if (
        previousFocus instanceof HTMLElement &&
        previousFocus.isConnected &&
        !previousFocus.closest('[inert]')
      ) {
        previousFocus.focus({ preventScroll: true });
      }
    };
  }, []);

  return (
    <div
      ref={root}
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={label}
      tabIndex={-1}
      onKeyDown={(event) => event.stopPropagation()}
    >
      {children}
    </div>
  );
}
