import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';

interface MikrotikState {
  connected: boolean;
  checking: boolean;
  lastCheck: Date | null;
  vpnConnected: boolean;
  vpnLatency: number | null;
  vpnLocalIp: string | null;
  _isChecking: boolean;
  _failCount: number; // Track consecutive failures

  checkAll: () => Promise<void>;
  retry: () => Promise<void>;
  startPolling: () => () => void;
}

export const useMikrotikStore = create<MikrotikState>((set, get) => ({
  connected: true, // Optimistic default
  checking: false,
  lastCheck: null,
  vpnConnected: false,
  vpnLatency: null,
  vpnLocalIp: null,
  _isChecking: false,
  _failCount: 0,

  checkAll: async () => {
    if (get()._isChecking) return;
    set({ _isChecking: true, checking: true });

    try {
      // Health check with timeout wrapper
      const healthPromise = invoke<{ connected: boolean; latency?: number }>('health_check');
      const vpnPromise = invoke<{ connected: boolean; localIp?: string; latency?: number }>('get_vpn_status');

      // Race against a 8-second timeout (VPN latency can be 500ms+)
      const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 8000));

      const [healthRaw, vpnRaw] = await Promise.all([
        Promise.race([healthPromise, timeout]),
        Promise.race([vpnPromise, timeout]),
      ]);

      const health = healthRaw as { connected: boolean; latency?: number } | null;
      const vpn = vpnRaw as { connected: boolean; localIp?: string; latency?: number } | null;

      const healthOk = !!health?.connected;
      const vpnOk = !!vpn?.connected;

      if (healthOk) {
        // Connected - reset fail counter
        set({
          connected: true,
          _failCount: 0,
          vpnConnected: vpnOk,
          vpnLocalIp: vpn?.localIp ?? null,
          vpnLatency: vpn?.latency ?? null,
        });
      } else {
        // Failed - only mark disconnected after 2 consecutive failures
        const newFailCount = get()._failCount + 1;
        if (newFailCount >= 2) {
          set({ connected: false, _failCount: newFailCount });
        } else {
          // First failure - keep current state, just increment counter
          set({ _failCount: newFailCount });
        }

        // VPN state updates regardless
        set({
          vpnConnected: vpnOk,
          vpnLocalIp: vpn?.localIp ?? null,
        });
      }
    } catch {
      // Exception - increment fail counter
      const newFailCount = get()._failCount + 1;
      if (newFailCount >= 2) {
        set({ connected: false, vpnConnected: false, _failCount: newFailCount });
      } else {
        set({ _failCount: newFailCount });
      }
    } finally {
      set({ checking: false, lastCheck: new Date(), _isChecking: false });
    }
  },

  retry: async () => {
    set({ _failCount: 0 }); // Reset on manual retry
    await get().checkAll();
  },

  startPolling: () => {
    const { checkAll } = get();
    // Initial check after 1 second (give app time to render)
    const initialTimer = setTimeout(checkAll, 1000);
    // Poll every 90 seconds (not 60 - less aggressive with high latency VPN)
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        checkAll();
      }
    }, 90000);

    return () => {
      clearTimeout(initialTimer);
      clearInterval(interval);
    };
  },
}));
