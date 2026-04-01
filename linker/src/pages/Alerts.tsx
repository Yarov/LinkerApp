import { useState, useEffect } from "react";
import { AlertTriangle, Bell, CheckCircle, Wifi, WifiOff, DollarSign, Trash2, Eye, CheckCheck, ShieldCheck } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import Skeleton from "@/components/Skeleton";
import { useAppStore } from "@/stores/useAppStore";

const typeConfig: Record<string, { icon: React.ReactNode; border: string; bg: string; dot: string; label: string; suggestion: string }> = {
  NODE_DOWN: {
    icon: <WifiOff className="h-5 w-5 text-[#dc2626]" />,
    border: "border-l-[#dc2626]",
    bg: "bg-[#fef2f2]",
    dot: "bg-[#dc2626]",
    label: "Nodo caido",
    suggestion: "Verificar conexion fisica y alimentacion electrica",
  },
  NODE_UP: {
    icon: <Wifi className="h-5 w-5 text-[#16a34a]" />,
    border: "border-l-[#16a34a]",
    bg: "bg-[#f0fdf4]",
    dot: "bg-[#16a34a]",
    label: "Nodo recuperado",
    suggestion: "",
  },
  LINK_DOWN: {
    icon: <WifiOff className="h-5 w-5 text-[#dc2626]" />,
    border: "border-l-[#dc2626]",
    bg: "bg-[#fef2f2]",
    dot: "bg-[#dc2626]",
    label: "Enlace caido",
    suggestion: "Revisar cableado y alineacion de antena",
  },
  LINK_UP: {
    icon: <Wifi className="h-5 w-5 text-[#16a34a]" />,
    border: "border-l-[#16a34a]",
    bg: "bg-[#f0fdf4]",
    dot: "bg-[#16a34a]",
    label: "Enlace activo",
    suggestion: "",
  },
  PAYMENT_DUE: {
    icon: <DollarSign className="h-5 w-5 text-[#f59e0b]" />,
    border: "border-l-[#f59e0b]",
    bg: "bg-[#fffbeb]",
    dot: "bg-[#f59e0b]",
    label: "Pago pendiente",
    suggestion: "Contactar al cliente para recordar pago",
  },
};

const defaultConfig = {
  icon: <Bell className="h-5 w-5 text-[#006fff]" />,
  border: "border-l-[#006fff]",
  bg: "bg-[#eff6ff]",
  dot: "bg-[#006fff]",
  label: "Alerta",
  suggestion: "",
};

export default function AlertasPage() {
  const alerts = useAppStore(s => s.alerts);
  const alertsLoaded = useAppStore(s => s.alertsLoaded);
  const alertsLoading = useAppStore(s => s.alertsLoading);
  const alertsError = useAppStore(s => s.alertsError);
  const alertsDownCount = useAppStore(s => s.alertsDownCount);
  const alertsUpCount = useAppStore(s => s.alertsUpCount);
  const fetchAlerts = useAppStore(s => s.fetchAlerts);
  const invalidateAlerts = useAppStore(s => s.invalidateAlerts);
  const markAlertRead = useAppStore(s => s.markAlertRead);
  const markAllAlertsRead = useAppStore(s => s.markAllAlertsRead);
  const deleteReadAlerts = useAppStore(s => s.deleteReadAlerts);

  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [showRead, setShowRead] = useState(false);

  useEffect(() => {
    if (!alertsLoaded && !alertsLoading) fetchAlerts();
  }, [alertsLoaded, alertsLoading, fetchAlerts]);

  const handleRefresh = () => {
    invalidateAlerts();
    fetchAlerts();
  };

  const formatTimeAgo = (dateStr?: string) => {
    if (!dateStr) return "";
    try {
      return formatDistanceToNow(new Date(dateStr), { addSuffix: true, locale: es });
    } catch {
      return "";
    }
  };

  const unreadAlerts = alerts.filter(a => !a.isRead);
  const readAlerts = alerts.filter(a => a.isRead);
  const unreadCount = unreadAlerts.length;
  const readCount = readAlerts.length;

  const alertTypes = ["all", ...Array.from(new Set(alerts.map(a => a.type).filter(Boolean)))];
  const typeLabels: Record<string, string> = {
    all: "Todas",
    NODE_DOWN: "Nodo caido",
    NODE_UP: "Recuperado",
    LINK_DOWN: "Enlace caido",
    LINK_UP: "Enlace activo",
    PAYMENT_DUE: "Pago pendiente",
  };

  const filteredUnread = typeFilter === "all" ? unreadAlerts : unreadAlerts.filter(a => a.type === typeFilter);
  const filteredRead = typeFilter === "all" ? readAlerts : readAlerts.filter(a => a.type === typeFilter);

  const loading = alertsLoading && !alertsLoaded;

  if (loading) return (
    <div className="space-y-6">
      <Skeleton className="h-7 w-24" />
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex items-start gap-4 rounded-2xl border border-[#e2e8f0] p-4">
          <Skeleton className="h-5 w-5 rounded-full" />
          <div className="flex-1">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="mt-2 h-3 w-20" />
          </div>
        </div>
      ))}
    </div>
  );

  if (alertsError) return (
    <div className="flex flex-col items-center justify-center py-20">
      <div className="rounded-2xl border border-[#e2e8f0] bg-white p-8 text-center shadow-sm">
        <AlertTriangle className="mx-auto h-10 w-10 text-[#dc2626]" />
        <p className="mt-4 text-sm text-[#dc2626]">{alertsError}</p>
        <button onClick={handleRefresh} className="mt-4 rounded-xl bg-[#006fff] px-5 py-2 text-sm font-medium text-white">Reintentar</button>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-[#0f172a]">Alertas</h1>
          {unreadCount > 0 ? (
            <p className="mt-1 text-sm text-[#475569]">
              {unreadCount} alerta{unreadCount !== 1 ? "s" : ""} activa{unreadCount !== 1 ? "s" : ""}
              {alertsDownCount > 0 && <span className="text-[#dc2626]"> - {alertsDownCount} nodo{alertsDownCount !== 1 ? "s" : ""} caido{alertsDownCount !== 1 ? "s" : ""}</span>}
              {alertsUpCount > 0 && <span className="text-[#16a34a]"> - {alertsUpCount} recuperado{alertsUpCount !== 1 ? "s" : ""}</span>}
            </p>
          ) : (
            <p className="mt-1 text-sm text-[#16a34a]">Todo funcionando correctamente</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {unreadCount > 0 && (
            <button onClick={markAllAlertsRead} className="flex items-center gap-2 rounded-xl border border-[#e2e8f0] px-4 py-2 text-sm text-[#475569] hover:bg-[#f5f7fa]">
              <CheckCheck className="h-4 w-4" />
              Marcar todas leidas
            </button>
          )}
          {readCount > 0 && (
            <button onClick={deleteReadAlerts} className="flex items-center gap-2 rounded-xl border border-[#dc2626]/20 px-4 py-2 text-sm text-[#dc2626] hover:bg-[#fef2f2]">
              <Trash2 className="h-4 w-4" />
              Limpiar leidas
            </button>
          )}
        </div>
      </div>

      {/* Filter pills */}
      <div className="flex flex-wrap gap-2">
        {alertTypes.map(type => (
          <button
            key={type}
            onClick={() => setTypeFilter(type)}
            className={`rounded-xl px-4 py-2 text-xs font-medium transition-colors ${
              typeFilter === type
                ? "bg-[#eff6ff] text-[#006fff] ring-1 ring-[#006fff]/30"
                : "bg-white text-[#94a3b8] hover:bg-[#f5f7fa]"
            }`}
          >
            {typeLabels[type] ?? type}
          </button>
        ))}
      </div>

      {/* Active alerts */}
      <div className="space-y-2">
        {filteredUnread.length === 0 && filteredRead.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-[#e2e8f0] bg-white py-20 shadow-sm">
            <ShieldCheck className="h-12 w-12 text-[#16a34a]" />
            <p className="mt-4 text-sm font-medium text-[#16a34a]">Todo esta funcionando correctamente</p>
            <p className="mt-1 text-xs text-[#94a3b8]">No hay alertas pendientes</p>
          </div>
        ) : (
          <>
            {filteredUnread.map(alert => {
              const cfg = typeConfig[alert.type] ?? defaultConfig;
              return (
                <div key={alert.id} className={`flex items-start gap-4 rounded-2xl border border-[#e2e8f0] border-l-4 p-4 ${cfg.border} ${cfg.bg}`}>
                  <div className="mt-0.5 shrink-0">{cfg.icon}</div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className={`inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-[10px] font-semibold uppercase ${cfg.bg}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${cfg.dot}`} />
                        {cfg.label}
                      </span>
                    </div>
                    <p className="mt-1 text-sm font-medium text-[#0f172a]">
                      {alert.nodeName && <span className="font-semibold">{alert.nodeName}</span>}
                      {alert.nodeName && " - "}
                      {alert.message}
                    </p>
                    {cfg.suggestion && (
                      <p className="mt-1 text-xs text-[#475569] italic">
                        Sugerencia: {cfg.suggestion}
                      </p>
                    )}
                    <p className="mt-2 text-xs text-[#94a3b8]">{formatTimeAgo(alert.createdAt)}</p>
                  </div>
                  <button
                    onClick={() => markAlertRead(alert.id)}
                    className="shrink-0 rounded-xl p-2 text-[#94a3b8] transition-colors hover:bg-white hover:text-[#0f172a]"
                    title="Marcar como leida"
                  >
                    <Eye className="h-4 w-4" />
                  </button>
                </div>
              );
            })}

            {/* Read alerts section */}
            {filteredRead.length > 0 && (
              <div className="mt-6">
                <button
                  onClick={() => setShowRead(!showRead)}
                  className="mb-3 flex items-center gap-2 text-sm text-[#94a3b8] hover:text-[#475569]"
                >
                  <CheckCircle className="h-4 w-4" />
                  {showRead ? "Ocultar" : "Mostrar"} historial ({filteredRead.length} leida{filteredRead.length !== 1 ? "s" : ""})
                </button>
                {showRead && (
                  <div className="space-y-2">
                    {filteredRead.map(alert => {
                      const cfg = typeConfig[alert.type] ?? defaultConfig;
                      return (
                        <div key={alert.id} className="flex items-start gap-4 rounded-2xl border border-[#e2e8f0] border-l-4 border-l-[#e2e8f0] bg-white p-4 opacity-60">
                          <div className="mt-0.5 shrink-0">{cfg.icon}</div>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm text-[#475569]">
                              {alert.nodeName && <span>{alert.nodeName} - </span>}
                              {alert.message}
                            </p>
                            <p className="mt-1 text-xs text-[#94a3b8]">{formatTimeAgo(alert.createdAt)}</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
