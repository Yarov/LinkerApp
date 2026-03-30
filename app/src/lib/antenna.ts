import { Client as SSHClient } from "ssh2";

const DEFAULT_USER = process.env.ANTENNA_USER || "ubnt";
const DEFAULT_PASSWORD = process.env.ANTENNA_PASSWORD || "Blaster9615*";

function sshExec(
  host: string,
  user: string,
  password: string,
  command: string,
  timeoutMs = 15000
): Promise<string> {
  return new Promise((resolve, reject) => {
    const conn = new SSHClient();
    let output = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        conn.end();
        reject(new Error(`SSH timeout connecting to ${host}`));
      }
    }, timeoutMs);

    conn
      .on("ready", () => {
        conn.exec(command, (err, stream) => {
          if (err) {
            clearTimeout(timer);
            settled = true;
            conn.end();
            reject(err);
            return;
          }
          stream.on("data", (data: Buffer) => {
            output += data.toString();
          });
          stream.stderr.on("data", (data: Buffer) => {
            output += data.toString();
          });
          stream.on("close", () => {
            clearTimeout(timer);
            settled = true;
            conn.end();
            resolve(output);
          });
        });
      })
      .on("error", (err) => {
        clearTimeout(timer);
        if (!settled) {
          settled = true;
          reject(err);
        }
      })
      .connect({
        host,
        port: 22,
        username: user,
        password,
        readyTimeout: 10000,
        algorithms: {
          kex: [
            "diffie-hellman-group14-sha256",
            "diffie-hellman-group14-sha1",
            "diffie-hellman-group1-sha1",
            "ecdh-sha2-nistp256",
            "ecdh-sha2-nistp384",
            "ecdh-sha2-nistp521",
          ],
          serverHostKey: [
            "ssh-rsa",
            "ssh-dss",
            "ecdsa-sha2-nistp256",
            "ssh-ed25519",
          ],
        },
      });
  });
}

export interface AntennaStatus {
  deviceName?: string;
  platform?: string;
  signal?: string;
  noiseFloor?: string;
  frequency?: string;
  channelWidth?: string;
  txRate?: string;
  rxRate?: string;
  uptime?: string;
  distance?: string;
  ccq?: string;
  [key: string]: string | undefined;
}

function parseMcaStatus(raw: string): AntennaStatus {
  const result: Record<string, string> = {};
  const lines = raw.split("\n");
  for (const line of lines) {
    const eqIndex = line.indexOf("=");
    if (eqIndex > 0) {
      const key = line.substring(0, eqIndex).trim();
      const value = line.substring(eqIndex + 1).trim();
      result[key] = value;
    }
  }

  return {
    deviceName: result["deviceName"] || result["hostname"],
    platform: result["platform"],
    signal: result["signal"],
    noiseFloor: result["noise"] || result["noiseFloor"],
    frequency: result["freq"],
    channelWidth: result["chanbw"],
    txRate: result["txrate"],
    rxRate: result["rxrate"],
    uptime: result["uptime"],
    distance: result["distance"],
    ccq: result["ccq"],
    ...result,
  };
}

export async function getAntennaStatus(
  host: string,
  user: string = DEFAULT_USER,
  password: string = DEFAULT_PASSWORD
): Promise<AntennaStatus> {
  const raw = await sshExec(host, user, password, "mca-status");
  return parseMcaStatus(raw);
}

export interface StationInfo {
  mac: string;
  lastip: string;
  signal: number;
  noisefloor: number;
  ccq: number;
  tx: number;
  rx: number;
  name?: string;
  [key: string]: string | number | undefined;
}

export async function getStations(
  host: string,
  user: string = DEFAULT_USER,
  password: string = DEFAULT_PASSWORD
): Promise<StationInfo[]> {
  const raw = await sshExec(host, user, password, "wstalist");
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export interface AntennaConfig {
  [key: string]: string;
}

export async function getConfig(
  host: string,
  user: string = DEFAULT_USER,
  password: string = DEFAULT_PASSWORD
): Promise<AntennaConfig> {
  const raw = await sshExec(host, user, password, "cat /tmp/system.cfg");
  const config: Record<string, string> = {};
  const lines = raw.split("\n");
  for (const line of lines) {
    const eqIndex = line.indexOf("=");
    if (eqIndex > 0) {
      const key = line.substring(0, eqIndex).trim();
      const value = line.substring(eqIndex + 1).trim();
      config[key] = value;
    }
  }
  return config;
}
