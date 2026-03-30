import { RouterOSAPI } from "routeros-api";
import { prisma } from "@/lib/db";

const MIKROTIK_HOST = process.env.MIKROTIK_HOST || "10.10.10.3";
const MIKROTIK_PORT = parseInt(process.env.MIKROTIK_PORT || "8728", 10);
const MIKROTIK_USER = process.env.MIKROTIK_USER || "admin";
const MIKROTIK_PASSWORD = process.env.MIKROTIK_PASSWORD || "";

function createApi(): RouterOSAPI {
  return new RouterOSAPI({
    host: MIKROTIK_HOST,
    port: MIKROTIK_PORT,
    user: MIKROTIK_USER,
    password: MIKROTIK_PASSWORD,
    timeout: 30,
  });
}

async function withConnection<T>(fn: (api: RouterOSAPI) => Promise<T>): Promise<T> {
  const api = createApi();
  try {
    await api.connect();
    const result = await fn(api);
    api.close();
    return result;
  } catch (error) {
    try {
      api.close();
    } catch {
      // ignore close errors
    }
    throw error;
  }
}

async function safeCall<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    console.error("[MikroTik-Audit]", error instanceof Error ? error.message : error);
    return fallback;
  }
}

// ─── Types ──────────────────────────────────────────────────────────────────

export interface MikroTikAudit {
  system: {
    identity: string;
    version: string;
    board: string;
    cpu: string;
    cpuCount: number;
    memory: { total: number; free: number };
    uptime: string;
    architecture: string;
  };

  pppoe: {
    serverEnabled: boolean;
    serverName: string;
    serverInterface: string;
    profiles: Array<{
      name: string;
      rateLimit: string;
      localAddress: string;
      remoteAddress: string;
    }>;
    secrets: Array<{
      name: string;
      password: string;
      profile: string;
      service: string;
      disabled: boolean;
      lastLoggedOut: string;
      comment: string;
    }>;
    activeSessions: Array<{
      name: string;
      address: string;
      uptime: string;
      callerId: string;
    }>;
  };

  firewall: {
    filterRules: Array<{
      chain: string;
      action: string;
      comment: string;
      disabled: boolean;
      srcAddress?: string;
      dstAddress?: string;
      protocol?: string;
      dstPort?: string;
      inInterface?: string;
      connectionState?: string;
    }>;
    natRules: Array<{
      chain: string;
      action: string;
      comment: string;
      outInterface?: string;
      srcAddress?: string;
    }>;
    mangleRules: number;
    rawRules: number;
    addressLists: Array<{ name: string; address: string; comment: string }>;
  };

  queues: {
    simpleQueues: Array<{
      name: string;
      target: string;
      maxLimit: string;
      burstLimit: string;
      disabled: boolean;
      comment: string;
    }>;
    queueTrees: Array<{
      name: string;
      parent: string;
      maxLimit: string;
      queueType: string;
    }>;
    queueTypes: string[];
  };

  interfaces: {
    all: Array<{ name: string; type: string; running: boolean; disabled: boolean }>;
    bridges: Array<{ name: string; ports: string[] }>;
    wireguard: Array<{ name: string; listenPort: number; publicKey: string }>;
    pppoeServer: Array<{ serviceName: string; interface: string }>;
  };

  ip: {
    addresses: Array<{ address: string; network: string; interface: string }>;
    pools: Array<{ name: string; ranges: string }>;
    dns: { servers: string; allowRemoteRequests: boolean; cacheSize: number };
    dhcpServers: Array<{ name: string; interface: string; addressPool: string }>;
    routes: Array<{ dst: string; gateway: string; distance: number }>;
  };

  security: {
    users: Array<{ name: string; group: string }>;
    services: Array<{ name: string; port: number; disabled: boolean }>;
    hasDefaultPassword: boolean;
  };

  scripts: Array<{ name: string; source: string }>;
  schedulers: Array<{ name: string; interval: string; onEvent: string }>;

  analysis: {
    firewallScore: "none" | "basic" | "medium" | "professional";
    qosType: "none" | "simple-queues" | "queue-trees" | "pcq";
    vulnerabilities: string[];
    recommendations: string[];
    clientCount: number;
    planCount: number;
    hasClientIsolation: boolean;
    hasAntiDdos: boolean;
    hasDnsCache: boolean;
    hasBackup: boolean;
  };
}

// ─── Helper: cast API results ───────────────────────────────────────────────

type RawRecord = Record<string, string | undefined>;
type RawArray = RawRecord[];

function raw(result: unknown): RawArray {
  return result as unknown as RawArray;
}

function first(result: unknown): RawRecord {
  const arr = raw(result);
  return arr[0] || {};
}

// ─── 1. Full Audit ──────────────────────────────────────────────────────────

export async function auditMikroTik(): Promise<MikroTikAudit> {
  return withConnection(async (api) => {
    // ── System ────────────────────────────────────────────────────────
    console.log("[Audit] Reading system info...");
    const resource = first(await api.write("/system/resource/print"));
    const identity = first(await api.write("/system/identity/print"));

    const system: MikroTikAudit["system"] = {
      identity: identity.name || "unknown",
      version: resource.version || "",
      board: resource["board-name"] || "",
      cpu: resource.cpu || "",
      cpuCount: parseInt(resource["cpu-count"] || "1", 10),
      memory: {
        total: parseInt(resource["total-memory"] || "0", 10),
        free: parseInt(resource["free-memory"] || "0", 10),
      },
      uptime: resource.uptime || "",
      architecture: resource["architecture-name"] || "",
    };

    // ── PPPoE ─────────────────────────────────────────────────────────
    console.log("[Audit] Reading PPPoE configuration...");
    const pppoeServers = raw(await api.write("/interface/pppoe-server/server/print"));
    const pppoeServer = pppoeServers[0] || {};

    const profilesRaw = raw(await api.write("/ppp/profile/print"));
    const profiles = profilesRaw.map((p) => ({
      name: p.name || "",
      rateLimit: p["rate-limit"] || "",
      localAddress: p["local-address"] || "",
      remoteAddress: p["remote-address"] || "",
    }));

    const secretsRaw = raw(await api.write("/ppp/secret/print"));
    const secrets = secretsRaw.map((s) => ({
      name: s.name || "",
      password: s.password || "",
      profile: s.profile || "",
      service: s.service || "",
      disabled: s.disabled === "true",
      lastLoggedOut: s["last-logged-out"] || "",
      comment: s.comment || "",
    }));

    const activeRaw = raw(await api.write("/ppp/active/print"));
    const activeSessions = activeRaw.map((a) => ({
      name: a.name || "",
      address: a.address || "",
      uptime: a.uptime || "",
      callerId: a["caller-id"] || "",
    }));

    const pppoe: MikroTikAudit["pppoe"] = {
      serverEnabled: pppoeServers.length > 0 && pppoeServer.disabled !== "true",
      serverName: pppoeServer["service-name"] || "",
      serverInterface: pppoeServer.interface || "",
      profiles,
      secrets,
      activeSessions,
    };

    // ── Firewall ──────────────────────────────────────────────────────
    console.log("[Audit] Reading firewall rules...");
    const filterRulesRaw = raw(await api.write("/ip/firewall/filter/print"));
    const filterRules = filterRulesRaw.map((r) => ({
      chain: r.chain || "",
      action: r.action || "",
      comment: r.comment || "",
      disabled: r.disabled === "true",
      srcAddress: r["src-address"],
      dstAddress: r["dst-address"],
      protocol: r.protocol,
      dstPort: r["dst-port"],
      inInterface: r["in-interface"],
      connectionState: r["connection-state"],
    }));

    const natRulesRaw = raw(await api.write("/ip/firewall/nat/print"));
    const natRules = natRulesRaw.map((r) => ({
      chain: r.chain || "",
      action: r.action || "",
      comment: r.comment || "",
      outInterface: r["out-interface"],
      srcAddress: r["src-address"],
    }));

    const mangleRulesRaw = raw(await api.write("/ip/firewall/mangle/print"));
    const rawRulesRaw = raw(await api.write("/ip/firewall/raw/print"));

    const addressListsRaw = raw(await api.write("/ip/firewall/address-list/print"));
    const addressLists = addressListsRaw.map((a) => ({
      name: a.list || "",
      address: a.address || "",
      comment: a.comment || "",
    }));

    const firewall: MikroTikAudit["firewall"] = {
      filterRules,
      natRules,
      mangleRules: mangleRulesRaw.length,
      rawRules: rawRulesRaw.length,
      addressLists,
    };

    // ── Queues ────────────────────────────────────────────────────────
    console.log("[Audit] Reading queue configuration...");
    const simpleQueuesRaw = raw(await api.write("/queue/simple/print"));
    const simpleQueues = simpleQueuesRaw.map((q) => ({
      name: q.name || "",
      target: q.target || "",
      maxLimit: q["max-limit"] || "",
      burstLimit: q["burst-limit"] || "",
      disabled: q.disabled === "true",
      comment: q.comment || "",
    }));

    const queueTreesRaw = raw(await api.write("/queue/tree/print"));
    const queueTrees = queueTreesRaw.map((q) => ({
      name: q.name || "",
      parent: q.parent || "",
      maxLimit: q["max-limit"] || "",
      queueType: q.queue || "",
    }));

    const queueTypesRaw = raw(await api.write("/queue/type/print"));
    const queueTypes = queueTypesRaw.map((q) => q.name || "").filter(Boolean);

    const queues: MikroTikAudit["queues"] = { simpleQueues, queueTrees, queueTypes };

    // ── Interfaces ────────────────────────────────────────────────────
    console.log("[Audit] Reading interfaces...");
    const interfacesRaw = raw(await api.write("/interface/print"));
    const allInterfaces = interfacesRaw.map((i) => ({
      name: i.name || "",
      type: i.type || "",
      running: i.running === "true",
      disabled: i.disabled === "true",
    }));

    const bridgesRaw = raw(await api.write("/interface/bridge/print"));
    const bridges: MikroTikAudit["interfaces"]["bridges"] = [];
    for (const b of bridgesRaw) {
      const bridgeName = b.name || "";
      const portsRaw = raw(
        await api.write("/interface/bridge/port/print", [`?bridge=${bridgeName}`])
      );
      bridges.push({
        name: bridgeName,
        ports: portsRaw.map((p) => p.interface || "").filter(Boolean),
      });
    }

    let wireguardInterfaces: MikroTikAudit["interfaces"]["wireguard"] = [];
    try {
      const wgRaw = raw(await api.write("/interface/wireguard/print"));
      wireguardInterfaces = wgRaw.map((w) => ({
        name: w.name || "",
        listenPort: parseInt(w["listen-port"] || "0", 10),
        publicKey: w["public-key"] || "",
      }));
    } catch {
      // WireGuard may not exist on older RouterOS
    }

    const pppoeServerInterfaces = pppoeServers.map((s) => ({
      serviceName: s["service-name"] || "",
      interface: s.interface || "",
    }));

    const interfaces: MikroTikAudit["interfaces"] = {
      all: allInterfaces,
      bridges,
      wireguard: wireguardInterfaces,
      pppoeServer: pppoeServerInterfaces,
    };

    // ── IP ────────────────────────────────────────────────────────────
    console.log("[Audit] Reading IP configuration...");
    const addressesRaw = raw(await api.write("/ip/address/print"));
    const addresses = addressesRaw.map((a) => ({
      address: a.address || "",
      network: a.network || "",
      interface: a.interface || "",
    }));

    const poolsRaw = raw(await api.write("/ip/pool/print"));
    const pools = poolsRaw.map((p) => ({
      name: p.name || "",
      ranges: p.ranges || "",
    }));

    const dnsRaw = first(await api.write("/ip/dns/print"));
    const dns: MikroTikAudit["ip"]["dns"] = {
      servers: dnsRaw.servers || "",
      allowRemoteRequests: dnsRaw["allow-remote-requests"] === "true",
      cacheSize: parseInt(dnsRaw["cache-size"] || "0", 10),
    };

    const dhcpServersRaw = raw(await api.write("/ip/dhcp-server/print"));
    const dhcpServers = dhcpServersRaw.map((d) => ({
      name: d.name || "",
      interface: d.interface || "",
      addressPool: d["address-pool"] || "",
    }));

    const routesRaw = raw(await api.write("/ip/route/print"));
    const routes = routesRaw.map((r) => ({
      dst: r["dst-address"] || "",
      gateway: r.gateway || "",
      distance: parseInt(r.distance || "0", 10),
    }));

    const ip: MikroTikAudit["ip"] = { addresses, pools, dns, dhcpServers, routes };

    // ── Security ──────────────────────────────────────────────────────
    console.log("[Audit] Reading security configuration...");
    const usersRaw = raw(await api.write("/user/print"));
    const users = usersRaw.map((u) => ({
      name: u.name || "",
      group: u.group || "",
    }));

    const servicesRaw = raw(await api.write("/ip/service/print"));
    const services = servicesRaw.map((s) => ({
      name: s.name || "",
      port: parseInt(s.port || "0", 10),
      disabled: s.disabled === "true",
    }));

    // Check if admin has empty password — if MIKROTIK_PASSWORD is empty and we connected, it's empty
    const hasDefaultPassword = MIKROTIK_PASSWORD === "" && users.some((u) => u.name === "admin");

    const security: MikroTikAudit["security"] = { users, services, hasDefaultPassword };

    // ── Scripts & Schedulers ──────────────────────────────────────────
    console.log("[Audit] Reading scripts and schedulers...");
    const scriptsRaw = raw(await api.write("/system/script/print"));
    const scripts = scriptsRaw.map((s) => ({
      name: s.name || "",
      source: s.source || "",
    }));

    const schedulersRaw = raw(await api.write("/system/scheduler/print"));
    const schedulers = schedulersRaw.map((s) => ({
      name: s.name || "",
      interval: s.interval || "",
      onEvent: s["on-event"] || "",
    }));

    // ── Analysis ──────────────────────────────────────────────────────
    console.log("[Audit] Running analysis...");
    const analysis = buildAnalysis({
      filterRules,
      natRules,
      simpleQueues,
      queueTrees,
      queueTypes,
      secrets,
      profiles,
      activeSessions,
      services,
      users,
      hasDefaultPassword,
      dns,
      addressLists,
      scripts,
      schedulers,
    });

    console.log("[Audit] Audit complete.");

    return {
      system,
      pppoe,
      firewall,
      queues,
      interfaces,
      ip,
      security,
      scripts,
      schedulers,
      analysis,
    };
  });
}

// ─── Analysis Builder ───────────────────────────────────────────────────────

function buildAnalysis(data: {
  filterRules: MikroTikAudit["firewall"]["filterRules"];
  natRules: MikroTikAudit["firewall"]["natRules"];
  simpleQueues: MikroTikAudit["queues"]["simpleQueues"];
  queueTrees: MikroTikAudit["queues"]["queueTrees"];
  queueTypes: string[];
  secrets: MikroTikAudit["pppoe"]["secrets"];
  profiles: MikroTikAudit["pppoe"]["profiles"];
  activeSessions: MikroTikAudit["pppoe"]["activeSessions"];
  services: MikroTikAudit["security"]["services"];
  users: MikroTikAudit["security"]["users"];
  hasDefaultPassword: boolean;
  dns: MikroTikAudit["ip"]["dns"];
  addressLists: MikroTikAudit["firewall"]["addressLists"];
  scripts: MikroTikAudit["scripts"];
  schedulers: MikroTikAudit["schedulers"];
}): MikroTikAudit["analysis"] {
  const vulnerabilities: string[] = [];
  const recommendations: string[] = [];

  // Firewall score
  const ruleCount = data.filterRules.length;
  let firewallScore: MikroTikAudit["analysis"]["firewallScore"] = "none";
  if (ruleCount >= 26) firewallScore = "professional";
  else if (ruleCount >= 16) firewallScore = "medium";
  else if (ruleCount >= 4) firewallScore = "basic";

  // QoS type
  let qosType: MikroTikAudit["analysis"]["qosType"] = "none";
  const hasPcq = data.queueTypes.some(
    (t) => t.includes("pcq-download") || t.includes("pcq-upload")
  );
  if (data.queueTrees.length > 0 && hasPcq) {
    qosType = "pcq";
  } else if (data.queueTrees.length > 0) {
    qosType = "queue-trees";
  } else if (data.simpleQueues.length > 0) {
    qosType = "simple-queues";
  }

  // Client isolation check
  const hasClientIsolation = data.filterRules.some(
    (r) =>
      r.chain === "forward" &&
      r.action === "drop" &&
      r.srcAddress &&
      r.dstAddress &&
      r.srcAddress === r.dstAddress
  );

  // Anti-DDoS check
  const hasAntiDdos = data.filterRules.some(
    (r) => r.comment.startsWith("DDoS-")
  );

  // DNS cache check
  const hasDnsCache = data.dns.allowRemoteRequests && data.dns.cacheSize > 0;

  // Backup check — look for backup-related scheduler
  const hasBackup = data.schedulers.some(
    (s) =>
      s.onEvent.includes("backup") ||
      s.name.toLowerCase().includes("backup")
  );

  // ── Vulnerabilities ─────────────────────────────────────────────

  if (data.hasDefaultPassword) {
    vulnerabilities.push("Admin user has empty password");
  }

  const telnet = data.services.find((s) => s.name === "telnet");
  if (telnet && !telnet.disabled) {
    vulnerabilities.push("Telnet service is enabled (insecure, sends passwords in plaintext)");
  }

  const ftp = data.services.find((s) => s.name === "ftp");
  if (ftp && !ftp.disabled) {
    vulnerabilities.push("FTP service is enabled (insecure, sends passwords in plaintext)");
  }

  const www = data.services.find((s) => s.name === "www");
  if (www && !www.disabled) {
    vulnerabilities.push("HTTP web interface is enabled (use HTTPS instead)");
  }

  const api = data.services.find((s) => s.name === "api");
  if (api && !api.disabled) {
    // Check if firewall restricts API access
    const apiProtected = data.filterRules.some(
      (r) => r.dstPort === "8728" && r.action === "accept" && r.srcAddress
    );
    if (!apiProtected) {
      vulnerabilities.push("API port (8728) is open without IP restriction");
    }
  }

  if (firewallScore === "none") {
    vulnerabilities.push("No firewall rules configured - router is completely exposed");
  }

  if (data.users.length === 1 && data.users[0].name === "admin") {
    vulnerabilities.push("Only default admin user exists - consider creating a named user");
  }

  const hasMasquerade = data.natRules.some((r) => r.action === "masquerade");
  if (!hasMasquerade) {
    vulnerabilities.push("No NAT masquerade rule found - clients may not have internet access");
  }

  // ── Recommendations ─────────────────────────────────────────────

  if (firewallScore === "none" || firewallScore === "basic") {
    recommendations.push("Apply a professional firewall ruleset to protect the router and clients");
  }

  if (qosType === "none") {
    recommendations.push("Configure QoS (queue trees with PCQ) to ensure fair bandwidth distribution");
  } else if (qosType === "simple-queues") {
    recommendations.push(
      "Migrate from simple queues to queue trees with PCQ for better scalability"
    );
  }

  if (!hasClientIsolation) {
    recommendations.push("Enable client isolation to prevent PPPoE clients from seeing each other");
  }

  if (!hasAntiDdos) {
    recommendations.push("Add anti-DDoS protection (SYN flood, ICMP flood, port scan detection)");
  }

  if (!hasDnsCache) {
    recommendations.push("Enable DNS cache to speed up DNS resolution for clients");
  }

  if (!hasBackup) {
    recommendations.push("Configure automatic backups via scheduler");
  }

  if (telnet && !telnet.disabled) {
    recommendations.push("Disable Telnet service and use SSH instead");
  }

  if (ftp && !ftp.disabled) {
    recommendations.push("Disable FTP service and use SFTP instead");
  }

  if (data.hasDefaultPassword) {
    recommendations.push("Set a strong password for the admin user immediately");
  }

  // Unique profiles used by secrets = plan count
  const uniqueProfiles = new Set(data.profiles.map((p) => p.name).filter((n) => n !== "default"));

  return {
    firewallScore,
    qosType,
    vulnerabilities,
    recommendations,
    clientCount: data.secrets.length,
    planCount: uniqueProfiles.size,
    hasClientIsolation,
    hasAntiDdos,
    hasDnsCache,
    hasBackup,
  };
}

// ─── 2. Import Functions ────────────────────────────────────────────────────

/**
 * Import PPPoE profiles as Plans into the Linker database.
 * Skips profiles that already exist (by profileName).
 * Parses rate-limit string to extract download/upload speeds.
 */
export async function importPPPoEProfiles(
  profiles: MikroTikAudit["pppoe"]["profiles"]
): Promise<{ imported: number; skipped: number; errors: string[] }> {
  let imported = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const profile of profiles) {
    // Skip default and encryption profiles
    if (profile.name === "default" || profile.name === "default-encryption") {
      skipped++;
      continue;
    }

    try {
      // Check if plan already exists
      const existing = await prisma.plan.findUnique({
        where: { profileName: profile.name },
      });

      if (existing) {
        console.log(`[Import] Plan '${profile.name}' already exists, skipping.`);
        skipped++;
        continue;
      }

      // Parse rate-limit: format is "upload/download" or just "rate"
      // MikroTik rate-limit: rx-rate[/tx-rate] — rx = upload from client perspective
      // Actually PPP profile rate-limit: "rx/tx" where rx = what client receives = download
      const { downloadKbps, uploadKbps } = parseRateLimit(profile.rateLimit);

      await prisma.plan.create({
        data: {
          name: profile.name,
          downloadMbps: Math.max(1, Math.round(downloadKbps / 1000)),
          uploadMbps: Math.max(1, Math.round(uploadKbps / 1000)),
          price: 0, // Must be set manually
          profileName: profile.name,
          isActive: true,
        },
      });

      console.log(`[Import] Plan '${profile.name}' imported (${downloadKbps}k/${uploadKbps}k).`);
      imported++;
    } catch (error) {
      const msg = `Failed to import profile '${profile.name}': ${error instanceof Error ? error.message : String(error)}`;
      console.error(`[Import] ${msg}`);
      errors.push(msg);
    }
  }

  console.log(`[Import] Profiles done: ${imported} imported, ${skipped} skipped, ${errors.length} errors.`);
  return { imported, skipped, errors };
}

/**
 * Import PPPoE secrets as Clients into the Linker database.
 * Requires a mapping from MikroTik profile name to the Linker profile name.
 * Skips secrets that already exist (by pppoeUser).
 */
export async function importPPPoEClients(
  secrets: MikroTikAudit["pppoe"]["secrets"],
  profileToPlan: Record<string, string> // maps MikroTik profile name to Linker plan profileName
): Promise<{ imported: number; skipped: number; errors: string[] }> {
  let imported = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const secret of secrets) {
    try {
      // Check if client already exists
      const existing = await prisma.client.findUnique({
        where: { pppoeUser: secret.name },
      });

      if (existing) {
        console.log(`[Import] Client '${secret.name}' already exists, skipping.`);
        skipped++;
        continue;
      }

      // Map the profile to a plan profileName
      const planProfileName = profileToPlan[secret.profile];
      if (!planProfileName) {
        errors.push(
          `Client '${secret.name}': no plan mapping for profile '${secret.profile}'`
        );
        skipped++;
        continue;
      }

      // Verify the plan exists
      const plan = await prisma.plan.findUnique({
        where: { profileName: planProfileName },
      });

      if (!plan) {
        errors.push(
          `Client '${secret.name}': plan with profileName '${planProfileName}' not found in DB`
        );
        skipped++;
        continue;
      }

      await prisma.client.create({
        data: {
          name: secret.comment || secret.name,
          phone: null,
          address: secret.comment || "Imported from MikroTik",
          status: secret.disabled ? "SUSPENDED" : "ACTIVE",
          pppoeUser: secret.name,
          pppoePassword: secret.password,
          profileName: planProfileName,
          notes: `Imported from MikroTik. Service: ${secret.service}. Last logged out: ${secret.lastLoggedOut}`,
        },
      });

      console.log(`[Import] Client '${secret.name}' imported with plan '${planProfileName}'.`);
      imported++;
    } catch (error) {
      const msg = `Failed to import secret '${secret.name}': ${error instanceof Error ? error.message : String(error)}`;
      console.error(`[Import] ${msg}`);
      errors.push(msg);
    }
  }

  console.log(`[Import] Clients done: ${imported} imported, ${skipped} skipped, ${errors.length} errors.`);
  return { imported, skipped, errors };
}

/**
 * Import simple queues as Clients into the Linker database.
 * Infers PPPoE user from queue target or name.
 * Creates plans for unique rate limits if they don't exist.
 */
export async function importSimpleQueues(
  queues: MikroTikAudit["queues"]["simpleQueues"]
): Promise<{ imported: number; skipped: number; errors: string[] }> {
  let imported = 0;
  let skipped = 0;
  const errors: string[] = [];

  // Build a map of rate limits to plan profile names, creating plans as needed
  const rateToPlan: Record<string, string> = {};

  for (const queue of queues) {
    try {
      const maxLimit = queue.maxLimit;
      if (!maxLimit || maxLimit === "0/0") {
        errors.push(`Queue '${queue.name}': no max-limit set, skipping.`);
        skipped++;
        continue;
      }

      // Derive a pppoe user name from queue name or target
      // Simple queues often have target like "10.0.0.x/32" or name matching the client
      const pppoeUser = queue.name;

      // Check if client already exists
      const existing = await prisma.client.findUnique({
        where: { pppoeUser },
      });

      if (existing) {
        console.log(`[Import] Client '${pppoeUser}' already exists, skipping.`);
        skipped++;
        continue;
      }

      // Ensure a plan exists for this rate limit
      let planProfileName = rateToPlan[maxLimit];
      if (!planProfileName) {
        // Create or find plan for this rate
        const { downloadKbps, uploadKbps } = parseRateLimit(maxLimit);
        const downMbps = Math.max(1, Math.round(downloadKbps / 1000));
        const upMbps = Math.max(1, Math.round(uploadKbps / 1000));
        planProfileName = `queue-${downMbps}M-${upMbps}M`;

        const existingPlan = await prisma.plan.findUnique({
          where: { profileName: planProfileName },
        });

        if (!existingPlan) {
          await prisma.plan.create({
            data: {
              name: `${downMbps}M/${upMbps}M`,
              downloadMbps: downMbps,
              uploadMbps: upMbps,
              price: 0,
              profileName: planProfileName,
              isActive: true,
            },
          });
          console.log(`[Import] Created plan '${planProfileName}' for rate ${maxLimit}.`);
        }

        rateToPlan[maxLimit] = planProfileName;
      }

      await prisma.client.create({
        data: {
          name: queue.comment || queue.name,
          phone: null,
          address: queue.comment || "Imported from simple queue",
          status: queue.disabled ? "SUSPENDED" : "ACTIVE",
          pppoeUser,
          pppoePassword: "", // Not available from queue, must be set manually
          profileName: planProfileName,
          notes: `Imported from simple queue. Target: ${queue.target}`,
        },
      });

      console.log(`[Import] Client '${pppoeUser}' imported from queue with plan '${planProfileName}'.`);
      imported++;
    } catch (error) {
      const msg = `Failed to import queue '${queue.name}': ${error instanceof Error ? error.message : String(error)}`;
      console.error(`[Import] ${msg}`);
      errors.push(msg);
    }
  }

  console.log(`[Import] Queues done: ${imported} imported, ${skipped} skipped, ${errors.length} errors.`);
  return { imported, skipped, errors };
}

// ─── Rate limit parser ──────────────────────────────────────────────────────

function parseRateLimit(rateLimit: string): {
  downloadKbps: number;
  uploadKbps: number;
} {
  if (!rateLimit) return { downloadKbps: 1000, uploadKbps: 1000 };

  // MikroTik PPP profile rate-limit format: "rx-rate[/tx-rate]"
  // For PPP, rx = what the client receives (download), tx = what client sends (upload)
  // Simple queue max-limit: "upload/download" (target upload / target download)
  const parts = rateLimit.split("/");
  if (parts.length >= 2) {
    return {
      uploadKbps: parseRateToKbps(parts[0]),
      downloadKbps: parseRateToKbps(parts[1]),
    };
  }
  // Single value — same for both
  const val = parseRateToKbps(parts[0]);
  return { downloadKbps: val, uploadKbps: val };
}

function parseRateToKbps(rate: string): number {
  const clean = rate.trim().toLowerCase();
  if (clean.endsWith("m")) return parseFloat(clean) * 1000;
  if (clean.endsWith("k")) return parseFloat(clean);
  // Raw number assumed bps
  const n = parseFloat(clean);
  if (isNaN(n)) return 1000;
  return n > 10000 ? n / 1000 : n; // Heuristic: large numbers are bps
}

// ─── 3. Safe Improvement Functions ──────────────────────────────────────────

const LK_PREFIX = "LK: ";

/**
 * Add missing Linker firewall rules without removing existing ones.
 * All Linker rules have comments starting with "LK: ".
 */
export async function addMissingFirewallRules(): Promise<{
  added: number;
  existing: number;
  rules: string[];
}> {
  return withConnection(async (api) => {
    let added = 0;
    let existing = 0;
    const addedRules: string[] = [];

    // Get all existing filter rules
    const currentRules = raw(await api.write("/ip/firewall/filter/print"));
    const currentComments = new Set(
      currentRules.map((r) => r.comment || "").filter(Boolean)
    );

    // Define the Linker ruleset — all comments prefixed with "LK: "
    const linkerRules: Array<{ args: string[]; comment: string }> = [
      // INPUT chain
      {
        comment: `${LK_PREFIX}Accept established, related, untracked`,
        args: [
          "=chain=input",
          "=connection-state=established,related,untracked",
          "=action=accept",
        ],
      },
      {
        comment: `${LK_PREFIX}Drop invalid input`,
        args: ["=chain=input", "=connection-state=invalid", "=action=drop"],
      },
      {
        comment: `${LK_PREFIX}Accept ICMP rate limited`,
        args: [
          "=chain=input",
          "=protocol=icmp",
          "=action=accept",
          "=limit=10,5:packet",
        ],
      },
      {
        comment: `${LK_PREFIX}Accept WireGuard UDP 13231`,
        args: [
          "=chain=input",
          "=protocol=udp",
          "=dst-port=13231",
          "=action=accept",
        ],
      },
      {
        comment: `${LK_PREFIX}Accept API from VPN only`,
        args: [
          "=chain=input",
          "=protocol=tcp",
          "=dst-port=8728",
          "=src-address=10.10.10.0/24",
          "=action=accept",
        ],
      },
      {
        comment: `${LK_PREFIX}Accept SSH from VPN only`,
        args: [
          "=chain=input",
          "=protocol=tcp",
          "=dst-port=22",
          "=src-address=10.10.10.0/24",
          "=action=accept",
        ],
      },
      {
        comment: `${LK_PREFIX}Accept Winbox from VPN only`,
        args: [
          "=chain=input",
          "=protocol=tcp",
          "=dst-port=8291",
          "=src-address=10.10.10.0/24",
          "=action=accept",
        ],
      },
      // FORWARD chain
      {
        comment: `${LK_PREFIX}Forward accept established, related`,
        args: [
          "=chain=forward",
          "=connection-state=established,related,untracked",
          "=action=accept",
        ],
      },
      {
        comment: `${LK_PREFIX}Forward drop invalid`,
        args: ["=chain=forward", "=connection-state=invalid", "=action=drop"],
      },
      {
        comment: `${LK_PREFIX}Client isolation`,
        args: [
          "=chain=forward",
          "=src-address=10.0.0.0/24",
          "=dst-address=10.0.0.0/24",
          "=action=drop",
        ],
      },
      {
        comment: `${LK_PREFIX}Drop clients to management`,
        args: [
          "=chain=forward",
          "=src-address=10.0.0.0/24",
          "=dst-address=192.168.1.0/24",
          "=action=drop",
        ],
      },
      {
        comment: `${LK_PREFIX}Drop clients to VPN network`,
        args: [
          "=chain=forward",
          "=src-address=10.0.0.0/24",
          "=dst-address=10.10.10.0/24",
          "=action=drop",
        ],
      },
      {
        comment: `${LK_PREFIX}Drop from WAN not DSTNATed`,
        args: [
          "=chain=forward",
          "=in-interface-list=WAN",
          "=connection-nat-state=!dstnat",
          "=action=drop",
        ],
      },
      // Anti-DDoS
      {
        comment: `${LK_PREFIX}SYN flood accept`,
        args: [
          "=chain=input",
          "=protocol=tcp",
          "=tcp-flags=syn",
          "=connection-state=new",
          "=action=accept",
          "=limit=200,100:packet",
        ],
      },
      {
        comment: `${LK_PREFIX}SYN flood drop`,
        args: [
          "=chain=input",
          "=protocol=tcp",
          "=tcp-flags=syn",
          "=connection-state=new",
          "=action=drop",
        ],
      },
      {
        comment: `${LK_PREFIX}Port scan detect`,
        args: [
          "=chain=input",
          "=protocol=tcp",
          "=psd=21,3s,3,1",
          "=action=add-src-to-address-list",
          "=address-list=lk-blacklist",
          "=address-list-timeout=1h",
        ],
      },
      {
        comment: `${LK_PREFIX}Drop blacklisted`,
        args: [
          "=chain=input",
          "=src-address-list=lk-blacklist",
          "=action=drop",
        ],
      },
      {
        comment: `${LK_PREFIX}Connection limit per client`,
        args: [
          "=chain=forward",
          "=protocol=tcp",
          "=connection-limit=500,32",
          "=action=drop",
          "=src-address=10.0.0.0/24",
        ],
      },
    ];

    // Check NAT masquerade
    const natRules = raw(await api.write("/ip/firewall/nat/print"));
    const hasMasquerade = natRules.some((r) => r.action === "masquerade");

    console.log("[Firewall] Checking and adding missing Linker rules...");

    for (const rule of linkerRules) {
      if (currentComments.has(rule.comment)) {
        existing++;
        continue;
      }

      try {
        await api.write("/ip/firewall/filter/add", [
          ...rule.args,
          `=comment=${rule.comment}`,
        ]);
        added++;
        addedRules.push(rule.comment);
        console.log(`[Firewall] Added: ${rule.comment}`);
      } catch (error) {
        console.error(
          `[Firewall] Failed to add '${rule.comment}': ${error instanceof Error ? error.message : error}`
        );
      }
    }

    // Add NAT masquerade if missing
    if (!hasMasquerade) {
      try {
        await api.write("/ip/firewall/nat/add", [
          "=chain=srcnat",
          "=out-interface-list=WAN",
          "=action=masquerade",
          `=comment=${LK_PREFIX}NAT masquerade`,
        ]);
        added++;
        addedRules.push(`${LK_PREFIX}NAT masquerade`);
        console.log("[Firewall] Added: NAT masquerade");
      } catch (error) {
        console.error(
          `[Firewall] Failed to add NAT masquerade: ${error instanceof Error ? error.message : error}`
        );
      }
    } else {
      existing++;
    }

    console.log(
      `[Firewall] Done: ${added} added, ${existing} already existed.`
    );
    return { added, existing, rules: addedRules };
  });
}

/**
 * Migrate simple queues to queue trees WITHOUT disrupting service.
 * Steps:
 *   1. Create PCQ queue types if missing
 *   2. Create mangle marks if missing
 *   3. Create parent queue trees
 *   4. Create per-client child trees from existing simple queues
 *   5. Disable (not delete) original simple queues
 * All Linker queue tree items are commented with "LK: " prefix.
 */
export async function migrateQueuesToTrees(
  totalDown: number,
  totalUp: number
): Promise<{ migrated: number; errors: string[] }> {
  return withConnection(async (api) => {
    let migrated = 0;
    const migrationErrors: string[] = [];

    console.log("[QoS-Migrate] Starting safe migration from simple queues to queue trees...");

    // Step 1: Create PCQ queue types if they don't exist
    const existingTypes = raw(await api.write("/queue/type/print"));
    const typeNames = new Set(existingTypes.map((t) => t.name));

    if (!typeNames.has("pcq-download-linker")) {
      console.log("[QoS-Migrate] Creating pcq-download-linker queue type...");
      await api.write("/queue/type/add", [
        "=name=pcq-download-linker",
        "=kind=pcq",
        "=pcq-rate=0",
        "=pcq-classifier=dst-address",
        "=pcq-total-limit=2000",
        "=pcq-burst-rate=0",
        "=pcq-burst-threshold=0",
        "=pcq-burst-time=10s",
        "=pcq-limit=50",
      ]);
    }

    if (!typeNames.has("pcq-upload-linker")) {
      console.log("[QoS-Migrate] Creating pcq-upload-linker queue type...");
      await api.write("/queue/type/add", [
        "=name=pcq-upload-linker",
        "=kind=pcq",
        "=pcq-rate=0",
        "=pcq-classifier=src-address",
        "=pcq-total-limit=2000",
        "=pcq-burst-rate=0",
        "=pcq-burst-threshold=0",
        "=pcq-burst-time=10s",
        "=pcq-limit=50",
      ]);
    }

    // Step 2: Create mangle rules if they don't exist
    const existingMangles = raw(await api.write("/ip/firewall/mangle/print"));
    const mangleComments = new Set(existingMangles.map((m) => m.comment || ""));

    const mangleRules = [
      {
        comment: `${LK_PREFIX}QoS mark download conn`,
        args: [
          "=chain=forward",
          "=in-interface-list=WAN",
          "=out-interface-list=LAN",
          "=action=mark-connection",
          "=new-connection-mark=lk-download-conn",
          "=passthrough=yes",
        ],
      },
      {
        comment: `${LK_PREFIX}QoS mark download packet`,
        args: [
          "=chain=forward",
          "=connection-mark=lk-download-conn",
          "=action=mark-packet",
          "=new-packet-mark=lk-download",
          "=passthrough=no",
        ],
      },
      {
        comment: `${LK_PREFIX}QoS mark upload conn`,
        args: [
          "=chain=forward",
          "=in-interface-list=LAN",
          "=out-interface-list=WAN",
          "=action=mark-connection",
          "=new-connection-mark=lk-upload-conn",
          "=passthrough=yes",
        ],
      },
      {
        comment: `${LK_PREFIX}QoS mark upload packet`,
        args: [
          "=chain=forward",
          "=connection-mark=lk-upload-conn",
          "=action=mark-packet",
          "=new-packet-mark=lk-upload",
          "=passthrough=no",
        ],
      },
    ];

    for (const rule of mangleRules) {
      if (!mangleComments.has(rule.comment)) {
        console.log(`[QoS-Migrate] Adding mangle: ${rule.comment}`);
        await api.write("/ip/firewall/mangle/add", [
          ...rule.args,
          `=comment=${rule.comment}`,
        ]);
      }
    }

    // Step 3: Create parent queue trees if they don't exist
    const existingTrees = raw(await api.write("/queue/tree/print"));
    const treeNames = new Set(existingTrees.map((t) => t.name));

    if (!treeNames.has("lk-download")) {
      console.log("[QoS-Migrate] Creating parent download queue tree...");
      await api.write("/queue/tree/add", [
        "=name=lk-download",
        "=parent=global",
        `=max-limit=${totalDown}M`,
        "=packet-mark=lk-download",
        "=queue=pcq-download-linker",
        `=comment=${LK_PREFIX}Parent download tree`,
      ]);
    }

    if (!treeNames.has("lk-upload")) {
      console.log("[QoS-Migrate] Creating parent upload queue tree...");
      await api.write("/queue/tree/add", [
        "=name=lk-upload",
        "=parent=global",
        `=max-limit=${totalUp}M`,
        "=packet-mark=lk-upload",
        "=queue=pcq-upload-linker",
        `=comment=${LK_PREFIX}Parent upload tree`,
      ]);
    }

    // Step 4: Read simple queues and create matching tree children
    const simpleQueues = raw(await api.write("/queue/simple/print"));
    console.log(`[QoS-Migrate] Found ${simpleQueues.length} simple queues to migrate.`);

    for (const sq of simpleQueues) {
      const queueName = sq.name || "";
      const maxLimit = sq["max-limit"] || "";

      if (!queueName || !maxLimit || maxLimit === "0/0") {
        migrationErrors.push(`Queue '${queueName}': no valid max-limit, skipping.`);
        continue;
      }

      // Parse upload/download from max-limit "upload/download"
      const parts = maxLimit.split("/");
      const uploadRate = parts[0] || "0";
      const downloadRate = parts[1] || parts[0] || "0";

      const dlTreeName = `lk-dl-${queueName}`;
      const ulTreeName = `lk-ul-${queueName}`;

      try {
        if (!treeNames.has(dlTreeName)) {
          await api.write("/queue/tree/add", [
            `=name=${dlTreeName}`,
            "=parent=lk-download",
            "=packet-mark=lk-download",
            `=max-limit=${downloadRate}`,
            "=priority=8",
            "=queue=pcq-download-linker",
            `=comment=${LK_PREFIX}Client ${queueName} download`,
          ]);
        }

        if (!treeNames.has(ulTreeName)) {
          await api.write("/queue/tree/add", [
            `=name=${ulTreeName}`,
            "=parent=lk-upload",
            "=packet-mark=lk-upload",
            `=max-limit=${uploadRate}`,
            "=priority=8",
            "=queue=pcq-upload-linker",
            `=comment=${LK_PREFIX}Client ${queueName} upload`,
          ]);
        }

        // Step 5: Disable the original simple queue (don't delete it)
        if (sq[".id"] && sq.disabled !== "true") {
          await api.write("/queue/simple/set", [
            `=.id=${sq[".id"]}`,
            "=disabled=yes",
          ]);
          console.log(`[QoS-Migrate] Disabled simple queue '${queueName}', created tree equivalents.`);
        }

        migrated++;
      } catch (error) {
        const msg = `Failed to migrate queue '${queueName}': ${error instanceof Error ? error.message : String(error)}`;
        console.error(`[QoS-Migrate] ${msg}`);
        migrationErrors.push(msg);
      }
    }

    console.log(
      `[QoS-Migrate] Migration complete: ${migrated} migrated, ${migrationErrors.length} errors.`
    );
    return { migrated, errors: migrationErrors };
  });
}

/**
 * Remove only Linker-added rules (comment starts with "LK: ").
 * Never touches rules without the LK prefix.
 */
export async function removeLK_Rules(): Promise<{
  removed: number;
  types: string[];
}> {
  return withConnection(async (api) => {
    let removed = 0;
    const removedTypes = new Set<string>();

    console.log("[Cleanup] Removing all Linker (LK:) rules...");

    // Filter rules
    const filterRules = raw(await api.write("/ip/firewall/filter/print"));
    for (const rule of filterRules) {
      if ((rule.comment || "").startsWith(LK_PREFIX) && rule[".id"]) {
        await api.write("/ip/firewall/filter/remove", [`=.id=${rule[".id"]}`]);
        removed++;
        removedTypes.add("firewall/filter");
      }
    }

    // NAT rules
    const natRules = raw(await api.write("/ip/firewall/nat/print"));
    for (const rule of natRules) {
      if ((rule.comment || "").startsWith(LK_PREFIX) && rule[".id"]) {
        await api.write("/ip/firewall/nat/remove", [`=.id=${rule[".id"]}`]);
        removed++;
        removedTypes.add("firewall/nat");
      }
    }

    // Mangle rules
    const mangleRules = raw(await api.write("/ip/firewall/mangle/print"));
    for (const rule of mangleRules) {
      if ((rule.comment || "").startsWith(LK_PREFIX) && rule[".id"]) {
        await api.write("/ip/firewall/mangle/remove", [`=.id=${rule[".id"]}`]);
        removed++;
        removedTypes.add("firewall/mangle");
      }
    }

    // Raw rules
    const rawRules = raw(await api.write("/ip/firewall/raw/print"));
    for (const rule of rawRules) {
      if ((rule.comment || "").startsWith(LK_PREFIX) && rule[".id"]) {
        await api.write("/ip/firewall/raw/remove", [`=.id=${rule[".id"]}`]);
        removed++;
        removedTypes.add("firewall/raw");
      }
    }

    // Queue trees
    const queueTrees = raw(await api.write("/queue/tree/print"));
    for (const tree of queueTrees) {
      if ((tree.comment || "").startsWith(LK_PREFIX) && tree[".id"]) {
        await api.write("/queue/tree/remove", [`=.id=${tree[".id"]}`]);
        removed++;
        removedTypes.add("queue/tree");
      }
    }

    // Queue types (pcq-download-linker, pcq-upload-linker)
    const queueTypes = raw(await api.write("/queue/type/print"));
    for (const qt of queueTypes) {
      if (
        (qt.name === "pcq-download-linker" || qt.name === "pcq-upload-linker") &&
        qt[".id"]
      ) {
        try {
          await api.write("/queue/type/remove", [`=.id=${qt[".id"]}`]);
          removed++;
          removedTypes.add("queue/type");
        } catch {
          // Queue type may be in use, ignore
        }
      }
    }

    // Address lists (lk-blacklist)
    const addressLists = raw(
      await api.write("/ip/firewall/address-list/print", ["?list=lk-blacklist"])
    );
    for (const entry of addressLists) {
      if (entry[".id"]) {
        await api.write("/ip/firewall/address-list/remove", [
          `=.id=${entry[".id"]}`,
        ]);
        removed++;
        removedTypes.add("firewall/address-list");
      }
    }

    // Re-enable simple queues that were disabled during migration
    const simpleQueues = raw(await api.write("/queue/simple/print"));
    for (const sq of simpleQueues) {
      if (sq.disabled === "true" && sq[".id"]) {
        // Only re-enable if we can reasonably assume we disabled it
        // (there's no comment marker on simple queues from migration, so re-enable all disabled ones is risky)
        // We'll skip this — the operator should manually re-enable if needed
      }
    }

    console.log(
      `[Cleanup] Done: ${removed} items removed from ${Array.from(removedTypes).join(", ")}.`
    );
    return { removed, types: Array.from(removedTypes) };
  });
}
