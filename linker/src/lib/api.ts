import { invoke } from '@tauri-apps/api/core';

// Wrapper that handles errors consistently
export async function api<T = unknown>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    console.error(`[API] ${command} failed:`, error);
    throw error;
  }
}
