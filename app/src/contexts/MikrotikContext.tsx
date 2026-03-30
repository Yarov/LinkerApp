"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";

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
  const [checking, setChecking] = useState(true);
  const [lastCheck, setLastCheck] = useState<Date | null>(null);

  // VPN state
  const [vpnConnected, setVpnConnected] = useState(false);
  const [vpnLatency, setVpnLatency] = useState<number | null>(null);
  const [vpnLocalIp, setVpnLocalIp] = useState<string | null>(null);

  const checkHealth = useCallback(async () => {
    setChecking(true);
    try {
      const res = await fetch("/api/mikrotik/health");
      const data = await res.json();
      setConnected(!!data.connected);
    } catch {
      setConnected(false);
    } finally {
      setChecking(false);
      setLastCheck(new Date());
    }
  }, []);

  const checkVpn = useCallback(async () => {
    try {
      const res = await fetch("/api/vpn/status");
      if (res.ok) {
        const data = await res.json();
        setVpnConnected(!!data.connected);
        setVpnLocalIp(data.localIp || null);
      } else {
        setVpnConnected(false);
      }
    } catch {
      setVpnConnected(false);
    }
  }, []);

  useEffect(() => {
    checkHealth();
    checkVpn();
    const healthInterval = setInterval(checkHealth, 30000);
    const vpnInterval = setInterval(checkVpn, 30000);
    return () => {
      clearInterval(healthInterval);
      clearInterval(vpnInterval);
    };
  }, [checkHealth, checkVpn]);

  return (
    <MikrotikContext.Provider
      value={{
        connected,
        checking,
        lastCheck,
        retry: checkHealth,
        vpnConnected,
        vpnLatency,
        vpnLocalIp,
      }}
    >
      {children}
    </MikrotikContext.Provider>
  );
}
