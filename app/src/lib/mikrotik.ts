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
    timeout: 10,
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

// Safe wrapper that returns a default value on connection failure
async function safeCall<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    console.error("[MikroTik]", error instanceof Error ? error.message : error);
    return fallback;
  }
}

// ─── System ──────────────────────────────────────────────────────────────────

export interface SystemResource {
  uptime: string;
  "cpu-load": string;
  "free-memory": string;
  "total-memory": string;
  "architecture-name": string;
  "board-name": string;
  version: string;
  [key: string]: string;
}

export async function getSystemResource(): Promise<SystemResource | null> {
  return safeCall(async () => {
    return withConnection(async (api) => {
      const result = await api.write("/system/resource/print");
      const arr = result as unknown as SystemResource[];
      return arr[0] || null;
    });
  }, null);
}

// ─── Interfaces ──────────────────────────────────────────────────────────────

export interface MikrotikInterface {
  name: string;
  type: string;
  running: string;
  disabled: string;
  "tx-byte"?: string;
  "rx-byte"?: string;
  [key: string]: string | undefined;
}

export async function getInterfaces(): Promise<MikrotikInterface[]> {
  return safeCall(async () => {
    return withConnection(async (api) => {
      const result = await api.write("/interface/print");
      return result as unknown as MikrotikInterface[];
    });
  }, []);
}

// ─── PPPoE Profiles ──────────────────────────────────────────────────────────

export interface PPPoEProfile {
  ".id": string;
  name: string;
  "rate-limit"?: string;
  comment?: string;
  [key: string]: string | undefined;
}

export async function getPPPoEProfiles(): Promise<PPPoEProfile[]> {
  return safeCall(async () => {
    return withConnection(async (api) => {
      const result = await api.write("/ppp/profile/print");
      return result as unknown as PPPoEProfile[];
    });
  }, []);
}

export async function createPPPoEProfile(
  name: string,
  rateLimit: string,
  comment?: string
): Promise<string> {
  return withConnection(async (api) => {
    const args = [
      `=name=${name}`,
      `=rate-limit=${rateLimit}`,
    ];
    if (comment) args.push(`=comment=${comment}`);
    const result = await api.write("/ppp/profile/add", args);
    const arr = result as unknown as Array<Record<string, string>>;
    return arr[0]?.ret || "";
  });
}

export async function updatePPPoEProfile(
  name: string,
  rateLimit?: string,
  comment?: string
): Promise<void> {
  return withConnection(async (api) => {
    // Find the profile by name first
    const profiles = await api.write("/ppp/profile/print", [`?name=${name}`]);
    const arr = profiles as unknown as PPPoEProfile[];
    if (arr.length === 0) throw new Error(`Profile '${name}' not found`);
    const id = arr[0][".id"];

    const args = [`=.id=${id}`];
    if (rateLimit) args.push(`=rate-limit=${rateLimit}`);
    if (comment !== undefined) args.push(`=comment=${comment}`);
    await api.write("/ppp/profile/set", args);
  });
}

export async function deletePPPoEProfile(name: string): Promise<void> {
  return withConnection(async (api) => {
    const profiles = await api.write("/ppp/profile/print", [`?name=${name}`]);
    const arr = profiles as unknown as PPPoEProfile[];
    if (arr.length === 0) throw new Error(`Profile '${name}' not found`);
    await api.write("/ppp/profile/remove", [`=.id=${arr[0][".id"]}`]);
  });
}

// ─── PPPoE Secrets (Clients) ────────────────────────────────────────────────

export interface PPPoESecret {
  ".id": string;
  name: string;
  password: string;
  profile: string;
  service: string;
  disabled: string;
  comment?: string;
  [key: string]: string | undefined;
}

export async function getPPPoESecrets(): Promise<PPPoESecret[]> {
  return safeCall(async () => {
    return withConnection(async (api) => {
      const result = await api.write("/ppp/secret/print");
      return result as unknown as PPPoESecret[];
    });
  }, []);
}

export async function createPPPoESecret(
  name: string,
  password: string,
  profile: string,
  comment?: string
): Promise<string> {
  return withConnection(async (api) => {
    const args = [
      `=name=${name}`,
      `=password=${password}`,
      `=profile=${profile}`,
      `=service=pppoe`,
    ];
    if (comment) args.push(`=comment=${comment}`);
    const result = await api.write("/ppp/secret/add", args);
    const arr = result as unknown as Array<Record<string, string>>;
    return arr[0]?.ret || "";
  });
}

export async function updatePPPoESecret(
  name: string,
  params: {
    password?: string;
    profile?: string;
    comment?: string;
    disabled?: boolean;
  }
): Promise<void> {
  return withConnection(async (api) => {
    const secrets = await api.write("/ppp/secret/print", [`?name=${name}`]);
    const arr = secrets as unknown as PPPoESecret[];
    if (arr.length === 0) throw new Error(`Secret '${name}' not found`);
    const id = arr[0][".id"];

    const args = [`=.id=${id}`];
    if (params.password) args.push(`=password=${params.password}`);
    if (params.profile) args.push(`=profile=${params.profile}`);
    if (params.comment !== undefined) args.push(`=comment=${params.comment}`);
    if (params.disabled !== undefined) args.push(`=disabled=${params.disabled ? "yes" : "no"}`);
    await api.write("/ppp/secret/set", args);
  });
}

export async function deletePPPoESecret(name: string): Promise<void> {
  return withConnection(async (api) => {
    const secrets = await api.write("/ppp/secret/print", [`?name=${name}`]);
    const arr = secrets as unknown as PPPoESecret[];
    if (arr.length === 0) throw new Error(`Secret '${name}' not found`);
    await api.write("/ppp/secret/remove", [`=.id=${arr[0][".id"]}`]);
  });
}

export async function enablePPPoESecret(name: string): Promise<void> {
  return withConnection(async (api) => {
    const secrets = await api.write("/ppp/secret/print", [`?name=${name}`]);
    const arr = secrets as unknown as PPPoESecret[];
    if (arr.length === 0) throw new Error(`Secret '${name}' not found`);
    await api.write("/ppp/secret/set", [`=.id=${arr[0][".id"]}`, "=disabled=no"]);
  });
}

export async function disablePPPoESecret(name: string): Promise<void> {
  return withConnection(async (api) => {
    const secrets = await api.write("/ppp/secret/print", [`?name=${name}`]);
    const arr = secrets as unknown as PPPoESecret[];
    if (arr.length === 0) throw new Error(`Secret '${name}' not found`);
    await api.write("/ppp/secret/set", [`=.id=${arr[0][".id"]}`, "=disabled=yes"]);
  });
}

// ─── Active PPPoE Sessions ──────────────────────────────────────────────────

export interface ActivePPPoE {
  ".id": string;
  name: string;
  service: string;
  "caller-id": string;
  address: string;
  uptime: string;
  encoding: string;
  [key: string]: string;
}

export async function getActivePPPoE(): Promise<ActivePPPoE[]> {
  return safeCall(async () => {
    return withConnection(async (api) => {
      const result = await api.write("/ppp/active/print");
      return result as unknown as ActivePPPoE[];
    });
  }, []);
}

// ─── Queues ──────────────────────────────────────────────────────────────────

export interface MikrotikQueue {
  ".id": string;
  name: string;
  target: string;
  "max-limit": string;
  disabled: string;
  [key: string]: string;
}

export async function getQueues(): Promise<MikrotikQueue[]> {
  return safeCall(async () => {
    return withConnection(async (api) => {
      const result = await api.write("/queue/simple/print");
      return result as unknown as MikrotikQueue[];
    });
  }, []);
}

// Ping a host from MikroTik and return true if reachable
export async function pingHost(ip: string): Promise<boolean> {
  return safeCall(async () => {
    return withConnection(async (api) => {
      const result = await api.write("/ping", [
        `=address=${ip}`,
        "=count=1",
        "=interval=1",
      ]);
      const row = result[0] as Record<string, string> | undefined;
      return row?.received === "1";
    });
  }, false);
}

// ─── ARP Table ──────────────────────────────────────────────────────────────

export interface ArpEntry {
  ".id": string;
  address: string;
  "mac-address": string;
  interface: string;
  dynamic: string;
  complete: string;
  [key: string]: string;
}

export async function getArpTable(): Promise<ArpEntry[]> {
  return safeCall(async () => {
    return withConnection(async (api) => {
      const result = await api.write("/ip/arp/print");
      return result as unknown as ArpEntry[];
    });
  }, []);
}

// ─── DHCP Leases ────────────────────────────────────────────────────────────

export interface DhcpLease {
  ".id": string;
  address: string;
  "mac-address": string;
  "host-name"?: string;
  status: string;
  dynamic: string;
  [key: string]: string | undefined;
}

export async function getDhcpLeases(): Promise<DhcpLease[]> {
  return safeCall(async () => {
    return withConnection(async (api) => {
      const result = await api.write("/ip/dhcp-server/lease/print");
      return result as unknown as DhcpLease[];
    });
  }, []);
}

// Ping multiple hosts from MikroTik, return map of ip -> online
export async function pingHosts(ips: string[]): Promise<Record<string, boolean>> {
  const results: Record<string, boolean> = {};
  await safeCall(async () => {
    return withConnection(async (api) => {
      for (const ip of ips) {
        try {
          const result = await api.write("/ping", [
            `=address=${ip}`,
            "=count=1",
            "=interval=1",
          ]);
          const row = result[0] as Record<string, string> | undefined;
          results[ip] = row?.received === "1";
        } catch {
          results[ip] = false;
        }
      }
      return results;
    });
  }, {});
  return results;
}
