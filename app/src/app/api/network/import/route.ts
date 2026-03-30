import { NextRequest, NextResponse } from "next/server";
import { RouterOSAPI } from "routeros-api";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

interface ImportBody {
  type: "clients" | "plans" | "all";
  profileMapping?: Record<string, { planName: string; price: number }>;
  selectedClients?: string[]; // PPPoE secret names to import (if empty, import all)
  selectedProfiles?: string[]; // Profile names to import (if empty, import all mapped)
}

interface ImportResult {
  plans: { imported: number; skipped: number; details: string[] };
  clients: { imported: number; skipped: number; details: string[] };
  errors: string[];
}

export async function POST(request: NextRequest) {
  const host = process.env.MIKROTIK_HOST || "10.10.10.3";
  const port = parseInt(process.env.MIKROTIK_PORT || "8728", 10);
  const user = process.env.MIKROTIK_USER || "admin";
  const password = process.env.MIKROTIK_PASSWORD || "";

  let body: ImportBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body JSON invalido" }, { status: 400 });
  }

  const { type, profileMapping = {}, selectedClients, selectedProfiles } = body;

  if (!type || !["clients", "plans", "all"].includes(type)) {
    return NextResponse.json(
      { error: "Tipo invalido. Usa 'clients', 'plans' o 'all'" },
      { status: 400 }
    );
  }

  const api = new RouterOSAPI({ host, port, user, password, timeout: 30 });
  const result: ImportResult = {
    plans: { imported: 0, skipped: 0, details: [] },
    clients: { imported: 0, skipped: 0, details: [] },
    errors: [],
  };

  try {
    await api.connect();

    // Fetch MikroTik data
    const [profilesRaw, secretsRaw] = await Promise.all([
      api.write("/ppp/profile/print").catch(() => []),
      api.write("/ppp/secret/print").catch(() => []),
    ]);

    api.close();

    const profiles = profilesRaw as Record<string, string>[];
    const secrets = secretsRaw as Record<string, string>[];

    // ─── Import Plans ─────────────────────────────────────────────────
    if (type === "plans" || type === "all") {
      const relevantProfiles = profiles.filter(
        (p) => p.name !== "default" && p.name !== "default-encryption"
      );

      for (const profile of relevantProfiles) {
        const profileName = profile.name;

        // Skip if not selected
        if (selectedProfiles && !selectedProfiles.includes(profileName)) {
          continue;
        }

        // Get mapping or build default
        const mapping = profileMapping[profileName];
        const planName = mapping?.planName || profileName;
        const price = mapping?.price ?? 0;

        // Parse rate-limit to get download/upload speeds
        const rateLimit = profile["rate-limit"] || "";
        let downloadMbps = 10;
        let uploadMbps = 5;

        if (rateLimit) {
          const parts = rateLimit.split("/");
          const uploadStr = parts[0] || "";
          const downloadStr = parts[1] || parts[0] || "";

          downloadMbps = parseRateToMbps(downloadStr);
          uploadMbps = parseRateToMbps(uploadStr);
        }

        // Check if plan already exists
        try {
          const existing = await prisma.plan.findUnique({
            where: { profileName },
          });

          if (existing) {
            result.plans.skipped++;
            result.plans.details.push(`"${profileName}" ya existe`);
            continue;
          }

          await prisma.plan.create({
            data: {
              name: planName,
              profileName,
              downloadMbps,
              uploadMbps,
              price,
              isActive: true,
            },
          });

          result.plans.imported++;
          result.plans.details.push(`"${planName}" importado (${downloadMbps}M/${uploadMbps}M)`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          result.errors.push(`Plan "${profileName}": ${msg}`);
        }
      }
    }

    // ─── Import Clients ───────────────────────────────────────────────
    if (type === "clients" || type === "all") {
      for (const secret of secrets) {
        const secretName = secret.name;

        // Skip if not selected
        if (selectedClients && !selectedClients.includes(secretName)) {
          continue;
        }

        // Skip disabled if importing selectively
        const isDisabled = secret.disabled === "true";

        try {
          // Check if client already exists by pppoeUser
          const existing = await prisma.client.findUnique({
            where: { pppoeUser: secretName },
          });

          if (existing) {
            result.clients.skipped++;
            result.clients.details.push(`"${secretName}" ya existe`);
            continue;
          }

          const profileName = secret.profile || "default";
          const clientName = secret.comment || secretName;

          await prisma.client.create({
            data: {
              name: clientName,
              address: secret["remote-address"] || "Sin direccion",
              pppoeUser: secretName,
              pppoePassword: secret.password || "",
              profileName,
              status: isDisabled ? "SUSPENDED" : "ACTIVE",
              notes: isDisabled ? "Importado (estaba deshabilitado en MikroTik)" : "Importado desde MikroTik",
            },
          });

          result.clients.imported++;
          result.clients.details.push(
            `"${clientName}" importado (${profileName})${isDisabled ? " [deshabilitado]" : ""}`
          );
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          result.errors.push(`Cliente "${secretName}": ${msg}`);
        }
      }
    }

    return NextResponse.json(result);
  } catch (error) {
    try {
      api.close();
    } catch {
      /* ignore */
    }
    const message = error instanceof Error ? error.message : "Error desconocido";
    return NextResponse.json(
      { error: `No se pudo conectar al MikroTik: ${message}`, ...result },
      { status: 503 }
    );
  }
}

function parseRateToMbps(rate: string): number {
  const clean = rate.trim().toLowerCase();
  if (clean.endsWith("m")) {
    return Math.round(parseFloat(clean));
  }
  if (clean.endsWith("k")) {
    return Math.max(1, Math.round(parseFloat(clean) / 1000));
  }
  // Raw number assumed bps
  const num = parseFloat(clean);
  if (num > 1000000) return Math.round(num / 1000000);
  if (num > 1000) return Math.round(num / 1000);
  return Math.max(1, Math.round(num));
}
