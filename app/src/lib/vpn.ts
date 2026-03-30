import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";

const execAsync = promisify(exec);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VPNStatus {
  connected: boolean;
  interface: string | null;
  endpoint: string | null;
  publicKey: string | null;
  latestHandshake: string | null;
  transferRx: string | null;
  transferTx: string | null;
  localIp: string | null;
  peers: Array<{
    publicKey: string;
    endpoint: string;
    latestHandshake: string;
    transfer: { rx: string; tx: string };
    allowedIps: string;
  }>;
}

export interface VPNConfig {
  privateKey: string;
  address: string;
  dns: string;
  peerPublicKey: string;
  endpoint: string;
  allowedIPs: string;
  persistentKeepalive: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Resolve the WireGuard config file path. */
function getConfigPath(): string {
  const envPath = process.env.VPN_CONFIG_PATH;
  if (envPath && fs.existsSync(envPath)) return envPath;

  const locations = [
    path.resolve(process.cwd(), "..", "wg-ameca.conf"),
    path.resolve(process.cwd(), "wg-ameca.conf"),
  ];

  for (const loc of locations) {
    if (fs.existsSync(loc)) return loc;
  }

  // Return the first candidate even if it doesn't exist yet (for first-time setup)
  return envPath || locations[0];
}

/**
 * Run a shell command that may require root privileges.
 *
 * Strategy:
 *  1. Try running the command directly (works if user has passwordless sudo or
 *     the binary has the required capabilities).
 *  2. Fall back to macOS `osascript` which presents a native password dialog.
 */
async function runWithSudo(
  command: string,
): Promise<{ success: boolean; output: string; error: string }> {
  // Attempt 1 — direct execution
  try {
    const { stdout, stderr } = await execAsync(command, { timeout: 20_000 });
    return { success: true, output: stdout, error: stderr };
  } catch {
    // Attempt 2 — osascript (macOS admin password prompt)
    try {
      const escaped = command.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      const { stdout, stderr } = await execAsync(
        `osascript -e 'do shell script "${escaped}" with administrator privileges'`,
        { timeout: 30_000 },
      );
      return { success: true, output: stdout, error: stderr };
    } catch (err) {
      return {
        success: false,
        output: "",
        error: err instanceof Error ? err.message : "Failed to execute with sudo",
      };
    }
  }
}

/** Check whether the `wg` CLI tool is available. */
async function isWireGuardInstalled(): Promise<boolean> {
  try {
    await execAsync("which wg");
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Return the current VPN status by inspecting network interfaces and `wg show`.
 */
export async function getVPNStatus(): Promise<VPNStatus> {
  const empty: VPNStatus = {
    connected: false,
    interface: null,
    endpoint: null,
    publicKey: null,
    latestHandshake: null,
    transferRx: null,
    transferTx: null,
    localIp: null,
    peers: [],
  };

  if (!(await isWireGuardInstalled())) return empty;

  // Check if any utun interface carries the VPN IP
  let hasInterface = false;
  let localIp: string | null = null;
  try {
    const { stdout } = await execAsync(
      "ifconfig 2>/dev/null | grep -B 5 '10.10.10' || true",
    );
    if (stdout.includes("10.10.10")) {
      hasInterface = true;
      const ipMatch = stdout.match(/inet\s+(10\.10\.10\.\d+)/);
      if (ipMatch) localIp = ipMatch[1];
    }
  } catch {
    // ignore
  }

  if (!hasInterface) return empty;

  // Try to get detailed info from `wg show`
  let interfaceName: string | null = null;
  let endpointStr: string | null = null;
  let peerPublicKey: string | null = null;
  let latestHandshake: string | null = null;
  let transferRx: string | null = null;
  let transferTx: string | null = null;
  const peers: VPNStatus["peers"] = [];

  // Use direct exec for status check - NO sudo needed for reading
  // wg show may need sudo on some systems, but ifconfig + ping is enough for status
  let wgResult: { success: boolean; output: string; error: string };
  try {
    const { stdout, stderr } = await execAsync("wg show 2>/dev/null || true", { timeout: 5000 });
    wgResult = { success: true, output: stdout, error: stderr };
  } catch {
    // wg show failed (needs sudo) - use ping-based detection instead
    let connected = false;
    try {
      const { stdout } = await execAsync("ping -c 1 -W 2 10.10.10.1 2>/dev/null || true", { timeout: 5000 });
      connected = stdout.includes("1 packets received") || stdout.includes("bytes from");
    } catch { /* ignore */ }

    return {
      connected: connected && hasInterface,
      interface: hasInterface ? "utun" : null,
      endpoint: null,
      publicKey: null,
      latestHandshake: null,
      transferRx: null,
      transferTx: null,
      localIp,
      peers: [],
    };
  }
  if (wgResult.success && wgResult.output.trim().length > 0) {
    const out = wgResult.output;

    const ifMatch = out.match(/interface:\s*(\S+)/);
    if (ifMatch) interfaceName = ifMatch[1];

    // Parse peer blocks
    const peerBlocks = out.split(/peer:\s*/);
    for (let i = 1; i < peerBlocks.length; i++) {
      const block = peerBlocks[i];
      const pkLine = block.split("\n")[0]?.trim() ?? "";
      const ep = block.match(/endpoint:\s*(\S+)/)?.[1] ?? "";
      const hs = block.match(/latest handshake:\s*(.+)/)?.[1]?.trim() ?? "";
      const rx = block.match(/transfer:\s*([\d.]+ \w+) received/)?.[1] ?? "";
      const tx = block.match(/([\d.]+ \w+) sent/)?.[1] ?? "";
      const allowed = block.match(/allowed ips:\s*(.+)/)?.[1]?.trim() ?? "";

      peers.push({
        publicKey: pkLine,
        endpoint: ep,
        latestHandshake: hs,
        transfer: { rx, tx },
        allowedIps: allowed,
      });

      // Use first peer for top-level fields
      if (i === 1) {
        peerPublicKey = pkLine;
        endpointStr = ep;
        latestHandshake = hs;
        transferRx = rx;
        transferTx = tx;
      }
    }
  }

  // Verify actual connectivity with a quick ping
  let connected = false;
  try {
    const { stdout } = await execAsync("ping -c 1 -W 2 10.10.10.1 2>/dev/null");
    connected = !stdout.includes("100.0% packet loss");
  } catch {
    // ping failed — interface exists but no connectivity
  }

  return {
    connected,
    interface: interfaceName,
    endpoint: endpointStr,
    publicKey: peerPublicKey,
    latestHandshake,
    transferRx,
    transferTx,
    localIp,
    peers,
  };
}

/**
 * Bring the WireGuard tunnel up.
 */
export async function connectVPN(): Promise<{
  success: boolean;
  error?: string;
  needsManual?: boolean;
}> {
  if (!(await isWireGuardInstalled())) {
    return { success: false, error: "WireGuard no esta instalado. Instala con: brew install wireguard-tools" };
  }

  const confPath = getConfigPath();
  if (!fs.existsSync(confPath)) {
    return { success: false, error: `Archivo de configuracion no encontrado: ${confPath}` };
  }

  const result = await runWithSudo(`wg-quick up "${confPath}"`);
  if (result.success) {
    return { success: true };
  }

  // Already connected?
  if (result.error.includes("already exists")) {
    return { success: true };
  }

  return {
    success: false,
    error: result.error,
    needsManual: true,
  };
}

/**
 * Bring the WireGuard tunnel down.
 */
export async function disconnectVPN(): Promise<{
  success: boolean;
  error?: string;
  needsManual?: boolean;
}> {
  if (!(await isWireGuardInstalled())) {
    return { success: false, error: "WireGuard no esta instalado" };
  }

  const confPath = getConfigPath();

  const result = await runWithSudo(`wg-quick down "${confPath}"`);
  if (result.success) {
    return { success: true };
  }

  // Already disconnected?
  if (result.error.includes("is not a WireGuard interface")) {
    return { success: true };
  }

  return {
    success: false,
    error: result.error,
    needsManual: true,
  };
}

/**
 * Parse the WireGuard config file and return a structured object.
 */
export async function readVPNConfig(): Promise<VPNConfig | null> {
  const confPath = getConfigPath();

  if (!fs.existsSync(confPath)) return null;

  const raw = fs.readFileSync(confPath, "utf-8");

  const get = (key: string): string => {
    const m = raw.match(new RegExp(`^${key}\\s*=\\s*(.+)`, "m"));
    return m ? m[1].trim() : "";
  };

  return {
    privateKey: get("PrivateKey"),
    address: get("Address"),
    dns: get("DNS"),
    peerPublicKey: get("PublicKey"),
    endpoint: get("Endpoint"),
    allowedIPs: get("AllowedIPs"),
    persistentKeepalive: parseInt(get("PersistentKeepalive") || "25", 10),
  };
}

/**
 * Write the WireGuard config file.
 */
export async function writeVPNConfig(
  config: VPNConfig,
): Promise<{ success: boolean; error?: string }> {
  const confPath = getConfigPath();

  const content = `[Interface]
PrivateKey = ${config.privateKey}
Address = ${config.address}
DNS = ${config.dns}

[Peer]
PublicKey = ${config.peerPublicKey}
Endpoint = ${config.endpoint}
AllowedIPs = ${config.allowedIPs}
PersistentKeepalive = ${config.persistentKeepalive}
`;

  try {
    fs.writeFileSync(confPath, content, { mode: 0o600 });
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Error writing config",
    };
  }
}

/**
 * Generate a new WireGuard keypair via `wg genkey` / `wg pubkey`.
 */
export async function generateKeyPair(): Promise<{
  privateKey: string;
  publicKey: string;
}> {
  if (!(await isWireGuardInstalled())) {
    throw new Error("WireGuard no esta instalado. Instala con: brew install wireguard-tools");
  }

  const { stdout: privateKey } = await execAsync("wg genkey");
  const priv = privateKey.trim();

  const { stdout: publicKey } = await execAsync(`echo "${priv}" | wg pubkey`);
  return { privateKey: priv, publicKey: publicKey.trim() };
}

/**
 * First-time VPN setup: generate a keypair and write a config file.
 */
export async function createVPNConfig(params: {
  vpsIp: string;
  vpsPort: number;
  vpsPublicKey: string;
  localAddress: string;
  allowedIPs: string;
  dns?: string;
  persistentKeepalive?: number;
}): Promise<{ success: boolean; config: VPNConfig | null; publicKey: string; error?: string }> {
  try {
    const keypair = await generateKeyPair();

    const config: VPNConfig = {
      privateKey: keypair.privateKey,
      address: params.localAddress,
      dns: params.dns || "8.8.8.8",
      peerPublicKey: params.vpsPublicKey,
      endpoint: `${params.vpsIp}:${params.vpsPort}`,
      allowedIPs: params.allowedIPs,
      persistentKeepalive: params.persistentKeepalive ?? 25,
    };

    const writeResult = await writeVPNConfig(config);
    if (!writeResult.success) {
      return { success: false, config: null, publicKey: "", error: writeResult.error };
    }

    return { success: true, config, publicKey: keypair.publicKey };
  } catch (err) {
    return {
      success: false,
      config: null,
      publicKey: "",
      error: err instanceof Error ? err.message : "Error creating config",
    };
  }
}

/**
 * Ping the VPS and MikroTik through the VPN tunnel and report latency.
 */
export async function testVPNConnection(): Promise<{
  vps: { reachable: boolean; latency: number };
  mikrotik: { reachable: boolean; latency: number };
}> {
  const ping = async (
    host: string,
  ): Promise<{ reachable: boolean; latency: number }> => {
    try {
      const { stdout } = await execAsync(`ping -c 2 -W 3 ${host} 2>/dev/null`);
      if (stdout.includes("100.0% packet loss")) {
        return { reachable: false, latency: 0 };
      }
      const avgMatch = stdout.match(/avg\s*=\s*([\d.]+)/);
      const latency = avgMatch ? parseFloat(avgMatch[1]) : 0;
      return { reachable: true, latency };
    } catch {
      return { reachable: false, latency: 0 };
    }
  };

  const [vps, mikrotik] = await Promise.all([
    ping("10.10.10.1"),
    ping("10.10.10.3"),
  ]);

  return { vps, mikrotik };
}
