import type { ReactNode } from 'react';

type IconName =
  | 'projects'
  | 'library'
  | 'studio'
  | 'settings'
  | 'arrow'
  | 'plus';

/** Shared, decorative icons; the adjacent control text supplies its name. */
export function Icon({
  name,
  className = '',
}: {
  name: IconName;
  className?: string;
}) {
  const paths: Record<IconName, ReactNode> = {
    projects: (
      <>
        <rect x="4" y="3" width="16" height="18" rx="1" />
        <path d="M4 8h16M4 12h16M4 16h16M9 3v18M15 3v18" />
      </>
    ),
    library: (
      <>
        <path d="m12 2 2.1 6.2L21 10l-6.4 3.1L13 20l-3.4-5.6L3 13l4.8-4.4L8 3l4 3" />
        <path d="m19 3 1 2.5L23 6l-2.5 1L20 10M3 18l1 2 2 1" />
      </>
    ),
    studio: (
      <>
        <rect x="5" y="3" width="14" height="18" rx="1" />
        <path d="M8 7h8M8 11h8M8 15h8M8 18h5" />
      </>
    ),
    settings: (
      <>
        <path d="m9 3 .6-1h4.8l.6 2 2 .9 2-.5 2.4 4.2-1.5 1.5V13l1.5 1.4-2.4 4.2-2-.5-2 1-.6 1.9h-4.8L9 19l-2-1-2 .6-2.4-4.2L4 13v-2.8L2.6 8.7 5 4.5l2 .5Z" />
        <circle cx="12" cy="11.5" r="3" />
      </>
    ),
    arrow: <path d="M5 19 19 5M6 5h13v13" />,
    plus: <path d="M12 5v14M5 12h14" />,
  };
  return (
    <svg
      className={`ui-icon ${className}`}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      {paths[name]}
    </svg>
  );
}
