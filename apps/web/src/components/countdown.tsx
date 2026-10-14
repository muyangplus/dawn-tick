import { useEffect, useState } from 'react';
import { formatCountdown, formatShortCountdown } from '../lib/format.ts';
import { cn } from '../lib/cn.ts';

export interface CountdownProps {
  target: number;
  short?: boolean;
  className?: string;
}

export function Countdown({ target, short = false, className }: CountdownProps) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const remaining = target - now;
  return (
    <span className={cn('tabular font-semibold', className)}>
      {short ? formatShortCountdown(remaining) : formatCountdown(remaining)}
    </span>
  );
}
