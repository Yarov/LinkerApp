"use client";

import { useState, useEffect } from "react";
import Modal from "./Modal";

interface Client {
  id: string;
  name: string;
  plan?: {
    name?: string;
    price?: number;
  };
}

interface PaymentFormProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export default function PaymentForm({
  open,
  onClose,
  onSuccess,
}: PaymentFormProps) {
  const [clients, setClients] = useState<Client[]>([]);
  const [clientId, setClientId] = useState("");
  const [amount, setAmount] = useState("");
  const [period, setPeriod] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  });
  const [method, setMethod] = useState("EFECTIVO");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    if (open) {
      setClientId("");
      setAmount("");
      setMethod("EFECTIVO");
      setError("");
      setSuccess("");
      setPeriod(() => {
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
      });
      fetch("/api/clients")
        .then((r) => r.json())
        .then((d) => setClients(Array.isArray(d) ? d : []))
        .catch(() => setClients([]));
    }
  }, [open]);

  useEffect(() => {
    const client = clients.find((c) => c.id === clientId);
    if (client?.plan?.price) {
      setAmount(String(client.plan.price));
    }
  }, [clientId, clients]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!clientId || !amount || !period) {
      setError("Cliente, monto y periodo son obligatorios.");
      return;
    }
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const res = await fetch("/api/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId,
          amount: parseFloat(amount),
          period,
          method,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Error al registrar el pago");
      }
      setSuccess("Pago registrado exitosamente");
      setTimeout(() => {
        onSuccess();
      }, 800);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setSaving(false);
    }
  };

  const inputClass =
    "w-full rounded-xl border border-[#e2e8f0] bg-white px-3.5 py-2.5 text-sm text-[#0f172a] placeholder-[#94a3b8] transition-colors focus:border-[#006fff] focus:outline-none focus:ring-1 focus:ring-[#006fff]/30";

  return (
    <Modal open={open} onClose={onClose} title="Registrar Pago">
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="rounded-xl border border-[#dc2626]/30 bg-[#fef2f2] px-4 py-2.5 text-sm text-[#dc2626]">
            {error}
          </div>
        )}
        {success && (
          <div className="rounded-xl border border-[#16a34a]/30 bg-[#f0fdf4] px-4 py-2.5 text-sm text-[#16a34a]">
            {success}
          </div>
        )}

        <div>
          <label className="mb-1.5 block text-xs font-medium uppercase tracking-widest text-[#475569]">
            Cliente *
          </label>
          <select
            className={inputClass}
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
          >
            <option value="">Seleccionar cliente</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name ?? "-"}
                {c.plan?.name ? ` (${c.plan.name})` : ""}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-widest text-[#475569]">
              Monto ($) *
            </label>
            <input
              type="number"
              step="0.01"
              className={inputClass}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-widest text-[#475569]">
              Periodo *
            </label>
            <input
              type="month"
              className={inputClass}
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
            />
          </div>
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-medium uppercase tracking-widest text-[#475569]">
            Metodo de Pago
          </label>
          <select
            className={inputClass}
            value={method}
            onChange={(e) => setMethod(e.target.value)}
          >
            <option value="EFECTIVO">Efectivo</option>
            <option value="TRANSFERENCIA">Transferencia</option>
            <option value="OTRO">Otro</option>
          </select>
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-[#e2e8f0] bg-transparent px-5 py-2.5 text-sm text-[#475569] transition-colors hover:bg-[#f5f7fa] hover:text-[#0f172a]"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={saving}
            className="rounded-xl bg-[#006fff] px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#0057cc] disabled:opacity-50"
          >
            {saving ? "Guardando..." : "Registrar Pago"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
