import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement>;
const base = (props: P) => ({ viewBox: '0 0 24 24', fill: 'currentColor', 'aria-hidden': true, ...props });

export const PlayIcon = (p: P) => (
  <svg {...base(p)}><path d="M8 5.14v13.72a1 1 0 0 0 1.5.86l11.04-6.86a1 1 0 0 0 0-1.72L9.5 4.28A1 1 0 0 0 8 5.14Z" /></svg>
);
export const PauseIcon = (p: P) => (
  <svg {...base(p)}><rect x="6" y="4.5" width="4" height="15" rx="1.2" /><rect x="14" y="4.5" width="4" height="15" rx="1.2" /></svg>
);
export const ReplayIcon = (p: P) => (
  <svg {...base(p)}><path d="M12 5V2L7 6l5 4V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7Z" /></svg>
);
export const VolumeIcon = ({ level, ...p }: P & { level: number }) => (
  <svg {...base(p)}>
    <path d="M4 9.5v5a1 1 0 0 0 1 1h3l4.3 3.6a1 1 0 0 0 1.7-.8V5.7a1 1 0 0 0-1.7-.8L8 8.5H5a1 1 0 0 0-1 1Z" />
    {level > 0 && <path d="M16.5 8.5a5 5 0 0 1 0 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />}
    {level > 0.5 && <path d="M19 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />}
    {level === 0 && <path d="m16 9.5 5 5m0-5-5 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />}
  </svg>
);
export const SparklesIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M10 3.5 11.6 8a2 2 0 0 0 1.2 1.2l4.5 1.6-4.5 1.6a2 2 0 0 0-1.2 1.2L10 18.1l-1.6-4.5a2 2 0 0 0-1.2-1.2L2.7 10.8l4.5-1.6A2 2 0 0 0 8.4 8L10 3.5Z" />
    <path d="M18 2.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7.7-1.8ZM18 15.5l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9.9-2.1Z" />
  </svg>
);
export const StatsIcon = (p: P) => (
  <svg {...base(p)}><path d="M5 20V11h3v9H5Zm5.5 0V4h3v16h-3ZM16 20v-6h3v6h-3Z" /></svg>
);
export const FullscreenIcon = ({ active, ...p }: P & { active: boolean }) => (
  <svg {...base(p)} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    {active ? <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" /> : <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />}
  </svg>
);
export const UploadIcon = (p: P) => (
  <svg {...base(p)} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 16V4m0 0L7 9m5-5 5 5M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
  </svg>
);
