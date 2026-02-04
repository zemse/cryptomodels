import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

interface SessionStore {
  [address: string]: string; // address -> dhHash
}

const CONFIG_DIR = join(homedir(), ".cryptomodels");
const SESSIONS_FILE = join(CONFIG_DIR, "sessions.json");

function ensureConfigDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

function loadSessions(): SessionStore {
  ensureConfigDir();
  if (!existsSync(SESSIONS_FILE)) {
    return {};
  }
  try {
    const content = readFileSync(SESSIONS_FILE, "utf-8");
    return JSON.parse(content);
  } catch {
    return {};
  }
}

function saveSessions(sessions: SessionStore): void {
  ensureConfigDir();
  writeFileSync(SESSIONS_FILE, JSON.stringify(sessions, null, 2));
}

/**
 * Save a session (dhHash) for an address
 */
export function saveSession(address: string, dhHash: string): void {
  const sessions = loadSessions();
  sessions[address.toLowerCase()] = dhHash;
  saveSessions(sessions);
}

/**
 * Get a session (dhHash) for an address
 */
export function getSession(address: string): string | null {
  const sessions = loadSessions();
  return sessions[address.toLowerCase()] ?? null;
}

/**
 * List all sessions
 */
export function listSessions(): SessionStore {
  return loadSessions();
}

/**
 * Delete a session
 */
export function deleteSession(address: string): void {
  const sessions = loadSessions();
  delete sessions[address.toLowerCase()];
  saveSessions(sessions);
}
