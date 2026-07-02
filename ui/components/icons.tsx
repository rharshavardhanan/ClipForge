import type { ReactNode } from 'react';

const PATHS: Record<string, ReactNode> = {
  import: <><path d="M12 3v11" /><path d="m7.5 9.5 4.5 4.5 4.5-4.5" /><path d="M4 21h16" /></>,
  clips: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4" /></>,
  style: <><path d="M4 7h16M4 7l1 3M20 7l-1 3M9 20h6M12 8v12" /><path d="M18 3.5l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4L16 5.5l1.4-.6z" /></>,
  rank: <><path d="M7 4h10v3a5 5 0 0 1-10 0zM7 4H4v1.5A3.5 3.5 0 0 0 7 9M17 4h3v1.5A3.5 3.5 0 0 1 17 9M9 21h6M12 12v9" /></>,
  export: <><path d="M4 20h16a1 1 0 0 0 1-1V8a1 1 0 0 0-1-1h-8l-2-2H4a1 1 0 0 0-1 1v13a1 1 0 0 0 1 1z" /></>,
  play: <polygon points="7 4 20 12 7 20 7 4" />,
  trash: <><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6.5 7l.8 12a1 1 0 0 0 1 .9h7.4a1 1 0 0 0 1-.9l.8-12" /></>,
  folder: <><path d="M4 20l2.3-8.5A1 1 0 0 1 7.3 11H21l-2 8a1 1 0 0 1-1 .8H4zM4 20V6a1 1 0 0 1 1-1h4.6l2 2H18a1 1 0 0 1 1 1v2" /></>,
  refresh: <><path d="M20.5 12a8.5 8.5 0 1 1-2.6-6.1M20.5 3.5V9h-5.5" /></>,
  upload: <><path d="M12 15V4M8 8l4-4 4 4M5 20h14" /></>,
  sparkle: <path d="M12 3l1.6 4.9L18.5 9.5 13.6 11 12 16l-1.6-5L5.5 9.5 10.4 7.9z" />,
  check: <path d="M5 12.5l4.5 4.5L19 7" />,
  bolt: <path d="M13 3L5 13h6l-1 8 8-11h-6z" />,
};

export function Icon({ name, className = 'h-5 w-5' }: { name: keyof typeof PATHS | string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      {PATHS[name] ?? null}
    </svg>
  );
}
