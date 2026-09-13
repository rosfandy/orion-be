/**
 * Vercel entry-point shim for the zero-config Express backend model.
 *
 * A fresh Vercel import detects the Express framework and expects the app
 * entry at src/index.ts (or src/server.ts via custom output settings).
 * This re-exports the fully-wired http.Server (Express + WebSocket upgrade
 * handler) from src/server.ts, keeping a single source of truth.
 */
export { default } from './server.js';