const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

function round(value) {
  return Math.round(Number(value) * 10) / 10;
}

module.exports = async (req, res) => {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ message: "Method not allowed" });
  }

  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Timing-Allow-Origin", "*");

  const requestStarted = performance.now();
  const target = String(req.query?.target || "edge");
  const region = process.env.VERCEL_REGION || process.env.VERCEL_ENV || "unknown";

  if (target === "edge") {
    const serverMs = round(performance.now() - requestStarted);
    res.setHeader("Server-Timing", `vercel;dur=${serverMs}`);
    return res.status(200).json({ ok: true, target, region, serverMs, at: new Date().toISOString() });
  }

  if (target !== "supabase") {
    return res.status(400).json({ message: "Unknown target" });
  }

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return res.status(500).json({ message: "Missing Supabase environment variables" });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  const supabaseStarted = performance.now();

  try {
    const authorization = req.headers.authorization || `Bearer ${SUPABASE_ANON_KEY}`;
    const upstream = await fetch(
      `${SUPABASE_URL.replace(/\/$/, "")}/rest/v1/orders?select=id&limit=1`,
      {
        method: "GET",
        headers: {
          apikey: SUPABASE_ANON_KEY,
          authorization,
          accept: "application/json",
          "cache-control": "no-store",
        },
        signal: controller.signal,
      },
    );
    const body = await upstream.arrayBuffer();
    const supabaseMs = round(performance.now() - supabaseStarted);
    const serverMs = round(performance.now() - requestStarted);
    res.setHeader("Server-Timing", `vercel;dur=${serverMs}, supabase;dur=${supabaseMs}`);
    return res.status(200).json({
      ok: upstream.ok,
      target,
      region,
      serverMs,
      supabaseMs,
      supabaseStatus: upstream.status,
      responseBytes: body.byteLength,
      at: new Date().toISOString(),
    });
  } catch (error) {
    const supabaseMs = round(performance.now() - supabaseStarted);
    const serverMs = round(performance.now() - requestStarted);
    res.setHeader("Server-Timing", `vercel;dur=${serverMs}, supabase;dur=${supabaseMs}`);
    return res.status(200).json({
      ok: false,
      target,
      region,
      serverMs,
      supabaseMs,
      error: error?.name === "AbortError" ? "Supabase timeout" : String(error?.message || error),
      at: new Date().toISOString(),
    });
  } finally {
    clearTimeout(timeout);
  }
};
