"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import {
  ArrowLeft,
  Pencil,
  Power,
  Phone,
  MapPin,
  Wifi,
  User,
  AlertTriangle,
} from "lucide-react";
import StatusBadge from "@/components/StatusBadge";
import ClientForm from "@/components/ClientForm";
import ConfirmDialog from "@/components/ConfirmDialog";
import Skeleton from "@/components/Skeleton";
import TableSkeleton from "@/components/skeletons/TableSkeleton";
import { useMikrotik } from "@/contexts/MikrotikContext";

interface ClientDetail {
  id: string;
  name: string;
  phone?: string;
  address: string;
  pppoeUser: string;
  profileName: string;
  status: string;
  nodeId?: string;
  plan?: {
    name?: string;
    downloadMbps?: number;
    uploadMbps?: number;
    price?: number;
  };
  node?: {
    id?: string;
    name?: string;
  };
  assignedIp?: string | null;
  isConnected?: boolean;
  sessionUptime?: string | null;
  sessionCallerId?: string | null;
}

interface Payment {
  id: string;
  amount: number;
  period: string;
  method: string;
  paidAt: string;
  createdAt: string;
}

const methodLabels: Record<string, string> = {
  EFECTIVO: "Efectivo",
  TRANSFERENCIA: "Transferencia",
  OTRO: "Otro",
  cash: "Efectivo",
  transfer: "Transferencia",
  other: "Otro",
};

const methodBadgeColors: Record<string, string> = {
  EFECTIVO: "bg-[#f0fdf4] text-[#16a34a]",
  TRANSFERENCIA: "bg-[#eff6ff] text-[#006fff]",
  OTRO: "bg-[#f5f7fa] text-[#475569]",
};

export default function ClienteDetailPage() {
  const router = useRouter();
  const params = useParams();
  const clientId = params.id as string;
  const { connected: mikrotikConnected } = useMikrotik();

  const [client, setClient] = useState<ClientDetail | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showEditForm, setShowEditForm] = useState(false);
  const [confirmToggle, setConfirmToggle] = useState(false);
  const [toggling, setToggling] = useState(false);

  const fetchClient = useCallback(() => {
    fetch(`/api/clients/${clientId}`)
      .then((r) => {
        if (!r.ok) throw new Error("Error al cargar cliente");
        return r.json();
      })
      .then((data) => {
        setClient(data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, [clientId]);

  const fetchPayments = useCallback(() => {
    fetch(`/api/payments?clientId=${clientId}`)
      .then((r) => {
        if (!r.ok) return [];
        return r.json();
      })
      .then((data) => {
        setPayments(Array.isArray(data) ? data : []);
      })
      .catch(() => {
        setPayments([]);
      });
  }, [clientId]);

  useEffect(() => {
    fetchClient();
    fetchPayments();
  }, [fetchClient, fetchPayments]);

  const handleToggle = async () => {
    setToggling(true);
    setConfirmToggle(false);
    try {
      const res = await fetch(`/api/clients/${clientId}/toggle`, {
        method: "POST",
      });
      if (!res.ok) throw new Error("Error al cambiar estado");
      fetchClient();
    } catch {
      alert("Error al cambiar el estado del cliente");
    } finally {
      setToggling(false);
    }
  };

  if (loading)
    return (
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Skeleton className="h-10 w-10 rounded-xl" />
            <div>
              <Skeleton className="h-7 w-40" />
              <div className="mt-2 flex items-center gap-2">
                <Skeleton className="h-5 w-16 rounded-lg" />
                <Skeleton className="h-4 w-24" />
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Skeleton className="h-10 w-24 rounded-xl" />
            <Skeleton className="h-10 w-28 rounded-xl" />
          </div>
        </div>
        {/* Client info card */}
        <div className="rounded-2xl border border-[#e2e8f0] bg-white p-6 shadow-sm">
          <Skeleton className="mb-4 h-3 w-40" />
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-start gap-3">
                <Skeleton className="h-8 w-8 rounded-lg" />
                <div>
                  <Skeleton className="h-3 w-16" />
                  <Skeleton className="mt-1.5 h-4 w-28" />
                </div>
              </div>
            ))}
          </div>
        </div>
        {/* Payment history table */}
        <div className="rounded-2xl border border-[#e2e8f0] bg-white shadow-sm">
          <div className="border-b border-[#e2e8f0] px-6 py-4">
            <Skeleton className="h-5 w-36" />
            <Skeleton className="mt-1.5 h-3 w-28" />
          </div>
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-[#e2e8f0] bg-[#f5f7fa]">
                {Array.from({ length: 4 }).map((_, col) => (
                  <th key={col} className="px-5 py-3">
                    <Skeleton className="h-3 w-16" />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 5 }).map((_, row) => (
                <tr
                  key={row}
                  className={`border-b border-[#e2e8f0] last:border-b-0 ${
                    row % 2 === 0 ? "bg-white" : "bg-[#f8f9fb]"
                  }`}
                >
                  {Array.from({ length: 4 }).map((_, col) => (
                    <td key={col} className="px-5 py-3">
                      <Skeleton className={`h-4 ${col === 0 ? "w-20" : "w-24"}`} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );

  if (error || !client) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <div className="rounded-2xl border border-[#e2e8f0] bg-white p-8 text-center shadow-sm">
          <AlertTriangle className="mx-auto h-10 w-10 text-[#dc2626]" />
          <p className="mt-4 text-sm text-[#dc2626]">
            {error || "Cliente no encontrado"}
          </p>
          <button
            onClick={() => router.push("/clientes")}
            className="mt-4 rounded-xl bg-[#006fff] px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-[#0057cc]"
          >
            Volver a Clientes
          </button>
        </div>
      </div>
    );
  }

  const status = (client.status ?? "").toUpperCase();
  const isActive = status === "ACTIVE";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={() => router.push("/clientes")}
            className="rounded-xl border border-[#e2e8f0] p-2 text-[#475569] transition-colors hover:bg-[#f5f7fa] hover:text-[#0f172a]"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-[#0f172a]">
              {client.name}
            </h1>
            <div className="mt-1 flex items-center gap-2">
              <StatusBadge status={client.status ?? "unknown"} size="sm" />
              {client.plan?.name && (
                <span className="text-sm text-[#475569]">
                  {client.plan.name}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowEditForm(true)}
            disabled={!mikrotikConnected}
            title={!mikrotikConnected ? "Requiere conexion a MikroTik" : undefined}
            className={`flex items-center gap-2 rounded-xl border border-[#e2e8f0] px-4 py-2.5 text-sm transition-colors ${
              mikrotikConnected
                ? "text-[#475569] hover:bg-[#f5f7fa] hover:text-[#0f172a]"
                : "cursor-not-allowed text-[#475569] opacity-50"
            }`}
          >
            <Pencil className="h-4 w-4" />
            Editar
          </button>
          <button
            onClick={() => setConfirmToggle(true)}
            disabled={toggling || !mikrotikConnected}
            title={!mikrotikConnected ? "Requiere conexion a MikroTik" : undefined}
            className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium text-white transition-colors disabled:opacity-50 ${
              !mikrotikConnected
                ? "cursor-not-allowed bg-[#94a3b8]"
                : isActive
                  ? "bg-[#dc2626] hover:bg-[#b91c1c]"
                  : "bg-[#16a34a] hover:bg-[#15803d]"
            }`}
          >
            <Power className="h-4 w-4" />
            {isActive ? "Suspender" : "Reactivar"}
          </button>
        </div>
      </div>

      {/* Client info card */}
      <div className="rounded-2xl border border-[#e2e8f0] bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-xs font-medium uppercase tracking-widest text-[#94a3b8]">
          Informacion del cliente
        </h2>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-[#eff6ff] p-2">
              <User className="h-4 w-4 text-[#006fff]" />
            </div>
            <div>
              <p className="text-xs text-[#94a3b8]">Nombre</p>
              <p className="text-sm font-medium text-[#0f172a]">
                {client.name}
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-[#eff6ff] p-2">
              <Phone className="h-4 w-4 text-[#006fff]" />
            </div>
            <div>
              <p className="text-xs text-[#94a3b8]">Telefono</p>
              <p className="text-sm font-medium text-[#0f172a]">
                {client.phone || "Sin telefono"}
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-[#eff6ff] p-2">
              <MapPin className="h-4 w-4 text-[#006fff]" />
            </div>
            <div>
              <p className="text-xs text-[#94a3b8]">Direccion</p>
              <p className="text-sm font-medium text-[#0f172a]">
                {client.address}
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-[#eff6ff] p-2">
              <Wifi className="h-4 w-4 text-[#006fff]" />
            </div>
            <div>
              <p className="text-xs text-[#94a3b8]">Usuario PPPoE</p>
              <p className="font-mono text-sm font-medium text-[#0f172a]">
                {client.pppoeUser}
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-[#eff6ff] p-2">
              <Wifi className="h-4 w-4 text-[#006fff]" />
            </div>
            <div>
              <p className="text-xs text-[#94a3b8]">Plan</p>
              <p className="text-sm font-medium text-[#0f172a]">
                {client.plan?.name ?? client.profileName ?? "-"}
                {client.plan?.downloadMbps && (
                  <span className="text-[#475569]">
                    {" "}
                    ({client.plan.downloadMbps}/{client.plan.uploadMbps} Mbps)
                  </span>
                )}
              </p>
              {client.plan?.price != null && (
                <p className="text-xs text-[#006fff] font-medium">
                  ${client.plan.price}/mes
                </p>
              )}
            </div>
          </div>

          {client.node?.name && (
            <div className="flex items-start gap-3">
              <div className="rounded-lg bg-[#eff6ff] p-2">
                <Wifi className="h-4 w-4 text-[#006fff]" />
              </div>
              <div>
                <p className="text-xs text-[#94a3b8]">Nodo</p>
                <p className="text-sm font-medium text-[#0f172a]">
                  {client.node.name}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* PPPoE Connection Status */}
      <div
        className={`rounded-2xl border p-6 shadow-sm ${
          client.isConnected
            ? "border-[#16a34a]/30 bg-[#f0fdf4]"
            : "border-[#e2e8f0] bg-[#f5f7fa]"
        }`}
      >
        <h2 className="mb-4 text-xs font-medium uppercase tracking-widest text-[#94a3b8]">
          Estado de conexion PPPoE
        </h2>
        {client.isConnected ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <p className="text-xs text-[#16a34a]/70">IP Asignada</p>
              <p className="mt-0.5 font-mono text-sm font-semibold text-[#16a34a]">
                {client.assignedIp || "-"}
              </p>
            </div>
            <div>
              <p className="text-xs text-[#16a34a]/70">Tiempo conectado</p>
              <p className="mt-0.5 text-sm font-semibold text-[#16a34a]">
                {client.sessionUptime || "-"}
              </p>
            </div>
            <div>
              <p className="text-xs text-[#16a34a]/70">MAC (caller-id)</p>
              <p className="mt-0.5 font-mono text-sm font-semibold text-[#16a34a]">
                {client.sessionCallerId || "-"}
              </p>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#e2e8f0]">
              <Wifi className="h-5 w-5 text-[#94a3b8]" />
            </div>
            <div>
              <p className="text-sm font-medium text-[#475569]">
                Cliente no conectado
              </p>
              <p className="text-xs text-[#94a3b8]">
                El modem puede estar apagado o sin conexion a la red.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Payment history */}
      <div className="rounded-2xl border border-[#e2e8f0] bg-white shadow-sm">
        <div className="border-b border-[#e2e8f0] px-6 py-4">
          <h2 className="text-sm font-semibold text-[#0f172a]">
            Historial de Pagos
          </h2>
          <p className="mt-0.5 text-xs text-[#94a3b8]">
            {payments.length} pagos registrados
          </p>
        </div>
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-[#e2e8f0] bg-[#f5f7fa]">
              <th className="px-5 py-3 text-xs font-medium uppercase tracking-widest text-[#94a3b8]">
                Monto
              </th>
              <th className="px-5 py-3 text-xs font-medium uppercase tracking-widest text-[#94a3b8]">
                Periodo
              </th>
              <th className="px-5 py-3 text-xs font-medium uppercase tracking-widest text-[#94a3b8]">
                Metodo
              </th>
              <th className="px-5 py-3 text-xs font-medium uppercase tracking-widest text-[#94a3b8]">
                Fecha
              </th>
            </tr>
          </thead>
          <tbody>
            {payments.length === 0 ? (
              <tr>
                <td
                  colSpan={4}
                  className="px-5 py-12 text-center text-sm text-[#94a3b8]"
                >
                  No hay pagos registrados para este cliente
                </td>
              </tr>
            ) : (
              payments.map((payment, idx) => (
                <tr
                  key={payment.id}
                  className={`transition-colors hover:bg-[#f8f9fb] ${
                    idx % 2 === 0 ? "bg-white" : "bg-[#f8f9fb]"
                  }`}
                >
                  <td className="px-5 py-3 font-mono text-sm font-semibold text-[#16a34a]">
                    ${(payment.amount ?? 0).toLocaleString("es-MX")}
                  </td>
                  <td className="px-5 py-3 text-[#475569]">
                    {payment.period ?? "-"}
                  </td>
                  <td className="px-5 py-3">
                    <span
                      className={`inline-flex items-center rounded-lg px-2.5 py-1 text-xs font-medium ${
                        methodBadgeColors[payment.method ?? ""] ??
                        "bg-[#f5f7fa] text-[#475569]"
                      }`}
                    >
                      {methodLabels[payment.method ?? ""] ??
                        payment.method ??
                        "-"}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-[#94a3b8]">
                    {payment.paidAt
                      ? new Date(payment.paidAt).toLocaleDateString("es-MX")
                      : payment.createdAt
                        ? new Date(payment.createdAt).toLocaleDateString(
                            "es-MX"
                          )
                        : "-"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Edit form */}
      <ClientForm
        open={showEditForm}
        onClose={() => setShowEditForm(false)}
        onSuccess={() => {
          setShowEditForm(false);
          fetchClient();
        }}
        client={client}
      />

      {/* Confirm toggle dialog */}
      <ConfirmDialog
        open={confirmToggle}
        onClose={() => setConfirmToggle(false)}
        onConfirm={handleToggle}
        title={isActive ? "Suspender servicio" : "Reactivar servicio"}
        message={
          isActive
            ? `Estas seguro de suspender el servicio de ${client.name}? El cliente perdera internet inmediatamente.`
            : `Reactivar el servicio de ${client.name}?`
        }
        confirmText={isActive ? "Suspender" : "Reactivar"}
        confirmColor={isActive ? "red" : "blue"}
        loading={toggling}
      />
    </div>
  );
}
