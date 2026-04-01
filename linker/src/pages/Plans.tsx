import { useState, useEffect } from "react";
import { Plus, Edit2, Trash2, AlertTriangle, Wifi, ArrowDown, ArrowUp } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import Modal from "@/components/Modal";
import CardGridSkeleton from "@/components/skeletons/CardGridSkeleton";
import Skeleton from "@/components/Skeleton";
import { useMikrotikStore } from "@/stores/useMikrotikStore";
import { useAppStore, type Plan } from "@/stores/useAppStore";

interface PlanForm { name: string; downloadMbps: string; uploadMbps: string; price: string; profileName: string; }
const emptyForm: PlanForm = { name: "", downloadMbps: "", uploadMbps: "", price: "", profileName: "" };

export default function PlanesPage() {
  const mikrotikConnected = useMikrotikStore(s => s.connected);
  const plans = useAppStore(s => s.plans);
  const plansLoaded = useAppStore(s => s.plansLoaded);
  const plansLoading = useAppStore(s => s.plansLoading);
  const plansError = useAppStore(s => s.plansError);
  const fetchPlans = useAppStore(s => s.fetchPlans);
  const invalidatePlans = useAppStore(s => s.invalidatePlans);

  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<PlanForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  useEffect(() => {
    if (!plansLoaded && !plansLoading) fetchPlans();
  }, [plansLoaded, plansLoading, fetchPlans]);

  const handleRefresh = () => {
    invalidatePlans();
    fetchPlans();
  };

  const openCreate = () => { setEditId(null); setForm(emptyForm); setFormError(""); setShowForm(true); };
  const openEdit = (plan: Plan) => { setEditId(plan.id); setForm({ name: plan.name ?? "", downloadMbps: String(plan.downloadMbps ?? ""), uploadMbps: String(plan.uploadMbps ?? ""), price: String(plan.price ?? ""), profileName: plan.profileName ?? "" }); setFormError(""); setShowForm(true); };
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name || !form.downloadMbps || !form.uploadMbps || !form.price) { setFormError("Todos los campos son obligatorios."); return; }
    setSaving(true); setFormError("");
    try {
      const profileName = form.profileName || form.name.toLowerCase().replace(/\s+/g, "-");
      if (editId) {
        await invoke("update_plan", {
          id: editId,
          name: form.name,
          downloadMbps: parseInt(form.downloadMbps),
          uploadMbps: parseInt(form.uploadMbps),
          price: parseFloat(form.price),
          profileName,
        });
      } else {
        await invoke("create_plan", {
          name: form.name,
          downloadMbps: parseInt(form.downloadMbps),
          uploadMbps: parseInt(form.uploadMbps),
          price: parseFloat(form.price),
          profileName,
        });
      }
      setShowForm(false);
      invalidatePlans();
      fetchPlans();
    } catch (err: unknown) { setFormError(err instanceof Error ? err.message : String(err)); } finally { setSaving(false); }
  };
  const handleDelete = async (planId: string) => {
    if (!confirm("Estas seguro de eliminar este plan?")) return;
    try { await invoke("delete_plan", { id: planId }); invalidatePlans(); fetchPlans(); } catch (err) { alert(err instanceof Error ? err.message : String(err)); }
  };
  const inputClass = "w-full rounded-xl border border-[#e2e8f0] bg-white px-3.5 py-2.5 text-sm text-[#0f172a] placeholder-[#94a3b8] transition-colors focus:border-[#006fff] focus:outline-none focus:ring-1 focus:ring-[#006fff]/30";

  const loading = plansLoading && !plansLoaded;

  if (loading) return (<div className="space-y-6"><div className="flex items-center justify-between"><div><Skeleton className="h-7 w-24" /><Skeleton className="mt-2 h-4 w-36" /></div><Skeleton className="h-10 w-32 rounded-xl" /></div><CardGridSkeleton count={3} /></div>);
  if (plansError) return (<div className="flex flex-col items-center justify-center py-20"><div className="rounded-2xl border border-[#e2e8f0] bg-white p-8 text-center shadow-sm"><AlertTriangle className="mx-auto h-10 w-10 text-[#dc2626]" /><p className="mt-4 text-sm text-[#dc2626]">{plansError}</p><button onClick={handleRefresh} className="mt-4 rounded-xl bg-[#006fff] px-5 py-2 text-sm font-medium text-white">Reintentar</button></div></div>);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between"><div><h1 className="text-2xl font-semibold tracking-tight text-[#0f172a]">Planes</h1><p className="mt-1 text-sm text-[#475569]">{plans.length} planes de servicio</p></div><button onClick={openCreate} disabled={!mikrotikConnected} className={`flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-medium text-white ${mikrotikConnected ? "bg-[#006fff] shadow-lg shadow-[#006fff]/20 hover:bg-[#0057cc]" : "cursor-not-allowed bg-[#006fff] opacity-50"}`}><Plus className="h-4 w-4" />Nuevo Plan</button></div>
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
        {plans.length === 0 ? <div className="col-span-full flex flex-col items-center justify-center rounded-2xl border border-[#e2e8f0] bg-white py-16 shadow-sm"><Wifi className="h-10 w-10 text-[#94a3b8]" /><p className="mt-4 text-sm text-[#94a3b8]">No hay planes registrados</p></div> : plans.map(plan => (
          <div key={plan.id} className={`group relative overflow-hidden rounded-2xl border border-[#e2e8f0] bg-white shadow-sm transition-all hover:border-[#cbd5e1] hover:bg-[#f8f9fb] ${plan.isActive === false ? "opacity-50" : ""}`}>
            <div className="h-1 w-full bg-gradient-to-r from-[#006fff] via-[#7c4dff] to-[#006fff]" />
            <div className="p-5">
              <div className="flex items-start justify-between"><div><h3 className="text-base font-semibold text-[#0f172a]">{plan.name}</h3><div className="mt-3"><span className="text-3xl font-bold text-[#0f172a]">${(plan.price ?? 0).toLocaleString("es-MX")}</span><span className="ml-1 text-sm text-[#94a3b8]">/mes</span></div></div><div className="flex gap-1"><button onClick={() => openEdit(plan)} className="rounded-xl p-2 text-[#94a3b8] hover:bg-[#f5f7fa] hover:text-[#0f172a]"><Edit2 className="h-4 w-4" /></button><button onClick={() => handleDelete(plan.id)} className="rounded-xl p-2 text-[#94a3b8] hover:bg-[#fef2f2] hover:text-[#dc2626]"><Trash2 className="h-4 w-4" /></button></div></div>
              <div className="mt-4 flex items-center gap-3"><div className="flex-1 rounded-xl bg-[#f5f7fa] px-3.5 py-2.5"><div className="flex items-center gap-1.5 text-xs text-[#94a3b8]"><ArrowDown className="h-3 w-3 text-[#16a34a]" />Descarga</div><p className="mt-1 text-lg font-bold text-[#0f172a]">{plan.downloadMbps}<span className="ml-1 text-xs font-normal text-[#94a3b8]">Mbps</span></p></div><div className="flex-1 rounded-xl bg-[#f5f7fa] px-3.5 py-2.5"><div className="flex items-center gap-1.5 text-xs text-[#94a3b8]"><ArrowUp className="h-3 w-3 text-[#006fff]" />Subida</div><p className="mt-1 text-lg font-bold text-[#0f172a]">{plan.uploadMbps}<span className="ml-1 text-xs font-normal text-[#94a3b8]">Mbps</span></p></div></div>
              <div className="mt-4 flex items-center justify-between border-t border-[#e2e8f0] pt-4"><span className="rounded-lg bg-[#f5f7fa] px-2.5 py-1 font-mono text-[10px] text-[#475569] border border-[#e2e8f0]">{plan.profileName}</span></div>
            </div>
          </div>
        ))}
      </div>
      <Modal open={showForm} onClose={() => setShowForm(false)} title={editId ? "Editar Plan" : "Nuevo Plan"}>
        <form onSubmit={handleSubmit} className="space-y-4">
          {formError && <div className="rounded-xl border border-[#dc2626]/30 bg-[#fef2f2] px-4 py-2.5 text-sm text-[#dc2626]">{formError}</div>}
          <div><label className="mb-1.5 block text-xs font-medium uppercase tracking-widest text-[#475569]">Nombre del Plan *</label><input type="text" className={inputClass} value={form.name} onChange={e => setForm({...form, name: e.target.value})} placeholder="Ej: Plan 10 Mbps" /></div>
          <div><label className="mb-1.5 block text-xs font-medium uppercase tracking-widest text-[#475569]">Nombre de Perfil (MikroTik)</label><input type="text" className={inputClass} value={form.profileName} onChange={e => setForm({...form, profileName: e.target.value})} placeholder="plan-10M" /></div>
          <div className="grid grid-cols-2 gap-4"><div><label className="mb-1.5 block text-xs font-medium uppercase tracking-widest text-[#475569]">Descarga (Mbps) *</label><input type="number" step="0.1" className={inputClass} value={form.downloadMbps} onChange={e => setForm({...form, downloadMbps: e.target.value})} /></div><div><label className="mb-1.5 block text-xs font-medium uppercase tracking-widest text-[#475569]">Subida (Mbps) *</label><input type="number" step="0.1" className={inputClass} value={form.uploadMbps} onChange={e => setForm({...form, uploadMbps: e.target.value})} /></div></div>
          <div><label className="mb-1.5 block text-xs font-medium uppercase tracking-widest text-[#475569]">Precio ($) *</label><input type="number" step="0.01" className={inputClass} value={form.price} onChange={e => setForm({...form, price: e.target.value})} placeholder="350" /></div>
          <div className="flex justify-end gap-3 pt-2"><button type="button" onClick={() => setShowForm(false)} className="rounded-xl border border-[#e2e8f0] px-5 py-2.5 text-sm text-[#475569] hover:bg-[#f5f7fa]">Cancelar</button><button type="submit" disabled={saving} className="rounded-xl bg-[#006fff] px-5 py-2.5 text-sm font-medium text-white hover:bg-[#0057cc] disabled:opacity-50">{saving ? "Guardando..." : editId ? "Actualizar" : "Crear Plan"}</button></div>
        </form>
      </Modal>
    </div>
  );
}
