/**
 * Where paired-home credentials persist.
 *
 * Inside Tauri: shell commands write `<product state>/paired-homes.json` (OS-protected app data).
 * In the browser / tests: injectable memory, or a localStorage fallback for `npm run dev`.
 */

import type { PairedHomesStorage } from "./paired-homes.js";
import { memoryPairedHomesStorage } from "./paired-homes.js";

interface TauriGlobal {
  core?: { invoke?: (command: string, args?: Record<string, unknown>) => Promise<unknown> };
}

function tauri(): TauriGlobal | undefined {
  const candidate = (globalThis as { __TAURI__?: TauriGlobal }).__TAURI__;
  return candidate?.core?.invoke ? candidate : undefined;
}

const DEV_KEY = "envoydev.paired-homes.v1";

/** Production / app storage: shell file when available, else localStorage for browser dev. */
export function defaultPairedHomesStorage(): PairedHomesStorage {
  const bridge = tauri();
  if (bridge?.core?.invoke) {
    return {
      async read() {
        const text = (await bridge.core!.invoke!("paired_homes_read")) as string | null;
        return text ?? undefined;
      },
      async write(text) {
        await bridge.core!.invoke!("paired_homes_write", { text });
      },
    };
  }
  if (typeof localStorage !== "undefined") {
    return {
      async read() {
        return localStorage.getItem(DEV_KEY) ?? undefined;
      },
      async write(text) {
        localStorage.setItem(DEV_KEY, text);
      },
    };
  }
  return memoryPairedHomesStorage();
}
