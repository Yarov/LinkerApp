"use client";

import { useEffect, useRef, useCallback, useState } from "react";

interface UseAutoRefreshOptions {
  /** URL to call on each interval */
  url: string;
  /** Interval in milliseconds (default: 60000 = 60s) */
  interval?: number;
  /** Whether the auto-refresh is enabled (default: true) */
  enabled?: boolean;
  /** Called with the JSON response on each successful fetch */
  onData?: (data: unknown) => void;
  /** Called on fetch error */
  onError?: (error: Error) => void;
}

export function useAutoRefresh({
  url,
  interval = 60000,
  enabled = true,
  onData,
  onError,
}: UseAutoRefreshOptions) {
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Error ${res.status}`);
      const data = await res.json();
      setLastRefresh(new Date());
      onData?.(data);
    } catch (err) {
      onError?.(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setIsRefreshing(false);
    }
  }, [url, onData, onError]);

  useEffect(() => {
    if (!enabled) return;

    // Initial call
    refresh();

    intervalRef.current = setInterval(refresh, interval);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [refresh, interval, enabled]);

  return { lastRefresh, isRefreshing, refresh };
}
