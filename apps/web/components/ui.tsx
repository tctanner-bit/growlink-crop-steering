'use client';

/**
 * Growlink UI kit — a small set of primitives for the Tesla-style look.
 * Props mirror the Atlaskit components they replace, so call sites stay simple.
 */
import { createContext, useContext, useEffect, useRef, type ReactNode, type ComponentType, type CSSProperties } from 'react';
import Link from 'next/link';

type Appearance = 'default' | 'primary' | 'subtle' | 'danger' | 'warning' | 'rovo';

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

export function Spinner({ size = 16 }: { size?: number | 'small' | 'medium' | 'large' }) {
  const px = typeof size === 'number' ? size : size === 'small' ? 14 : size === 'large' ? 28 : 20;
  return <span className="gl-spinner" style={{ width: px, height: px }} role="status" aria-label="Loading" />;
}

export function Button({
  appearance = 'default', spacing, isDisabled, isLoading, iconBefore: Icon, onClick, type = 'button', children, style, ...rest
}: {
  appearance?: Appearance; spacing?: 'default' | 'compact'; isDisabled?: boolean; isLoading?: boolean;
  iconBefore?: ComponentType<any>; onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void; type?: 'button' | 'submit';
  children?: ReactNode; style?: CSSProperties; 'aria-label'?: string; title?: string; autoFocus?: boolean;
}) {
  return (
    <button {...rest} type={type} onClick={onClick} disabled={isDisabled || isLoading} aria-busy={isLoading || undefined} style={style}
      className={cx('gl-btn', `gl-btn--${appearance === 'rovo' ? 'primary' : appearance}`, spacing === 'compact' && 'gl-btn--compact')}>
      {isLoading ? <Spinner size={14} /> : Icon ? <Icon label="" /> : null}
      <span>{children}</span>
    </button>
  );
}

export function LinkButton({ href, appearance = 'default', children, spacing }: { href: string; appearance?: Appearance; children: ReactNode; spacing?: 'default' | 'compact' }) {
  return <Link href={href} className={cx('gl-btn', `gl-btn--${appearance}`, spacing === 'compact' && 'gl-btn--compact')}>{children}</Link>;
}

const HEADING: Record<string, string> = { xxlarge: 'gl-h1', xlarge: 'gl-h1', large: 'gl-h2', medium: 'gl-h2', small: 'gl-h3', xsmall: 'gl-h4', xxsmall: 'gl-h4' };
export function Heading({ size = 'medium', as, children, id }: { size?: string; as?: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'div' | 'span'; children: ReactNode; id?: string }) {
  const Tag = (as ?? (size === 'xlarge' || size === 'xxlarge' ? 'h1' : size === 'small' || size === 'xsmall' ? 'h3' : 'h2')) as any;
  return <Tag id={id} className={HEADING[size] ?? 'gl-h2'}>{children}</Tag>;
}

const TONE: Record<string, string> = {
  default: 'neutral', success: 'ok', removed: 'danger', moved: 'warn', inprogress: 'info', new: 'accent',
};
export function Lozenge({ appearance = 'default', isBold, children }: { appearance?: string; isBold?: boolean; children: ReactNode }) {
  return <span className={cx('gl-pill', `gl-pill--${TONE[appearance] ?? 'neutral'}`, isBold && 'gl-pill--bold')}>{children}</span>;
}

const NOTICE: Record<string, string> = { information: 'info', warning: 'warn', error: 'danger', success: 'ok', discovery: 'accent' };
export function SectionMessage({ appearance = 'information', title, children }: { appearance?: string; title?: ReactNode; children?: ReactNode }) {
  return (
    <div className={cx('gl-notice', `gl-notice--${NOTICE[appearance] ?? 'info'}`)} role={appearance === 'error' ? 'alert' : 'note'}>
      <span className="gl-notice-dot" aria-hidden="true" />
      <div className="gl-notice-body">
        {title && <div className="gl-notice-title">{title}</div>}
        {children && <div className="gl-notice-text">{children}</div>}
      </div>
    </div>
  );
}

/** Native tooltip: keyboard and touch users get the same text via title. */
export function Tooltip({ content, children }: { content: string; children: ReactNode }) {
  return <span title={content} className="gl-tip">{children}</span>;
}

export function Badge({ children }: { children: ReactNode }) {
  return <span className="gl-pill gl-pill--neutral">{children}</span>;
}

type FieldProps = React.InputHTMLAttributes<HTMLInputElement> & { isCompact?: boolean; elemAfterInput?: ReactNode; isRequired?: boolean; isDisabled?: boolean };
export function Textfield({ isCompact, elemAfterInput, isRequired, isDisabled, className, ...rest }: FieldProps) {
  return (
    <span className={cx('gl-input', isCompact && 'gl-input--compact', className)}>
      <input {...rest} required={isRequired || rest.required} disabled={isDisabled || rest.disabled} />
      {elemAfterInput && <span className="gl-input-after">{elemAfterInput}</span>}
    </span>
  );
}

export function TextArea({ isDisabled, minimumRows = 3, ...rest }: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { isDisabled?: boolean; minimumRows?: number; resize?: string }) {
  const { resize, ...props } = rest as any;
  return <textarea {...props} rows={minimumRows} disabled={isDisabled} className="gl-textarea" />;
}

export function Toggle({ isChecked, isDisabled, onChange, label, id }: { isChecked?: boolean; isDisabled?: boolean; onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void; label?: string; id?: string }) {
  return (
    <span className="gl-toggle">
      <input id={id} type="checkbox" role="switch" checked={!!isChecked} disabled={isDisabled} onChange={onChange} aria-label={label} />
      <span className="gl-toggle-track" aria-hidden="true"><span className="gl-toggle-thumb" /></span>
    </span>
  );
}

/* ── Modal ──────────────────────────────────────────────────────────────── */
const ModalCtx = createContext<{ titleId: string }>({ titleId: 'gl-modal-title' });

export function ModalTransition({ children }: { children: ReactNode }) { return <>{children}</>; }

export default function Modal({ onClose, children, width }: { onClose: () => void; children: ReactNode; width?: 'small' | 'medium' | 'large' | string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const el = ref.current;
    (el?.querySelector<HTMLElement>('[autofocus], input, textarea, button:not([data-close])') ?? el)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab' && el) {
        const f = Array.from(el.querySelectorAll<HTMLElement>('button, [href], input, textarea, select, [tabindex]:not([tabindex="-1"])')).filter((n) => !n.hasAttribute('disabled'));
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; prev?.focus?.(); };
  }, [onClose]);
  const titleId = 'gl-modal-title';
  return (
    <div className="gl-modal-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} className={cx('gl-modal', width === 'large' && 'gl-modal--large')} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <ModalCtx.Provider value={{ titleId }}>{children}</ModalCtx.Provider>
      </div>
    </div>
  );
}
export function ModalHeader({ children }: { children: ReactNode }) { return <div className="gl-modal-header">{children}</div>; }
export function ModalTitle({ children, appearance }: { children: ReactNode; appearance?: 'warning' | 'danger' }) {
  const { titleId } = useContext(ModalCtx);
  return <h2 id={titleId} className={cx('gl-h2', appearance && `gl-title--${appearance === 'warning' ? 'warn' : 'danger'}`)}>{children}</h2>;
}
export function ModalBody({ children }: { children: ReactNode }) { return <div className="gl-modal-body">{children}</div>; }
export function ModalFooter({ children }: { children: ReactNode }) { return <div className="gl-modal-footer">{children}</div>; }

/* ── Segmented control ─────────────────────────────────────────────────── */
export function Segmented<T extends string>({ value, options, onChange, label, disabled, danger }: {
  value: T; options: { id: T; label: string }[]; onChange: (v: T) => void; label: string; disabled?: boolean; danger?: T;
}) {
  return (
    <div className="gl-seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.id} type="button" aria-pressed={value === o.id} data-danger={o.id === danger || undefined} disabled={disabled} onClick={() => onChange(o.id)}>{o.label}</button>
      ))}
    </div>
  );
}

/** Nova mark: a four-point spark in the accent colour. */
export function NovaMark({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className="gl-nova-mark">
      <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M18.5 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z" fill="currentColor" />
    </svg>
  );
}
