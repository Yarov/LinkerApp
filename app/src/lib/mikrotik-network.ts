import { RouterOSAPI } from "routeros-api";

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
    console.error("[MikroTik-Network]", error instanceof Error ? error.message : error);
    return fallback;
  }
}

// Helper to remove all items from a path
async function removeAll(api: RouterOSAPI, path: string): Promise<void> {
  const items = await api.write(`${path}/print`) as unknown as Array<Record<string, string>>;
  for (const item of items) {
    if (item[".id"]) {
      await api.write(`${path}/remove`, [`=.id=${item[".id"]}`]);
    }
  }
}

// ─── 1. Professional Firewall ────────────────────────────────────────────────

export async function applyProfessionalFirewall(): Promise<boolean> {
  return safeCall(async () => {
    return withConnection(async (api) => {
      console.log("[Firewall] Removing existing filter rules...");
      await removeAll(api, "/ip/firewall/filter");

      console.log("[Firewall] Applying INPUT chain rules...");

      // INPUT 1: Accept established, related, untracked
      await api.write("/ip/firewall/filter/add", [
        "=chain=input",
        "=connection-state=established,related,untracked",
        "=action=accept",
        "=comment=LK: Accept established, related, untracked",
      ]);

      // INPUT 2: Drop invalid
      await api.write("/ip/firewall/filter/add", [
        "=chain=input",
        "=connection-state=invalid",
        "=action=drop",
        "=comment=LK: Drop invalid",
      ]);

      // INPUT 3: Accept ICMP rate limited
      await api.write("/ip/firewall/filter/add", [
        "=chain=input",
        "=protocol=icmp",
        "=action=accept",
        "=limit=10,5:packet",
        "=comment=LK: Accept ICMP rate limited 10/sec",
      ]);

      // INPUT 4: Accept from LAN interface list
      await api.write("/ip/firewall/filter/add", [
        "=chain=input",
        "=in-interface-list=LAN",
        "=action=accept",
        "=comment=LK: Accept from LAN",
      ]);

      // INPUT 5: Accept WireGuard UDP 13231
      await api.write("/ip/firewall/filter/add", [
        "=chain=input",
        "=protocol=udp",
        "=dst-port=13231",
        "=action=accept",
        "=comment=LK: Accept WireGuard",
      ]);

      // INPUT 6: Accept RouterOS API from VPN only
      await api.write("/ip/firewall/filter/add", [
        "=chain=input",
        "=protocol=tcp",
        "=dst-port=8728",
        "=src-address=10.10.10.0/24",
        "=action=accept",
        "=comment=LK: Accept API from VPN only",
      ]);

      // INPUT 7: Accept SSH from VPN only
      await api.write("/ip/firewall/filter/add", [
        "=chain=input",
        "=protocol=tcp",
        "=dst-port=22",
        "=src-address=10.10.10.0/24",
        "=action=accept",
        "=comment=LK: Accept SSH from VPN only",
      ]);

      // INPUT 8: Accept Winbox from VPN only
      await api.write("/ip/firewall/filter/add", [
        "=chain=input",
        "=protocol=tcp",
        "=dst-port=8291",
        "=src-address=10.10.10.0/24",
        "=action=accept",
        "=comment=LK: Accept Winbox from VPN only",
      ]);

      // INPUT 9: Drop everything else
      await api.write("/ip/firewall/filter/add", [
        "=chain=input",
        "=action=drop",
        "=log=yes",
        "=log-prefix=FW-DROP-INPUT",
        "=comment=LK: Drop all other input",
      ]);

      console.log("[Firewall] Applying FORWARD chain rules...");

      // FORWARD 1: Accept established, related, untracked
      await api.write("/ip/firewall/filter/add", [
        "=chain=forward",
        "=connection-state=established,related,untracked",
        "=action=accept",
        "=comment=LK: Accept established, related, untracked",
      ]);

      // FORWARD 2: Drop invalid
      await api.write("/ip/firewall/filter/add", [
        "=chain=forward",
        "=connection-state=invalid",
        "=action=drop",
        "=comment=LK: Drop invalid",
      ]);

      // FORWARD 3: Fasttrack established, related
      await api.write("/ip/firewall/filter/add", [
        "=chain=forward",
        "=connection-state=established,related",
        "=action=fasttrack-connection",
        "=hw-offload=yes",
        "=comment=LK: Fasttrack established, related",
      ]);

      // FORWARD 4: Accept LAN to WAN
      await api.write("/ip/firewall/filter/add", [
        "=chain=forward",
        "=in-interface-list=LAN",
        "=out-interface-list=WAN",
        "=action=accept",
        "=comment=LK: Accept LAN to WAN (clients to internet)",
      ]);

      // FORWARD 5: Drop client-to-client (PPPoE isolation)
      await api.write("/ip/firewall/filter/add", [
        "=chain=forward",
        "=src-address=10.0.0.0/24",
        "=dst-address=10.0.0.0/24",
        "=action=drop",
        "=comment=LK: Drop client-to-client traffic (PPPoE isolation)",
      ]);

      // FORWARD 6: Drop clients accessing management network
      await api.write("/ip/firewall/filter/add", [
        "=chain=forward",
        "=src-address=10.0.0.0/24",
        "=dst-address=192.168.1.0/24",
        "=action=drop",
        "=comment=LK: Drop clients to management network",
      ]);

      // FORWARD 7: Drop clients accessing VPN network
      await api.write("/ip/firewall/filter/add", [
        "=chain=forward",
        "=src-address=10.0.0.0/24",
        "=dst-address=10.10.10.0/24",
        "=action=drop",
        "=comment=LK: Drop clients to VPN network",
      ]);

      // FORWARD 8: Accept VPN to LAN (remote management)
      await api.write("/ip/firewall/filter/add", [
        "=chain=forward",
        "=src-address=10.10.10.0/24",
        "=in-interface-list=LAN",
        "=action=accept",
        "=comment=LK: Accept VPN to LAN (remote management)",
      ]);

      // FORWARD 9: Drop all from WAN not DSTNATed
      await api.write("/ip/firewall/filter/add", [
        "=chain=forward",
        "=in-interface-list=WAN",
        "=connection-nat-state=!dstnat",
        "=action=drop",
        "=comment=LK: Drop from WAN not DSTNATed",
      ]);

      console.log("[Firewall] Professional firewall applied successfully.");
      return true;
    });
  }, false);
}

// ─── 2. QoS Queue Trees ─────────────────────────────────────────────────────

export async function applyQoS(
  totalDownloadMbps: number,
  totalUploadMbps: number
): Promise<boolean> {
  return safeCall(async () => {
    return withConnection(async (api) => {
      const totalDown = `${totalDownloadMbps}M`;
      const totalUp = `${totalUploadMbps}M`;

      // Step 1: Clean existing QoS config
      console.log("[QoS] Removing existing mangle rules for QoS...");
      const mangles = await api.write("/ip/firewall/mangle/print") as unknown as Array<Record<string, string>>;
      for (const m of mangles) {
        const comment = m.comment || "";
        if (comment.startsWith("LK: QoS-") || comment.startsWith("QoS-") || comment.startsWith("qos-")) {
          await api.write("/ip/firewall/mangle/remove", [`=.id=${m[".id"]}`]);
        }
      }

      console.log("[QoS] Removing existing queue trees...");
      await removeAll(api, "/queue/tree");

      console.log("[QoS] Removing existing queue types for QoS...");
      const queueTypes = await api.write("/queue/type/print") as unknown as Array<Record<string, string>>;
      for (const qt of queueTypes) {
        if (qt.name === "pcq-download-linker" || qt.name === "pcq-upload-linker") {
          await api.write("/queue/type/remove", [`=.id=${qt[".id"]}`]);
        }
      }

      // Step 2: Create PCQ queue types
      console.log("[QoS] Creating PCQ queue types...");
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

      // Step 3: Create mangle rules to mark traffic
      console.log("[QoS] Creating mangle rules...");

      // Mark download connections (from WAN to PPPoE clients)
      await api.write("/ip/firewall/mangle/add", [
        "=chain=forward",
        "=in-interface-list=WAN",
        "=out-interface-list=LAN",
        "=action=mark-connection",
        "=new-connection-mark=pppoe-download-conn",
        "=passthrough=yes",
        "=comment=LK: QoS-mark-download-conn",
      ]);

      await api.write("/ip/firewall/mangle/add", [
        "=chain=forward",
        "=connection-mark=pppoe-download-conn",
        "=action=mark-packet",
        "=new-packet-mark=pppoe-download",
        "=passthrough=no",
        "=comment=LK: QoS-mark-download-packet",
      ]);

      // Mark upload connections (from PPPoE clients to WAN)
      await api.write("/ip/firewall/mangle/add", [
        "=chain=forward",
        "=in-interface-list=LAN",
        "=out-interface-list=WAN",
        "=action=mark-connection",
        "=new-connection-mark=pppoe-upload-conn",
        "=passthrough=yes",
        "=comment=LK: QoS-mark-upload-conn",
      ]);

      await api.write("/ip/firewall/mangle/add", [
        "=chain=forward",
        "=connection-mark=pppoe-upload-conn",
        "=action=mark-packet",
        "=new-packet-mark=pppoe-upload",
        "=passthrough=no",
        "=comment=LK: QoS-mark-upload-packet",
      ]);

      // Step 4: Create parent queue trees
      console.log("[QoS] Creating queue trees...");

      await api.write("/queue/tree/add", [
        "=name=download",
        "=parent=global",
        `=max-limit=${totalDown}`,
        "=packet-mark=pppoe-download",
        "=queue=pcq-download-linker",
        "=comment=LK: QoS parent download",
      ]);

      await api.write("/queue/tree/add", [
        "=name=upload",
        "=parent=global",
        `=max-limit=${totalUp}`,
        "=packet-mark=pppoe-upload",
        "=queue=pcq-upload-linker",
        "=comment=LK: QoS parent upload",
      ]);

      // Step 5: Create per-client child queues from active PPPoE sessions
      console.log("[QoS] Creating per-client queue trees from active sessions...");
      const activeSessions = await api.write("/ppp/active/print") as unknown as Array<Record<string, string>>;
      const profiles = await api.write("/ppp/profile/print") as unknown as Array<Record<string, string>>;

      const profileRates: Record<string, { down: string; up: string }> = {};
      for (const p of profiles) {
        if (p["rate-limit"]) {
          const parts = p["rate-limit"].split("/");
          profileRates[p.name] = {
            up: parts[0] || "10M",
            down: parts[1] || parts[0] || "10M",
          };
        }
      }

      // Get secrets to map user -> profile
      const secrets = await api.write("/ppp/secret/print") as unknown as Array<Record<string, string>>;
      const secretProfiles: Record<string, string> = {};
      for (const s of secrets) {
        secretProfiles[s.name] = s.profile;
      }

      for (const session of activeSessions) {
        const clientName = session.name;
        const profileName = secretProfiles[clientName] || "default";
        const rates = profileRates[profileName];

        if (rates) {
          // Parse rate to number for burst calculation
          const downNum = parseRate(rates.down);
          const upNum = parseRate(rates.up);
          const burstDown = Math.round(downNum * 1.2);
          const burstUp = Math.round(upNum * 1.2);

          await api.write("/queue/tree/add", [
            `=name=dl-${clientName}`,
            "=parent=download",
            `=packet-mark=pppoe-download`,
            `=max-limit=${rates.down}`,
            `=burst-limit=${burstDown}k`,
            "=burst-threshold=0",
            "=burst-time=10s",
            "=priority=8",
            "=queue=pcq-download-linker",
            `=comment=LK: QoS client ${clientName} download`,
          ]);

          await api.write("/queue/tree/add", [
            `=name=ul-${clientName}`,
            "=parent=upload",
            `=packet-mark=pppoe-upload`,
            `=max-limit=${rates.up}`,
            `=burst-limit=${burstUp}k`,
            "=burst-threshold=0",
            "=burst-time=10s",
            "=priority=8",
            "=queue=pcq-upload-linker",
            `=comment=LK: QoS client ${clientName} upload`,
          ]);
        }
      }

      console.log(`[QoS] Applied QoS with ${totalDown}/${totalUp} total, ${activeSessions.length} client queues.`);
      return true;
    });
  }, false);
}

// Parse rate strings like "10M", "512k", "1024" to kbps
function parseRate(rate: string): number {
  const clean = rate.trim().toLowerCase();
  if (clean.endsWith("m")) {
    return parseFloat(clean) * 1000;
  }
  if (clean.endsWith("k")) {
    return parseFloat(clean);
  }
  // Assume raw number is in bps, convert to kbps
  return parseFloat(clean) / 1000;
}

// ─── 3. DNS Cache ────────────────────────────────────────────────────────────

export async function applyDNSCache(): Promise<boolean> {
  return safeCall(async () => {
    return withConnection(async (api) => {
      console.log("[DNS] Configuring DNS cache...");
      await api.write("/ip/dns/set", [
        "=servers=8.8.8.8,1.1.1.1,8.8.4.4",
        "=allow-remote-requests=yes",
        "=max-udp-packet-size=4096",
        "=cache-size=4096",
        "=cache-max-ttl=1d",
      ]);
      console.log("[DNS] DNS cache configured successfully.");
      return true;
    });
  }, false);
}

// ─── 4. Client Isolation ─────────────────────────────────────────────────────

export async function applyClientIsolation(): Promise<boolean> {
  return safeCall(async () => {
    return withConnection(async (api) => {
      console.log("[Isolation] Checking for existing client isolation rule...");

      // Check if rule already exists
      const existing = await api.write("/ip/firewall/filter/print", [
        "?chain=forward",
        "?src-address=10.0.0.0/24",
        "?dst-address=10.0.0.0/24",
        "?action=drop",
      ]) as unknown as Array<Record<string, string>>;

      if (existing.length > 0) {
        console.log("[Isolation] Client isolation rule already exists.");
        return true;
      }

      console.log("[Isolation] Adding client isolation firewall rule...");
      await api.write("/ip/firewall/filter/add", [
        "=chain=forward",
        "=src-address=10.0.0.0/24",
        "=dst-address=10.0.0.0/24",
        "=action=drop",
        "=comment=LK: Client isolation - block PPPoE client-to-client",
      ]);

      console.log("[Isolation] Client isolation applied successfully.");
      return true;
    });
  }, false);
}

// ─── 5. Anti-DDoS Protection ─────────────────────────────────────────────────

export async function applyAntiDDoS(): Promise<boolean> {
  return safeCall(async () => {
    return withConnection(async (api) => {
      console.log("[AntiDDoS] Removing existing anti-DDoS rules...");
      const existing = await api.write("/ip/firewall/filter/print") as unknown as Array<Record<string, string>>;
      for (const rule of existing) {
        const comment = rule.comment || "";
        if (comment.startsWith("LK: DDoS-") || comment.startsWith("DDoS-")) {
          await api.write("/ip/firewall/filter/remove", [`=.id=${rule[".id"]}`]);
        }
      }

      // Also clean existing raw rules
      const rawRules = await api.write("/ip/firewall/raw/print") as unknown as Array<Record<string, string>>;
      for (const rule of rawRules) {
        const comment = rule.comment || "";
        if (comment.startsWith("LK: DDoS-") || comment.startsWith("DDoS-")) {
          await api.write("/ip/firewall/raw/remove", [`=.id=${rule[".id"]}`]);
        }
      }

      // Clean existing address lists
      const addrLists = await api.write("/ip/firewall/address-list/print", [
        "?list=ddos-blacklist",
      ]) as unknown as Array<Record<string, string>>;
      for (const entry of addrLists) {
        await api.write("/ip/firewall/address-list/remove", [`=.id=${entry[".id"]}`]);
      }

      console.log("[AntiDDoS] Applying SYN flood protection...");
      await api.write("/ip/firewall/filter/add", [
        "=chain=input",
        "=protocol=tcp",
        "=tcp-flags=syn",
        "=action=accept",
        "=connection-state=new",
        "=limit=200,100:packet",
        "=comment=LK: DDoS-SYN-flood-accept",
      ]);
      await api.write("/ip/firewall/filter/add", [
        "=chain=input",
        "=protocol=tcp",
        "=tcp-flags=syn",
        "=connection-state=new",
        "=action=drop",
        "=comment=LK: DDoS-SYN-flood-drop",
      ]);

      console.log("[AntiDDoS] Applying ICMP flood protection...");
      await api.write("/ip/firewall/filter/add", [
        "=chain=input",
        "=protocol=icmp",
        "=action=accept",
        "=limit=10,5:packet",
        "=comment=LK: DDoS-ICMP-flood-accept",
      ]);
      await api.write("/ip/firewall/filter/add", [
        "=chain=input",
        "=protocol=icmp",
        "=action=drop",
        "=comment=LK: DDoS-ICMP-flood-drop",
      ]);

      console.log("[AntiDDoS] Applying port scan detection...");
      // Port scan detection: add scanner to blacklist
      await api.write("/ip/firewall/filter/add", [
        "=chain=input",
        "=protocol=tcp",
        "=psd=21,3s,3,1",
        "=action=add-src-to-address-list",
        "=address-list=ddos-blacklist",
        "=address-list-timeout=1h",
        "=comment=LK: DDoS-port-scan-detect",
      ]);

      // Drop traffic from blacklisted IPs
      await api.write("/ip/firewall/filter/add", [
        "=chain=input",
        "=src-address-list=ddos-blacklist",
        "=action=drop",
        "=comment=LK: DDoS-drop-blacklisted",
      ]);

      console.log("[AntiDDoS] Applying bogon/martian IP filter on WAN...");
      const bogonNetworks = [
        "0.0.0.0/8",
        "10.0.0.0/8",
        "100.64.0.0/10",
        "127.0.0.0/8",
        "169.254.0.0/16",
        "172.16.0.0/12",
        "192.0.0.0/24",
        "192.0.2.0/24",
        "192.168.0.0/16",
        "198.18.0.0/15",
        "198.51.100.0/24",
        "203.0.113.0/24",
        "224.0.0.0/3",
      ];

      for (const bogon of bogonNetworks) {
        await api.write("/ip/firewall/raw/add", [
          "=chain=prerouting",
          `=src-address=${bogon}`,
          "=in-interface-list=WAN",
          "=action=drop",
          `=comment=LK: DDoS-bogon-${bogon}`,
        ]);
      }

      console.log("[AntiDDoS] Applying connection limit per client...");
      await api.write("/ip/firewall/filter/add", [
        "=chain=forward",
        "=protocol=tcp",
        "=connection-limit=500,32",
        "=action=drop",
        "=src-address=10.0.0.0/24",
        "=comment=LK: DDoS-connection-limit-per-client",
      ]);

      console.log("[AntiDDoS] Anti-DDoS protection applied successfully.");
      return true;
    });
  }, false);
}

// ─── 6. Backup Configuration ─────────────────────────────────────────────────

export interface BackupInfo {
  success: boolean;
  name: string;
  timestamp: string;
}

export async function createBackup(): Promise<BackupInfo> {
  return safeCall(async () => {
    return withConnection(async (api) => {
      const backupName = "linker-backup";
      console.log(`[Backup] Creating backup '${backupName}'...`);

      await api.write("/system/backup/save", [
        `=name=${backupName}`,
      ]);

      const timestamp = new Date().toISOString();
      console.log(`[Backup] Backup created successfully at ${timestamp}.`);

      return {
        success: true,
        name: backupName,
        timestamp,
      };
    });
  }, { success: false, name: "", timestamp: "" } as BackupInfo);
}

// ─── 7. Network Health ───────────────────────────────────────────────────────

export interface NetworkHealth {
  firewall: { status: "none" | "basic" | "professional"; ruleCount: number };
  qos: { status: "none" | "simple" | "tree"; queueCount: number };
  dns: { cacheEnabled: boolean; servers: string[] };
  clientIsolation: boolean;
  antiDdos: boolean;
  pppoeServer: { active: boolean; clientCount: number };
  backup: { lastBackup: string | null };
  nat: { masquerade: boolean };
}

export async function getNetworkHealth(): Promise<NetworkHealth> {
  return safeCall(async () => {
    return withConnection(async (api) => {
      console.log("[Health] Auditing network configuration...");

      // Check firewall
      const filterRules = await api.write("/ip/firewall/filter/print") as unknown as Array<Record<string, string>>;
      let firewallStatus: "none" | "basic" | "professional" = "none";
      if (filterRules.length > 0) {
        // Check if it's our professional ruleset by looking for our comments
        const hasProfessionalMarkers = filterRules.some(
          (r) => r.comment?.includes("FW-DROP-INPUT") || r.comment?.includes("Fasttrack") || r.comment?.startsWith("LK:")
        );
        firewallStatus = hasProfessionalMarkers ? "professional" : "basic";
      }

      // Check QoS
      const queueTrees = await api.write("/queue/tree/print") as unknown as Array<Record<string, string>>;
      const simpleQueues = await api.write("/queue/simple/print") as unknown as Array<Record<string, string>>;
      let qosStatus: "none" | "simple" | "tree" = "none";
      let queueCount = 0;
      if (queueTrees.length > 0) {
        qosStatus = "tree";
        queueCount = queueTrees.length;
      } else if (simpleQueues.length > 0) {
        qosStatus = "simple";
        queueCount = simpleQueues.length;
      }

      // Check DNS
      const dnsConfig = await api.write("/ip/dns/print") as unknown as Array<Record<string, string>>;
      const dns = dnsConfig[0] || {};
      const cacheEnabled = dns["allow-remote-requests"] === "true";
      const servers = dns.servers ? dns.servers.split(",") : [];

      // Check client isolation
      const isolationRules = await api.write("/ip/firewall/filter/print", [
        "?chain=forward",
        "?src-address=10.0.0.0/24",
        "?dst-address=10.0.0.0/24",
        "?action=drop",
      ]) as unknown as Array<Record<string, string>>;
      const clientIsolation = isolationRules.length > 0;

      // Check anti-DDoS
      const allRules = await api.write("/ip/firewall/filter/print") as unknown as Array<Record<string, string>>;
      const antiDdos = allRules.some((r) => (r.comment || "").startsWith("LK: DDoS-") || (r.comment || "").startsWith("DDoS-"));

      // Check PPPoE server
      const pppoeServers = await api.write("/interface/pppoe-server/server/print") as unknown as Array<Record<string, string>>;
      const activeSessions = await api.write("/ppp/active/print") as unknown as Array<Record<string, string>>;
      const pppoeActive = pppoeServers.length > 0;

      // Check backup
      const files = await api.write("/file/print") as unknown as Array<Record<string, string>>;
      const backupFile = files.find((f) => f.name?.includes("linker-backup"));
      const lastBackup = backupFile?.["creation-time"] || null;

      // Check NAT masquerade
      const natRules = await api.write("/ip/firewall/nat/print") as unknown as Array<Record<string, string>>;
      const masquerade = natRules.some((r) => r.action === "masquerade");

      const health: NetworkHealth = {
        firewall: { status: firewallStatus, ruleCount: filterRules.length },
        qos: { status: qosStatus, queueCount },
        dns: { cacheEnabled, servers },
        clientIsolation,
        antiDdos,
        pppoeServer: { active: pppoeActive, clientCount: activeSessions.length },
        backup: { lastBackup },
        nat: { masquerade },
      };

      console.log("[Health] Audit complete:", JSON.stringify(health, null, 2));
      return health;
    });
  }, {
    firewall: { status: "none", ruleCount: 0 },
    qos: { status: "none", queueCount: 0 },
    dns: { cacheEnabled: false, servers: [] },
    clientIsolation: false,
    antiDdos: false,
    pppoeServer: { active: false, clientCount: 0 },
    backup: { lastBackup: null },
    nat: { masquerade: false },
  });
}

// ─── 8. Apply All Best Practices ─────────────────────────────────────────────

export interface BestPracticesResult {
  firewall: boolean;
  qos: boolean;
  dns: boolean;
  clientIsolation: boolean;
  antiDdos: boolean;
  backup: boolean;
  errors: string[];
}

export async function applyAllBestPractices(
  totalBandwidthDown: number,
  totalBandwidthUp: number
): Promise<BestPracticesResult> {
  const errors: string[] = [];
  const result: BestPracticesResult = {
    firewall: false,
    qos: false,
    dns: false,
    clientIsolation: false,
    antiDdos: false,
    backup: false,
    errors,
  };

  console.log("[BestPractices] Starting full WISP best practices application...");

  // 1. Firewall
  console.log("[BestPractices] Step 1/6: Professional Firewall...");
  try {
    result.firewall = await applyProfessionalFirewall();
    if (!result.firewall) errors.push("Firewall: returned false");
  } catch (e) {
    errors.push(`Firewall: ${e instanceof Error ? e.message : String(e)}`);
  }

  // 2. QoS
  console.log("[BestPractices] Step 2/6: QoS Queue Trees...");
  try {
    result.qos = await applyQoS(totalBandwidthDown, totalBandwidthUp);
    if (!result.qos) errors.push("QoS: returned false");
  } catch (e) {
    errors.push(`QoS: ${e instanceof Error ? e.message : String(e)}`);
  }

  // 3. DNS
  console.log("[BestPractices] Step 3/6: DNS Cache...");
  try {
    result.dns = await applyDNSCache();
    if (!result.dns) errors.push("DNS: returned false");
  } catch (e) {
    errors.push(`DNS: ${e instanceof Error ? e.message : String(e)}`);
  }

  // 4. Client Isolation
  console.log("[BestPractices] Step 4/6: Client Isolation...");
  try {
    result.clientIsolation = await applyClientIsolation();
    if (!result.clientIsolation) errors.push("Client Isolation: returned false");
  } catch (e) {
    errors.push(`Client Isolation: ${e instanceof Error ? e.message : String(e)}`);
  }

  // 5. Anti-DDoS
  console.log("[BestPractices] Step 5/6: Anti-DDoS Protection...");
  try {
    result.antiDdos = await applyAntiDDoS();
    if (!result.antiDdos) errors.push("Anti-DDoS: returned false");
  } catch (e) {
    errors.push(`Anti-DDoS: ${e instanceof Error ? e.message : String(e)}`);
  }

  // 6. Backup
  console.log("[BestPractices] Step 6/6: Configuration Backup...");
  try {
    const backupInfo = await createBackup();
    result.backup = backupInfo.success;
    if (!result.backup) errors.push("Backup: returned false");
  } catch (e) {
    errors.push(`Backup: ${e instanceof Error ? e.message : String(e)}`);
  }

  console.log("[BestPractices] Complete.", result);
  return result;
}
