import "server-only";
import path from "node:path";
import { FileStore } from "./fileStore";
import { SupabaseStore } from "./supabaseStore";
import type { Store } from "./types";

let store: Store | undefined;

/** Supabase when configured, otherwise the local JSON store under .data/. */
export function getStore(): Store {
  if (store) return store;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url && key) {
    store = new SupabaseStore(url, key);
  } else {
    if (process.env.NODE_ENV === "production" && !process.env.ALLOW_FILE_STORE) {
      throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required in production (or set ALLOW_FILE_STORE=1).");
    }
    store = new FileStore(process.env.DATA_DIR || path.join(process.cwd(), ".data"));
  }
  return store;
}

export function usingFileStore(): boolean {
  return !(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export type { Store } from "./types";
