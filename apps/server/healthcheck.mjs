// Docker HEALTHCHECK probe (spec 19.1/19.2): a small standalone script with
// no dependency on the app's own module graph, since it must keep working
// even if application code has a startup bug.
const port = process.env.SIM_PORT ?? "8080";

try {
  const res = await fetch(`http://127.0.0.1:${port}/healthz`, {
    signal: AbortSignal.timeout(1_500),
  });
  process.exit(res.ok ? 0 : 1);
} catch {
  process.exit(1);
}
