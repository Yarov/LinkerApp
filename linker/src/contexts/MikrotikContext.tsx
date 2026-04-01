import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
import { invoke } from "@tauri-apps/api/core";

interface MikrotikContextValue {
  connected: boolean;
  checking: boolean;
  lastCheck: Date | null;
  retry: () => void;
  vpnConnected: boolean;
  vpnLatency: number | null;
  vpnLocalIp: string | null;
}

const MikrotikContext = createContext<MikrotikContextValue>({
  connected: true,
  checking: true,
  lastCheck: null,
  retry: () => {},
  vpnConnected: false,
  vpnLatency: null,
  vpnLocalIp: null,
});

export function useMikrotik() {
  return useContext(MikrotikContext);
}

export function MikrotikProvider({ children }: { children: ReactNode }) {
  const [connected, setConnected] = useState(true);
  const [checking, setChecking] = useState(false);
  const [lastCheck, setLastCheck] = useState<Date | null>(null);
  const [vpnConnected, setVpnConnected] = useState(false);
  const [vpnLatency, setVpnLatency] = useState<number | null>(null);
  const [vpnLocalIp, setVpnLocalIp] = useState<string | null>(null);
  const isChecking = useRef(false);

  const checkAll = useCallback(async () => {
    // Prevent overlapping checks
    if (isChecking.current) return;
    isChecking.current = true;
    setChecking(true);

    try {
      // Run both checks in parallel but don't block UI
      const [healthResult, vpnResult] = await Promise.allSettled([
        invoke<{ connected: boolean; latency?: number }>("health_check"),
        invoke<{ connected: boolean; localIp?: string; latency?: number }>("get_vpn_status"),
      ]);

      if (healthResult.status === "fulfilled") {
        setConnected(!!healthResult.value.connected);
      } else {
        setConnected(false);
      }

      if (vpnResult.status === "fulfilled") {
        setVpnConnected(!!vpnResult.value.connected);
        setVpnLocalIp(vpnResult.value.localIp || null);
        setVpnLatency(vpnResult.value.latency ?? null);
      } else {
        setVpnConnected(false);
      }
    } catch {
      setConnected(false);
      setVpnConnected(false);
    } finally {
      setChecking(false);
      setLastCheck(new Date());
      isChecking.current = false;
    }
  }, []);

  useEffect(() => {
    // Initial check after a small delay to not block first render
    const initialTimer = setTimeout(checkAll, 500);
    // Poll every 60 seconds (not 30 - less aggressive)
    const interval = setInterval(checkAll, 60000);
    return () => {
      clearTimeout(initialTimer);
      clearInterval(interval);
    };
  }, [checkAll]);

  return (
    <MikrotikContext.Provider
      value={{
        connected,
        checking,
        lastCheck,
        retry: checkAll,
        vpnConnected,
        vpnLatency,
        vpnLocalIp,
      }}
    >
      {children}
    </MikrotikContext.Provider>
  );
}
