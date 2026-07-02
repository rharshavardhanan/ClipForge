'use client';

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
