import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';

/* ═══════════════════ TYPES ═══════════════════ */

// Raw types from Rust (snake_case)
interface RawClient {
  id: string;
  name: string;
  phone: string | null;
  address: string;
  status: string;
  pppoe_user: string;
  pppoe_password: string;
  profile_name: string;
  node_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  plan_name: string;
  download_mbps: number;
  upload_mbps: number;
  price: number;
}

export interface Client {
  id: string;
  name: string;
  phone: string | null;
  address: string;
  status: string;
  pppoeUser: string;
  pppoePassword: string;
  profileName: string;
  nodeId: string | null;
  notes: string | null;
  planName: string;
  downloadMbps: number;
  uploadMbps: number;
  price: number;
}

function mapClient(raw: RawClient): Client {
  return {
    id: raw.id,
    name: raw.name,
    phone: raw.phone,
    address: raw.address,
    status: raw.status,
    pppoeUser: raw.pppoe_user,
    pppoePassword: raw.pppoe_password,
    profileName: raw.profile_name,
    nodeId: raw.node_id,
    notes: raw.notes,
    planName: raw.plan_name,
    downloadMbps: raw.download_mbps,
    uploadMbps: raw.upload_mbps,
    price: raw.price,
  };
}

interface RawPlan {
  id: string;
  name: string;
  download_mbps: number;
  upload_mbps: number;
  price: number;
  profile_name: string;
  is_active: boolean;
  created_at: string;
}

export interface Plan {
  id: string;
  name: string;
  downloadMbps: number;
  uploadMbps: number;
  price: number;
  profileName: string;
  isActive: boolean;
}

function mapPlan(raw: RawPlan): Plan {
  return {
    id: raw.id,
    name: raw.name,
    downloadMbps: raw.download_mbps,
    uploadMbps: raw.upload_mbps,
    price: raw.price,
    profileName: raw.profile_name,
    isActive: raw.is_active,
  };
}

interface RawNode {
  id: string;
  name: string;
  type: string;
  ip: string | null;
  mac: string | null;
  model: string | null;
  firmware: string | null;
  latitude: number | null;
  longitude: number | null;
  parent_id: string | null;
  status: string;
  last_seen: string | null;
  created_at: string;
  updated_at: string;
}

export interface NodeData {
  id: string;
  name: string;
  type: string;
  ip: string;
  status: string;
  lastSeen: string | null;
  parentId: string | null;
}

function mapNode(raw: RawNode): NodeData {
  return {
    id: raw.id,
    name: raw.name,
    type: raw.type,
    ip: raw.ip ?? '',
    status: raw.status,
    lastSeen: raw.last_seen,
    parentId: raw.parent_id,
  };
}

interface RawPayment {
  id: string;
  client_id: string;
  client_name: string;
  amount: number;
  period: string;
  method: string;
  notes: string | null;
  paid_at: string;
  created_at: string;
}

export interface Payment {
  id: string;
  clientId: string;
  clientName: string;
  amount: number;
  period: string;
  method: string;
  notes: string | null;
  paidAt: string;
  createdAt: string;
}

function mapPayment(raw: RawPayment): Payment {
  return {
    id: raw.id,
    clientId: raw.client_id,
    clientName: raw.client_name,
    amount: raw.amount,
    period: raw.period,
    method: raw.method,
    notes: raw.notes,
    paidAt: raw.paid_at,
    createdAt: raw.created_at,
  };
}

interface RawAlert {
  id: string;
  node_id: string | null;
  type: string;
  message: string;
  is_read: boolean;
  created_at: string;
  node_name: string;
}

export interface Alert {
  id: string;
  nodeId: string | null;
  type: string;
  message: string;
  isRead: boolean;
  createdAt: string;
  nodeName: string;
}

function mapAlert(raw: RawAlert): Alert {
  return {
    id: raw.id,
    nodeId: raw.node_id,
    type: raw.type,
    message: raw.message,
    isRead: raw.is_read,
    createdAt: raw.created_at,
    nodeName: raw.node_name,
  };
}

interface RecentPayment {
  id: string;
  client_name: string;
  amount: number;
  paid_at: string;
  period: string;
  method: string;
}

interface DashboardAlert {
  id: string;
  node_id: string | null;
  type: string;
  message: string;
  is_read: boolean;
  created_at: string;
  node_name: string;
}

interface MikrotikStatus {
  uptime: string;
  cpu: string;
  memory: string;
  freeMemory: string;
  totalMemory: string;
  version: string;
  board: string;
}

interface DashboardData {
  totalClients: number;
  totalPlans: number;
  activeClients: number;
  monthlyRevenue: number;
  onlineNodes: number;
  totalNodes: number;
  recentPayments: RecentPayment[];
  unreadAlerts: number;
  mikrotikStatus: MikrotikStatus | null;
  mikrotikLoaded: boolean;
  pppoeActive: number;
  pppoeConfigured: boolean;
  recentAlerts: DashboardAlert[];
  lastUpdate: Date | null;
}

/* ═══════════════════ STORE ═══════════════════ */

interface AppState {
  // Sidebar
  sidebarPinned: boolean;
  toggleSidebar: () => void;
  setSidebarPinned: (v: boolean) => void;

  // Clients
  clients: Client[];
  clientsLoaded: boolean;
  clientsLoading: boolean;
  clientsError: string;
  fetchClients: () => Promise<void>;
  invalidateClients: () => void;

  // Plans
  plans: Plan[];
  plansLoaded: boolean;
  plansLoading: boolean;
  plansError: string;
  fetchPlans: () => Promise<void>;
  invalidatePlans: () => void;

  // Nodes
  nodes: NodeData[];
  nodesLoaded: boolean;
  nodesLoading: boolean;
  nodesError: string;
  fetchNodes: () => Promise<void>;
  invalidateNodes: () => void;

  // Payments (filtered by month)
  payments: Payment[];
  paymentsLoaded: boolean;
  paymentsLoading: boolean;
  paymentsError: string;
  paymentsMonth: string;
  fetchPayments: (month?: string) => Promise<void>;
  invalidatePayments: () => void;

  // Alerts
  alerts: Alert[];
  alertsLoaded: boolean;
  alertsLoading: boolean;
  alertsError: string;
  alertsDownCount: number;
  alertsUpCount: number;
  fetchAlerts: () => Promise<void>;
  invalidateAlerts: () => void;
  markAlertRead: (id: string) => Promise<void>;
  markAllAlertsRead: () => Promise<void>;
  deleteReadAlerts: () => Promise<void>;

  // Dashboard
  dashboard: DashboardData;
  dashboardLoaded: boolean;
  dashboardLoading: boolean;
  dashboardError: string;
  fetchDashboard: () => Promise<void>;
  invalidateDashboard: () => void;

  // Global invalidation
  invalidateAll: () => void;
}

const defaultDashboard: DashboardData = {
  totalClients: 0,
  totalPlans: 0,
  activeClients: 0,
  monthlyRevenue: 0,
  onlineNodes: 0,
  totalNodes: 0,
  recentPayments: [],
  unreadAlerts: 0,
  mikrotikStatus: null,
  mikrotikLoaded: false,
  pppoeActive: 0,
  pppoeConfigured: true,
  recentAlerts: [],
  lastUpdate: null,
};

export const useAppStore = create<AppState>((set, get) => ({
  // ── Sidebar ──
  sidebarPinned: (() => {
    try {
      return localStorage.getItem('sidebar-pinned') === 'true';
    } catch {
      return false;
    }
  })(),

  toggleSidebar: () => {
    const next = !get().sidebarPinned;
    set({ sidebarPinned: next });
    try { localStorage.setItem('sidebar-pinned', String(next)); } catch { /* ignore */ }
  },

  setSidebarPinned: (v: boolean) => {
    set({ sidebarPinned: v });
    try { localStorage.setItem('sidebar-pinned', String(v)); } catch { /* ignore */ }
  },

  // ── Clients ──
  clients: [],
  clientsLoaded: false,
  clientsLoading: false,
  clientsError: '',

  fetchClients: async () => {
    if (get().clientsLoading) return;
    set({ clientsLoading: true, clientsError: '' });
    try {
      const data = await invoke<{ clients: RawClient[] }>('list_clients');
      const rawClients = data?.clients ?? [];
      set({ clients: rawClients.map(mapClient), clientsLoaded: true, clientsLoading: false });
    } catch (err) {
      set({ clientsError: String(err), clientsLoading: false });
    }
  },

  invalidateClients: () => set({ clientsLoaded: false }),

  // ── Plans ──
  plans: [],
  plansLoaded: false,
  plansLoading: false,
  plansError: '',

  fetchPlans: async () => {
    if (get().plansLoading) return;
    set({ plansLoading: true, plansError: '' });
    try {
      const data = await invoke<{ plans: RawPlan[] }>('list_plans');
      const rawPlans = data?.plans ?? [];
      set({ plans: rawPlans.map(mapPlan), plansLoaded: true, plansLoading: false });
    } catch (err) {
      set({ plansError: String(err), plansLoading: false });
    }
  },

  invalidatePlans: () => set({ plansLoaded: false }),

  // ── Nodes ──
  nodes: [],
  nodesLoaded: false,
  nodesLoading: false,
  nodesError: '',

  fetchNodes: async () => {
    if (get().nodesLoading) return;
    set({ nodesLoading: true, nodesError: '' });
    try {
      const data = await invoke<{ nodes: RawNode[] }>('list_nodes');
      const rawNodes = data?.nodes ?? [];
      set({ nodes: rawNodes.map(mapNode), nodesLoaded: true, nodesLoading: false });
    } catch (err) {
      set({ nodesError: String(err), nodesLoading: false });
    }
  },

  invalidateNodes: () => set({ nodesLoaded: false }),

  // ── Payments ──
  payments: [],
  paymentsLoaded: false,
  paymentsLoading: false,
  paymentsError: '',
  paymentsMonth: '',

  fetchPayments: async (month?: string) => {
    if (get().paymentsLoading) return;
    const targetMonth = month ?? get().paymentsMonth;
    set({ paymentsLoading: true, paymentsError: '', paymentsMonth: targetMonth });
    try {
      const data = await invoke<{ payments: RawPayment[]; total: number; paid_count: number; pending_count: number; period: string }>(
        'list_payments',
        { month: targetMonth || undefined }
      );
      const rawPayments = data?.payments ?? [];
      set({ payments: rawPayments.map(mapPayment), paymentsLoaded: true, paymentsLoading: false });
    } catch (err) {
      set({ paymentsError: String(err), paymentsLoading: false });
    }
  },

  invalidatePayments: () => set({ paymentsLoaded: false }),

  // ── Alerts ──
  alerts: [],
  alertsLoaded: false,
  alertsLoading: false,
  alertsError: '',
  alertsDownCount: 0,
  alertsUpCount: 0,

  fetchAlerts: async () => {
    if (get().alertsLoading) return;
    set({ alertsLoading: true, alertsError: '' });
    try {
      const data = await invoke<{ alerts: RawAlert[]; unread_count: number; down_count: number; up_count: number }>('list_alerts');
      const rawAlerts = data?.alerts ?? [];
      set({
        alerts: rawAlerts.map(mapAlert),
        alertsDownCount: data?.down_count ?? 0,
        alertsUpCount: data?.up_count ?? 0,
        alertsLoaded: true,
        alertsLoading: false,
      });
    } catch (err) {
      set({ alertsError: String(err), alertsLoading: false });
    }
  },

  invalidateAlerts: () => set({ alertsLoaded: false }),

  markAlertRead: async (id: string) => {
    try {
      await invoke('mark_alert_read', { id });
      set({ alerts: get().alerts.map(a => a.id === id ? { ...a, isRead: true } : a) });
    } catch { /* ignore */ }
  },

  markAllAlertsRead: async () => {
    try {
      await invoke('mark_all_alerts_read');
      set({ alerts: get().alerts.map(a => ({ ...a, isRead: true })) });
    } catch { /* ignore */ }
  },

  deleteReadAlerts: async () => {
    try {
      await invoke('delete_read_alerts');
      set({ alerts: get().alerts.filter(a => !a.isRead) });
    } catch { /* ignore */ }
  },

  // ── Dashboard ──
  dashboard: defaultDashboard,
  dashboardLoaded: false,
  dashboardLoading: false,
  dashboardError: '',

  fetchDashboard: async () => {
    if (get().dashboardLoading) return;
    // Only show loading state if we don't have data yet (first load)
    // Subsequent refreshes are silent (no skeleton flash)
    const isFirstLoad = !get().dashboardLoaded;
    set({ dashboardLoading: isFirstLoad, dashboardError: '' });

    try {
      // Fetch all dashboard data in parallel
      const [dashRaw, statusData, pppoeData, alertsData] = await Promise.allSettled([
        invoke<Record<string, unknown>>('get_dashboard'),
        invoke<Record<string, unknown>>('get_system_status'),
        invoke<Record<string, unknown>>('get_pppoe_sessions'),
        invoke<{ alerts: DashboardAlert[] }>('get_recent_alerts'),
      ]);

      const current = get().dashboard;
      const updates: DashboardData = { ...current };

      // Dashboard data
      if (dashRaw.status === 'fulfilled' && dashRaw.value) {
        const raw = dashRaw.value;
        updates.totalClients = (raw.total_clients as number) ?? 0;
        updates.totalPlans = (raw.total_plans as number) ?? 0;
        updates.activeClients = (raw.active_clients as number) ?? 0;
        updates.monthlyRevenue = (raw.monthly_revenue as number) ?? 0;
        updates.onlineNodes = (raw.online_nodes as number) ?? 0;
        updates.totalNodes = (raw.total_nodes as number) ?? 0;
        updates.unreadAlerts = (raw.unread_alerts as number) ?? 0;
        updates.recentPayments = (raw.recent_payments as RecentPayment[]) ?? [];
      }

      // MikroTik status
      if (statusData.status === 'fulfilled' && statusData.value?.connected && statusData.value.resource) {
        const res = statusData.value.resource as Record<string, string>;
        const free = parseInt(res['free-memory'] ?? '0', 10);
        const total = parseInt(res['total-memory'] ?? '1', 10);
        const memPercent = total > 0 ? Math.round(((total - free) / total) * 100) : 0;
        updates.mikrotikStatus = {
          uptime: res['uptime'] ?? '-',
          version: res['version'] ?? '-',
          board: res['board-name'] ?? '-',
          cpu: res['cpu-load'] + '%',
          memory: memPercent + '%',
          freeMemory: free > 1048576 ? `${Math.round(free / 1048576)}MB` : '-',
          totalMemory: total > 1048576 ? `${Math.round(total / 1048576)}MB` : '-',
        };
      }
      updates.mikrotikLoaded = true;

      // PPPoE sessions
      if (pppoeData.status === 'fulfilled' && pppoeData.value) {
        const data = pppoeData.value;
        updates.pppoeActive = (data?.count as number) ?? 0;
        if (typeof data.configured === 'boolean') {
          updates.pppoeConfigured = data.configured as boolean;
        } else if (typeof data?.count === 'number') {
          updates.pppoeConfigured = true;
        }
      } else {
        updates.pppoeConfigured = false;
      }

      // Recent alerts
      if (alertsData.status === 'fulfilled') {
        updates.recentAlerts = alertsData.value?.alerts ?? [];
      }

      updates.lastUpdate = new Date();

      // Run monitor in background
      invoke('run_monitor').catch(() => {});

      set({ dashboard: updates, dashboardLoaded: true, dashboardLoading: false });
    } catch (err) {
      set({ dashboardError: String(err), dashboardLoading: false });
    }
  },

  invalidateDashboard: () => set({ dashboardLoaded: false }),

  // ── Global ──
  invalidateAll: () => {
    set({
      clientsLoaded: false,
      plansLoaded: false,
      nodesLoaded: false,
      paymentsLoaded: false,
      alertsLoaded: false,
      dashboardLoaded: false,
    });
  },
}));
