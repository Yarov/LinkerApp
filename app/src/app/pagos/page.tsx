"use client";

import { useState, useEffect, useCallback } from "react";
import {
  DollarSign,
  Plus,
  Search,
  AlertTriangle,
  Calendar,
  Trash2,
} from "lucide-react";
import PaymentForm from "@/components/PaymentForm";
import StatCard from "@/components/StatCard";
import ConfirmDialog from "@/components/ConfirmDialog";
import Skeleton from "@/components/Skeleton";
import TableSkeleton from "@/components/skeletons/TableSkeleton";

interface Payment {
  id: string;
  client?: { name?: string };
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

export default function PagosPage() {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [search, setSearch] = useState("");
  const [monthFilter, setMonthFilter] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  });
  const [deletingPayment, setDeletingPayment] = useState<Payment | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchPayments = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (monthFilter) params.set("period", monthFilter);

    fetch(`/api/payments?${params.toString()}`)
      .then((r) => {
        if (!r.ok) throw new Error("Error al cargar pagos");
        return r.json();
      })
      .then((data) => {
        setPayments(Array.isArray(data) ? data : []);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, [monthFilter]);

  useEffect(() => {
    fetchPayments();
  }, [fetchPayments]);

  const handleDeletePayment = async () => {
    if (!deletingPayment) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/payments/${deletingPayment.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Error al eliminar el pago");
      setDeletingPayment(null);
      fetchPayments();
    } catch {
      alert("Error al eliminar el pago");
    } finally {
      setDeleting(false);
    }
  };

  const filtered = payments.filter(
    (p) =>
      !search ||
      (p.client?.name ?? "").toLowerCase().includes(search.toLowerCase())
  );

  const totalRevenue = filtered.reduce((sum, p) => sum + (p.amount ?? 0), 0);

  if (loading)
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <Skeleton className="h-7 w-20" />
            <Skeleton className="mt-2 h-4 w-44" />
          </div>
          <Skeleton className="h-10 w-36 rounded-xl" />
        </div>
        {/* Stat cards skeleton */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <div
              key={i}
              className="relative overflow-hidden rounded-2xl border border-[#e2e8f0] bg-white p-5 shadow-sm"
            >
              <div className="absolute left-0 top-0 h-full w-[3px] bg-[#e2e8f0]" />
              <div className="flex items-center justify-between">
                <div>
                  <Skeleton className="h-3 w-28" />
                  <Skeleton className="mt-3 h-7 w-20" />
                </div>
                <Skeleton className="h-12 w-12 rounded-xl" />
              </div>
            </div>
          ))}
        </div>
        {/* Filter skeleton */}
        <div className="flex flex-wrap items-center gap-3">
          <Skeleton className="h-10 min-w-[280px] flex-1 rounded-xl" />
          <Skeleton className="h-10 w-36 rounded-xl" />
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
              fetchPayments();
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-[#0f172a]">
            Pagos
          </h1>
          <p className="mt-1 text-sm text-[#475569]">
            Historial de pagos y cobranza
          </p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 rounded-xl bg-[#006fff] px-5 py-2.5 text-sm font-medium text-white shadow-lg shadow-[#006fff]/20 transition-all duration-200 hover:bg-[#0057cc] hover:shadow-[#006fff]/30"
        >
          <Plus className="h-4 w-4" />
          Registrar Pago
        </button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <StatCard
          label="Ingresos del Mes"
          value={`$${totalRevenue.toLocaleString("es-MX")}`}
          icon={DollarSign}
          color="green"
        />
        <StatCard
          label="Pagos Registrados"
          value={filtered.length}
          icon={Calendar}
          color="blue"
        />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[280px] flex-1">
          <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#94a3b8]" />
          <input
            type="text"
            placeholder="Buscar por cliente..."
            className="w-full rounded-xl border border-[#e2e8f0] bg-white py-2.5 pl-10 pr-4 text-sm text-[#0f172a] placeholder-[#94a3b8] transition-colors focus:border-[#006fff] focus:outline-none focus:ring-1 focus:ring-[#006fff]/30"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <input
          type="month"
          className="rounded-xl border border-[#e2e8f0] bg-white px-4 py-2.5 text-sm text-[#0f172a] transition-colors focus:border-[#006fff] focus:outline-none focus:ring-1 focus:ring-[#006fff]/30"
          value={monthFilter}
          onChange={(e) => setMonthFilter(e.target.value)}
        />
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-2xl border border-[#e2e8f0] bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-[#e2e8f0] bg-[#f5f7fa]">
              <th className="px-5 py-3.5 text-xs font-medium uppercase tracking-widest text-[#94a3b8]">
                Cliente
              </th>
              <th className="px-5 py-3.5 text-xs font-medium uppercase tracking-widest text-[#94a3b8]">
                Monto
              </th>
              <th className="px-5 py-3.5 text-xs font-medium uppercase tracking-widest text-[#94a3b8]">
                Periodo
              </th>
              <th className="px-5 py-3.5 text-xs font-medium uppercase tracking-widest text-[#94a3b8]">
                Metodo
              </th>
              <th className="px-5 py-3.5 text-xs font-medium uppercase tracking-widest text-[#94a3b8]">
                Fecha
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
                  colSpan={6}
                  className="px-5 py-12 text-center text-sm text-[#94a3b8]"
                >
                  No se encontraron pagos
                </td>
              </tr>
            ) : (
              filtered.map((payment, idx) => (
                <tr
                  key={payment.id}
                  className={`transition-colors hover:bg-[#f8f9fb] ${
                    idx % 2 === 0 ? "bg-white" : "bg-[#f8f9fb]"
                  }`}
                >
                  <td className="px-5 py-3.5 font-medium text-[#0f172a]">
                    {payment.client?.name ?? "-"}
                  </td>
                  <td className="px-5 py-3.5 font-mono text-sm font-semibold text-[#16a34a]">
                    ${(payment.amount ?? 0).toLocaleString("es-MX")}
                  </td>
                  <td className="px-5 py-3.5 text-[#475569]">
                    {payment.period ?? "-"}
                  </td>
                  <td className="px-5 py-3.5">
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
                  <td className="px-5 py-3.5 text-[#94a3b8]">
                    {payment.paidAt
                      ? new Date(payment.paidAt).toLocaleDateString("es-MX")
                      : payment.createdAt
                        ? new Date(payment.createdAt).toLocaleDateString(
                            "es-MX"
                          )
                        : "-"}
                  </td>
                  <td className="px-5 py-3.5">
                    <button
                      onClick={() => setDeletingPayment(payment)}
                      className="rounded-lg p-1.5 text-[#94a3b8] transition-colors hover:bg-[#fef2f2] hover:text-[#dc2626]"
                      title="Eliminar pago"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <PaymentForm
        open={showForm}
        onClose={() => setShowForm(false)}
        onSuccess={() => {
          setShowForm(false);
          fetchPayments();
        }}
      />

      {/* Delete confirmation */}
      <ConfirmDialog
        open={!!deletingPayment}
        onClose={() => setDeletingPayment(null)}
        onConfirm={handleDeletePayment}
        title="Eliminar pago"
        message={
          deletingPayment
            ? `Estas seguro de eliminar el pago de $${(deletingPayment.amount ?? 0).toLocaleString("es-MX")} de ${deletingPayment.client?.name ?? "este cliente"}? Esta accion no se puede deshacer.`
            : ""
        }
        confirmText="Eliminar"
        confirmColor="red"
        loading={deleting}
      />
    </div>
  );
}
