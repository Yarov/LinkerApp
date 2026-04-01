import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "@/stores/useAuthStore";

export default function LoginPage() {
  const navigate = useNavigate();
  const login = useAuthStore(s => s.login);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const result = await login(username, password);
      if (result.success) {
        navigate("/");
      } else {
        setError(result.error || "Error al iniciar sesion");
      }
    } catch {
      setError("Error de conexion");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f5f7fa]">
      <div className="w-full max-w-sm">
        <div className="rounded-2xl bg-white p-8 shadow-lg ring-1 ring-[#e2e8f0]">
          <div className="mb-6 flex flex-col items-center gap-3">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#006fff] text-lg font-bold tracking-tight text-white shadow-lg shadow-[#006fff]/20">LK</div>
            <h1 className="text-xl font-semibold tracking-tight text-[#0f172a]">Linker</h1>
            <p className="text-sm text-[#64748b]">Inicia sesion para continuar</p>
          </div>
          {error && <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600 ring-1 ring-red-200">{error}</div>}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="username" className="mb-1.5 block text-sm font-medium text-[#374151]">Usuario</label>
              <input id="username" type="text" value={username} onChange={e => setUsername(e.target.value)} placeholder="admin" required className="w-full rounded-lg border border-[#e2e8f0] bg-white px-3.5 py-2.5 text-sm text-[#0f172a] placeholder-[#94a3b8] outline-none transition-colors focus:border-[#006fff] focus:ring-2 focus:ring-[#006fff]/20" />
            </div>
            <div>
              <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-[#374151]">Contrasena</label>
              <input id="password" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" required className="w-full rounded-lg border border-[#e2e8f0] bg-white px-3.5 py-2.5 text-sm text-[#0f172a] placeholder-[#94a3b8] outline-none transition-colors focus:border-[#006fff] focus:ring-2 focus:ring-[#006fff]/20" />
            </div>
            <button type="submit" disabled={loading} className="w-full rounded-lg bg-[#006fff] px-4 py-2.5 text-sm font-medium text-white shadow-lg shadow-[#006fff]/20 transition-all hover:bg-[#0058cc] disabled:opacity-50 disabled:cursor-not-allowed">{loading ? "Ingresando..." : "Iniciar sesion"}</button>
          </form>
        </div>
        <p className="mt-6 text-center text-xs text-[#94a3b8]">Linker WISP Manager v0.1.0</p>
      </div>
    </div>
  );
}
