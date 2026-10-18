export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.NEXT_PHASE !== 'phase-production-build' && process.env.GANTRY_EXECUTOR_DISABLED !== '1') {
    const { startExecutor } = await import('./lib/server/workflow-executor');
    startExecutor();
  }
}
