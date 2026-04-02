import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Search, X, CheckCircle2, AlertTriangle, Banknote, ArrowLeftRight,
  MoreHorizontal, User, ChevronDown, Plus, Loader2,
} from "lucide-react";
import Modal from "./Modal";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface RawClient {
  id: string;
  name: string;
  profile_name: string;
  plan_name: string;
  price: number;
  status: string;
  phone: string | null;
}

interface PaymentFormProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

// ---------------------------------------------------------------------------
// Payment methods
// ---------------------------------------------------------------------------
const METHODS = [
  { value: "EFECTIVO", label: "Efectivo", icon: Banknote, color: "#16a34a" },
  { value: "TRANSFERENCIA", label: "Transferencia", icon: ArrowLeftRight, color: "#006fff" },
  { value: "OTRO", label: "Otro", icon: MoreHorizontal, color: "#475569" },
] as const;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function PaymentForm({ open, onClose, onSuccess }: PaymentFormProps) {
  const [clients, setClients] = useState<RawClient[]>([]);
  const [selectedClient, setSelectedClient] = useState<RawClient | null>(null);
  const [search, setSearch] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(0);

  const [amount, setAmount] = useState("");
  const [period, setPeriod] = useState(() => currentMonth());
  const [method, setMethod] = useState("EFECTIVO");
  const [notes, setNotes] = useState("");
  const [showNotes, setShowNotes] = useState(false);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [duplicateWarning, setDuplicateWarning] = useState(false);

  // Session tracking
  const [sessionCount, setSessionCount] = useState(0);
  const [sessionTotal, setSessionTotal] = useState(0);

  const searchRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // -----------------------------------------------------------------------
  // Init
  // -----------------------------------------------------------------------
  useEffect(() => {
    if (open) {
      resetForm();
      setSessionCount(0);
      setSessionTotal(0);
      invoke<{ clients: RawClient[] }>("list_clients")
        .then(d => setClients(d?.clients ?? []))
        .catch(() => setClients([]));
      setTimeout(() => searchRef.current?.focus(), 100);
    }
  }, [open]);

  function currentMonth() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  }

  function resetForm() {
    setSelectedClient(null);
    setSearch("");
    setAmount("");
    setPeriod(currentMonth());
    setMethod("EFECTIVO");
    setNotes("");
    setShowNotes(false);
    setError("");
    setSuccess(false);
    setDuplicateWarning(false);
    setShowDropdown(false);
  }

  // -----------------------------------------------------------------------
  // Filter clients
  // -----------------------------------------------------------------------
  const filtered = search.trim()
    ? clients.filter(c => {
        const q = search.toLowerCase();
        return (
          c.name?.toLowerCase().includes(q) ||
          c.profile_name?.toLowerCase().includes(q) ||
          c.plan_name?.toLowerCase().includes(q) ||
          c.phone?.toLowerCase().includes(q)
        );
      })
    : clients;

  // -----------------------------------------------------------------------
  // Select client
  // -----------------------------------------------------------------------
  const selectClient = useCallback(async (client: RawClient) => {
    setSelectedClient(client);
    setSearch("");
    setShowDropdown(false);
    setAmount(String(client.price || ""));
    setDuplicateWarning(false);

    // Check for duplicate payment
    try {
      const payments = await invoke<{ payments: { client_id: string; period: string }[] }>(
        "list_payments", { month: period }
      );
      const exists = payments?.payments?.some(
        p => p.client_id === client.id && p.period === period
      );
      if (exists) setDuplicateWarning(true);
    } catch { /* ignore */ }
  }, [period]);

  const clearClient = () => {
    setSelectedClient(null);
    setSearch("");
    setAmount("");
    setDuplicateWarning(false);
    setTimeout(() => searchRef.current?.focus(), 50);
  };

  // -----------------------------------------------------------------------
  // Keyboard navigation
  // -----------------------------------------------------------------------
  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (!showDropdown || filtered.length === 0) {
      if (e.key === "ArrowDown" && filtered.length > 0) {
        setShowDropdown(true);
        setHighlightIdx(0);
        e.preventDefault();
      }
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightIdx(i => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightIdx(i => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (filtered[highlightIdx]) selectClient(filtered[highlightIdx]);
    } else if (e.key === "Escape") {
      setShowDropdown(false);
    }
  };

  // Scroll highlighted item into view
  useEffect(() => {
    if (showDropdown && dropdownRef.current) {
      const el = dropdownRef.current.children[highlightIdx] as HTMLElement;
      el?.scrollIntoView({ block: "nearest" });
    }
  }, [highlightIdx, showDropdown]);

  // -----------------------------------------------------------------------
  // Submit
  // -----------------------------------------------------------------------
  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!selectedClient || !amount || !period) {
      setError("Selecciona un cliente, monto y periodo.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await invoke("create_payment", {
        clientId: selectedClient.id,
        amount: parseFloat(amount),
        period,
        method,
        notes: notes || null,
      });
      setSuccess(true);
      setSessionCount(c => c + 1);
      setSessionTotal(t => t + parseFloat(amount));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleRegisterAnother = () => {
    onSuccess(); // invalidate stores
    resetForm();
    setTimeout(() => searchRef.current?.focus(), 100);
  };

  const handleClose = () => {
    if (sessionCount > 0) onSuccess(); // invalidate stores if any payments were made
    onClose();
  };

  // Ctrl+Enter to submit
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && !success) {
        handleSubmit();
      }
      if (success && e.key === "Enter") {
        handleRegisterAnother();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, success, selectedClient, amount, period]); // eslint-disable-line react-hooks/exhaustive-deps

  // -----------------------------------------------------------------------
  // Close dropdown on outside click
  // -----------------------------------------------------------------------
  useEffect(() => {
    if (!showDropdown) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest("[data-combobox]")) setShowDropdown(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showDropdown]);

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------
  return (
    <Modal open={open} onClose={handleClose} title="Registrar Pago" maxWidth="max-w-xl">
      {success ? (
        /* ==================== SUCCESS STATE ==================== */
        <div className="py-4 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-[#f0fdf4]">
            <CheckCircle2 className="h-8 w-8 text-[#16a34a]" />
          </div>
          <p className="text-lg font-semibold text-[#0f172a]">Pago registrado</p>
          <p className="mt-1 text-sm text-[#475569]">
            ${parseFloat(amount).toLocaleString("es-MX", { minimumFractionDigits: 2 })} — {selectedClient?.name}
          </p>

          {/* Session counter */}
          <div className="mt-4 inline-flex items-center gap-2 rounded-full bg-[#f5f7fa] px-4 py-2 text-xs text-[#475569]">
            <span className="font-semibold text-[#0f172a]">{sessionCount}</span> pago{sessionCount !== 1 && "s"}
            <span className="text-[#cbd5e1]">|</span>
            <span className="font-semibold text-[#16a34a]">${sessionTotal.toLocaleString("es-MX", { minimumFractionDigits: 2 })}</span> total
          </div>

          <div className="mt-6 flex justify-center gap-3">
            <button
              onClick={handleRegisterAnother}
              className="flex items-center gap-2 rounded-xl bg-[#006fff] px-5 py-2.5 text-sm font-medium text-white hover:bg-[#0057cc]"
            >
              <Plus className="h-4 w-4" />
              Registrar otro
            </button>
            <button
              onClick={handleClose}
              className="rounded-xl border border-[#e2e8f0] px-5 py-2.5 text-sm text-[#475569] hover:bg-[#f5f7fa]"
            >
              Cerrar
            </button>
          </div>
          <p className="mt-3 text-[10px] text-[#94a3b8]">Enter = registrar otro | Esc = cerrar</p>
        </div>
      ) : (
        /* ==================== FORM STATE ==================== */
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="rounded-xl border border-[#dc2626]/30 bg-[#fef2f2] px-4 py-2.5 text-sm text-[#dc2626]">{error}</div>
          )}

          {/* Client selector */}
          <div>
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-widest text-[#475569]">
              Cliente *
            </label>

            {selectedClient ? (
              /* Selected client card */
              <div className="rounded-xl border border-[#006fff]/20 bg-[#f8fafc] p-3.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#006fff]/10 text-[#006fff]">
                      <User className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-[#0f172a]">{selectedClient.name}</p>
                      <div className="flex items-center gap-2 text-xs text-[#475569]">
                        <span>{selectedClient.plan_name || selectedClient.profile_name || "Sin plan"}</span>
                        <span className="text-[#cbd5e1]">|</span>
                        <span className="font-medium text-[#16a34a]">
                          ${selectedClient.price?.toLocaleString("es-MX", { minimumFractionDigits: 2 }) || "0.00"}
                        </span>
                        <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-bold ${
                          selectedClient.status === "ACTIVE"
                            ? "bg-[#f0fdf4] text-[#16a34a]"
                            : "bg-[#fef2f2] text-[#dc2626]"
                        }`}>
                          <span className={`h-1 w-1 rounded-full ${
                            selectedClient.status === "ACTIVE" ? "bg-[#16a34a]" : "bg-[#dc2626]"
                          }`} />
                          {selectedClient.status === "ACTIVE" ? "Activo" : "Suspendido"}
                        </span>
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={clearClient}
                    className="rounded-lg p-1.5 text-[#94a3b8] hover:bg-white hover:text-[#475569]"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                {duplicateWarning && (
                  <div className="mt-2.5 flex items-center gap-2 rounded-lg bg-[#fffbeb] px-3 py-2">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-[#f59e0b]" />
                    <p className="text-[11px] text-[#92400e]">
                      Este cliente ya tiene pago registrado para {period}
                    </p>
                  </div>
                )}
              </div>
            ) : (
              /* Search combobox */
              <div className="relative" data-combobox>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#94a3b8]" />
                  <input
                    ref={searchRef}
                    type="text"
                    value={search}
                    onChange={e => {
                      setSearch(e.target.value);
                      setShowDropdown(true);
                      setHighlightIdx(0);
                    }}
                    onFocus={() => setShowDropdown(true)}
                    onKeyDown={handleSearchKeyDown}
                    placeholder="Buscar por nombre, plan o telefono..."
                    className="w-full rounded-xl border border-[#e2e8f0] bg-white py-2.5 pl-10 pr-10 text-sm text-[#0f172a] placeholder-[#94a3b8] transition-colors focus:border-[#006fff] focus:outline-none focus:ring-1 focus:ring-[#006fff]/30"
                    autoComplete="off"
                  />
                  <ChevronDown className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#94a3b8]" />
                </div>

                {/* Dropdown */}
                {showDropdown && (
                  <div
                    ref={dropdownRef}
                    className="absolute z-50 mt-1 max-h-60 w-full overflow-y-auto rounded-xl border border-[#e2e8f0] bg-white shadow-lg"
                  >
                    {filtered.length === 0 ? (
                      <div className="px-4 py-6 text-center text-sm text-[#94a3b8]">
                        {search ? "No se encontraron clientes" : "Sin clientes registrados"}
                      </div>
                    ) : (
                      filtered.map((client, idx) => (
                        <button
                          key={client.id}
                          type="button"
                          onClick={() => selectClient(client)}
                          className={`flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition-colors ${
                            idx === highlightIdx
                              ? "bg-[#eff6ff]"
                              : "hover:bg-[#f8fafc]"
                          } ${idx > 0 ? "border-t border-[#f1f5f9]" : ""}`}
                        >
                          <span className={`h-2 w-2 shrink-0 rounded-full ${
                            client.status === "ACTIVE" ? "bg-[#16a34a]" : "bg-[#dc2626]"
                          }`} />
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-[#0f172a] truncate">{client.name}</p>
                            <p className="text-[11px] text-[#94a3b8] truncate">
                              {client.plan_name || client.profile_name || "Sin plan"}
                              {client.phone && ` | ${client.phone}`}
                            </p>
                          </div>
                          <span className="shrink-0 text-xs font-semibold text-[#16a34a]">
                            ${client.price?.toLocaleString("es-MX") || "0"}
                          </span>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Amount + Period */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1.5 block text-xs font-medium uppercase tracking-widest text-[#475569]">
                Monto ($) *
              </label>
              <input
                type="number"
                step="0.01"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                placeholder="0.00"
                className="w-full rounded-xl border border-[#e2e8f0] bg-white px-3.5 py-2.5 text-sm text-[#0f172a] placeholder-[#94a3b8] transition-colors focus:border-[#006fff] focus:outline-none focus:ring-1 focus:ring-[#006fff]/30"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium uppercase tracking-widest text-[#475569]">
                Periodo *
              </label>
              <input
                type="month"
                value={period}
                onChange={e => {
                  setPeriod(e.target.value);
                  setDuplicateWarning(false);
                }}
                className="w-full rounded-xl border border-[#e2e8f0] bg-white px-3.5 py-2.5 text-sm text-[#0f172a] transition-colors focus:border-[#006fff] focus:outline-none focus:ring-1 focus:ring-[#006fff]/30"
              />
            </div>
          </div>

          {/* Payment method — radio buttons */}
          <div>
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-widest text-[#475569]">
              Metodo de pago
            </label>
            <div className="flex gap-2">
              {METHODS.map(m => {
                const Icon = m.icon;
                const isSelected = method === m.value;
                return (
                  <button
                    key={m.value}
                    type="button"
                    onClick={() => setMethod(m.value)}
                    className={`flex flex-1 items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-xs font-medium transition-all ${
                      isSelected
                        ? "border-opacity-30 bg-opacity-5 shadow-sm"
                        : "border-[#e2e8f0] bg-white text-[#475569] hover:bg-[#f8fafc]"
                    }`}
                    style={isSelected ? {
                      borderColor: `${m.color}40`,
                      backgroundColor: `${m.color}08`,
                      color: m.color,
                    } : undefined}
                  >
                    <Icon className="h-4 w-4" />
                    {m.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Notes (collapsible) */}
          {showNotes ? (
            <div>
              <label className="mb-1.5 block text-xs font-medium uppercase tracking-widest text-[#475569]">
                Notas
              </label>
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                rows={2}
                placeholder="Nota opcional..."
                className="w-full rounded-xl border border-[#e2e8f0] bg-white px-3.5 py-2.5 text-sm text-[#0f172a] placeholder-[#94a3b8] transition-colors focus:border-[#006fff] focus:outline-none focus:ring-1 focus:ring-[#006fff]/30 resize-none"
              />
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowNotes(true)}
              className="text-xs text-[#006fff] hover:underline"
            >
              + Agregar nota
            </button>
          )}

          {/* Actions */}
          <div className="flex items-center justify-between pt-2">
            {sessionCount > 0 && (
              <span className="text-[11px] text-[#94a3b8]">
                Sesion: {sessionCount} pago{sessionCount !== 1 && "s"} | ${sessionTotal.toLocaleString("es-MX", { minimumFractionDigits: 2 })}
              </span>
            )}
            <div className={`flex gap-3 ${sessionCount === 0 ? "ml-auto" : ""}`}>
              <button
                type="button"
                onClick={handleClose}
                className="rounded-xl border border-[#e2e8f0] bg-transparent px-5 py-2.5 text-sm text-[#475569] transition-colors hover:bg-[#f5f7fa]"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={saving || !selectedClient || !amount}
                className="flex items-center gap-2 rounded-xl bg-[#006fff] px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#0057cc] disabled:opacity-50"
              >
                {saving ? (
                  <><Loader2 className="h-4 w-4 animate-spin" />Guardando...</>
                ) : (
                  "Registrar Pago"
                )}
              </button>
            </div>
          </div>
          <p className="text-[10px] text-[#94a3b8] text-right">Ctrl+Enter para registrar</p>
        </form>
      )}
    </Modal>
  );
}
