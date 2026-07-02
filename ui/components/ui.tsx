'use client';

import { useEffect, useState } from 'react';

/** shadcn-style primitives (tailwind-only, no CLI codegen) — restyled for the studio UI. */

export function Button({
  children, onClick, disabled, variant = 'primary', size = 'md', type = 'button', className = '',
}: {
  children: React.ReactNode; onClick?: () => void; disabled?: boolean;
  variant?: 'primary' | 'outline' | 'ghost' | 'danger'; size?: 'sm' | 'md'; type?: 'button' | 'submit'; className?: string;
}) {
  const base = 'inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-all duration-150 active:scale-[0.97] disabled:opacity-40 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/60';
  const sizes = { sm: 'px-3 py-1.5 text-xs', md: 'px-4 py-2.5 text-sm' };
  const variants = {
    primary: 'bg-gold text-ink-900 hover:bg-gold-hover shadow-pop',
    outline: 'border border-line bg-ink-700/60 text-zinc-100 hover:border-zinc-600 hover:bg-ink-600',
    ghost: 'text-zinc-300 hover:bg-ink-600/70 hover:text-zinc-100',
    danger: 'border border-red-500/30 bg-red-500/10 text-red-300 hover:bg-red-500/20 hover:border-red-500/50',
  };
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={`${base} ${sizes[size]} ${variants[variant]} ${className}`}>
      {children}
    </button>
  );
}

export function Card({ children, className = '', accent = false }: { children: React.ReactNode; className?: string; accent?: boolean }) {
  return (
    <div className={`rounded-2xl border border-line bg-ink-800/70 p-5 shadow-card backdrop-blur-sm ${accent ? 'accent-top' : ''} ${className}`}>
      {children}
    </div>
  );
}

export function Badge({ children, tone = 'zinc' }: { children: React.ReactNode; tone?: 'zinc' | 'gold' | 'green' | 'red' }) {
  const tones = {
    zinc: 'bg-ink-600 text-zinc-300 border border-line',
    gold: 'bg-gold-soft text-gold border border-gold/25',
    green: 'bg-green-400/12 text-green-300 border border-green-400/25',
    red: 'bg-red-400/12 text-red-300 border border-red-400/25',
  };
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${tones[tone]}`}>{children}</span>;
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="font-medium text-zinc-300">{label}</span>
      {children}
      {hint && <span className="text-xs text-zinc-500">{hint}</span>}
    </label>
  );
}

export const inputCls = 'rounded-xl border border-line bg-ink-900/60 px-3.5 py-2.5 text-sm text-zinc-100 outline-none transition-colors placeholder:text-zinc-600 focus:border-gold/50 focus:ring-2 focus:ring-gold/15';

/** Section heading with an optional trailing slot (actions). */
export function SectionHead({ title, subtitle, right }: { title: string; subtitle?: string; right?: React.ReactNode }) {
  return (
    <div className="mb-4 flex items-start justify-between gap-4">
      <div>
        <h2 className="font-display text-lg font-semibold tracking-tight text-zinc-100">{title}</h2>
        {subtitle && <p className="mt-0.5 text-sm text-zinc-500">{subtitle}</p>}
      </div>
      {right}
    </div>
  );
}

/** Number stepper: −/+ buttons plus free typing; clamps to [min,max] on blur/Enter. */
export function Stepper({ value, onChange, min = 1, max = 20 }: {
  value: number; onChange: (n: number) => void; min?: number; max?: number;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => { setText(String(value)); }, [value]);

  const clamp = (n: number) => Math.min(max, Math.max(min, n));
  const commit = () => {
    const n = parseInt(text, 10);
    if (Number.isFinite(n)) onChange(clamp(n));
    setText(String(Number.isFinite(parseInt(text, 10)) ? clamp(parseInt(text, 10)) : value));
  };

  const btn = 'flex w-10 items-center justify-center text-xl leading-none text-zinc-400 transition-colors hover:bg-ink-600 hover:text-gold disabled:opacity-25 disabled:hover:bg-transparent';
  return (
    <div className="flex w-fit items-stretch overflow-hidden rounded-xl border border-line bg-ink-900/60 focus-within:border-gold/50 focus-within:ring-2 focus-within:ring-gold/15">
      <button type="button" className={btn} aria-label="decrease" disabled={value <= min} onClick={() => onChange(clamp(value - 1))}>−</button>
      <input
        value={text}
        inputMode="numeric"
        onFocus={(e) => e.target.select()}
        onChange={(e) => setText(e.target.value.replace(/[^0-9]/g, '').slice(0, 3))}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'ArrowUp') { e.preventDefault(); onChange(clamp(value + 1)); }
          if (e.key === 'ArrowDown') { e.preventDefault(); onChange(clamp(value - 1)); }
        }}
        className="w-12 border-x border-line bg-transparent py-2.5 text-center text-sm font-semibold text-zinc-100 outline-none"
        aria-label="value"
      />
      <button type="button" className={btn} aria-label="increase" disabled={value >= max} onClick={() => onChange(clamp(value + 1))}>+</button>
    </div>
  );
}
