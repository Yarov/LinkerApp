"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Plus, Network, ChevronRight, AlertTriangle, Pencil, Trash2, Server, Radio, Wifi, Share2, Home, Cable, Search, CheckCircle, AlertCircle } from "lucide-react";
import StatusBadge from "@/components/StatusBadge";
import Skeleton from "@/components/Skeleton";
import TableSkeleton from "@/components/skeletons/TableSkeleton";
import Modal from "@/components/Modal";
import ConfirmDialog from "@/components/ConfirmDialog";
import { useMikrotik } from "@/contexts/MikrotikContext";

const typeLabels: Record<string, string> = {
  ROUTER: "Router",
  AP: "Antena AP",
  STATION: "Estacion",
  DISTRIBUTION: "Distribucion",
  CPE: "Equipo Cliente",
  SWITCH: "Switch",
};

function getTypeLabel(type: string): string {
  return typeLabels[type?.toUpperCase()] ?? type ?? "-";
}

interface NodeData {
  id: string;
  name: string;
  type: string;
  ip: string;
  status: string;
  lastSeen: string;
  signal: number | null;
  parentId?: string;
  children: NodeData[];
}

interface NodeForm {
  name: string;
  type: string;
  ip: string;
  parentId: string;
}

const emptyNodeForm: NodeForm = {
  name: "",
  type: "CPE",
  ip: "",
  parentId: "",
};

function TreeNode({
  node,
  level,
  onSelect,
}: {
  node: NodeData;
  level: number;
  onSelect: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = (node.children ?? []).length > 0;
  const isOnline = (node.status ?? "").toUpperCase() === "ONLINE";
  const isDegraded = (node.status ?? "").toUpperCase() === "DEGRADED";

  return (
    <div>
      <div
        className="group flex cursor-pointer items-center gap-2 rounded-xl px-3 py-2.5 transition-all duration-200 hover:bg-[#f8f9fb]"
        style={{ paddingLeft: `${level * 28 + 12}px` }}
        onClick={() => onSelect(node.id)}
      >
        {hasChildren ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setExpanded(!expanded);
            }}
            className="text-[#94a3b8] transition-colors hover:text-[#0f172a]"
          >
            <ChevronRight
              className={`h-4 w-4 transition-transform duration-200 ${expanded ? "rotate-90" : ""}`}
            />
          </button>
        ) : (
          <span className="w-4" />
        )}
        {/* Connection line */}
        {level > 0 && (
          <div className="mr-1 h-px w-3 bg-[#cbd5e1]" />
        )}
        <div
          className={`h-3 w-3 shrink-0 rounded-full ${
            isOnline
              ? "bg-[#16a34a] status-dot-online"
              : isDegraded
                ? "bg-[#f59e0b]"
                : "bg-[#dc2626]"
          }`}
        />
        <span className="text-sm font-medium text-[#0f172a]">
          {node.name ?? "-"}
        </span>
        <span className="rounded-md bg-[#f5f7fa] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-[#475569] border border-[#e2e8f0]">
          {getTypeLabel(node.type)}
        </span>
        <span className="ml-auto font-mono text-xs text-[#94a3b8]">
          {node.ip ?? "-"}
        </span>
      </div>
      {hasChildren && expanded && (
        <div>
          {(node.children ?? []).map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              level={level + 1}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function RedPage() {
  const router = useRouter();
  const { connected: mikrotikConnected } = useMikrotik();
  const [nodes, setNodes] = useState<NodeData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [view, setView] = useState<"table" | "topology">("table");
  const [showAddForm, setShowAddForm] = useState(false);
  const [nodeForm, setNodeForm] = useState<NodeForm>(emptyNodeForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [editingNode, setEditingNode] = useState<NodeData | null>(null);
  const [deletingNode, setDeletingNode] = useState<NodeData | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: "success" | "warning" } | null>(null);
  const [detecting, setDetecting] = useState(false);

  const fetchNodes = () => {
    setLoading(true);
    fetch("/api/nodes")
      .then((r) => {
        if (!r.ok) throw new Error("Error al cargar nodos");
        return r.json();
      })
      .then((data) => {
        setNodes(Array.isArray(data) ? data : []);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchNodes();
  }, []);

  const flattenNodes = (nodeList: NodeData[]): NodeData[] => {
    const flat: NodeData[] = [];
    const walk = (list: NodeData[]) => {
      for (const n of list) {
        flat.push(n);
        if (n.children && n.children.length > 0) {
          walk(n.children);
        }
      }
    };
    walk(nodeList);
    return flat;
  };

  const allNodesFlat = flattenNodes(nodes).filter(
    (node, idx, arr) => arr.findIndex((n) => n.id === node.id) === idx
  );
  const onlineCount = allNodesFlat.filter(
    (n) => (n.status ?? "").toUpperCase() === "ONLINE"
  ).length;

  const isEditing = !!editingNode;

  const handleNodeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nodeForm.name || !nodeForm.ip) {
      setFormError("Nombre e IP son obligatorios.");
      return;
    }
    setSaving(true);
    setFormError("");
    try {
      if (isEditing) {
        const res = await fetch(`/api/nodes/${editingNode.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: nodeForm.name,
            type: nodeForm.type,
            ip: nodeForm.ip,
            parentId: nodeForm.parentId || null,
          }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || "Error al actualizar nodo");
        }
        const result = await res.json();
        if (nodeForm.ip) {
          if (result.reachable) {
            setToast({ message: `Nodo actualizado. IP ${nodeForm.ip} responde correctamente`, type: "success" });
          } else {
            setToast({ message: `Nodo actualizado. Advertencia: IP ${nodeForm.ip} no responde. Verifica la conexion`, type: "warning" });
          }
        }
      } else {
        const res = await fetch("/api/nodes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: nodeForm.name,
            type: nodeForm.type,
            ip: nodeForm.ip,
            parentId: nodeForm.parentId || null,
          }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || "Error al crear nodo");
        }
        const result = await res.json();
        if (nodeForm.ip) {
          if (result.reachable) {
            setToast({ message: `Nodo creado. IP ${nodeForm.ip} responde correctamente`, type: "success" });
          } else {
            setToast({ message: `Nodo creado. Advertencia: IP ${nodeForm.ip} no responde. Verifica la conexion`, type: "warning" });
          }
        }
      }
      setShowAddForm(false);
      setEditingNode(null);
      setNodeForm(emptyNodeForm);
      fetchNodes();
      // Auto-dismiss toast after 6 seconds
      setTimeout(() => setToast(null), 6000);
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteNode = async () => {
    if (!deletingNode) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/nodes/${deletingNode.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Error al eliminar nodo");
      setDeletingNode(null);
      fetchNodes();
    } catch {
      alert("Error al eliminar el nodo");
    } finally {
      setDeleting(false);
    }
  };

  const openEditForm = (node: NodeData) => {
    setEditingNode(node);
    setNodeForm({
      name: node.name ?? "",
      type: node.type ?? "CPE",
      ip: node.ip ?? "",
      parentId: node.parentId ?? "",
    });
    setFormError("");
    setShowAddForm(true);
  };

  const inputClass =
    "w-full rounded-xl border border-[#e2e8f0] bg-white px-3.5 py-2.5 text-sm text-[#0f172a] placeholder-[#94a3b8] transition-colors focus:border-[#006fff] focus:outline-none focus:ring-1 focus:ring-[#006fff]/30";

  if (loading)
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <Skeleton className="h-7 w-16" />
            <Skeleton className="mt-2 h-4 w-32" />
          </div>
          <div className="flex items-center gap-3">
            <Skeleton className="h-9 w-36 rounded-xl" />
            <Skeleton className="h-10 w-32 rounded-xl" />
          </div>
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
              fetchNodes();
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
            Red
          </h1>
          <p className="mt-1 text-sm text-[#475569]">
            {onlineCount}/{allNodesFlat.length} nodos en linea
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* View Toggle */}
          <div className="flex overflow-hidden rounded-xl border border-[#e2e8f0] bg-white">
            <button
              onClick={() => setView("table")}
              className={`px-4 py-2 text-xs font-medium transition-all duration-200 ${
                view === "table"
                  ? "bg-[#eff6ff] text-[#006fff]"
                  : "text-[#94a3b8] hover:text-[#475569]"
              }`}
            >
              Tabla
            </button>
            <button
              onClick={() => setView("topology")}
              className={`px-4 py-2 text-xs font-medium transition-all duration-200 ${
                view === "topology"
                  ? "bg-[#eff6ff] text-[#006fff]"
                  : "text-[#94a3b8] hover:text-[#475569]"
              }`}
            >
              Topologia
            </button>
          </div>
          <button
            onClick={async () => {
              setDetecting(true);
              try {
                const res = await fetch("/api/topology/auto-detect", { method: "POST" });
                const data = await res.json();
                if (data.changes?.length > 0) {
                  setToast({
                    message: `Topologia actualizada: ${data.changes.length} cambio(s) detectado(s)`,
                    type: "success"
                  });
                } else {
                  setToast({
                    message: "Topologia verificada. No se detectaron cambios",
                    type: "success"
                  });
                }
                if (data.errors?.length > 0) {
                  setToast({
                    message: `${data.errors.length} nodo(s) no accesibles. ${data.changes?.length || 0} cambio(s) aplicados`,
                    type: "warning"
                  });
                }
                fetchNodes();
                setTimeout(() => setToast(null), 6000);
              } catch {
                setToast({ message: "Error al auto-detectar topologia", type: "warning" });
                setTimeout(() => setToast(null), 6000);
              } finally {
                setDetecting(false);
              }
            }}
            disabled={detecting || !mikrotikConnected}
            title={!mikrotikConnected ? "Requiere conexion a MikroTik" : undefined}
            className={`flex items-center gap-2 rounded-xl border border-[#16a34a]/30 bg-[#f0fdf4] px-4 py-2.5 text-sm font-medium text-[#16a34a] transition-all duration-200 hover:bg-[#dcfce7] disabled:opacity-50 ${
              !mikrotikConnected ? "cursor-not-allowed" : ""
            }`}
          >
            <Network className={`h-4 w-4 ${detecting ? "animate-spin" : ""}`} />
            {detecting ? "Detectando..." : "Auto-detectar"}
          </button>
          <button
            onClick={() => router.push("/red/discover")}
            disabled={!mikrotikConnected}
            title={!mikrotikConnected ? "Requiere conexion a MikroTik" : undefined}
            className={`flex items-center gap-2 rounded-xl border border-[#e2e8f0] bg-white px-4 py-2.5 text-sm font-medium transition-all duration-200 ${
              mikrotikConnected
                ? "text-[#475569] hover:bg-[#f5f7fa] hover:text-[#0f172a]"
                : "cursor-not-allowed text-[#475569] opacity-50"
            }`}
          >
            <Search className="h-4 w-4" />
            Descubrir
          </button>
          <button
            onClick={() => {
              setEditingNode(null);
              setNodeForm(emptyNodeForm);
              setFormError("");
              setShowAddForm(true);
            }}
            className="flex items-center gap-2 rounded-xl bg-[#006fff] px-5 py-2.5 text-sm font-medium text-white shadow-lg shadow-[#006fff]/20 transition-all duration-200 hover:bg-[#0057cc] hover:shadow-[#006fff]/30"
          >
            <Plus className="h-4 w-4" />
            Nuevo Nodo
          </button>
        </div>
      </div>

      {view === "table" ? (
        <div className="overflow-hidden rounded-2xl border border-[#e2e8f0] bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-[#e2e8f0] bg-[#f5f7fa]">
                <th className="px-5 py-3.5 text-xs font-medium uppercase tracking-widest text-[#94a3b8]">
                  Nombre
                </th>
                <th className="px-5 py-3.5 text-xs font-medium uppercase tracking-widest text-[#94a3b8]">
                  Tipo
                </th>
                <th className="px-5 py-3.5 text-xs font-medium uppercase tracking-widest text-[#94a3b8]">
                  IP
                </th>
                <th className="px-5 py-3.5 text-xs font-medium uppercase tracking-widest text-[#94a3b8]">
                  Estado
                </th>
                <th className="px-5 py-3.5 text-xs font-medium uppercase tracking-widest text-[#94a3b8]">
                  Ultima vez visto
                </th>
                <th className="px-5 py-3.5 text-xs font-medium uppercase tracking-widest text-[#94a3b8]">
                  Acciones
                </th>
              </tr>
            </thead>
            <tbody>
              {allNodesFlat.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-5 py-12 text-center text-sm text-[#94a3b8]"
                  >
                    No hay nodos registrados
                  </td>
                </tr>
              ) : (
                allNodesFlat.map((node, idx) => (
                  <tr
                    key={node.id}
                    className={`cursor-pointer transition-colors hover:bg-[#f8f9fb] ${
                      idx % 2 === 0 ? "bg-white" : "bg-[#f8f9fb]"
                    }`}
                    onClick={() => router.push(`/red/${node.id}`)}
                  >
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-3">
                        <div
                          className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                            (node.status ?? "").toUpperCase() === "ONLINE"
                              ? "bg-[#16a34a] status-dot-online"
                              : (node.status ?? "").toUpperCase() === "DEGRADED"
                                ? "bg-[#f59e0b]"
                                : "bg-[#dc2626]"
                          }`}
                        />
                        <span className="font-medium text-[#0f172a]">
                          {node.name ?? "-"}
                        </span>
                      </div>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className="rounded-md bg-[#f5f7fa] px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider text-[#475569] border border-[#e2e8f0]">
                        {getTypeLabel(node.type)}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 font-mono text-xs text-[#475569]">
                      {node.ip ?? "-"}
                    </td>
                    <td className="px-5 py-3.5">
                      <StatusBadge
                        status={node.status ?? "unknown"}
                        size="sm"
                      />
                    </td>
                    <td className="px-5 py-3.5 text-xs text-[#94a3b8]">
                      {node.lastSeen
                        ? new Date(node.lastSeen).toLocaleString("es-MX")
                        : "-"}
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-1">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            openEditForm(node);
                          }}
                          className="rounded-lg p-1.5 text-[#94a3b8] transition-colors hover:bg-[#eff6ff] hover:text-[#006fff]"
                          title="Editar nodo"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeletingNode(node);
                          }}
                          className="rounded-lg p-1.5 text-[#94a3b8] transition-colors hover:bg-[#fef2f2] hover:text-[#dc2626]"
                          title="Eliminar nodo"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="rounded-2xl border border-[#e2e8f0] bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center gap-2 text-sm text-[#475569]">
            <Network className="h-4 w-4 text-[#006fff]" />
            Topologia de Red
          </div>
          {nodes.length === 0 ? (
            <p className="py-12 text-center text-sm text-[#94a3b8]">
              No hay nodos para mostrar
            </p>
          ) : (
            <div className="space-y-0.5">
              {nodes.map((node) => (
                <TreeNode
                  key={node.id}
                  node={node}
                  level={0}
                  onSelect={(id) => router.push(`/red/${id}`)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Add/Edit Node Modal */}
      <Modal
        open={showAddForm}
        onClose={() => {
          setShowAddForm(false);
          setEditingNode(null);
        }}
        title={isEditing ? "Editar Nodo" : "Nuevo Nodo"}
      >
        <form onSubmit={handleNodeSubmit} className="space-y-4">
          {formError && (
            <div className="rounded-xl border border-[#dc2626]/30 bg-[#fef2f2] px-4 py-2.5 text-sm text-[#dc2626]">
              {formError}
            </div>
          )}
          <div>
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-widest text-[#475569]">
              Nombre *
            </label>
            <input
              type="text"
              className={inputClass}
              value={nodeForm.name}
              onChange={(e) =>
                setNodeForm({ ...nodeForm, name: e.target.value })
              }
              placeholder="Ej: Base-G5"
            />
          </div>
          <div>
            <label className="mb-2 block text-xs font-medium uppercase tracking-widest text-[#475569]">
              Tipo de equipo
            </label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { value: "ROUTER", Icon: Server, label: "Router", desc: "Equipo principal (MikroTik)" },
                { value: "AP", Icon: Radio, label: "Antena AP", desc: "Transmite senal a distancia" },
                { value: "STATION", Icon: Wifi, label: "Estacion", desc: "Recibe senal del AP" },
                { value: "DISTRIBUTION", Icon: Share2, label: "Distribucion", desc: "Redistribuye a mas clientes" },
                { value: "CPE", Icon: Home, label: "Equipo Cliente", desc: "Modem en casa del cliente" },
                { value: "SWITCH", Icon: Cable, label: "Switch", desc: "Conecta equipos por cable" },
              ].map((t) => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => setNodeForm({ ...nodeForm, type: t.value })}
                  className={`flex flex-col items-center gap-1.5 rounded-xl border-2 px-3 py-3 text-center transition-all duration-200 ${
                    nodeForm.type === t.value
                      ? "border-[#006fff] bg-[#eff6ff] shadow-sm"
                      : "border-[#e2e8f0] bg-white hover:border-[#cbd5e1] hover:bg-[#f8f9fb]"
                  }`}
                >
                  <t.Icon className={`h-5 w-5 ${
                    nodeForm.type === t.value ? "text-[#006fff]" : "text-[#94a3b8]"
                  }`} />
                  <span className={`text-xs font-semibold ${
                    nodeForm.type === t.value ? "text-[#006fff]" : "text-[#0f172a]"
                  }`}>
                    {t.label}
                  </span>
                  <span className="text-[10px] leading-tight text-[#94a3b8]">
                    {t.desc}
                  </span>
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-widest text-[#475569]">
              IP *
            </label>
            <input
              type="text"
              className={inputClass}
              value={nodeForm.ip}
              onChange={(e) =>
                setNodeForm({ ...nodeForm, ip: e.target.value })
              }
              placeholder="192.168.1.1"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-widest text-[#475569]">
              Nodo Padre (opcional)
            </label>
            <select
              className={inputClass}
              value={nodeForm.parentId}
              onChange={(e) =>
                setNodeForm({ ...nodeForm, parentId: e.target.value })
              }
            >
              <option value="">Sin padre (raiz)</option>
              {allNodesFlat
                .filter((n) => !isEditing || n.id !== editingNode.id)
                .map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.name} ({n.type})
                  </option>
                ))}
            </select>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => {
                setShowAddForm(false);
                setEditingNode(null);
              }}
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
                : isEditing
                  ? "Guardar Cambios"
                  : "Crear Nodo"}
            </button>
          </div>
        </form>
      </Modal>

      {/* Delete confirmation */}
      <ConfirmDialog
        open={!!deletingNode}
        onClose={() => setDeletingNode(null)}
        onConfirm={handleDeleteNode}
        title="Eliminar nodo"
        message={
          deletingNode
            ? `Estas seguro de eliminar el nodo "${deletingNode.name}"? Esta accion no se puede deshacer.`
            : ""
        }
        confirmText="Eliminar"
        confirmColor="red"
        loading={deleting}
      />

      {/* Toast notification */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 animate-in fade-in slide-in-from-bottom-4 duration-300">
          <div
            className={`flex items-center gap-3 rounded-xl border px-5 py-3.5 shadow-lg ${
              toast.type === "success"
                ? "border-[#16a34a]/30 bg-[#f0fdf4] text-[#16a34a]"
                : "border-[#f59e0b]/30 bg-[#fffbeb] text-[#b45309]"
            }`}
          >
            {toast.type === "success" ? (
              <CheckCircle className="h-5 w-5 shrink-0" />
            ) : (
              <AlertCircle className="h-5 w-5 shrink-0" />
            )}
            <p className="text-sm font-medium">{toast.message}</p>
            <button
              onClick={() => setToast(null)}
              className="ml-2 text-current opacity-60 hover:opacity-100"
            >
              &times;
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
