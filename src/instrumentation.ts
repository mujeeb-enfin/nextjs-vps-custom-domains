/**
 * Runs once when a server process starts (Node.js runtime only): validates the
 * platform config, failing hard so a broken deploy is visible at boot, and
 * starts the blocking consumer of host-agent results.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // `next build` also loads this file; only a running server needs config and Redis.
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  const { getPlatformConfig } = await import("@/lib/env");
  getPlatformConfig();

  const { startAgentResultConsumer } = await import("@/modules/custom-domains/agent-results");
  startAgentResultConsumer();
}
