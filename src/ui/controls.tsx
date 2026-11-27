import { useId, useRef, type ReactNode } from 'react';

export function Section({ title, aside, children }: { title?: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="section">
      {(title || aside) && (
        <header className="section-head">
          <h3>{title}</h3>
          {aside}
        </header>
      )}
      {children}
    </section>
  );
}

export function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" className="toggle" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}>
      <span className="toggle-box" aria-hidden />
      <span>{label}</span>
    </button>
  );
}

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  const i = Math.max(0, options.findIndex((o) => o.value === value));
  return (
    <div className="segmented" role="radiogroup" aria-label={label} style={{ ['--n' as string]: options.length, ['--i' as string]: i }}>
      {options.map((o) => (
        <button key={String(o.value)} type="button" role="radio" aria-checked={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
      <span className="segmented-mark" aria-hidden />
    </div>
  );
}

export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  format,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
}) {
  const id = useId();
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="slider">
      <label htmlFor={id}>
        <span>{label}</span>
        <output>{format ? format(value) : value}</output>
      </label>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ ['--pct' as string]: `${pct}%` }}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}

export function NumberField({
  label,
  value,
  onCommit,
  min = 1,
  max = 400,
}: {
  label: string;
  value: number;
  onCommit: (v: number) => void;
  min?: number;
  max?: number;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const commit = () => {
    const v = Number(ref.current?.value.replace(',', '.'));
    if (Number.isFinite(v) && v >= min && v <= max) onCommit(v);
    else if (ref.current) ref.current.value = String(value);
  };
  return (
    <label className="number">
      <span>{label}</span>
      <input
        ref={ref}
        key={value}
        defaultValue={value}
        inputMode="decimal"
        aria-label={label}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
      />
    </label>
  );
}

export function Button({
  children,
  onClick,
  variant = 'line',
  disabled,
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'line' | 'ink' | 'quiet';
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button type="button" className={`btn btn-${variant}`} onClick={onClick} disabled={disabled} title={title}>
      {children}
    </button>
  );
}
