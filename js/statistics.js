import { supabaseClient } from "./config.js";
import { formatTaskDateRu } from "./format.js";
import { isAdmin } from "./roles.js";

function pad2(n) {
  return String(n).padStart(2, "0");
}

function toDatetimeLocalValue(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function defaultStatisticsDatetimeFrom() {
  const d = new Date();
  d.setTime(d.getTime() - 24 * 60 * 60 * 1000);
  return toDatetimeLocalValue(d);
}

function defaultStatisticsDatetimeTo() {
  return toDatetimeLocalValue(new Date());
}

function datetimeLocalToIso(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function readStatisticsRangeFromInputs() {
  const fromEl = document.getElementById("statisticsDatetimeFrom");
  const toEl = document.getElementById("statisticsDatetimeTo");
  let fromLocal = (fromEl?.value || "").trim();
  let toLocal = (toEl?.value || "").trim();
  if (!fromLocal) fromLocal = defaultStatisticsDatetimeFrom();
  if (!toLocal) toLocal = defaultStatisticsDatetimeTo();
  if (fromEl && !fromEl.value) fromEl.value = fromLocal;
  if (toEl && !toEl.value) toEl.value = toLocal;

  const fromMs = new Date(fromLocal).getTime();
  const toMs = new Date(toLocal).getTime();
  if (!Number.isNaN(fromMs) && !Number.isNaN(toMs) && fromMs > toMs) {
    const s = fromLocal;
    fromLocal = toLocal;
    toLocal = s;
    if (fromEl) fromEl.value = fromLocal;
    if (toEl) toEl.value = toLocal;
  }

  return {
    fromIso: datetimeLocalToIso(fromLocal),
    toIso: datetimeLocalToIso(toLocal),
  };
}

function escapeHtml(s) {
  if (s == null) return "";
  const div = document.createElement("div");
  div.textContent = String(s);
  return div.innerHTML;
}

function formatVpn(v) {
  if (v === true) return "Да";
  if (v === false) return "Нет";
  return "—";
}

function formatDevice(row) {
  const parts = [];
  if (row.device_type) parts.push(row.device_type);
  if (row.device_name) parts.push(row.device_name);
  return parts.join(", ") || "—";
}

function formatOs(row) {
  const parts = [];
  if (row.os_name) parts.push(row.os_name);
  if (row.os_version) parts.push(row.os_version);
  return parts.join(" ") || "—";
}

function applyStatisticsFilter() {
  const input = document.getElementById("statisticsSearchInput");
  const tbody = document.querySelector("#statisticsTable tbody");
  if (!tbody) return;
  const q = (input?.value ?? "").trim().toLowerCase();
  const rows = tbody.querySelectorAll("tr.statistics-row");
  for (const tr of rows) {
    if (!q) {
      tr.hidden = false;
      continue;
    }
    const haystack = (tr.textContent ?? "").toLowerCase();
    tr.hidden = !haystack.includes(q);
  }
}

function paintStatisticsTable(rows) {
  const tbody = document.querySelector("#statisticsTable tbody");
  const msg = document.getElementById("statisticsMessage");
  if (!tbody) return;

  tbody.innerHTML = "";
  if (!rows.length) {
    if (msg) msg.textContent = "За выбранный период записей нет.";
    return;
  }

  for (const row of rows) {
    const tr = document.createElement("tr");
    tr.className = "statistics-row";
    const pageLabel = row.page_title ? `${row.page_path} (${row.page_title})` : row.page_path;
    tr.innerHTML = `
      <td>${escapeHtml(formatTaskDateRu(row.created_at))}</td>
      <td title="${escapeHtml(row.user_email || "")}">${escapeHtml(row.user_email || "—")}</td>
      <td class="statistics-page-cell" title="${escapeHtml(pageLabel || "")}">${escapeHtml(row.page_path || "—")}</td>
      <td>${escapeHtml(formatDevice(row))}</td>
      <td>${escapeHtml(formatOs(row))}</td>
      <td>${escapeHtml(row.city || "—")}</td>
      <td>${escapeHtml(row.country || "—")}</td>
      <td>${escapeHtml(formatVpn(row.vpn_detected))}</td>
      <td>${row.response_time_ms != null ? escapeHtml(String(row.response_time_ms)) : "—"}</td>
    `;
    tbody.appendChild(tr);
  }

  if (msg) msg.textContent = `Записей: ${rows.length}`;
  applyStatisticsFilter();
}

export async function loadStatistics() {
  if (!isAdmin()) return;

  const tbody = document.querySelector("#statisticsTable tbody");
  const msg = document.getElementById("statisticsMessage");
  if (!tbody) return;

  const { fromIso, toIso } = readStatisticsRangeFromInputs();
  if (!fromIso || !toIso) {
    if (msg) msg.textContent = "Укажите корректный период.";
    return;
  }

  tbody.innerHTML = `<tr><td colspan="9" class="statistics-loading-cell">Загрузка…</td></tr>`;
  if (msg) msg.textContent = "";

  const { data, error } = await supabaseClient
    .from("site_access_logs")
    .select(
      "id, created_at, user_email, page_path, page_title, device_type, device_name, os_name, os_version, city, country, vpn_detected, response_time_ms",
    )
    .gte("created_at", fromIso)
    .lte("created_at", toIso)
    .order("created_at", { ascending: false })
    .limit(5000);

  if (error) {
    console.error("Ошибка загрузки статистики:", error);
    tbody.innerHTML = "";
    if (msg) msg.textContent = "Не удалось загрузить данные. Проверьте права доступа и подключение.";
    return;
  }

  paintStatisticsTable(data || []);
}

export function initStatisticsSection() {
  if (!isAdmin()) return;

  const fromEl = document.getElementById("statisticsDatetimeFrom");
  const toEl = document.getElementById("statisticsDatetimeTo");
  if (fromEl && !fromEl.value) fromEl.value = defaultStatisticsDatetimeFrom();
  if (toEl && !toEl.value) toEl.value = defaultStatisticsDatetimeTo();

  const btn = document.getElementById("statisticsLoadBtn");
  const searchInput = document.getElementById("statisticsSearchInput");
  if (btn && !btn.dataset.bound) {
    btn.dataset.bound = "1";
    btn.addEventListener("click", () => {
      void loadStatistics();
    });
  }
  if (searchInput && !searchInput.dataset.bound) {
    searchInput.dataset.bound = "1";
    searchInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        applyStatisticsFilter();
      }
    });
  }
}
