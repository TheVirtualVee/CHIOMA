/**
 * core/runtime/index.ts
 *
 * CHIOMA Staff Runtime — public entry point.
 *
 * Exports runSyncPipeline as the canonical execution entry for the
 * synchronous staff loop. Webhook handlers import from here; the
 * underlying deterministic staff-loop lives in core/staff-loop/index.ts.
 *
 * This module exists so webhook API handlers have a stable import path
 * that does not expose internal staff-loop implementation details.
 */

export { runStaffLoop as runSyncPipeline } from "../staff-loop/index.js";
