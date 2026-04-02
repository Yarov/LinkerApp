import { useState, useEffect, useCallback } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Pencil, Power, Phone, MapPin, Wifi, User, AlertTriangle, Eye, EyeOff, Copy, Check } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import StatusBadge from "@/components/StatusBadge";
import ClientForm from "@/components/ClientForm";
import ConfirmDialog from "@/components/ConfirmDialog";
import Skeleton from "@/components/Skeleton";
import { useMikrotikStore } from "@/stores/useMikrotikStore";
import { useAppStore } from "@/stores/useAppStore";

// Rust list_clients returns { clients: [...] } with snake_case fields
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
  plan_name: string;
  download_mbps: number;
  upload_mbps: number;
  price: number;
}

interface ClientDetailData {
  id: string;
  name: string;
  phone: string | null;
  address: string;
  pppoeUser: string;
  pppoePassword: string;
  profileName: string;
  status: string;
  nodeId: string | null;
  planName: string;
  downloadMbps: number;
  uploadMbps: number;
  price: number;
}

// Rust list_payments returns { payments: [...] } with snake_case
interface RawPayment {
  id: string;
  client_id: string;
  amount: number;
  period: string;
  method: string;
  paid_at: string;
  created_at: string;
  client_name: string;
}

interface Payment {
  id: string;
  amount: number;
  period: string;
  method: string;
  paidAt: string;
  createdAt: string;
}

const methodLabels: Record<string, string> = { EFECTIVO: "Efectivo", TRANSFERENCIA: "Transferencia", OTRO: "Otro" };
const methodBadgeColors: Record<string, string> = { EFECTIVO: "bg-[#f0fdf4] text-[#16a34a]", TRANSFERENCIA: "bg-[#eff6ff] text-[#006fff]", OTRO: "bg-[#f5f7fa] text-[#475569]" };

export default function ClienteDetailPage() {
  const navigate = useNavigate();
  const { id: clientId } = useParams<{ id: string }>();
  const mikrotikConnected = useMikrotikStore(s => s.connected);
  const invalidateDashboard = useAppStore(s => s.invalidateDashboard);
  const invalidateClients = useAppStore(s => s.invalidateClients);
  const [client, setClient] = useState<ClientDetailData | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true); const [error, setError] = useState("");
  const [showEditForm, setShowEditForm] = useState(false);
  const [confirmToggle, setConfirmToggle] = useState(false); const [toggling, setToggling] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(label);
      setTimeout(() => setCopied(null), 2000);
    }).catch(() => {});
  };

  const fetchClient = useCallback(() => {
    // No get_client command exists - use list_clients and find by id
    invoke<{ clients: RawClient[] }>("list_clients")
      .then(data => {
        const raw = (data?.clients ?? []).find(c => c.id === clientId);
        if (raw) {
          setClient({
            id: raw.id,
            name: raw.name,
            phone: raw.phone,
            address: raw.address,
            pppoeUser: raw.pppoe_user,
            pppoePassword: raw.pppoe_password,
            profileName: raw.profile_name,
            status: raw.status,
            nodeId: raw.node_id,
            planName: raw.plan_name,
            downloadMbps: raw.download_mbps,
            uploadMbps: raw.upload_mbps,
            price: raw.price,
          });
        } else {
          setError("Cliente no encontrado");
        }
        setLoading(false);
      })
      .catch(err => { setError(String(err)); setLoading(false); });
  }, [clientId]);

  const fetchPayments = useCallback(() => {
    // list_payments requires month param, get current month and filter by client_id
    invoke<{ payments: RawPayment[] }>("list_payments", {})
      .then(data => {
        const clientPayments = (data?.payments ?? [])
          .filter(p => p.client_id === clientId)
          .map(p => ({
            id: p.id,
            amount: p.amount,
            period: p.period,
            method: p.method,
            paidAt: p.paid_at,
            createdAt: p.created_at,
          }));
        setPayments(clientPayments);
      })
      .catch(() => setPayments([]));
  }, [clientId]);

  useEffect(() => { fetchClient(); }, [fetchClient]);
  useEffect(() => { if (client) fetchPayments(); }, [client, fetchPayments]);

  const handleToggle = async () => {
    setToggling(true); setConfirmToggle(false);
    try { await invoke("toggle_client", { id: clientId }); invalidateClients(); invalidateDashboard(); fetchClient(); } catch { alert("Error al cambiar el estado del cliente"); } finally { setToggling(false); }
  };

  if (loading) return (<div className="space-y-6"><div className="flex items-center justify-between"><div className="flex items-center gap-4"><Skeleton className="h-10 w-10 rounded-xl" /><div><Skeleton className="h-7 w-40" /><div className="mt-2 flex items-center gap-2"><Skeleton className="h-5 w-16 rounded-lg" /><Skeleton className="h-4 w-24" /></div></div></div></div></div>);
  if (error || !client) return (<div className="flex flex-col items-center justify-center py-20"><div className="rounded-2xl border border-[#e2e8f0] bg-white p-8 text-center shadow-sm"><AlertTriangle className="mx-auto h-10 w-10 text-[#dc2626]" /><p className="mt-4 text-sm text-[#dc2626]">{error || "Cliente no encontrado"}</p><button onClick={() => navigate("/clientes")} className="mt-4 rounded-xl bg-[#006fff] px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-[#0057cc]">Volver a Clientes</button></div></div>);

  const status = (client.status ?? "").toUpperCase(); const isActive = status === "ACTIVE";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button onClick={() => navigate("/clientes")} className="rounded-xl border border-[#e2e8f0] p-2 text-[#475569] transition-colors hover:bg-[#f5f7fa] hover:text-[#0f172a]"><ArrowLeft className="h-5 w-5" /></button>
          <div><h1 className="text-2xl font-semibold tracking-tight text-[#0f172a]">{client.name}</h1><div className="mt-1 flex items-center gap-2"><StatusBadge status={client.status ?? "unknown"} size="sm" />{client.planName && <span className="text-sm text-[#475569]">{client.planName}</span>}</div></div>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={() => setShowEditForm(true)} disabled={!mikrotikConnected} className={`flex items-center gap-2 rounded-xl border border-[#e2e8f0] px-4 py-2.5 text-sm transition-colors ${mikrotikConnected ? "text-[#475569] hover:bg-[#f5f7fa] hover:text-[#0f172a]" : "cursor-not-allowed text-[#475569] opacity-50"}`}><Pencil className="h-4 w-4" />Editar</button>
          <button onClick={() => setConfirmToggle(true)} disabled={toggling || !mikrotikConnected} className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium text-white transition-colors disabled:opacity-50 ${!mikrotikConnected ? "cursor-not-allowed bg-[#94a3b8]" : isActive ? "bg-[#dc2626] hover:bg-[#b91c1c]" : "bg-[#16a34a] hover:bg-[#15803d]"}`}><Power className="h-4 w-4" />{isActive ? "Suspender" : "Reactivar"}</button>
        </div>
      </div>
      <div className="rounded-2xl border border-[#e2e8f0] bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-xs font-medium uppercase tracking-widest text-[#94a3b8]">Informacion del cliente</h2>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {[{ icon: User, label: "Nombre", value: client.name }, { icon: Phone, label: "Telefono", value: client.phone || "Sin telefono" }, { icon: MapPin, label: "Direccion", value: client.address }].map((item, i) => (
            <div key={i} className="flex items-start gap-3"><div className="rounded-lg bg-[#eff6ff] p-2"><item.icon className="h-4 w-4 text-[#006fff]" /></div><div><p className="text-xs text-[#94a3b8]">{item.label}</p><p className="text-sm font-medium text-[#0f172a]">{item.value}</p></div></div>
          ))}
          <div className="flex items-start gap-3"><div className="rounded-lg bg-[#eff6ff] p-2"><Wifi className="h-4 w-4 text-[#006fff]" /></div><div><p className="text-xs text-[#94a3b8]">Plan</p><p className="text-sm font-medium text-[#0f172a]">{client.planName || client.profileName || "-"}{client.downloadMbps > 0 && <span className="text-[#475569]"> ({client.downloadMbps}/{client.uploadMbps} Mbps)</span>}</p>{client.price > 0 && <p className="text-xs text-[#006fff] font-medium">${client.price}/mes</p>}</div></div>
        </div>
      </div>

      {/* PPPoE Credentials */}
      <div className="rounded-2xl border border-[#e2e8f0] bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-xs font-medium uppercase tracking-widest text-[#94a3b8]">Credenciales PPPoE</h2>
        <div className="space-y-3">
          <div className="flex items-center justify-between rounded-xl bg-[#f5f7fa] px-4 py-3">
            <div>
              <p className="text-xs text-[#94a3b8]">Usuario</p>
              <p className="font-mono text-sm font-medium text-[#0f172a]">{client.pppoeUser}</p>
            </div>
            <button
              onClick={() => copyToClipboard(client.pppoeUser, "user")}
              className="flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-[#475569] shadow-sm hover:bg-[#e2e8f0]"
            >
              {copied === "user" ? <><Check className="h-3.5 w-3.5 text-[#16a34a]" />Copiado</> : <><Copy className="h-3.5 w-3.5" />Copiar</>}
            </button>
          </div>
          <div className="flex items-center justify-between rounded-xl bg-[#f5f7fa] px-4 py-3">
            <div>
              <p className="text-xs text-[#94a3b8]">Contrasena</p>
              <p className="font-mono text-sm font-medium text-[#0f172a]">
                {showPassword ? client.pppoePassword : "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022"}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowPassword(!showPassword)}
                className="rounded-lg bg-white p-1.5 text-[#475569] shadow-sm hover:bg-[#e2e8f0]"
              >
                {showPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
              <button
                onClick={() => copyToClipboard(client.pppoePassword, "pass")}
                className="flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-[#475569] shadow-sm hover:bg-[#e2e8f0]"
              >
                {copied === "pass" ? <><Check className="h-3.5 w-3.5 text-[#16a34a]" />Copiado</> : <><Copy className="h-3.5 w-3.5" />Copiar</>}
              </button>
            </div>
          </div>
        </div>
        <p className="mt-3 text-[11px] text-[#94a3b8]">Estas credenciales se configuran en el modem/router del cliente en modo PPPoE.</p>
      </div>

      <div className="rounded-2xl border border-[#e2e8f0] bg-white shadow-sm">
        <div className="border-b border-[#e2e8f0] px-6 py-4"><h2 className="text-sm font-semibold text-[#0f172a]">Historial de Pagos</h2><p className="mt-0.5 text-xs text-[#94a3b8]">{payments.length} pagos registrados</p></div>
        <table className="w-full text-left text-sm">
          <thead><tr className="border-b border-[#e2e8f0] bg-[#f5f7fa]"><th className="px-5 py-3 text-xs font-medium uppercase tracking-widest text-[#94a3b8]">Monto</th><th className="px-5 py-3 text-xs font-medium uppercase tracking-widest text-[#94a3b8]">Periodo</th><th className="px-5 py-3 text-xs font-medium uppercase tracking-widest text-[#94a3b8]">Metodo</th><th className="px-5 py-3 text-xs font-medium uppercase tracking-widest text-[#94a3b8]">Fecha</th></tr></thead>
          <tbody>
            {payments.length === 0 ? <tr><td colSpan={4} className="px-5 py-12 text-center text-sm text-[#94a3b8]">No hay pagos registrados para este cliente</td></tr> : payments.map((payment, idx) => (
              <tr key={payment.id} className={`transition-colors hover:bg-[#f8f9fb] ${idx % 2 === 0 ? "bg-white" : "bg-[#f8f9fb]"}`}>
                <td className="px-5 py-3 font-mono text-sm font-semibold text-[#16a34a]">${(payment.amount ?? 0).toLocaleString("es-MX")}</td>
                <td className="px-5 py-3 text-[#475569]">{payment.period ?? "-"}</td>
                <td className="px-5 py-3"><span className={`inline-flex items-center rounded-lg px-2.5 py-1 text-xs font-medium ${methodBadgeColors[payment.method ?? ""] ?? "bg-[#f5f7fa] text-[#475569]"}`}>{methodLabels[payment.method ?? ""] ?? payment.method ?? "-"}</span></td>
                <td className="px-5 py-3 text-[#94a3b8]">{payment.paidAt ? new Date(payment.paidAt).toLocaleDateString("es-MX") : payment.createdAt ? new Date(payment.createdAt).toLocaleDateString("es-MX") : "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ClientForm open={showEditForm} onClose={() => setShowEditForm(false)} onSuccess={() => { setShowEditForm(false); invalidateClients(); invalidateDashboard(); fetchClient(); }} client={client} />
      <ConfirmDialog open={confirmToggle} onClose={() => setConfirmToggle(false)} onConfirm={handleToggle} title={isActive ? "Suspender servicio" : "Reactivar servicio"} message={isActive ? `Estas seguro de suspender el servicio de ${client.name}? El cliente perdera internet inmediatamente.` : `Reactivar el servicio de ${client.name}?`} confirmText={isActive ? "Suspender" : "Reactivar"} confirmColor={isActive ? "red" : "blue"} loading={toggling} />
    </div>
  );
}
