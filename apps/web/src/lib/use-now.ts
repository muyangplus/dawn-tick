import { useEffect, useState } from 'react';

/**
 * 每 intervalMs 取一次当前时刻。
 * 用于「进行中 / 已完成 / 剩余时间」这类只随时间变化、数据没有变动的状态：
 * 没有它，界面只会在下次数据加载时才对。
 */
export function useNowTick(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}
