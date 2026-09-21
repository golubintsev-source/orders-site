(function initOrdersPerformanceMonitor() {
  "use strict";

  if (window.__ordersPerf) return;

  const STORAGE_KEY = "orders_site_performance_sessions_v1";
  const MAX_SESSIONS = 20;
  const MAX_REQUESTS = 160;
  const MAX_RESOURCES = 220;
  const MAX_LONG_TASKS = 80;
  const startedAt = performance.now();
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  const session = {
    version: 1,
    id,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    path: window.location.pathname || "/",
    referrerHost: safeHost(document.referrer),
    userAgent: navigator.userAgent,
    platform: navigator.platform || "",
    online: navigator.onLine,
    connection: readConnection(),
    navigation: null,
    paints: {},
    lcpMs: null,
    requests: [],
    resources: [],
    longTasks: [],
    sections: [],
    errors: [],
  };

  let persistTimer = 0;
  let activeSection = inferSectionFromPath();
  let sectionStartedAt = startedAt;

  function safeHost(value) {
    if (!value) return "";
    try {
      return new URL(value, window.location.href).host;
    } catch {
      return "";
    }
  }

  function safeUrl(value) {
    try {
      const url = new URL(String(value), window.location.href);
      return {
        host: url.host,
        path: url.pathname,
        category: classifyUrl(url),
      };
    } catch {
      return { host: "", path: "unknown", category: "other" };
    }
  }

  function classifyUrl(url) {
    if (url.hostname.endsWith(".supabase.co")) return "supabase";
    if (url.origin === window.location.origin && url.pathname.startsWith("/api/")) {
      return "vercel-api";
    }
    if (url.origin === window.location.origin) return "vercel-static";
    return "other";
  }

  function inferSectionFromPath() {
    const path = (window.location.pathname || "/").replace(/^\//, "");
    return path || "all";
  }

  function readConnection() {
    if (!connection) return null;
    return {
      effectiveType: connection.effectiveType || null,
      downlinkMbps: finiteOrNull(connection.downlink),
      rttMs: finiteOrNull(connection.rtt),
      saveData: Boolean(connection.saveData),
    };
  }

  function finiteOrNull(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function round(value) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.round(number * 10) / 10 : 0;
  }

  function readStoredSessions() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function collectNavigation() {
    const nav = performance.getEntriesByType("navigation")[0];
    if (!nav) return;
    const tlsStart = nav.secureConnectionStart > 0 ? nav.secureConnectionStart : nav.connectStart;
    session.navigation = {
      redirectMs: round(nav.redirectEnd - nav.redirectStart),
      dnsMs: round(nav.domainLookupEnd - nav.domainLookupStart),
      tcpMs: round(nav.connectEnd - nav.connectStart),
      tlsMs: round(nav.connectEnd - tlsStart),
      requestToFirstByteMs: round(nav.responseStart - nav.requestStart),
      downloadMs: round(nav.responseEnd - nav.responseStart),
      domProcessingMs: round(nav.domContentLoadedEventEnd - nav.responseEnd),
      domContentLoadedMs: round(nav.domContentLoadedEventEnd),
      loadEventMs: round(nav.loadEventEnd || performance.now()),
      totalMs: round((nav.loadEventEnd || performance.now()) - nav.startTime),
      transferBytes: finiteOrNull(nav.transferSize),
      encodedBytes: finiteOrNull(nav.encodedBodySize),
      decodedBytes: finiteOrNull(nav.decodedBodySize),
      protocol: nav.nextHopProtocol || "",
      serverTiming: (nav.serverTiming || []).map((item) => ({
        name: item.name,
        durationMs: round(item.duration),
      })),
    };
  }

  function persistNow() {
    window.clearTimeout(persistTimer);
    persistTimer = 0;
    collectNavigation();
    session.updatedAt = new Date().toISOString();
    session.online = navigator.onLine;
    session.connection = readConnection();
    try {
      const stored = readStoredSessions().filter((item) => item && item.id !== id);
      stored.unshift(session);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(stored.slice(0, MAX_SESSIONS)));
    } catch {
      // Диагностика не должна ломать приложение при переполненном localStorage.
    }
  }

  function schedulePersist() {
    if (persistTimer) return;
    persistTimer = window.setTimeout(persistNow, 500);
  }

  function pushLimited(list, item, max) {
    list.push(item);
    if (list.length > max) list.splice(0, list.length - max);
    schedulePersist();
  }

  function parseServerTimingHeader(value) {
    if (!value) return [];
    return String(value)
      .split(",")
      .map((chunk) => {
        const [namePart, ...params] = chunk.trim().split(";");
        const durationParam = params.find((part) => part.trim().startsWith("dur="));
        const duration = durationParam ? Number(durationParam.trim().slice(4)) : null;
        return { name: namePart || "server", durationMs: finiteOrNull(duration) };
      })
      .filter((item) => item.name);
  }

  const originalFetch = window.fetch.bind(window);
  window.fetch = function monitoredFetch(input, init) {
    const requestUrl = typeof input === "string" || input instanceof URL ? input : input?.url;
    const meta = safeUrl(requestUrl || "");
    const method = String(init?.method || input?.method || "GET").toUpperCase();
    const started = performance.now();
    const requestRecord = {
      startedMs: round(started - startedAt),
      section: activeSection,
      category: meta.category,
      host: meta.host,
      path: meta.path,
      method,
      headersMs: null,
      status: null,
      ok: null,
      error: null,
      serverTiming: [],
    };

    let promise;
    try {
      promise = originalFetch(input, init);
    } catch (error) {
      requestRecord.headersMs = round(performance.now() - started);
      requestRecord.ok = false;
      requestRecord.error = String(error?.message || error || "fetch failed").slice(0, 180);
      pushLimited(session.requests, requestRecord, MAX_REQUESTS);
      throw error;
    }

    return promise.then(
      (response) => {
        requestRecord.headersMs = round(performance.now() - started);
        requestRecord.status = response.status;
        requestRecord.ok = response.ok;
        requestRecord.serverTiming = parseServerTimingHeader(response.headers.get("server-timing"));
        pushLimited(session.requests, requestRecord, MAX_REQUESTS);
        return response;
      },
      (error) => {
        requestRecord.headersMs = round(performance.now() - started);
        requestRecord.ok = false;
        requestRecord.error = String(error?.message || error || "fetch failed").slice(0, 180);
        pushLimited(session.requests, requestRecord, MAX_REQUESTS);
        throw error;
      },
    );
  };

  function observe(type, callback) {
    if (typeof PerformanceObserver !== "function") return;
    try {
      const observer = new PerformanceObserver((list) => callback(list.getEntries()));
      observer.observe({ type, buffered: true });
    } catch {
      // Не все версии Safari поддерживают все entryType.
    }
  }

  observe("resource", (entries) => {
    for (const entry of entries) {
      const meta = safeUrl(entry.name);
      pushLimited(
        session.resources,
        {
          startedMs: round(entry.startTime),
          category: meta.category,
          host: meta.host,
          path: meta.path,
          initiator: entry.initiatorType || "",
          durationMs: round(entry.duration),
          dnsMs: round(entry.domainLookupEnd - entry.domainLookupStart),
          tcpMs: round(entry.connectEnd - entry.connectStart),
          tlsMs: round(entry.connectEnd - (entry.secureConnectionStart || entry.connectStart)),
          ttf