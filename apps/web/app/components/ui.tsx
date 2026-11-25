import { cloneElement, isValidElement, type ComponentProps, type ReactNode } from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'destructive';
type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

export function Button({ variant = 'primary', loading, icon, disabled, className = '', children, type = 'button', ...props }:
  ComponentProps<'button'> & { variant?: ButtonVariant; loading?: boolean; icon?: boolean }) {
  return <button {...props} type={type} disabled={disabled || loading} aria-busy={loading}
    className={`ui-button ui-button--${variant} ${icon ? 'ui-button--icon' : ''} ${className}`}>
    {loading && <Spinner />}{children}
  </button>;
}

export function Input({ className = '', ...props }: ComponentProps<'input'>) {
  return <input {...props} className={`ui-input ${className}`} />;
}

export function Textarea({ className = '', ...props }: ComponentProps<'textarea'>) {
  return <textarea {...props} className={`ui-input ${className}`} />;
}

export function Select({ className = '', ...props }: ComponentProps<'select'>) {
  return <select {...props} className={`ui-input ${className}`} />;
}

export function Field({ id, label, error, hint, children }: {
  id: string;
  label: ReactNode;
  error?: string;
  hint?: string;
  children: ReactNode;
}) {
  const control = isValidElement<ComponentProps<'input'>>(children) ? children : null;
  const describedBy = new Set([
    ...(control?.props['aria-describedby']?.split(/\s+/) ?? []),
    ...(hint ? [`${id}-hint`] : []),
    ...(error ? [`${id}-error`] : []),
  ]);
  return <div className="ui-field">
    <label htmlFor={id}>{label}</label>
    {control ? cloneElement(control, {
      id,
      'aria-invalid': error ? true : control.props['aria-invalid'],
      'aria-describedby': [...describedBy].join(' ') || undefined,
    }) : children}
    {hint && <p id={`${id}-hint`} className="text-muted">{hint}</p>}
    {error && <p id={`${id}-error`} className="ui-error" role="alert">{error}</p>}
  </div>;
}

export function Card({ className = '', ...props }: ComponentProps<'div'>) {
  return <div {...props} className={`ui-card ${className}`} />;
}

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`ui-badge ui-tone--${tone}`}>{children}</span>;
}

export function Alert({ tone = 'info', children }: { tone?: Tone; children: ReactNode }) {
  return <div role={tone === 'danger' ? 'alert' : 'status'} className={`ui-alert ui-tone--${tone}`}>{children}</div>;
}

export function Toast({ children, tone = 'success', onDismiss }: {
  children: ReactNode;
  tone?: Tone;
  onDismiss: () => void;
}) {
  return <div className="ui-toast">
    <Alert tone={tone}>
      <div className="flex items-center gap-3">{children}
        <Button variant="ghost" icon aria-label="Закрыть уведомление" onClick={onDismiss}>×</Button>
      </div>
    </Alert>
  </div>;
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return <Card className="ui-empty"><p className="font-semibold">{title}</p>
    {description && <p>{description}</p>}{action}
  </Card>;
}

export function Spinner() {
  return <span className="ui-spinner" aria-hidden="true" />;
}

export function Skeleton({ label = 'Загрузка данных' }: { label?: string }) {
  return <Card className="ui-skeleton" role="status" aria-label={label}>
    <span /><span /><span />
  </Card>;
}

export function TableRegion({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) {
  return <div role="region" tabIndex={0} aria-label={label} className={`ui-table-region ${className}`}>{children}</div>;
}

export function Avatar({ name }: { name: string }) {
  const initials = name.trim().split(/\s+/).slice(0, 2).map((part) => Array.from(part)[0]).join('').toUpperCase();
  return <span className="ui-avatar" aria-hidden="true">{initials || 'SM'}</span>;
}
