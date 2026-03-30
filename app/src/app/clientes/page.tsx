"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Search, Plus, Power, AlertTriangle, Pencil } from "lucide-react";
import StatusBadge from "@/components/StatusBadge";
import ClientForm from "@/components/ClientForm";
import ConfirmDialog from "@/components/ConfirmDialog";
import Skeleton from "@/components/Skeleton";
import TableSkeleton from "@/components/skeletons/TableSkeleton";
import { useMikrotik } from "@/contexts/MikrotikContext";

interface Client {
  id: string;
  name: string;
  phone: string;
  address: string;
  status: string;
  pppoeUser: string;
  profileName: string;
  nodeId?: string;
  plan?: {
    name?: string;
    downloadMbps?: number;
    price?: number;
  };
  node?: {
    id?: string;
    name?: string;
  };
  assignedIp?: string | null;
  isConnected?: boolean;
  sessionUptime?: string | null;
}

export default function ClientesPage() {
  const router = useRouter();
  const { connected: mikrotikConnected } = useMikrotik();
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [showForm, setShowForm] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);
  const [confirmToggle, setConfirmToggle] = useState<Client | null>(null);

  const fetchClients = useCallback(() => {
    setLoading(true);
    fetch("/api/clients")
      .then((r) => {
        if (!r.ok) throw new Error("Error al cargar clientes");
        return r.json();
      })
      .then((data) => {
        setClients(Array.isArray(data) ? data : []);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    fetchClients();
  }, [fetchClients]);

  const handleToggle = async (clientId: string) => {
    setToggling(clientId);
    setConfirmToggle(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/toggle`, {
        method: "POST",
      });
      if (!res.ok) throw new Error("Error al cambiar estado");
      fetchClients();
    } catch {
      alert("Error al cambiar el estado del cliente");
    } finally {
      setToggling(null);
    }
  };

  const filtered = clients.filter((c) => {
    const matchesSearch =
      !search ||
      (c.name ?? "").toLowerCase().includes(search.toLowerCase()) ||
      (c.pppoeUser ?? "").toLowerCase().includes(search.toLowerCase());
    const matchesStatus =
      statusFilter === "all" ||
      (c.status ?? "").toUpperCase() === statusFilter.toUpperCase();
    return matchesSearch && matchesStatus;
  });

  if (loading)
    return (
      <div className="space-y-6">
        {/* Header skeleton */}
        <div className="flex items-center justify-between">
          <div>
            <Skeleton className="h-7 w-28" />
            <Skeleton className="mt-2 h-4 w-40" />
          </div>
          <Skeleton className="h-10 w-36 rounded-xl" />
        </div>
        {/* Filter skeleton */}
        <div className="flex flex-wrap items-center gap-3">
          <Skeleton className="h-10 min-w-[280px] flex-1 rounded-xl" />
          <Skeleton className="h-10 w-44 rounded-xl" />
        </div>
        <TableSkeleton rows={5} columns={6} />
      </div>
    );
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <div className="rounded-2xl border border-[#e2e8f0] bg-white p-8 text-center shadow-sm">
          <AlertTriangle className="mx-auto h-10 w-10 text-[#dc2626]" />
          <p className="mt-4 text-sm text-[#dc2626]">{error}</p>
          <button
            onClick={() => {
              setError("");
              fetchClients();
            }}
            className="mt-4 rounded-xl bg-[#006fff] px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-[#0057cc]"
          >
            Reintentar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-[#0f172a]">
            Clientes
          </h1>
          <p className="mt-1 text-sm text-[#475569]">
            {clients.length} clientes registrados
          </p>
        </div>
        <button
          onClick={() => {
            if (!mikrotikConnected) return;
            setEditingClient(null);
            setShowForm(true);
          }}
          disabled={!mikrotikConnected}
          title={!mikrotikConnected ? "Requiere conexion a MikroTik" : undefined}
          className={`flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-medium text-white transition-all duration-200 ${
            mikrotikConnected
              ? "bg-[#006fff] shadow-lg shadow-[#006fff]/20 hover:bg-[#0057cc] hover:shadow-[#006fff]/30"
              : "cursor-not-allowed bg-[#006fff] opacity-50"
          }`}
        >
          <Plus className="h-4 w-4" />
          Nuevo Cliente
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[280px] flex-1">
          <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#94a3b8]" />
          <input
            type="text"
            placeholder="Buscar por nombre o usuario PPPoE..."
            className="w-full rounded-xl border border-[#e2e8f0] bg-white py-2.5 pl-10 pr-4 text-sm text-[#0f172a] placeholder-[#94a3b8] transition-colors focus:border-[#006fff] focus:outline-none focus:ring-1 focus:ring-[#006fff]/30"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select
          className="rounded-xl border border-[#e2e8f0] bg-white px-4 py-2.5 text-sm text-[#0f172a] transition-colors focus:border-[#006fff] focus:outline-none focus:ring-1 focus:ring-[#006fff]/30"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="all">Todos los estados</option>
          <option value="ACTIVE">Activos</option>
          <option value="SUSPENDED">Suspendidos</option>
        </select>
      </div>

      {/* Table Card */}
      <div className="overflow-hidden rounded-2xl border border-[#e2e8f0] bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-[#e2e8f0] bg-[#f5f7fa]">
              <th className="px-5 py-3.5 text-xs font-medium uppercase tracking-widest text-[#94a3b8]">
                Nombre
              </th>
              <th className="px-5 py-3.5 text-xs font-medium uppercase tracking-widest text-[#94a3b8]">
                Direccion
              </th>
              <th className="px-5 py-3.5 text-xs font-medium uppercase tracking-widest text-[#94a3b8]">
                Usuario PPPoE
              </th>
              <th className="px-5 py-3.5 text-xs font-medium uppercase tracking-widest text-[#94a3b8]">
                Plan
              </th>
              <th className="px-5 py-3.5 text-xs font-medium uppercase tracking-widest text-[#94a3b8]">
                Estado
              </th>
              <th className="px-5 py-3.5 text-xs font-medium uppercase tracking-widest text-[#94a3b8]">
                Conexion
              </th>
              <th className="px-5 py-3.5 text-xs font-medium uppercase tracking-widest text-[#94a3b8]">
                Acciones
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td
                  colSpan={7}
                  className="px-5 py-12 text-center text-sm text-[#94a3b8]"
                >
                  No se encontraron clientes
                </td>
              </tr>
            ) : (
              filtered.map((client, idx) => {
                const status = (client.status ?? "").toUpperCase();
                const isActive = status === "ACTIVE";
                return (
                  <tr
                    key={client.id}
                    className={`cursor-pointer transition-colors hover:bg-[#f8f9fb] ${
                      idx % 2 === 0 ? "bg-white" : "bg-[#f8f9fb]"
                    }`}
                    onClick={() => router.push(`/clientes/${client.id}`)}
                  >
                    <td className="px-5 py-3.5">
                      <div>
                        <p className="font-medium text-[#0f172a]">
                          {client.name ?? "-"}
                        </p>
                        {client.phone && (
                          <p className="mt-0.5 text-xs text-[#94a3b8]">
                            {client.phone}
                          </p>
                        )}
                      </div>
                    </td>
                    <td className="px-5 py-3.5 text-[#475569]">
                      {client.address ?? "-"}
                    </td>
                    <td className="px-5 py-3.5 font-mono text-xs text-[#475569]">
                      {client.pppoeUser ?? "-"}
                    </td>
                    <td className="px-5 py-3.5 text-[#475569]">
                      {client.plan?.name ?? client.profileName ?? "-"}
                    </td>
                    <td className="px-5 py-3.5">
                      <StatusBadge
                        status={client.status ?? "unknown"}
                        size="sm"
                      />
                    </td>
                    <td className="px-5 py-3.5">
                      {client.isConnected ? (
                        <div>
                          <span className="inline-flex items-center gap-1.5 rounded-lg bg-[#f0fdf4] px-2.5 py-1 text-xs font-medium text-[#16a34a]">
                            <span className="h-1.5 w-1.5 rounded-full bg-[#16a34a] status-dot-online" />
                            Conectado
                          </span>
                          {client.assignedIp && (
                            <p className="mt-0.5 font-mono text-[10px] text-[#475569]">{client.assignedIp}</p>
                          )}
                        </div>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 rounded-lg bg-[#f5f7fa] px-2.5 py-1 text-xs font-medium text-[#94a3b8]">
                          <span className="h-1.5 w-1.5 rounded-full bg-[#94a3b8]" />
                          Desconectado
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-2">
                        {/* Edit button */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (!mikrotikConnected) return;
                            setEditingClient(client);
                            setShowForm(true);
                          }}
                          disabled={!mikrotikConnected}
                          title={!mikrotikConnected ? "Requiere conexion a MikroTik" : "Editar cliente"}
                          className={`rounded-lg p-1.5 transition-colors ${
                            mikrotikConnected
                              ? "text-[#94a3b8] hover:bg-[#eff6ff] hover:text-[#006fff]"
                              : "cursor-not-allowed text-[#94a3b8] opacity-50"
                          }`}
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        {/* Toggle switch style button */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (!mikrotikConnected) return;
                            setConfirmToggle(client);
                          }}
                          disabled={toggling === client.id || !mikrotikConnected}
                          className={`group/toggle relative inline-flex h-7 w-12 items-center rounded-full transition-colors disabled:opacity-50 ${
                            !mikrotikConnected ? "cursor-not-allowed" : ""
                          }`}
                          style={{
                            backgroundColor: isActive
                              ? "rgba(22, 163, 74, 0.15)"
                              : "rgba(220, 38, 38, 0.15)",
                          }}
                          title={
                            !mikrotikConnected
                              ? "Requiere conexion a MikroTik"
                              : isActive
                                ? "Suspender servicio"
                                : "Activar servicio"
                          }
                        >
                          <span
                            className={`inline-block h-5 w-5 transform rounded-full transition-all duration-200 ${
                              isActive
                                ? "translate-x-6 bg-[#16a34a]"
                                : "translate-x-1 bg-[#dc2626]"
                            }`}
                          >
                            <Power
                              className="h-3 w-3 text-white"
                              style={{
                                margin: "4px",
                              }}
                            />
                          </span>
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <ClientForm
        open={showForm}
        onClose={() => {
          setShowForm(false);
          setEditingClient(null);
        }}
        onSuccess={() => {
          setShowForm(false);
          setEditingClient(null);
          fetchClients();
        }}
        client={editingClient}
      />

      {/* Confirm toggle dialog */}
      <ConfirmDialog
        open={!!confirmToggle}
        onClose={() => setConfirmToggle(null)}
        onConfirm={() => {
          if (confirmToggle) handleToggle(confirmToggle.id);
        }}
        title={
          confirmToggle
            ? (confirmToggle.status ?? "").toUpperCase() === "ACTIVE"
              ? "Suspender servicio"
              : "Reactivar servicio"
            : ""
        }
        message={
          confirmToggle
            ? (confirmToggle.status ?? "").toUpperCase() === "ACTIVE"
              ? `Estas seguro de suspender el servicio de ${confirmToggle.name}? El cliente perdera internet inmediatamente.`
              : `Reactivar el servicio de ${confirmToggle.name}?`
            : ""
        }
        confirmText={
          confirmToggle
            ? (confirmToggle.status ?? "").toUpperCase() === "ACTIVE"
              ? "Suspender"
              : "Reactivar"
            : "Confirmar"
        }
        confirmColor={
          confirmToggle && (confirmToggle.status ?? "").toUpperCase() === "ACTIVE"
            ? "red"
            : "blue"
        }
        loading={!!toggling}
      />
    </div>
  );
}
