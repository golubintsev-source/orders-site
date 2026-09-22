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
      <div class="speed-test-metric-value">${escapeHtml(value)}</div>
      <div class="speed-test-metric-detail">${escapeHtml(detail)}</div>
    </article>`;
}

function renderNavigation(navigation) {
  const body = byId("speedTestNavigationBody");
  if (!body) return;
  const rows = [
    ["DNS", navigation?.dnsMs, "Поиск адреса сервера"],
    ["TCP", navigation?.tcpMs, "Установка соединения"],
    ["TLS", navigation?.tlsMs, "Шифрование HTTPS"],
    ["Ожидание первого байта", navigation?.requestToFirstByteMs, "Сеть + сервер до начала ответа"],
    ["Передача HTML", navigation?.downloadMs, "Получение ответа браузером"],
    ["Обработка DOM", navigation?.domProcessingMs, "Разбор HTML и выполнение стартового кода"],
    ["Полная загрузка", navigation?.totalMs, "До события load"],
  ];
  body.innerHTML = rows
    .map(
      ([name, value, detail]) => `
        <tr>
          <td><strong>${escapeHtml(name)}</strong><span>${escapeHtml(detail)}</span></td>
          <td class="speed-test-table-value speed-test-tone-${metricTone(Number(value), [500, 1500])}">${formatMs(value)}</td>
        </tr>`,
    )
    .join("");
}

function renderRequestSummary(requests) {
  const body = byId("speedTestRequestsBody");
  if (!body) return;
  const labels = {
    supabase: "Supabase (напрямую)",
    "vercel-api": "Vercel API",
    "vercel-static": "Vercel: файлы сайта",
    other: "Другие серверы",
  };
  body.innerHTML = Object.entries(requests.categories)
    .sort((a, b) => b[1].cumulativeHeadersMs - a[1].cumulativeHeadersMs)
    .map(
      ([category, item]) => `
        <tr>
          <td>${escapeHtml(labels[category] || category)}</td>
          <td>${item.count}</td>
          <td>${formatMs(item.maxHeadersMs)}</td>
          <td>${formatMs(item.cumulativeHeadersMs)}</td>
          <td>${item.errors || "—"}</td>
        </tr>`,
    )
    .join("") || '<tr><td colspan="5">Запросы пока не зафиксированы</td></tr>';
}

function sessionSummary(session) {
  const requests = summarizeRequests(session);
  const supabase = requests.categories.supabase || {};
  const api = requests.categories["vercel-api"] || {};
  const longTasks = summarizeLongTasks(session);
  return {
    startedAt: session.startedAt,
    path: session.path || "/",
    loadMs: session.navigation?.totalMs,
    requests: requests.total,
    supabaseMaxMs: supabase.maxHeadersMs || 0,
    apiMaxMs: api.maxHeadersMs || 0,
    longTaskMaxMs: longTasks.maxMs,
  };
}

function renderHistory() {
  const body = byId("speedTestHistoryBody");
  if (!body) return;
  const history = window.__ordersPerf?.getHistory?.() || [];
  body.innerHTML = history
    .slice(0, 12)
    .map(sessionSummary)
    .map(
      (item) => `
        <tr>
          <td>${escapeHtml(new Date(item.startedAt).toLocaleString("ru-RU"))}<span>${escapeHtml(item.path)}</span></td>
          <td>${formatMs(item.loadMs)}</td>
          <td>${item.requests}</td>
          <td>${formatMs(item.supabaseMaxMs)}</td>
          <td>${formatMs(item.longTaskMaxMs)}</td>
        </tr>`,
    )
    .join("") || '<tr><td colspan="5">История появится после первых загрузок сайта</td></tr>';
}

function renderReport(report) {
  const { medians, navigation, requests, longTasks, device, connection, region } = report;
  const metrics = byId("speedTestMetrics");
  if (metrics) {
    metrics.innerHTML = [
      renderMetric(
        "iPhone → Vercel",
        formatMs(medians.edgeTotalMs),
        `Сеть и первый ответ, регион ${region || "—"}`,
        metricTone(medians.edgeTotalMs),
      ),
      renderMetric(
        "Обработка Vercel",
        formatMs(medians.edgeServerMs),
        "Время кода на сервере без сетевого пути",
        metricTone(medians.edgeServerMs, [100, 500]),
      ),
      renderMetric(
        "iPhone → Supabase",
        formatMs(medians.supabaseDirectMs),
        "Так большинство данных загружается сейчас",
        metricTone(medians.supabaseDirectMs),
      ),
      renderMetric(
        "Vercel → Supabase",
        formatMs(medians.supabaseFromVercelMs),
        "Контрольный запрос из инфраструктуры Vercel",
        metricTone(medians.supabaseFromVercelMs),
      ),
      renderMetric(
        "CPU iPhone",
        formatMs(device.cpuMs),
        "Одинаковая вычислительная проба",
        metricTone(device.cpuMs, [80, 250]),
      ),
      renderMetric(
        "Рендер iPhone",
        formatMs(device.renderMs),
        "Создание и отображение 300 строк",
        metricTone(device.renderMs, [120, 350]),
      ),
    ].join("");
  }

  renderNavigation(navigation);
  renderRequestSummary(requests);
  renderHistory();

  const recommendations = byId("speedTestRecommendations");
  if (recommendations) {
    recommendations.innerHTML = report.recommendations
      .map((item) => `<li>${escapeHtml(item)}</li>`)
      .join("");
  }

  const environment = byId("speedTestEnvironment");
  if (environment) {
    const connectionText = connection
      ? `${connection.effectiveType || "тип неизвестен"}, RTT ${connection.rttMs ?? "—"} мс, ${connection.downlinkMbps ?? "—"} Мбит/с`
      : "iOS не предоставил Network Information API";
    environment.textContent = `${navigator.onLine ? "Онлайн" : "Офлайн"} · ${connectionText} · ${navigator.userAgent}`;
  }

  const longTaskEl = byId("speedTestLongTasks");
  if (longTaskEl) {
    longTaskEl.textContent = longTasks.count
      ? `${longTasks.count} длинных задач, суммарно ${formatMs(longTasks.totalMs)}, максимум ${formatMs(longTasks.maxMs)}`
      : "Длинные задачи JavaScript не обнаружены или браузер не поддерживает их измерение";
  }

  const navBytes = byId("speedTestNavigationBytes");
  if (navBytes) {
    navBytes.textContent = `HTML: передано ${formatBytes(navigation?.transferBytes)}, распаковано ${formatBytes(navigation?.decodedBytes)}. Времена параллельных запросов перекрываются и не складываются напрямую.`;
  }
}

async function runSpeedTest() {
  if (running) return;
  running = true;
  const button = byId("speedTestRunBtn");
  const status = byId("speedTestStatus");
  if (button) button.disabled = true;
  if (status) status.textContent = "Проверяю Vercel, Supabase и скорость iPhone…";

  try {
    const edge = await runRepeated(testVercelEdge);
    if (status) status.textContent = "Проверяю прямой путь до Supabase…";
    const direct = await runRepeated(testSupabaseDirect);
    if (status) status.textContent = "Проверяю путь Vercel → Supabase…";
    const viaVercel = await runRepeated(testSupabaseViaVercel);
    if (status) status.textContent = "Измеряю обработку и рендер на устройстве…";
    const device = await runDeviceBenchmarks();
    window.__ordersPerf?.persist?.();
    const snapshot = window.__ordersPerf?.getCurrentSnapshot?.() || {};
    const requests = summarizeRequests(snapshot);
    const longTasks = summarizeLongTasks(snapshot);
    const successfulEdge = edge.find((sample) => sample?.ok);

    lastReport = {
      createdAt: new Date().toISOString(),
      path: window.location.pathname,
      connection: currentConnection(),
      region: successfulEdge?.region || viaVercel.find((sample) => sample?.ok)?.region || null,
      medians: {
        edgeTotalMs: summarizeSamples(edge, "totalMs"),
        edgeServerMs: summarizeSamples(edge, "serverMs"),
        supabaseDirectMs: summarizeSamples(direct, "totalMs"),
        supabaseViaVercelTotalMs: summarizeSamples(viaVercel, "totalMs"),
        supabaseFromVercelMs: summarizeSamples(viaVercel, "supabaseMs"),
      },
      samples: { edge, direct, viaVercel },
      navigation: snapshot.navigation || null,
      requests,
      longTasks,
      device,
      userAgent: navigator.userAgent,
    };
    lastReport.recommendations = buildRecommendations(lastReport);
    renderReport(lastReport);
    if (status) status.textContent = `Готово: по ${TEST_RUNS} замера каждого сетевого пути`;
  } catch (error) {
    if (status) status.textContent = `Не удалось завершить тест: ${error?.message || error}`;
  } finally {
    running = false;
    if (button) button.disabled = false;
  }
}

async function copyReport() {
  const status = byId("speedTestStatus");
  if (!lastReport) {
    if (status) status.textContent = "Сначала запустите тест";
    return;
  }
  const text = JSON.stringify(lastReport, null, 2);
  try {
    await navigator.clipboard.writeText(text);
    if (status) status.textContent = "Отчёт скопирован — его можно отправить разработчику";
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    document.body.appendChild(area);
    area.select();
    document.execCommand("copy");
    area.remove();
    if (status) status.textContent = "Отчёт скопирован";
  }
}

function clearHistory() {
  window.__ordersPerf?.clearHistory?.();
  renderHistory();
  const status = byId("speedTestStatus");
  if (status) status.textContent = "Локальная история очищена";
}

export function initSpeedTestSection() {
  if (initialized) return;
  initialized = true;
  byId("speedTestRunBtn")?.addEventListener("click", runSpeedTest);
  byId("speedTestCopyBtn")?.addEventListener("click", copyReport);
  byId("speedTestClearBtn")?.addEventListener("click", clearHistory);
  renderHistory();
}

export function onSpeedTestSectionEnter() {
  initSpeedTestSection();
  renderHistory();
  if (!hasRun) {
    hasRun = true;
    void runSpeedTest();
  }
}
