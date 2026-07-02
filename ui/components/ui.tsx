'use client';

import { useEffect, useState } from 'react';

/** shadcn-style primitives (tailwind-only, no CLI codegen). */

export function Button({
  children, onClick, disabled, variant = 'default', type = 'button', className = '',
}: {
  children: React.ReactNode; onClick?: () => void; disabled?: boolean;
  variant?: 'default' | 'outline' | 'ghost'; type?: 'button' | 'submit'; className?: string;
}) {
  const base = 'inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
  const variants = {
    default: 'bg-amber-400 text-zinc-950 hover:bg-amber-300',
    outline: 'border border-zinc-700 text-zinc-100 hover:bg-zinc-800',
    ghost: 'text-zinc-300 hover:bg-zinc-800',
  };
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={`${base} ${variants[variant]} ${className}`}>
      {children}
    </button>
  );
}

export function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 ${className}`}>{children}</div>;
}

export function Badge({ children, tone = 'zinc' }: { children: React.ReactNode; tone?: 'zinc' | 'amber' | 'green' | 'red' }) {
  const tones = {
    zinc: 'bg-zinc-800 text-zinc-300',
    amber: 'bg-amber-400/15 text-amber-300 border border-amber-400/30',
    green: 'bg-green-400/15 text-green-300 border border-green-400/30',
    red: 'bg-red-400/15 text-red-300 border border-red-400/30',
  };
  return <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${tones[tone]}`}>{children}</span>;
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="text-zinc-400">{label}</span>
      {children}
    </label>
  );
}

export const inputCls = 'rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-amber-400';

/**
 * Number stepper: −/+ buttons plus free typing. While focused you can clear and
 * retype without the value snapping back; it clamps to [min,max] on blur/Enter.
 */
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

  const btn = 'px-3.5 py-2 text-lg leading-none text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-amber-300 disabled:opacity-30 disabled:hover:bg-transparent';
  return (
    <div className="flex w-fit items-stretch overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 focus-within:border-amber-400">
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
        className="w-12 border-x border-zinc-800 bg-transparent py-2 text-center text-sm font-semibold text-zinc-100 outline-none"
        aria-label="value"
      />
      <button type="button" className={btn} aria-label="increase" disabled={value >= max} onClick={() => onChange(clamp(value + 1))}>+</button>
    </div>
  );
}
