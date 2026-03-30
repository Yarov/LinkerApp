import { NextRequest, NextResponse } from "next/server";
import { RouterOSAPI } from "routeros-api";

export const dynamic = "force-dynamic";

// Map category to MikroTik path
const categoryPaths: Record<string, string> = {
  firewall: "/ip/firewall/filter",
  antiddos: "/ip/firewall/raw",
  isolation: "/interface/bridge/filter",
  qos_tree: "/queue/tree",
  qos_simple: "/queue/simple",
};

async function findRuleById(api: RouterOSAPI, ruleId: string): Promise<{ path: string; rule: Record<string, string> } | null> {
  for (const [, path] of Object.entries(categoryPaths)) {
    try {
      const rules = (await api.write(`${path}/print`, [`=?.id=${ruleId}`])) as Record<string, string>[];
      if (rules.length > 0) {
        return { path, rule: rules[0] };
      }
    } catch {
      // Path may not exist on this router
    }
  }
  // Also try without filter (some versions don't support filter well)
  for (const [, path] of Object.entries(categoryPaths)) {
    try {
      const rules = (await api.write(`${path}/print`)) as Record<string, string>[];
      const found = rules.find((r) => r[".id"] === ruleId);
      if (found) {
        return { path, rule: found };
      }
    } catch {
      // ignore
    }
  }
  return null;
}

function isLinkerRule(rule: Record<string, string>): boolean {
  const comment = rule["comment"] || "";
  return comment.startsWith("LK:") || comment.startsWith("Linker:");
}

// ─── PUT: Toggle enable/disable ──────────────────────────────────────────────

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: ruleId } = await params;
  const host = process.env.MIKROTIK_HOST || "10.10.10.3";
  const port = parseInt(process.env.MIKROTIK_PORT || "8728", 10);
  const user = process.env.MIKROTIK_USER || "admin";
  const password = process.env.MIKROTIK_PASSWORD || "";

  let body: { disabled: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body JSON invalido" }, { status: 400 });
  }

  const api = new RouterOSAPI({ host, port, user, password, timeout: 10 });

  try {
    await api.connect();

    const found = await findRuleById(api, ruleId);
    if (!found) {
      api.close();
      return NextResponse.json({ error: "Regla no encontrada" }, { status: 404 });
    }

    if (!isLinkerRule(found.rule)) {
      api.close();
      return NextResponse.json(
        { error: "Solo se pueden modificar reglas de Linker" },
        { status: 403 }
      );
    }

    await api.write(`${found.path}/set`, [
      `=.id=${ruleId}`,
      `=disabled=${body.disabled ? "yes" : "no"}`,
    ]);

    api.close();

    return NextResponse.json({
      success: true,
      message: body.disabled ? "Regla desactivada" : "Regla activada",
    });
  } catch (error) {
    try { api.close(); } catch { /* ignore */ }
    const message = error instanceof Error ? error.message : "Error desconocido";
    return NextResponse.json(
      { error: `Error al modificar regla: ${message}` },
      { status: 500 }
    );
  }
}

// ─── DELETE: Remove a Linker rule ────────────────────────────────────────────

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: ruleId } = await params;
  const host = process.env.MIKROTIK_HOST || "10.10.10.3";
  const port = parseInt(process.env.MIKROTIK_PORT || "8728", 10);
  const user = process.env.MIKROTIK_USER || "admin";
  const password = process.env.MIKROTIK_PASSWORD || "";

  const api = new RouterOSAPI({ host, port, user, password, timeout: 10 });

  try {
    await api.connect();

    const found = await findRuleById(api, ruleId);
    if (!found) {
      api.close();
      return NextResponse.json({ error: "Regla no encontrada" }, { status: 404 });
    }

    if (!isLinkerRule(found.rule)) {
      api.close();
      return NextResponse.json(
        { error: "Solo se pueden modificar reglas de Linker" },
        { status: 403 }
      );
    }

    await api.write(`${found.path}/remove`, [`=.id=${ruleId}`]);

    api.close();

    return NextResponse.json({
      success: true,
      message: "Regla eliminada",
    });
  } catch (error) {
    try { api.close(); } catch { /* ignore */ }
    const message = error instanceof Error ? error.message : "Error desconocido";
    return NextResponse.json(
      { error: `Error al eliminar regla: ${message}` },
      { status: 500 }
    );
  }
}
