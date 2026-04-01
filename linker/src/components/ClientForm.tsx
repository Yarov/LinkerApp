import { useState, useEffect } from "react";
import { WifiOff } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import Modal from "./Modal";
import { useMikrotikStore } from "@/stores/useMikrotikStore";

interface Plan { id: string; name: string; download_mbps: number; upload_mbps: number; price: number; profile_name: string; }
interface Node { id: string; name: string; type: string; }
interface ClientData { id: string; name: string; phone?: string | null; address: string; pppoeUser: string; pppoePassword?: string; profileName: string; nodeId?: string | null; notes?: string | null; }
interface ClientFormProps { open: boolean; onClose: () => void; onSuccess: () => void; client?: ClientData | null; }

function generateUsername(name: string): string {
  return name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9\s-]/g, "").trim().replace(/\s+/g, "-").slice(0, 30);
}
function generatePassword(): string {
  const chars = "abcdefghjkmnpqrstuvwxyz23456789";
  let pass = "lk-";
  for (let i = 0; i < 6; i++) pass += chars[Math.floor(Math.random() * chars.length)];
  return pass;
}

export default function ClientForm({ open, onClose, onSuccess, client }: ClientFormProps) {
  const isEditing = !!client;
  const mikrotikConnected = useMikrotikStore(s => s.connected);
  const [name, setName] = useState(""); const [phone, setPhone] = useState(""); const [address, setAddress] = useState("");
  const [profileName, setProfileName] = useState(""); const [nodeId, setNodeId] = useState("");
  const [plans, setPlans] = useState<Plan[]>([]); const [nodes, setNodes] = useState<Node[]>([]);
  const [saving, setSaving] = useState(false); const [error, setError] = useState(""); const [success, setSuccess] = useState("");
  const [createdCredentials, setCreatedCredentials] = useState<{ user: string; pass: string } | null>(null);

  useEffect(() => {
    if (open) {
      if (client) { setName(client.name ?? ""); setPhone(client.phone ?? ""); setAddress(client.address ?? ""); setProfileName(client.profileName ?? ""); setNodeId(client.nodeId ?? ""); }
      else { setName(""); setPhone(""); setAddress(""); setProfileName(""); setNodeId(""); }
      setError(""); setSuccess(""); setCreatedCredentials(null);
      // Rust returns { plans: [...] } and { nodes: [...] }
      invoke<{ plans: Plan[] }>("list_plans").then(d => setPlans(d?.plans ?? [])).catch(() => setPlans([]));
      invoke<{ nodes: Node[] }>("list_nodes").then(d => setNodes(d?.nodes ?? [])).catch(() => setNodes([]));
    }
  }, [open, client]);

  const selectedPlan = plans.find(p => p.profile_name === profileName);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !profileName || !address) { setError("Nombre, direccion y plan son obligatorios."); return; }
    setSaving(true); setError(""); setSuccess("");
    try {
      if (isEditing) {
        // Rust update_client expects flat params
        await invoke("update_client", {
          id: client.id,
          name,
          phone: phone || null,
          address,
          pppoeUser: client.pppoeUser,
          pppoePassword: client.pppoePassword ?? "",
          profileName,
          nodeId: nodeId || null,
          notes: null,
        });
        setSuccess("Cliente actualizado exitosamente");
        setTimeout(() => onSuccess(), 800);
      } else {
        const pppoeUser = generateUsername(name);
        const pppoePassword = generatePassword();
        if (!pppoeUser) { setError("No se pudo generar un usuario valido del nombre."); setSaving(false); return; }
        // Rust create_client expects flat params
        await invoke("create_client", {
          name,
          phone: phone || null,
          address,
          pppoeUser,
          pppoePassword,
          profileName,
          nodeId: nodeId || null,
          notes: null,
        });
        setCreatedCredentials({ user: pppoeUser, pass: pppoePassword });
        setSuccess("Cliente creado exitosamente");
      }
    } catch (err: unknown) { setError(err instanceof Error ? err.message : String(err)); } finally { setSaving(false); }
  };

  const inputClass = "w-full rounded-xl border border-[#e2e8f0] bg-white px-3.5 py-2.5 text-sm text-[#0f172a] placeholder-[#94a3b8] transition-colors focus:border-[#006fff] focus:outline-none focus:ring-1 focus:ring-[#006fff]/30";
  const readOnlyClass = "w-full rounded-xl border border-[#e2e8f0] bg-[#f5f7fa] px-3.5 py-2.5 text-sm text-[#475569] cursor-not-allowed";

  return (
    <Modal open={open} onClose={onClose} title={isEditing ? "Editar Cliente" : "Nuevo Cliente"} maxWidth="max-w-lg">
      {createdCredentials ? (
        <div className="space-y-5">
          <div className="rounded-xl border border-[#16a34a]/30 bg-[#f0fdf4] px-5 py-4 text-sm text-[#16a34a]">Cliente creado exitosamente</div>
          <div className="rounded-xl border border-[#e2e8f0] bg-[#f5f7fa] p-5">
            <p className="mb-3 text-xs font-medium uppercase tracking-widest text-[#475569]">Credenciales PPPoE para configurar en el modem del cliente</p>
            <div className="space-y-3">
              <div className="flex items-center justify-between"><span className="text-sm text-[#475569]">Usuario:</span><code className="rounded-lg bg-white px-3 py-1.5 font-mono text-sm font-medium text-[#0f172a] border border-[#e2e8f0]">{createdCredentials.user}</code></div>
              <div className="flex items-center justify-between"><span className="text-sm text-[#475569]">Contrasena:</span><code className="rounded-lg bg-white px-3 py-1.5 font-mono text-sm font-medium text-[#0f172a] border border-[#e2e8f0]">{createdCredentials.pass}</code></div>
              {selectedPlan && <div className="flex items-center justify-between"><span className="text-sm text-[#475569]">Plan:</span><span className="text-sm font-medium text-[#0f172a]">{selectedPlan.name} ({selectedPlan.download_mbps}Mbps)</span></div>}
            </div>
            <p className="mt-4 text-xs text-[#94a3b8]">Configura el modem del cliente en modo PPPoE con estos datos.</p>
          </div>
          <div className="flex justify-end"><button onClick={() => { setCreatedCredentials(null); onSuccess(); }} className="rounded-xl bg-[#006fff] px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#0057cc]">Listo</button></div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          {!mikrotikConnected && <div className="flex items-center gap-2 rounded-xl border border-[#f59e0b]/30 bg-[#fffbeb] px-4 py-2.5 text-sm text-[#b45309]"><WifiOff className="h-4 w-4 shrink-0" />No hay conexion a MikroTik. No se puede {isEditing ? "editar" : "crear"} el cliente.</div>}
          {error && <div className="rounded-xl border border-[#dc2626]/30 bg-[#fef2f2] px-4 py-2.5 text-sm text-[#dc2626]">{error}</div>}
          {success && !createdCredentials && <div className="rounded-xl border border-[#16a34a]/30 bg-[#f0fdf4] px-4 py-2.5 text-sm text-[#16a34a]">{success}</div>}
          <fieldset disabled={!mikrotikConnected} className={!mikrotikConnected ? "opacity-50" : ""}>
          <div className="space-y-4">
            <div><label className="mb-1.5 block text-xs font-medium uppercase tracking-widest text-[#475569]">Nombre del cliente *</label><input type="text" className={inputClass} value={name} onChange={e => setName(e.target.value)} placeholder="Juan Perez Lopez" />{!isEditing && name && <p className="mt-1 text-xs text-[#94a3b8]">Usuario PPPoE: <span className="font-mono text-[#006fff]">{generateUsername(name)}</span></p>}</div>
            {isEditing && <div><label className="mb-1.5 block text-xs font-medium uppercase tracking-widest text-[#475569]">Usuario PPPoE</label><input type="text" className={readOnlyClass} value={client.pppoeUser ?? ""} readOnly /><p className="mt-1 text-xs text-[#94a3b8]">El usuario PPPoE no se puede modificar.</p></div>}
            <div className="grid grid-cols-2 gap-4">
              <div><label className="mb-1.5 block text-xs font-medium uppercase tracking-widest text-[#475569]">Telefono</label><input type="text" className={inputClass} value={phone} onChange={e => setPhone(e.target.value)} placeholder="3XX XXX XXXX" /></div>
              <div><label className="mb-1.5 block text-xs font-medium uppercase tracking-widest text-[#475569]">Plan *</label><select className={inputClass} value={profileName} onChange={e => setProfileName(e.target.value)}><option value="">Seleccionar plan</option>{plans.map(p => <option key={p.id} value={p.profile_name}>{p.name}{p.price > 0 ? ` - $${p.price}/mes` : ""}</option>)}</select></div>
            </div>
            <div><label className="mb-1.5 block text-xs font-medium uppercase tracking-widest text-[#475569]">Direccion *</label><input type="text" className={inputClass} value={address} onChange={e => setAddress(e.target.value)} placeholder="Calle, colonia, numero" /></div>
            <div><label className="mb-1.5 block text-xs font-medium uppercase tracking-widest text-[#475569]">Nodo de conexion</label><select className={inputClass} value={nodeId} onChange={e => setNodeId(e.target.value)}><option value="">Seleccionar nodo (opcional)</option>{nodes.map(n => <option key={n.id} value={n.id}>{n.name} ({n.type ?? ""})</option>)}</select></div>
            {selectedPlan && <div className="rounded-xl border border-[#006fff]/20 bg-[#eff6ff] px-4 py-3"><p className="text-sm text-[#006fff]"><span className="font-medium">{selectedPlan.name}</span> — {selectedPlan.download_mbps}/{selectedPlan.upload_mbps} Mbps — <span className="font-semibold">${selectedPlan.price}/mes</span></p></div>}
          </div>
          </fieldset>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="rounded-xl border border-[#e2e8f0] bg-transparent px-5 py-2.5 text-sm text-[#475569] transition-colors hover:bg-[#f5f7fa] hover:text-[#0f172a]">Cancelar</button>
            <button type="submit" disabled={saving || !mikrotikConnected} className="rounded-xl bg-[#006fff] px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#0057cc] disabled:cursor-not-allowed disabled:opacity-50">{saving ? (isEditing ? "Guardando..." : "Creando...") : (isEditing ? "Guardar Cambios" : "Crear Cliente")}</button>
          </div>
        </form>
      )}
    </Modal>
  );
}
