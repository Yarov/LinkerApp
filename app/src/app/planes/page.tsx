"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Plus,
  Edit2,
  Trash2,
  AlertTriangle,
  Wifi,
  ArrowDown,
  ArrowUp,
  Users,
} from "lucide-react";
import Modal from "@/components/Modal";
import CardGridSkeleton from "@/components/skeletons/CardGridSkeleton";
import Skeleton from "@/components/Skeleton";
import { useMikrotik } from "@/contexts/MikrotikContext";

interface Plan {
  id: string;
  name: string;
  downloadMbps: number;
  uploadMbps: number;
  price: number;
  profileName: string;
  isActive: boolean;
  clientCount?: number;
}

interface PlanForm {
  name: string;
  downloadMbps: string;
  uploadMbps: string;
  price: string;
  profileName: string;
}

const emptyForm: PlanForm = {
  name: "",
  downloadMbps: "",
  uploadMbps: "",
  price: "",
  profileName: "",
};

export default function PlanesPage() {
  const { connected: mikrotikConnected } = useMikrotik();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<PlanForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const fetchPlans = useCallback(() => {
    setLoading(true);
    fetch("/api/plans")
      .then((r) => {
        if (!r.ok) throw new Error("Error al cargar planes");
        return r.json();
      })
      .then((data) => {
        setPlans(Array.isArray(data) ? data : []);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    fetchPlans();
  }, [fetchPlans]);

  const openCreate = () => {
    setEditId(null);
    setForm(emptyForm);
    setFormError("");
    setShowForm(true);
  };

  const openEdit = (plan: Plan) => {
    setEditId(plan.id);
    setForm({
      name: plan.name ?? "",
      downloadMbps: String(plan.downloadMbps ?? ""),
      uploadMbps: String(plan.uploadMbps ?? ""),
      price: String(plan.price ?? ""),
      profileName: plan.profileName ?? "",
    });
    setFormError("");
    setShowForm(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name || !form.downloadMbps || !form.uploadMbps || !form.price) {
      setFormError("Todos los campos son obligatorios.");
      return;
    }
    setSaving(true);
    setFormError("");
    try {
      const url = editId ? `/api/plans/${editId}` : "/api/plans";
      const method = editId ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          downloadMbps: parseFloat(form.downloadMbps),
          uploadMbps: parseFloat(form.uploadMbps),
          price: parseFloat(form.price),
          profileName:
            form.profileName ||
            form.name.toLowerCase().replace(/\s+/g, "-"),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Error al guardar el plan");
      }
      setShowForm(false);
      fetchPlans();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (planId: string) => {
    if (!confirm("Estas seguro de eliminar este plan?")) return;
    try {
      const res = await fetch(`/api/plans/${planId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Error al eliminar");
      fetchPlans();
    } catch {
      alert("Error al eliminar el plan");
    }
  };

  const inputClass =
    "w-full rounded-xl border border-[#e2e8f0] bg-white px-3.5 py-2.5 text-sm text-[#0f172a] placeholder-[#94a3b8] transition-colors focus:border-[#006fff] focus:outline-none focus:ring-1 focus:ring-[#006fff]/30";

  if (loading)
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <Skeleton className="h-7 w-24" />
            <Skeleton className="mt-2 h-4 w-36" />
          </div>
          <Skeleton className="h-10 w-32 rounded-xl" />
        </div>
        <CardGridSkeleton count={3} />
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
              fetchPlans();
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
            Planes
          </h1>
          <p className="mt-1 text-sm text-[#475569]">
            {plans.length} planes de servicio
          </p>
        </div>
        <button
          onClick={openCreate}
          disabled={!mikrotikConnected}
          title={!mikrotikConnected ? "Requiere conexion a MikroTik" : undefined}
          className={`flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-medium text-white transition-all duration-200 ${
            mikrotikConnected
              ? "bg-[#006fff] shadow-lg shadow-[#006fff]/20 hover:bg-[#0057cc] hover:shadow-[#006fff]/30"
              : "cursor-not-allowed bg-[#006fff] opacity-50"
          }`}
        >
          <Plus className="h-4 w-4" />
          Nuevo Plan
        </button>
      </div>

      {/* Plan Cards */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
        {plans.length === 0 ? (
          <div className="col-span-full flex flex-col items-center justify-center rounded-2xl border border-[#e2e8f0] bg-white py-16 shadow-sm">
            <Wifi className="h-10 w-10 text-[#94a3b8]" />
            <p className="mt-4 text-sm text-[#94a3b8]">
              No hay planes registrados
            </p>
          </div>
        ) : (
          plans.map((plan) => {
            const isInactive = plan.isActive === false;
            return (
              <div
                key={plan.id}
                className={`group relative overflow-hidden rounded-2xl border border-[#e2e8f0] bg-white shadow-sm transition-all duration-200 hover:border-[#cbd5e1] hover:bg-[#f8f9fb] ${
                  isInactive ? "opacity-50" : ""
                }`}
              >
                {/* Top gradient accent */}
                <div className="h-1 w-full bg-gradient-to-r from-[#006fff] via-[#7c4dff] to-[#006fff]" />

                <div className="p-5">
                  {/* Header */}
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-base font-semibold tracking-tight text-[#0f172a]">
                          {plan.name ?? "-"}
                        </h3>
                        {isInactive && (
                          <span className="rounded-md bg-[#fef2f2] px-2 py-0.5 text-[10px] font-medium text-[#dc2626]">
                            Inactivo
                          </span>
                        )}
                      </div>
                      <div className="mt-3">
                        <span className="text-3xl font-bold tracking-tight text-[#0f172a]">
                          ${(plan.price ?? 0).toLocaleString("es-MX")}
                        </span>
                        <span className="ml-1 text-sm font-normal text-[#94a3b8]">
                          /mes
                        </span>
                      </div>
                    </div>
                    <div className="flex gap-1">
                      <button
                        onClick={() => openEdit(plan)}
                        disabled={!mikrotikConnected}
                        title={!mikrotikConnected ? "Requiere conexion a MikroTik" : undefined}
                        className={`rounded-xl p-2 transition-all duration-200 ${
                          mikrotikConnected
                            ? "text-[#94a3b8] hover:bg-[#f5f7fa] hover:text-[#0f172a]"
                            : "cursor-not-allowed text-[#94a3b8] opacity-50"
                        }`}
                      >
                        <Edit2 className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(plan.id)}
                        disabled={!mikrotikConnected}
                        title={!mikrotikConnected ? "Requiere conexion a MikroTik" : undefined}
                        className={`rounded-xl p-2 transition-all duration-200 ${
                          mikrotikConnected
                            ? "text-[#94a3b8] hover:bg-[#fef2f2] hover:text-[#dc2626]"
                            : "cursor-not-allowed text-[#94a3b8] opacity-50"
                        }`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                  {/* Speed badges */}
                  <div className="mt-4 flex items-center gap-3">
                    <div className="flex-1 rounded-xl bg-[#f5f7fa] px-3.5 py-2.5">
                      <div className="flex items-center gap-1.5 text-xs text-[#94a3b8]">
                        <ArrowDown className="h-3 w-3 text-[#16a34a]" />
                        Descarga
                      </div>
                      <p className="mt-1 text-lg font-bold text-[#0f172a]">
                        {plan.downloadMbps ?? 0}
                        <span className="ml-1 text-xs font-normal text-[#94a3b8]">
                          Mbps
                        </span>
                      </p>
                    </div>
                    <div className="flex-1 rounded-xl bg-[#f5f7fa] px-3.5 py-2.5">
                      <div className="flex items-center gap-1.5 text-xs text-[#94a3b8]">
                        <ArrowUp className="h-3 w-3 text-[#006fff]" />
                        Subida
                      </div>
                      <p className="mt-1 text-lg font-bold text-[#0f172a]">
                        {plan.uploadMbps ?? 0}
                        <span className="ml-1 text-xs font-normal text-[#94a3b8]">
                          Mbps
                        </span>
                      </p>
                    </div>
                  </div>

                  {/* Footer */}
                  <div className="mt-4 flex items-center justify-between border-t border-[#e2e8f0] pt-4">
                    <span className="rounded-lg bg-[#f5f7fa] px-2.5 py-1 font-mono text-[10px] text-[#475569] border border-[#e2e8f0]">
                      {plan.profileName ?? "-"}
                    </span>
                    <div className="flex items-center gap-1.5 text-xs text-[#94a3b8]">
                      <Users className="h-3 w-3" />
                      {plan.clientCount ?? 0} cliente
                      {(plan.clientCount ?? 0) !== 1 ? "s" : ""}
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Form Modal */}
      <Modal
        open={showForm}
        onClose={() => setShowForm(false)}
        title={editId ? "Editar Plan" : "Nuevo Plan"}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          {formError && (
            <div className="rounded-xl border border-[#dc2626]/30 bg-[#fef2f2] px-4 py-2.5 text-sm text-[#dc2626]">
              {formError}
            </div>
          )}
          <div>
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-widest text-[#475569]">
              Nombre del Plan *
            </label>
            <input
              type="text"
              className={inputClass}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Ej: Plan 10 Mbps"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-widest text-[#475569]">
              Nombre de Perfil (MikroTik)
            </label>
            <input
              type="text"
              className={inputClass}
              value={form.profileName}
              onChange={(e) =>
                setForm({ ...form, profileName: e.target.value })
              }
              placeholder="Ej: plan-10M"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1.5 block text-xs font-medium uppercase tracking-widest text-[#475569]">
                Descarga (Mbps) *
              </label>
              <input
                type="number"
                step="0.1"
                className={inputClass}
                value={form.downloadMbps}
                onChange={(e) =>
                  setForm({ ...form, downloadMbps: e.target.value })
                }
                placeholder="10"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium uppercase tracking-widest text-[#475569]">
                Subida (Mbps) *
              </label>
              <input
                type="number"
                step="0.1"
                className={inputClass}
                value={form.uploadMbps}
                onChange={(e) =>
                  setForm({ ...form, uploadMbps: e.target.value })
                }
                placeholder="10"
              />
            </div>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-widest text-[#475569]">
              Precio Mensual ($) *
            </label>
            <input
              type="number"
              step="0.01"
              className={inputClass}
              value={form.price}
              onChange={(e) => setForm({ ...form, price: e.target.value })}
              placeholder="350.00"
            />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="rounded-xl border border-[#e2e8f0] bg-transparent px-5 py-2.5 text-sm text-[#475569] transition-colors hover:bg-[#f5f7fa] hover:text-[#0f172a]"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-xl bg-[#006fff] px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#0057cc] disabled:opacity-50"
            >
              {saving
                ? "Guardando..."
                : editId
                  ? "Actualizar"
                  : "Crear Plan"}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
