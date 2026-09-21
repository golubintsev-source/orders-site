import { supabaseClient } from "./config.js";

const TEST_RUNS = 3;
let initialized = false;
let hasRun = false;
let running = false;
let lastReport = null;

function byId(id) {
  return document.getElementById(id);
}

function round(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number) : null;
}

function formatMs(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  if (number >= 1000) return `${(number / 1000).toFixed(number >= 10000 ? 1 : 2)} с`;
  return `${Math.round(number)} мс`;
}

function formatBytes(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return "—";
  if (number >= 1024 * 1024) return `${(number / 1024 / 1024).toFixed(1)} МБ`;
  return `${Math.round(number / 1024)} КБ`;
}

function median(values) {
  const sorted = values.filter(Number.isFinite).slice().sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function metricTone(ms, limits = [800, 2000]) {
  if (!Number.isFinite(ms)) return "neutral";
  if (ms <= limits[0]) return "good";
  if (ms <= limits[1]) return "warn";
  return "bad";
}

async function runRepeated(sample) {
  const values = [];
  for (let index = 0; index < TEST_RUNS; index += 1) {
    try {
      values.push(await sample(index));
    } catch (error) {
      values.push({ ok: false, error: String(error?.message || error || "Ошибка") });
    }
  }
  return values;
}

async function testVercelEdge(index) {
  const started = performance.now();
  const response = await fetch(`/api/speed-test?target=edge&run=${index}&t=${Date.now()}`, {
    cache: "no-store",
  });
  const body = await response.json();
  return {
    ok: response.ok && body.ok,
    totalMs: performance.now() - started,
    serverMs: Number(body.serverMs),
    region: body.region || "unknown",
    status: response.status,
  };
}

async function testSupabaseDirect() {
  const started = performance.now();
  const { data, error } = await supabaseClient.from("orders").select("id").limit(1);
  const totalMs = performance.now() - started;
  if (error) throw new Error(error.message);
  return { ok: true, totalMs, rows: Array.isArray(data) ? data.length : 0 };
}

async function testSupabaseViaVercel(index) {
  const { data } = await supabaseClient.auth.getSession();
  const token = data?.session?.access_token;
  const started = performance.now();
  const response = await fetch(`/api/speed-test?target=supabase&run=${index}&t=${Date.now()}`, {
    cache: "no-store",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const body = await response.json();
  return {
    ok: response.ok && body.ok,
    totalMs: performance.now() - started,
    serverMs: Number(body.serverMs),
    supabaseMs: Number(body.supabaseMs),
    region: body.region || "unknown",
    status: body.supabaseStatus || response.status,
    error: body.error || null,
  };
}

async function runDeviceBenchmarks() {
  const cpuStarted = performance.now();
  let checksum = 0;
  for (let index = 0; index < 350000; index += 1) {
    checksum = (checksum + Math.sqrt(index + 1) * 17) % 1000003;
  }
  const cpuMs = performance.now() - cpuStarted;

  const host = document.createElement("div");
  host.className = "speed-test-benchmark-host";
  host.setAttribute("aria-hidden", "true");
  document.body.appendChild(host);
  const renderStarted = performance.now();
  const fragment = document.createDocumentFragment();
  for (let index = 0; index < 300; index += 1) {
    const row = document.createElement("div");
    row.textContent = `Диагностическая строка ${index + 1}: ${checksum.toFixed(2)}`;
    fragment.appendChild(row);
  }
  host.appendChild(fragment);
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const renderMs = performance.now() - renderStarted;
  host.remove();
  return { cpuMs, renderMs };
}

function summarizeSamples(samples, field) {
  return median(samples.filter((sample) => sample?.ok).map((sample) => Number(sample[field])));
}

function summarizeRequests(snapshot) {
  const requests = Array.isArray(snapshot?.requests) ? snapshot.requests : [];
  const categories = {};
  for (const request of requests) {
    const key = request.category || "other";
    const bucket = categories[key] || { count: 0, cumulativeHeadersMs: 0, maxHeadersMs: 0, errors: 0 };
    const ms = Number(request.headersMs) || 0;
    bucket.count += 1;
    bucket.cumulativeHeadersMs += ms;
    bucket.maxHeadersMs = Math.max(bucket.maxHeadersMs, ms);
    if (request.ok === false) bucket.errors += 1;
    categories[key] = bucket;
  }
  return { total: requests.length, categories };
}

function summarizeLongTasks(snapshot) {
  const tasks = Array.isArray(snapshot?.longTasks) ? snapshot.longTasks : [];
  return {
    count: tasks.length,
    totalMs: tasks.reduce((sum, task) => sum + (Number(task.durationMs) || 0), 0),
    maxMs: tasks.reduce((max, task) => Math.max(max, Number(task.durationMs) || 0), 0),
  };
}

function buildRecommendations(report) {
  const out = [];
  const { medians, navigation, requests, longTasks, device } = report;

  if (medians.edgeTotalMs > 2000) {
    out.push("Медленный путь до Vercel. Сравните тест с VPN и без него: проблема вероятнее в маршруте провайдера, DNS или TLS, а не в базе.");
  }
  if (medians.supabaseDirectMs > 2000 && medians.edgeTotalMs < 1200) {
    out.push("Vercel доступен нормально, но прямой путь iPhone → Supabase медленный. VPN или перенос базы ближе к пользователям может дать основной эффект.");
  }
  if (medians.supabaseFromVercelMs > 1500) {
    out.push("Даже Vercel долго ждёт Supabase. Нужно смотреть SQL-запросы, индексы, блокировки и регион базы.");
  }
  if ((navigation?.domProcessingMs || 0) > 1800 || device.renderMs > 250) {
    out.push("Заметная задержка на обработке и отрисовке в браузере. Нужны уменьшение DOM, объёма JavaScript и порционная отрисовка.");
  }
  if (longTasks.totalMs > 600 || longTasks.maxMs > 250) {
    out.push("На главном потоке есть длинные задачи JavaScript — во время них iPhone визуально «зависает» и не реагирует на касания.");
  }
  if (requests.total > 70) {
    out.push(`За текущую загрузку зафиксировано ${requests.total} запросов. Большой fan-out увеличивает влияние плохой сети; стоит объединять и откладывать вторичные запросы.`);
  }
  if (!out.length) {
    out.push("Критичных отклонений в этом запуске нет. Запустите тест именно во время замедления и сравните результаты с VPN и без VPN.");
  }
  return out;
}

function currentConnection() {
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  if (!connection) return null;
  return {
    effectiveType: connection.effectiveType || null,
    downlinkMbps: Number.isFinite(connection.downlink) ? connection.downlink : null,
    rttMs: Number.isFinite(connection.rtt) ? connection.rtt : null,
    saveData: Boolean(connection.saveData),
  };
}

function renderMetric(label, value, detail, tone) {
  return `
    <article class="speed-test-metric speed-test-metric--${tone}">
      <div class="speed-test-metric-label">${escapeHtml(label)}</div>
      <div class="speed