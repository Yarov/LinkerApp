"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Search,
  Plus,
  Wifi,
  AlertTriangle,
  CheckCircle,
  Monitor,
} from "lucide-react";
import Skeleton from "@/components/Skeleton";

interface DiscoveredDevice {
  ip: string;
  mac: string;
  hostname: string | null;
  interface: string | null;
  source: string;
}

interface KnownDevice extends DiscoveredDevice {
  node: {
    id: string;
    name: string;
    type: string;
    ip: string | null;
    mac: string | null;
    status: string;
  };
}

interface DiscoverResult {
  known: KnownDevice[];
  unknown: DiscoveredDevice[];
  summary: {
    total: number;
    known: number;
    unknown: number;
    arpEntries: number;
    dhcpLeases: number;
  };
}

export default function DiscoverPage() {
  const router = useRouter();
  const [result, setResult] = useState<DiscoverResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState<string | null>(null);
  const [addedIps, setAddedIps] = useState<Set<string>>(new Set());

  const handleScan = async () => {
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const res = await fetch("/api/discover");
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Error al escanear la red");
      }
      const data = await res.json();
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setLoading(false);
    }
  };

  const handleAddNode = async (device: DiscoveredDevice) => {
    setAdding(device.ip);
    try {
      const res = await fetch("/api/nodes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: device.hostname || `Dispositivo ${device.ip}`,
          type: "CPE",
          ip: device.ip,
          mac: device.mac,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Error al crear nodo");
      }
      setAddedIps((prev) => new Set(prev).add(device.ip));
    } catch (err) {
      alert(err instanceof Error ? err.message : "Error al agregar nodo");
    } finally {
      setAdding(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={() => router.push("/red")}
            className="rounded-xl border border-[#e2e8f0] p-2 text-[#475569] transition-colors hover:bg-[#f5f7fa] hover:text-[#0f172a]"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-[#0f172a]">
              Descubrir Dispositivos
            </h1>
            <p className="mt-1 text-sm text-[#475569]">
              Escanea la red para encontrar dispositivos nuevos
            </p>
          </div>
        </div>
        <button
          onClick={handleScan}
          disabled={loading}
          className="flex items-center gap-2 rounded-xl bg-[#006fff] px-5 py-2.5 text-sm font-medium text-white shadow-lg shadow-[#006fff]/20 transition-all duration-200 hover:bg-[#0057cc] hover:shadow-[#006fff]/30 disabled:opacity-50"
        >
          <Search className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          {loading ? "Escaneando..." : "Escanear Red"}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-2xl border border-[#dc2626]/30 bg-[#fef2f2] p-5">
          <div className="flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 text-[#dc2626]" />
            <p className="text-sm text-[#dc2626]">{error}</p>
          </div>
        </div>
      )}

      {/* Loading skeleton */}
      {loading && (
        <div className="space-y-6">
          <div className="rounded-2xl border border-[#e2e8f0] bg-white p-6 shadow-sm">
            <Skeleton className="mb-4 h-5 w-48" />
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4">
                  <Skeleton className="h-10 w-10 rounded-lg" />
                  <div className="flex-1">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="mt-1 h-3 w-48" />
                  </div>
                  <Skeleton className="h-8 w-20 rounded-lg" />
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-2xl border border-[#e2e8f0] bg-white p-6 shadow-sm">
            <Skeleton className="mb-4 h-5 w-48" />
            <div className="space-y-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4">
                  <Skeleton className="h-10 w-10 rounded-lg" />
                  <div className="flex-1">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="mt-1 h-3 w-48" />
                  </div>
                  <Skeleton className="h-8 w-20 rounded-lg" />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* No scan yet */}
      {!loading && !result && !error && (
        <div className="flex flex-col items-center justify-center py-20">
          <div className="rounded-2xl border border-[#e2e8f0] bg-white p-8 text-center shadow-sm">
            <Search className="mx-auto h-12 w-12 text-[#94a3b8]" />
            <p className="mt-4 text-sm font-medium text-[#0f172a]">
              Presiona &quot;Escanear Red&quot; para buscar dispositivos
            </p>
            <p className="mt-1 text-xs text-[#94a3b8]">
              Se revisaran las tablas ARP y DHCP de MikroTik
            </p>
          </div>
        </div>
      )}

      {/* Results */}
      {result && (
        <div className="space-y-6">
          {/* Summary */}
          <div className="grid grid-cols-3 gap-4">
            <div className="rounded-2xl border border-[#e2e8f0] bg-white p-5 shadow-sm">
              <p className="text-xs font-medium uppercase tracking-widest text-[#94a3b8]">
                Total
              </p>
              <p className="mt-1 text-2xl font-semibold text-[#0f172a]">
                {result.summary.total}
              </p>
            </div>
            <div className="rounded-2xl border border-[#e2e8f0] bg-white p-5 shadow-sm">
              <p className="text-xs font-medium uppercase tracking-widest text-[#16a34a]">
                Conocidos
              </p>
              <p className="mt-1 text-2xl font-semibold text-[#16a34a]">
                {result.summary.known}
              </p>
            </div>
            <div className="rounded-2xl border border-[#e2e8f0] bg-white p-5 shadow-sm">
              <p className="text-xs font-medium uppercase tracking-widest text-[#f59e0b]">
                Nuevos
              </p>
              <p className="mt-1 text-2xl font-semibold text-[#f59e0b]">
                {result.summary.unknown}
              </p>
            </div>
          </div>

          {/* Unknown devices */}
          {result.unknown.length > 0 && (
            <div className="rounded-2xl border border-[#e2e8f0] bg-white shadow-sm">
              <div className="border-b border-[#e2e8f0] px-6 py-4">
                <h2 className="text-sm font-semibold text-[#0f172a]">
                  Dispositivos Nuevos
                </h2>
                <p className="mt-0.5 text-xs text-[#94a3b8]">
                  {result.unknown.length} dispositivos no registrados en la base de datos
                </p>
              </div>
              <div className="divide-y divide-[#e2e8f0]">
                {result.unknown.map((device) => {
                  const isAdded = addedIps.has(device.ip);
                  const isAdding = adding === device.ip;
                  return (
                    <div
                      key={`${device.ip}-${device.mac}`}
                      className="flex items-center gap-4 px-6 py-3.5 transition-colors hover:bg-[#f8f9fb]"
                    >
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#fffbeb]">
                        <Monitor className="h-5 w-5 text-[#f59e0b]" />
                      </div>
                      <div className="flex-1">
                        <p className="text-sm font-medium text-[#0f172a]">
                          {device.hostname || "Dispositivo desconocido"}
                        </p>
                        <div className="mt-0.5 flex items-center gap-3 text-xs text-[#94a3b8]">
                          <span className="font-mono">{device.ip}</span>
                          <span className="font-mono">{device.mac}</span>
                          {device.interface && (
                            <span>{device.interface}</span>
                          )}
                          <span className="rounded bg-[#f5f7fa] px-1.5 py-0.5 text-[10px] uppercase">
                            {device.source}
                          </span>
                        </div>
                      </div>
                      {isAdded ? (
                        <span className="flex items-center gap-1.5 text-xs font-medium text-[#16a34a]">
                          <CheckCircle className="h-4 w-4" />
                          Agregado
                        </span>
                      ) : (
                        <button
                          onClick={() => handleAddNode(device)}
                          disabled={isAdding}
                          className="flex items-center gap-1.5 rounded-lg bg-[#006fff] px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[#0057cc] disabled:opacity-50"
                        >
                          <Plus className="h-3.5 w-3.5" />
                          {isAdding ? "Agregando..." : "Agregar"}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Known devices */}
          {result.known.length > 0 && (
            <div className="rounded-2xl border border-[#e2e8f0] bg-white shadow-sm">
              <div className="border-b border-[#e2e8f0] px-6 py-4">
                <h2 className="text-sm font-semibold text-[#0f172a]">
                  Dispositivos Conocidos
                </h2>
                <p className="mt-0.5 text-xs text-[#94a3b8]">
                  {result.known.length} dispositivos ya registrados
                </p>
              </div>
              <div className="divide-y divide-[#e2e8f0]">
                {result.known.map((device) => {
                  const isOnline = device.node.status === "ONLINE";
                  return (
                    <div
                      key={`${device.ip}-${device.mac}`}
                      className="flex cursor-pointer items-center gap-4 px-6 py-3.5 transition-colors hover:bg-[#f8f9fb]"
                      onClick={() => router.push(`/red/${device.node.id}`)}
                    >
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#f0fdf4]">
                        <Wifi className={`h-5 w-5 ${isOnline ? "text-[#16a34a]" : "text-[#94a3b8]"}`} />
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium text-[#0f172a]">
                            {device.node.name}
                          </p>
                          <span className="rounded-md bg-[#f5f7fa] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-[#475569] border border-[#e2e8f0]">
                            {device.node.type}
                          </span>
                          <span
                            className={`inline-flex h-2 w-2 rounded-full ${
                              isOnline ? "bg-[#16a34a]" : "bg-[#dc2626]"
                            }`}
                          />
                        </div>
                        <div className="mt-0.5 flex items-center gap-3 text-xs text-[#94a3b8]">
                          <span className="font-mono">{device.ip}</span>
                          <span className="font-mono">{device.mac}</span>
                          {device.hostname && (
                            <span>{device.hostname}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* No devices at all */}
          {result.summary.total === 0 && (
            <div className="flex flex-col items-center justify-center py-12">
              <div className="rounded-2xl border border-[#e2e8f0] bg-white p-8 text-center shadow-sm">
                <AlertTriangle className="mx-auto h-10 w-10 text-[#f59e0b]" />
                <p className="mt-4 text-sm text-[#475569]">
                  No se encontraron dispositivos en la red. Verifica la conexion con MikroTik.
                </p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
