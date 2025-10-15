// Calcula la URL base del backend. Preferimos hablar con el mismo origen
// para evitar problemas de CSP/CORS cuando se sirve tras Nginx.
const API = (function () {
  if (location.protocol === "file:") {
    return "http://127.0.0.1:5001/api";
  }
  return `${location.origin}/api`;
})();
const $ = (sel) => document.querySelector(sel);
const on = (el, ev, fn) => el && el.addEventListener(ev, fn);

function ensureToastsContainer() {
  let container = document.getElementById("toasts");
  if (!container) {
    container = document.createElement("div");
    container.id = "toasts";
    container.className = "toasts";
    document.body.appendChild(container);
  }
  return container;
}

function toast(msg, ok = false) {
  if (ok && typeof state !== "undefined" && state.preferences && state.preferences.realtimeToasts === false) {
    return;
  }
  const container = ensureToastsContainer();
  const node = document.createElement("div");
  node.className = `toast ${ok ? "ok" : "err"}`;
  node.setAttribute("role", "status");
  node.textContent = msg;
  node.classList.add("enter");
  container.appendChild(node);
  requestAnimationFrame(() => {
    node.classList.add("enter-active");
  });
  setTimeout(() => {
    node.classList.add("fade-out");
    node.addEventListener("transitionend", () => node.remove(), { once: true });
  }, 3400);
}

async function api(path, opts = {}) {
  const config = {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...opts,
  };
  const res = await fetch(`${API}${path}`, config);
  if (!res.ok) {
    let err = "Error de red";
    try {
      const json = await res.json();
      err = json.error?.message || err;
    } catch (_ignored) {}
    throw new Error(err);
  }
  const isJson = res.headers
    .get("content-type")
    ?.includes("application/json");
  return isJson ? res.json() : res.text();
}

const show = (el) => el.classList.remove("hide");
const hide = (el) => el.classList.add("hide");

function isNotFoundError(err) {
  const msg = (err?.message || "").toLowerCase();
  return msg.includes("no encontrada") || msg.includes("no existe") || msg.includes("notfound");
}

const currencyFormatter = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
});

const formatCurrency = (value) => currencyFormatter.format(Number(value || 0));

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDateTime(value) {
  if (!value) return "—";
  const normalised = typeof value === "string" ? value.replace("T", " ") : value;
  const date = new Date(normalised);
  if (Number.isNaN(date.getTime())) {
    return typeof value === "string" ? value : "—";
  }
  return date.toLocaleString();
}

function formatDateOnly(value) {
  if (!value) return "—";
  const normalised = typeof value === "string" ? value.replace("T", " ") : value;
  const date = new Date(normalised);
  if (Number.isNaN(date.getTime())) {
    return typeof value === "string" ? value : "—";
  }
  return date.toLocaleDateString();
}

function formatPercentage(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return "0%";
  }
  if (numeric >= 100) {
    return "100%";
  }
  const digits = numeric >= 10 ? 0 : 1;
  return `${numeric.toFixed(digits)}%`;
}

const ANIMATED_SELECTORS = [
  ".pane",
  ".card",
  ".metric-card",
  ".notification-item",
  ".detail-section",
  ".content-section > *:not(.page-header)",
  ".admin-material-detail",
  ".admin-user-detail",
  ".archivos-adjuntos",
];
const REDUCED_MOTION_MEDIA = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
const dynamicFilterHandlers = new WeakMap();
let animationObserver = null;
let effectsEnabled = true;
let headerNavInitialized = false;

function markAnimatedElements(scope = document) {
  if (!scope || (scope === document && !document.body)) {
    return [];
  }
  const nodes = new Set();
  ANIMATED_SELECTORS.forEach((selector) => {
    scope.querySelectorAll(selector).forEach((element) => {
      if (!element.dataset.animate) {
        element.dataset.animate = "fade-up";
      }
      nodes.add(element);
    });
  });
  scope.querySelectorAll("[data-animate]").forEach((element) => nodes.add(element));
  return Array.from(nodes);
}

function teardownAnimations() {
  if (animationObserver) {
    animationObserver.disconnect();
    animationObserver = null;
  }
}

function refreshAnimations(scope = document) {
  const elements = markAnimatedElements(scope);
  if (!elements.length) {
    return;
  }
  if (!effectsEnabled) {
    elements.forEach((el) => el.classList.add("is-visible"));
    teardownAnimations();
    return;
  }
  if (REDUCED_MOTION_MEDIA && REDUCED_MOTION_MEDIA.matches) {
    elements.forEach((el) => el.classList.add("is-visible"));
    teardownAnimations();
    return;
  }
  if (!animationObserver) {
    animationObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            animationObserver.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -10%" },
    );
  }
  elements.forEach((el) => {
    if (animationObserver) {
      animationObserver.observe(el);
    }
  });
}

function applyEffectsPreference(enabled) {
  effectsEnabled = enabled;
  document.documentElement.dataset.effects = enabled ? "on" : "off";
  if (document.body) {
    document.body.dataset.effects = enabled ? "on" : "off";
  }
  if (enabled) {
    document.documentElement.style.removeProperty("--current-motion-scale");
    refreshAnimations();
  } else {
    teardownAnimations();
    document.querySelectorAll("[data-animate]").forEach((el) => {
      el.classList.add("is-visible");
    });
  }
}

const skeletonRegistry = new WeakMap();

function showTableSkeleton(target, { rows = 6, columns = null } = {}) {
  const table = typeof target === "string" ? document.querySelector(target) : target;
  if (!table) {
    return () => {};
  }
  const tbody = table.tBodies?.[0] || table.querySelector("tbody");
  if (!tbody) {
    return () => {};
  }
  const colCount = columns || table.tHead?.rows?.[0]?.cells?.length || 4;
  const skeletonRows = [];
  for (let rowIndex = 0; rowIndex < rows; rowIndex += 1) {
    const tr = document.createElement("tr");
    tr.className = "skeleton-row";
    for (let colIndex = 0; colIndex < colCount; colIndex += 1) {
      const td = document.createElement("td");
      const span = document.createElement("span");
      span.className = "skeleton skeleton-line";
      td.appendChild(span);
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
    skeletonRows.push(tr);
  }
  skeletonRegistry.set(table, skeletonRows);
  return () => {
    (skeletonRegistry.get(table) || []).forEach((row) => row.remove());
    skeletonRegistry.delete(table);
  };
}

function setButtonLoading(button, isLoading) {
  if (!button) {
    return;
  }
  if (isLoading) {
    button.dataset.loading = "true";
    button.classList.add("is-loading");
    button.setAttribute("aria-busy", "true");
  } else {
    button.dataset.loading = "false";
    button.classList.remove("is-loading");
    button.removeAttribute("aria-busy");
  }
}

function initDynamicFilters(scope = document) {
  scope.querySelectorAll('[data-filter-target]').forEach((input) => {
    if (dynamicFilterHandlers.has(input)) {
      return;
    }
    const targetSelector = input.dataset.filterTarget;
    const itemsSelector = input.dataset.filterItems || "tr";
    const emptySelector = input.dataset.filterEmpty || "";
    const target = document.querySelector(targetSelector);
    if (!target) {
      return;
    }
    const handler = () => {
      const value = (input.value || "").trim().toLowerCase();
      const items = target.querySelectorAll(itemsSelector);
      let visibleCount = 0;
      items.forEach((item) => {
        const matches = !value || (item.textContent || "").toLowerCase().includes(value);
        item.style.display = matches ? "" : "none";
        if (matches) {
          visibleCount += 1;
        }
      });
      if (emptySelector) {
        const emptyNode = document.querySelector(emptySelector);
        if (emptyNode) {
          emptyNode.style.display = visibleCount === 0 ? "block" : "none";
        }
      }
    };
    input.addEventListener("input", handler);
    dynamicFilterHandlers.set(input, handler);
    handler();
  });
}

function setSubmenuTabState(submenu, enabled) {
  if (!submenu) {
    return;
  }
  const focusable = submenu.querySelectorAll("a,button");
  focusable.forEach((node) => {
    if (enabled) {
      node.removeAttribute("tabindex");
    } else {
      node.setAttribute("tabindex", "-1");
    }
  });
}

function closeSubmenu(item) {
  if (!item) {
    return;
  }
  const trigger = item.querySelector(":scope > .app-menu__trigger");
  const submenu = item.querySelector(":scope > .app-submenu");
  item.classList.remove("is-open");
  if (trigger) {
    trigger.setAttribute("aria-expanded", "false");
  }
  if (submenu) {
    submenu.hidden = true;
    submenu.setAttribute("aria-hidden", "true");
    setSubmenuTabState(submenu, false);
    submenu.querySelectorAll(".has-submenu").forEach((child) => {
      if (child !== item) {
        closeSubmenu(child);
      }
    });
  }
}

function openSubmenu(item) {
  if (!item) {
    return;
  }
  const trigger = item.querySelector(":scope > .app-menu__trigger");
  const submenu = item.querySelector(":scope > .app-submenu");
  item.classList.add("is-open");
  if (trigger) {
    trigger.setAttribute("aria-expanded", "true");
  }
  if (submenu) {
    submenu.hidden = false;
    submenu.removeAttribute("hidden");
    submenu.setAttribute("aria-hidden", "false");
    setSubmenuTabState(submenu, true);
  }
}

function closeAllSubmenus(except = null, scope = document) {
  scope.querySelectorAll(".has-submenu").forEach((item) => {
    if (item === except) {
      return;
    }
    closeSubmenu(item);
  });
}

function initializeHeaderSubmenus(root = document) {
  root.querySelectorAll(".has-submenu").forEach((item) => {
    closeSubmenu(item);
  });
}

function setupHeaderNav() {
  const nav = document.getElementById("primaryNav");
  if (!nav) return;

  initializeHeaderSubmenus(nav);

  nav.addEventListener("click", (event) => {
    const trigger = event.target instanceof Element ? event.target.closest(".app-menu__trigger") : null;
    if (trigger && nav.contains(trigger)) {
      event.preventDefault();
      const item = trigger.closest(".has-submenu");
      if (!item) return;
      const isOpen = item.classList.contains("is-open");
      closeAllSubmenus(item, nav);
      if (isOpen) {
        closeSubmenu(item);
      } else {
        openSubmenu(item);
      }
      return;
    }
    const link = event.target instanceof Element ? event.target.closest(".app-menu__link") : null;
    if (link && nav.contains(link)) {
      closeAllSubmenus(null, nav);
    }
  });

  nav.addEventListener("keydown", (event) => {
    const trigger = event.target instanceof Element ? event.target.closest(".app-menu__trigger") : null;
    if (!trigger || !nav.contains(trigger)) {
      return;
    }
    const item = trigger.closest(".has-submenu");
    if (!item) {
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      closeSubmenu(item);
      trigger.focus({ preventScroll: true });
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!item.classList.contains("is-open")) {
        closeAllSubmenus(item, nav);
        openSubmenu(item);
      }
      const submenu = item.querySelector(":scope > .app-submenu");
      if (submenu) {
        const firstFocusable = submenu.querySelector("a,button");
        firstFocusable?.focus({ preventScroll: true });
      }
    }
  });

  nav.addEventListener("focusout", (event) => {
    if (!nav.contains(event.relatedTarget)) {
      closeAllSubmenus(null, nav);
    }
  });

  document.addEventListener("click", (event) => {
    if (!nav.contains(event.target)) {
      closeAllSubmenus(null, nav);
    }
  });
}

function finalizePage(scope = document) {
  document.body?.classList.add("is-ready");
  markAnimatedElements(scope);
  refreshAnimations(scope);
  initDynamicFilters(scope);
  setupHeaderNav();
}

const tableSortStates = new WeakMap();

function refreshSortableTables(root = document) {
  const scope = root instanceof Element ? root : document;
  scope.querySelectorAll("table[data-sortable-table]").forEach((table) => {
    ensureTableSortable(table);
  });
}

function ensureTableSortable(target) {
  const table = typeof target === "string" ? document.querySelector(target) : target;
  if (!table) {
    return;
  }
  let state = tableSortStates.get(table);
  if (!state) {
    state = { column: null, direction: 1 };
    tableSortStates.set(table, state);
    initTableSortable(table, state);
  }
  updateSortIndicators(table, state);
  if (typeof state.column === "number") {
    sortTableRows(table, state.column, state.direction, { preserveState: true });
  }
}

function initTableSortable(table, state) {
  if (!table || table.dataset.sortableInit === "1") {
    return;
  }
  const thead = table.querySelector("thead");
  if (!thead) {
    return;
  }
  table.dataset.sortableInit = "1";
  const headers = Array.from(thead.querySelectorAll("th"));
  headers.forEach((th, index) => {
    const rawLabel = (th.textContent || "").trim() || `Columna ${index + 1}`;
    const safeLabel = escapeHtml(rawLabel);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "sort-button";
    button.dataset.label = rawLabel;
    button.innerHTML = `<span class="sort-label">${safeLabel}</span><span class="sort-icon">A-Z</span>`;
    button.addEventListener("click", () => {
      let nextDirection = 1;
      if (state.column === index) {
        nextDirection = state.direction === 1 ? -1 : 1;
      }
      state.column = index;
      state.direction = nextDirection;
      sortTableRows(table, index, nextDirection);
      updateSortIndicators(table, state);
    });
    th.classList.add("sortable");
    th.setAttribute("data-sort", "none");
    th.replaceChildren(button);
  });
}

function sortTableRows(table, columnIndex, direction, options = {}) {
  if (!table || !table.tBodies || !table.tBodies.length) {
    return;
  }
  const tbody = table.tBodies[0];
  const rows = Array.from(tbody.querySelectorAll("tr"));
  if (!rows.length) {
    return;
  }
  const multiplier = direction === -1 ? -1 : 1;
  rows.sort((rowA, rowB) => {
    const aToken = getCellSortToken(rowA, columnIndex);
    const bToken = getCellSortToken(rowB, columnIndex);
    if (aToken.type === bToken.type) {
      if (aToken.type === "number" || aToken.type === "date") {
        return (aToken.value - bToken.value) * multiplier;
      }
      return aToken.value.localeCompare(bToken.value, "es", {
        sensitivity: "base",
        numeric: true,
      }) * multiplier;
    }
    return aToken.raw.localeCompare(bToken.raw, "es", {
      sensitivity: "base",
      numeric: true,
    }) * multiplier;
  });
  rows.forEach((row) => tbody.appendChild(row));
  if (!options.preserveState) {
    const state = tableSortStates.get(table);
    if (state) {
      state.column = columnIndex;
      state.direction = multiplier;
    }
  }

  refreshSortableTables();
}

function getCellSortToken(row, columnIndex) {
  const cell = row.cells?.[columnIndex];
  if (!cell) {
    return { type: "string", value: "", raw: "" };
  }
  const dataValue = cell.getAttribute("data-sort");
  const raw = (dataValue ?? cell.textContent ?? "").trim();
  const numeric = parseNumericValue(raw);
  if (numeric !== null) {
    return { type: "number", value: numeric, raw };
  }
  const parsedDate = Date.parse(raw);
  if (!Number.isNaN(parsedDate)) {
    return { type: "date", value: parsedDate, raw };
  }
  return { type: "string", value: raw.toLowerCase(), raw };
}

function parseNumericValue(raw) {
  if (!raw) {
    return null;
  }
  const normalized = raw
    .replace(/\s+/g, "")
    .replace(/[^0-9,.-]/g, "");
  if (!normalized) {
    return null;
  }
  let candidate = normalized;
  if (candidate.includes(",") && (!candidate.includes(".") || candidate.lastIndexOf(",") > candidate.lastIndexOf("."))) {
    candidate = candidate.replace(/\./g, "").replace(",", ".");
  } else {
    candidate = candidate.replace(/,/g, "");
  }
  if (!candidate || candidate === "-" || candidate === ".") {
    return null;
  }
  const numeric = Number(candidate);
  return Number.isFinite(numeric) ? numeric : null;
}

function updateSortIndicators(table, state) {
  if (!table) {
    return;
  }
  const thead = table.querySelector("thead");
  if (!thead) {
    return;
  }
  const headers = thead.querySelectorAll("th.sortable");
  headers.forEach((th, index) => {
    const button = th.querySelector("button.sort-button");
    const icon = button?.querySelector(".sort-icon");
    const baseLabel = button?.dataset.label || (th.textContent || "").trim() || `Columna ${index + 1}`;
    const isActive = state && state.column === index;
    if (icon) {
      if (isActive) {
        icon.textContent = state.direction === -1 ? "Z-A" : "A-Z";
        th.setAttribute("data-sort", state.direction === -1 ? "desc" : "asc");
      } else {
        icon.textContent = "A-Z";
        th.setAttribute("data-sort", "none");
      }
    }
    if (button) {
      const dirLabel = isActive ? (state.direction === -1 ? "Z-A" : "A-Z") : "A-Z";
      button.setAttribute("aria-label", `Ordenar por ${baseLabel}${isActive ? ` (${dirLabel})` : ""}`);
    }
  });
}

function trimChatHistory() {
  const max = CHAT_HISTORY_LIMIT * 2;
  if (state.chat.messages.length > max) {
    state.chat.messages = state.chat.messages.slice(-max);
  }
}

function renderChatMessages() {
  const container = document.getElementById("chatbotMessages");
  if (!container) {
    return;
  }
  container.innerHTML = "";
  if (!state.chat.messages.length) {
    const empty = document.createElement("div");
    empty.className = "chatbot-empty";
    empty.textContent = "Todavia no iniciaste una conversacion. Escribi tu consulta.";
    container.appendChild(empty);
    return;
  }
  const fragment = document.createDocumentFragment();
  state.chat.messages.forEach((msg) => {
    const wrapper = document.createElement("div");
    const role = msg.role === "assistant" ? "assistant" : "user";
    wrapper.className = `chatbot-message chatbot-message--${role}`;
    wrapper.innerHTML = `<p>${escapeHtml(msg.content)}</p>`;
    fragment.appendChild(wrapper);
  });
  container.appendChild(fragment);
  container.scrollTop = container.scrollHeight;
}

function updateChatbotControls() {
  const input = document.getElementById("chatbotInput");
  const sendBtn = document.getElementById("chatbotSend");
  const status = document.getElementById("chatbotStatus");
  if (input) {
    input.disabled = state.chat.isSending;
  }
  if (sendBtn) {
    sendBtn.disabled = state.chat.isSending;
    sendBtn.textContent = state.chat.isSending ? "Enviando..." : "Enviar";
  }
  if (status) {
    status.textContent = state.chat.isSending ? "Consultando modelo..." : "";
  }
}

function toggleChatbotPanel(forceState) {
  const panel = document.getElementById("chatbotPanel");
  const fab = document.getElementById("chatbotFab");
  if (!panel || !fab) {
    return;
  }
  const nextState = typeof forceState === "boolean" ? forceState : !state.chat.isOpen;
  state.chat.isOpen = nextState;
  panel.classList.toggle("chatbot-panel--open", nextState);
  panel.setAttribute("aria-hidden", nextState ? "false" : "true");
  fab.classList.toggle("chatbot-fab--hidden", nextState);
  if (nextState) {
    renderChatMessages();
    const input = document.getElementById("chatbotInput");
    if (input) {
      input.focus();
    }
  }
}

async function processChatbotPrompt(rawText) {
  const text = String(rawText || "").trim();
  if (!text || state.chat.isSending) {
    return;
  }
  const historyPayload = state.chat.messages.slice(-(CHAT_HISTORY_LIMIT - 1)).map((msg) => ({
    role: msg.role,
    content: msg.content,
  }));
  const userMessage = { role: "user", content: text };
  state.chat.messages.push(userMessage);
  trimChatHistory();
  renderChatMessages();

  state.chat.isSending = true;
  updateChatbotControls();

  try {
    const resp = await api("/chatbot", {
      method: "POST",
      body: JSON.stringify({ message: text, history: historyPayload }),
    });
    if (!resp?.ok) {
      throw new Error(resp?.error?.message || "No se obtuvo respuesta");
    }
    const reply = String(resp.message?.content || "No recibimos respuesta del asistente.").trim();
    state.chat.messages.push({ role: "assistant", content: reply });
  } catch (err) {
    const detail = err?.message || "No se pudo contactar al asistente";
    state.chat.messages.push({ role: "assistant", content: `Hubo un problema: ${detail}` });
    toast(detail);
  } finally {
    trimChatHistory();
    state.chat.isSending = false;
    renderChatMessages();
    updateChatbotControls();
  }
}

function ensureChatbotWidget() {
  if (document.getElementById("chatbotFab")) {
    return;
  }
  const fab = document.createElement("button");
  fab.id = "chatbotFab";
  fab.type = "button";
  fab.className = "chatbot-fab";
  fab.innerHTML = `
    <img src="assets/chatbot-icon.svg" alt="Abrir asistente" class="chatbot-fab__icon" aria-hidden="true"/>
    <span class="sr-only">Chat con asistente</span>
  `;
  document.body.appendChild(fab);

  const panel = document.createElement("section");
  panel.id = "chatbotPanel";
  panel.className = "chatbot-panel";
  panel.setAttribute("aria-hidden", "true");
  panel.innerHTML = `
    <header class="chatbot-panel__header">
      <span class="chatbot-panel__title">Asistente SPM</span>
      <button type="button" class="chatbot-panel__close" id="chatbotClose" aria-label="Cerrar asistente">X</button>
    </header>
    <div class="chatbot-panel__messages" id="chatbotMessages"></div>
    <p class="chatbot-panel__status" id="chatbotStatus"></p>
    <form class="chatbot-panel__form" id="chatbotForm">
      <label for="chatbotInput" class="sr-only">Mensaje para el asistente</label>
      <textarea id="chatbotInput" rows="3" placeholder="Escribi tu consulta..." required></textarea>
      <div class="chatbot-panel__actions">
        <button type="submit" id="chatbotSend" class="btn">Enviar</button>
      </div>
    </form>
  `;
  document.body.appendChild(panel);

  fab.addEventListener("click", () => {
    toggleChatbotPanel(true);
  });

  const closeBtn = document.getElementById("chatbotClose");
  if (closeBtn) {
    closeBtn.addEventListener("click", (ev) => {
      ev.preventDefault();
      toggleChatbotPanel(false);
    });
  }

  const form = document.getElementById("chatbotForm");
  const input = document.getElementById("chatbotInput");
  if (form) {
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      if (!input) {
        return;
      }
      const value = input.value;
      if (!value.trim() || state.chat.isSending) {
        return;
      }
      input.value = "";
      await processChatbotPrompt(value);
    });
  }
  if (input) {
    input.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" && (ev.ctrlKey || ev.metaKey)) {
        ev.preventDefault();
        form?.dispatchEvent(new Event("submit", { cancelable: true }));
      }
    });
  }

  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && state.chat.isOpen) {
      toggleChatbotPanel(false);
    }
  });
}

function initChatbotWidget() {
  ensureChatbotWidget();
  if (!state.chat.messages.length) {
    state.chat.messages.push({
      role: "assistant",
      content: "Hola, soy el asistente de SPM. En que puedo ayudarte hoy?",
    });
  }
  renderChatMessages();
  updateChatbotControls();
}

function initHomeHero(userName) {
  const node = document.getElementById("homeTypewriter");
  if (!node || node.dataset.typewriterDone === "1") {
    return;
  }
  const template = node.dataset.typewriter || node.textContent || "";
  const message = template.replace(/\{\{\s*name\s*\}\}/gi, userName || "").replace(/\s{2,}/g, " ").trim();
  if (!message) {
    node.classList.add("is-finished");
    node.dataset.typewriterDone = "1";
    return;
  }
  node.textContent = "";
  node.dataset.typewriterDone = "1";
  node.classList.add("is-typing");
  let index = 0;
  const delay = Number(node.dataset.typewriterSpeed) || 48;
  const initialDelay = Number(node.dataset.typewriterDelay) || 260;

  const tick = () => {
    index += 1;
    node.textContent = message.slice(0, index);
    if (index < message.length) {
      window.setTimeout(tick, delay);
    } else {
      node.classList.remove("is-typing");
      node.classList.add("is-finished");
    }
  };

  window.setTimeout(tick, initialDelay);
}

const STATUS_LABELS = {
  draft: "Borrador",
  finalizada: "Finalizada",
  cancelada: "Cancelada",
  pendiente_de_aprobacion: "Pendiente de aprobación",
  pendiente: "Pendiente",
  aprobada: "Aprobada",
  rechazada: "Rechazada",
  cancelacion_pendiente: "Cancelación pendiente",
  cancelacion_rechazada: "Cancelación rechazada",
};

const PENDING_SOLICITUD_KEY = "pendingSolicitudId";
const PREFS_STORAGE_KEY = "spmPreferences";
const DEFAULT_PREFERENCES = {
  emailAlerts: true,
  realtimeToasts: true,
  approvalDigest: false,
  digestHour: "08:30",
  theme: "auto",
  density: "comfortable",
  rememberFilters: true,
  keyboardShortcuts: false,
};

const FILTER_STORAGE_PREFIX = "spmFilters:";
const KNOWN_FILTER_KEYS = ["adminUsers", "adminMateriales", "adminSolicitudes"];
const SYSTEM_THEME_MEDIA = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
let systemThemeListener = null;
let keyboardHandler = null;

function storageKeyForFilters(key) {
  return `${FILTER_STORAGE_PREFIX}${key}`;
}

function loadStoredFilters(key, fallback = {}) {
  if (!state.preferences?.rememberFilters) {
    return { ...fallback };
  }
  try {
    const raw = localStorage.getItem(storageKeyForFilters(key));
    if (!raw) {
      return { ...fallback };
    }
    const parsed = JSON.parse(raw);
    return { ...fallback, ...parsed };
  } catch (_err) {
    return { ...fallback };
  }
}

function saveStoredFilters(key, value) {
  if (!state.preferences?.rememberFilters) {
    localStorage.removeItem(storageKeyForFilters(key));
    return;
  }
  try {
    localStorage.setItem(storageKeyForFilters(key), JSON.stringify(value));
  } catch (_err) {
    console.warn("No se pudieron guardar filtros para", key);
  }
}

function clearStoredFilters(key) {
  localStorage.removeItem(storageKeyForFilters(key));
}

function clearAllStoredFilters() {
  KNOWN_FILTER_KEYS.forEach((key) => clearStoredFilters(key));
}

function statusBadge(status) {
  const normalized = (status || "").toLowerCase();
  const fallback = normalized ? normalized.replace(/_/g, " ") : "—";
  const label = STATUS_LABELS[normalized] || fallback;
  const pretty = STATUS_LABELS[normalized]
    ? label
    : label.charAt(0).toUpperCase() + label.slice(1);
  return `<span class="status-pill status-${normalized || "desconocido"}">${pretty}</span>`;
}

const DEFAULT_CENTROS = ["1008", "1050", "1500"];

const DEFAULT_ALMACENES_VIRTUALES = [
  { id: "AV-CENTRAL", label: "AV-CENTRAL - Almacén Central" },
  { id: "AV-MANT", label: "AV-MANT - Depósito de Mantenimiento" },
  { id: "AV-REP", label: "AV-REP - Repuestos Críticos" },
  { id: "AV-SERV", label: "AV-SERV - Servicios Industriales" },
];

const MATERIAL_SUGGESTION_LIMIT = 100000;

const ADMIN_CONFIG_FIELDS = {
  centros: ["codigo", "nombre", "descripcion", "notas", "activo"],
  almacenes: ["codigo", "nombre", "centro_codigo", "descripcion", "activo"],
  roles: ["nombre", "descripcion", "activo"],
  puestos: ["nombre", "descripcion", "activo"],
  sectores: ["nombre", "descripcion", "activo"],
};

const ADMIN_CONFIG_TABLE_FIELDS = {
  centros: ["codigo", "nombre", "descripcion", "notas", "activo"],
  almacenes: ["codigo", "nombre", "centro_codigo", "descripcion", "activo"],
  roles: ["nombre", "descripcion", "activo"],
  puestos: ["nombre", "descripcion", "activo"],
  sectores: ["nombre", "descripcion", "activo"],
};

const ADMIN_CONFIG_LABELS = {
  centros: "centro logístico",
  almacenes: "almacén virtual",
  roles: "rol",
  puestos: "puesto",
  sectores: "sector",
};

const CATALOG_KEYS = ["centros", "almacenes", "roles", "puestos", "sectores"];

function getCatalogItems(resource, { activeOnly = true } = {}) {
  if (!resource) {
    return [];
  }
  const items = Array.isArray(state.catalogs?.[resource]) ? state.catalogs[resource] : [];
  if (!activeOnly) {
    return [...items];
  }
  return items.filter((item) => item && item.activo !== false);
}

function setCatalogItems(resource, items) {
  if (!resource) {
    return;
  }
  state.catalogs[resource] = Array.isArray(items) ? items : [];
  refreshCatalogConsumers(resource);
}

function ensureCatalogDefaults(data = {}) {
  CATALOG_KEYS.forEach((key) => {
    if (!Array.isArray(data[key])) {
      data[key] = [];
    }
  });
  return data;
}

function updateDatalist(nodeId, values) {
  const node = document.getElementById(nodeId);
  if (!node) {
    return;
  }
  const unique = Array.from(new Set(values.filter(Boolean)));
  node.innerHTML = unique.map((value) => `<option value="${escapeHtml(value)}"></option>`).join("");
}

function refreshCatalogConsumers(resource = null) {
  const targets = resource ? [resource] : CATALOG_KEYS;
  if (targets.includes("roles")) {
    updateDatalist("catalogRolesList", getCatalogItems("roles", { activeOnly: true }).map((item) => item.nombre));
  }
  if (targets.includes("puestos")) {
    updateDatalist("catalogPuestosList", getCatalogItems("puestos", { activeOnly: true }).map((item) => item.nombre));
  }
  if (targets.includes("sectores")) {
    updateDatalist("catalogSectoresList", getCatalogItems("sectores", { activeOnly: true }).map((item) => item.nombre));
  }
}

async function loadCatalogData(resource = null, { silent = false, includeInactive = false } = {}) {
  if (!state.me) {
    return null;
  }
  try {
    const params = new URLSearchParams();
    if (includeInactive) {
      params.set("include_inactive", "1");
    }
    if (resource) {
      const endpoint = params.size ? `/catalogos/${resource}?${params.toString()}` : `/catalogos/${resource}`;
      const resp = await api(endpoint);
      if (!resp?.ok) {
        throw new Error(resp?.error?.message || "No se pudo cargar el catálogo");
      }
      setCatalogItems(resource, resp.items || []);
      if (!silent) {
        toast(`Catálogo de ${adminConfigLabel(resource)} actualizado`, true);
      }
      return resp.items || [];
    }
    const endpoint = params.size ? `/catalogos?${params.toString()}` : "/catalogos";
    const resp = await api(endpoint);
    if (!resp?.ok) {
      throw new Error(resp?.error?.message || "No se pudo cargar la configuración");
    }
    const normalized = ensureCatalogDefaults(resp.data || {});
    CATALOG_KEYS.forEach((key) => {
      setCatalogItems(key, normalized[key]);
    });
    if (!silent) {
      toast("Catálogos sincronizados", true);
    }
    return normalized;
  } catch (err) {
    console.error(err);
    if (!silent) {
      toast(err.message || "No se pudieron cargar los catálogos");
    }
    return null;
  }
}

function catalogueOptionLabel(code, name, extra) {
  const parts = [code];
  const printableName = (name || "").trim();
  if (printableName && printableName.toUpperCase() !== String(code || "").toUpperCase()) {
    parts.push(printableName);
  }
  if (extra) {
    parts.push(extra);
  }
  return parts.join(" — ");
}

function buildCentroOptions() {
  const centrosUsuario = Array.isArray(state.me?.centros)
    ? state.me.centros
    : parseCentrosList(state.me?.centros);
  const catalogCentros = getCatalogItems("centros", { activeOnly: true });
  const seen = new Set();
  const options = [];
  const addCentro = (codigo) => {
    const value = (codigo || "").trim();
    if (!value) {
      return;
    }
    const key = value.toUpperCase();
    if (seen.has(key)) {
      return;
    }
    const match = catalogCentros.find((item) => String(item.codigo).toUpperCase() === key);
    const label = match ? catalogueOptionLabel(match.codigo, match.nombre, null) : value;
    options.push({ value, label });
    seen.add(key);
  };
  centrosUsuario.forEach(addCentro);
  catalogCentros.forEach((item) => addCentro(item.codigo));
  if (!options.length) {
    DEFAULT_CENTROS.forEach(addCentro);
  }
  return options;
}

function buildAlmacenOptions() {
  const catalogAlmacenes = getCatalogItems("almacenes", { activeOnly: true });
  const seen = new Set();
  const options = [];
  const addAlmacen = (item) => {
    if (!item) {
      return;
    }
    const codigo = (item.codigo || item.id || "").trim();
    if (!codigo) {
      return;
    }
    const key = codigo.toUpperCase();
    if (seen.has(key)) {
      return;
    }
    const centroLabel = item.centro_codigo ? `Centro ${item.centro_codigo}` : null;
    const label = catalogueOptionLabel(codigo, item.nombre, centroLabel);
    options.push({ value: codigo, label });
    seen.add(key);
  };
  catalogAlmacenes.forEach(addAlmacen);
  if (!options.length) {
    DEFAULT_ALMACENES_VIRTUALES.forEach((almacen) => addAlmacen({ codigo: almacen.id, nombre: almacen.label }));
  }
  return options;
}

function getDefaultCentroValue() {
  const options = buildCentroOptions();
  return options[0]?.value || DEFAULT_CENTROS[0] || "";
}

function getDefaultAlmacenValue() {
  const options = buildAlmacenOptions();
  return options[0]?.value || DEFAULT_ALMACENES_VIRTUALES[0]?.id || "";
}

const CHAT_HISTORY_LIMIT = 12;

function parseCentrosList(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  return String(value)
    .replace(/;/g, ",")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function normalizeMaterial(raw) {
  if (!raw) return null;
  return {
    codigo: raw.codigo,
    descripcion: raw.descripcion,
    descripcion_larga: (raw.descripcion_larga || raw.textocompletomaterialespanol || "").trim(),
    unidad: raw.unidad || raw.unidad_medida || raw.uom || "",
    precio: Number(raw.precio_usd ?? raw.precio ?? raw.precio_unitario ?? 0),
  };
}

function cloneItems(items) {
  return (items || []).map((item) => ({ ...item }));
}

function renderCart(items) {
  const tbody = $("#tbl tbody");
  if (!tbody) return;
  tbody.innerHTML = "";
  let total = 0;
  items.forEach((item, index) => {
    const cantidad = Math.max(1, Number(item.cantidad) || 1);
    const precio = Number(item.precio ?? 0);
    const subtotal = cantidad * precio;
    total += subtotal;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${item.codigo}</td>
      <td>${item.descripcion || ""}</td>
      <td>${item.unidad || "—"}</td>
      <td>${formatCurrency(precio)}</td>
      <td><input type="number" min="1" value="${cantidad}" data-index="${index}" class="qty-input"></td>
      <td>${formatCurrency(subtotal)}</td>
      <td><button class="btn" data-index="${index}">Quitar</button></td>
    `;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll(".qty-input").forEach((input) => {
    input.addEventListener("change", (event) => {
      const idx = Number(event.target.dataset.index);
      const value = Math.max(1, Number(event.target.value) || 1);
      event.target.value = value;
      if (state.items[idx]) {
        state.items[idx].cantidad = value;
        renderCart(state.items);
      }
    });
  });

  tbody.querySelectorAll("button[data-index]").forEach((btn) => {
    btn.addEventListener("click", (event) => {
      event.preventDefault();
      const idx = Number(btn.dataset.index);
      state.items.splice(idx, 1);
      renderCart(state.items);
    });
  });

  const totalSpan = $("#cartTotal");
  if (totalSpan) {
    totalSpan.textContent = formatCurrency(total);
  }

  refreshSortableTables(tbody.closest("table"));
  persistDraftState();
}

function renderList(data) {
  const tbody = $("#list tbody");
  if (!tbody) return;
  tbody.innerHTML = "";
  data.items.forEach((solicitud) => {
    const tr = document.createElement("tr");
    const count = (solicitud.data_json?.items || []).length;
    const statusHtml = statusBadge(solicitud.status);
    tr.innerHTML = `
      <td>${solicitud.id}</td>
      <td>${solicitud.centro}</td>
      <td>${solicitud.sector}</td>
      <td>${new Date(solicitud.created_at).toLocaleString()}</td>
      <td>${statusHtml}</td>
      <td>${count}</td>
    `;
    tr.dataset.id = solicitud.id;
    tr.classList.add("clickable-row");
    tr.addEventListener("click", () => {
      openSolicitudDetail(solicitud.id);
    });
    tbody.appendChild(tr);
  });
  $("#meta").textContent = `Solicitudes (total: ${data.total})`;
  refreshSortableTables(tbody.closest("table"));
}

const state = {
  preferences: null,
  me: null,
  items: [],
  cache: new Map(),
  selected: null,
  selectedSolicitud: null,
  catalogs: {
    centros: [],
    almacenes: [],
    roles: [],
    puestos: [],
    sectores: [],
  },
  notifications: {
    items: [],
    pending: [],
    unread: 0,
  },
  admin: {
    selectedMaterial: null,
    users: [],
    selectedUser: null,
    originalUser: null,
    config: {
      data: {},
      editing: null,
    },
  },
  budget: {
    data: null,
    lastLoadedAt: null,
    increases: null,
  },
  chat: {
    isOpen: false,
    isSending: false,
    messages: [],
  },
};

function updateNotificationBadge() {
  const badge = $("#navNotificationsBadge");
  if (!badge) return;
  const pendingCount = Array.isArray(state.notifications.pending)
    ? state.notifications.pending.length
    : 0;
  const unreadCount = Number(state.notifications.unread || 0);
  const total = unreadCount + pendingCount;
  if (total > 0) {
    badge.textContent = total > 99 ? "99+" : String(total);
    badge.classList.remove("hide");
    badge.classList.add("badge--pulse");
  } else {
    badge.textContent = "0";
    badge.classList.add("hide");
    badge.classList.remove("badge--pulse");
  }
}

async function markNotificationsRead(ids = [], markAll = false) {
  try {
    await api("/notificaciones/marcar", {
      method: "POST",
      body: JSON.stringify({ ids, mark_all: markAll }),
    });
  } catch (err) {
    console.error(err);
  }
}

async function loadNotificationsSummary(options = {}) {
  if (!state.me) return null;
  try {
    const resp = await api("/notificaciones");
    state.notifications.items = Array.isArray(resp.items) ? resp.items : [];
    state.notifications.pending = Array.isArray(resp.pending) ? resp.pending : [];
    state.notifications.unread = Number(resp.unread || 0);
    updateNotificationBadge();

    if (options.markAsRead) {
      const unreadIds = state.notifications.items
        .filter((item) => !item.leido)
        .map((item) => item.id);
      if (unreadIds.length) {
        await markNotificationsRead(unreadIds);
        state.notifications.items = state.notifications.items.map((item) => ({
          ...item,
          leido: true,
        }));
        state.notifications.unread = 0;
        updateNotificationBadge();
      }
    }

    return {
      items: state.notifications.items,
      pending: state.notifications.pending,
      unread: state.notifications.unread,
    };
  } catch (err) {
    console.error(err);
    return null;
  }
}

function openSolicitudFromNotifications(id) {
  if (!id) {
    return;
  }
  sessionStorage.setItem(PENDING_SOLICITUD_KEY, String(id));
  window.location.href = "mis-solicitudes.html";
}

async function decideSolicitudDecision(id, action, triggerBtn) {
  if (!id || !action) {
    return;
  }

  if (action === "ver") {
    openSolicitudFromNotifications(id);
    return;
  }

  const numericId = Number(id);
  if (!Number.isFinite(numericId) || numericId <= 0) {
    return;
  }

  let comentario = null;
  if (action === "aprobar") {
    const confirmed = window.confirm(`¿Confirmás aprobar la solicitud #${numericId}?`);
    if (!confirmed) {
      return;
    }
  } else if (action === "rechazar") {
    const reason = window.prompt(`Motivo del rechazo para la solicitud #${numericId} (opcional):`, "");
    if (reason === null) {
      return;
    }
    comentario = reason.trim() || null;
    const confirmed = window.confirm(`¿Confirmás rechazar la solicitud #${numericId}?`);
    if (!confirmed) {
      return;
    }
  } else {
    return;
  }

  if (triggerBtn) {
    triggerBtn.disabled = true;
  }

  try {
    const body = { accion: action };
    if (comentario) {
      body.comentario = comentario;
    }
    const resp = await api(`/solicitudes/${numericId}/decidir`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    if (!resp?.ok) {
      throw new Error(resp?.error?.message || "No se pudo registrar la decisión");
    }
    const status = (resp.status || "").toLowerCase();
    let okMsg = "Decisión registrada";
    if (status === "aprobada") {
      okMsg = "Solicitud aprobada";
    } else if (status === "rechazada") {
      okMsg = "Solicitud rechazada";
    }
    toast(okMsg, true);
    const updated = await loadNotificationsSummary({ markAsRead: true });
    renderNotificationsPage(updated);
  } catch (err) {
    toast(err.message || "No se pudo registrar la decisión");
  } finally {
    if (triggerBtn) {
      triggerBtn.disabled = false;
    }
  }
}

function bindPendingApprovalActions() {
  const table = document.getElementById("pendingApprovalsTable");
  if (!table || table.dataset.actionsBound === "1") {
    return;
  }
  table.dataset.actionsBound = "1";
  table.addEventListener("click", async (event) => {
    const button = event.target?.closest?.("button[data-action]");
    if (!button) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const action = button.dataset.action;
    const id = button.dataset.id;
    await decideSolicitudDecision(id, action, button);
  });
}

function renderNotificationsPage(data) {

  const items = data?.items ?? state.notifications.items;
  const pending = data?.pending ?? state.notifications.pending;
  const container = document.getElementById("notificationsContainer");
  const empty = document.getElementById("notificationsEmpty");
  if (container) {
    container.innerHTML = "";
    if (items && items.length) {
      container.style.display = "grid";
      if (empty) empty.style.display = "none";
      items.forEach((notif) => {
        const node = document.createElement("article");
        node.className = `notification-item${notif.leido ? "" : " unread"}`;

        const header = document.createElement("div");
        header.className = "notification-item-header";
        const createdAt = formatDateTime(notif.created_at);
        header.innerHTML = `<span>${escapeHtml(notif.mensaje || "Notificación")}</span><time>${createdAt}</time>`;
        node.appendChild(header);

        if (notif.solicitud_id) {
          const actions = document.createElement("div");
          actions.className = "notification-actions";
          const button = document.createElement("button");
          button.type = "button";
          button.className = "btn";
          button.textContent = "Ver solicitud";
          button.addEventListener("click", (ev) => {
            ev.preventDefault();
            openSolicitudFromNotifications(notif.solicitud_id);
          });
          actions.appendChild(button);
          node.appendChild(actions);
        }

        container.appendChild(node);
      });
    } else {
      container.style.display = "none";
      if (empty) empty.style.display = "block";
    }
  }

  const pendingSection = document.getElementById("pendingApprovalsSection");
  const pendingTable = document.querySelector("#pendingApprovalsTable tbody");
  const pendingEmpty = document.getElementById("pendingApprovalsEmpty");
  const isAprobador = typeof state.me?.rol === "string" && state.me.rol.toLowerCase().includes("aprobador");

  if (!pendingSection) {
    return;
  }

  if (!isAprobador && (!pending || !pending.length)) {
    pendingSection.style.display = "none";
    return;
  }

  pendingSection.style.display = "block";
  if (pendingTable) {
    pendingTable.innerHTML = "";
  }

  if (pending && pending.length) {
    if (pendingTable) {
      pending.forEach((row) => {
        const tr = document.createElement("tr");
        const createdAt = formatDateTime(row.created_at);
        const monto = Number(row.total_monto || 0);
        tr.innerHTML = `
          <td>#${row.id}</td>
          <td>${escapeHtml(row.centro || "—")}</td>
          <td>${escapeHtml(row.sector || "—")}</td>
          <td>${escapeHtml(row.justificacion || "—")}</td>
          <td data-sort="${monto}">${formatCurrency(monto)}</td>
          <td data-sort="${row.created_at || ""}">${createdAt}</td>
          <td class="pending-actions">
            <div class="table-actions">
              <button type="button" class="btn pri btn-sm" data-action="aprobar" data-id="${row.id}">Aprobar</button>
              <button type="button" class="btn danger btn-sm" data-action="rechazar" data-id="${row.id}">Rechazar</button>
              <button type="button" class="btn sec btn-sm" data-action="ver" data-id="${row.id}">Ver</button>
            </div>
          </td>
        `;
        tr.classList.add("clickable-row");
        tr.addEventListener("click", () => openSolicitudFromNotifications(row.id));
        pendingTable.appendChild(tr);
      });
    }
    const tableWrapper = document.getElementById("pendingApprovalsTable");
    if (tableWrapper) tableWrapper.style.display = "block";
    if (pendingEmpty) pendingEmpty.style.display = "none";
  } else {
    const tableWrapper = document.getElementById("pendingApprovalsTable");
    if (tableWrapper) tableWrapper.style.display = "none";
    if (pendingEmpty) pendingEmpty.style.display = "block";
  }

  bindPendingApprovalActions();
  refreshSortableTables(pendingSection);
}

function updateMaterialDetailButton() {
  const btn = $("#btnShowMaterialDetail");
  if (!btn) return;
  const hasDetail = Boolean(state.selected?.descripcion_larga?.trim());
  btn.disabled = !hasDetail;
}

function currentUserId() {
  return state.me?.id || state.me?.id_spm || "";
}

function getDraft() {
  const raw = sessionStorage.getItem("solicitudDraft");
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch (_ignored) {
    sessionStorage.removeItem("solicitudDraft");
    return null;
  }
}

function setDraft(draft) {
  if (!draft) {
    sessionStorage.removeItem("solicitudDraft");
    return;
  }
  sessionStorage.setItem("solicitudDraft", JSON.stringify(draft));
}

function persistDraftState() {
  const draft = getDraft();
  if (!draft) {
    return;
  }
  draft.items = cloneItems(state.items);
  setDraft(draft);
}

async function login() {
  const id = $("#id").value.trim();
  const password = $("#pw").value;
  try {
    await api("/login", {
      method: "POST",
      body: JSON.stringify({ id, password }),
    });
    window.location.href = "home.html";
  } catch (err) {
    toast(err.message);
  }
}

async function register() {
  const id = $("#id").value.trim();
  const password = $("#pw").value;
  if (!id || password.length < 6) {
    toast("Ingrese email/usuario y contraseña (mínimo 6 caracteres)");
    return;
  }
  const nombre = prompt("Nombre:");
  const apellido = prompt("Apellido:");
  if (!nombre || !apellido) {
    toast("Nombre y apellido requeridos");
    return;
  }
  try {
    await api("/register", {
      method: "POST",
      body: JSON.stringify({ id, password, nombre, apellido, rol: "Solicitante" }),
    });
    toast("Usuario registrado ✅. Ahora puede iniciar sesión.", true);
  } catch (err) {
    toast(err.message);
  }
}

function recover() {
  const id = $("#id").value.trim();
  if (!id) {
    toast("Ingrese su ID o email para recuperar la contraseña");
    return;
  }
  const mailto = `mailto:manuelremon@live.com.ar?subject=Recuperaci%C3%B3n%20de%20contrase%C3%B1a&body=Por%20favor%20asistir%20al%20usuario:%20${encodeURIComponent(id)}`;
  window.location.href = mailto;
}

function help() {
  const mailto = `mailto:manuelremon@live.com.ar?subject=Ayuda%20SPM&body=Hola%20Manuel,%20necesito%20ayuda.`;
  window.location.href = mailto;
}

async function me() {
  try {
    const resp = await api("/me");
    state.me = resp.usuario;
    if (state.me) {
      state.me.centros = parseCentrosList(state.me.centros);
      if (typeof state.me.sector !== "string") {
        state.me.sector = state.me.sector ? String(state.me.sector) : "";
      }
      state.me.posicion = state.me.posicion ? String(state.me.posicion) : "";
      state.me.mail = state.me.mail ? String(state.me.mail) : "";
      state.me.telefono = state.me.telefono ? String(state.me.telefono) : "";
      state.me.id_red = state.me.id_red || state.me.id_ypf || "";
      state.me.jefe = state.me.jefe ? String(state.me.jefe) : "";
      state.me.gerente1 = state.me.gerente1 ? String(state.me.gerente1) : "";
      state.me.gerente2 = state.me.gerente2 ? String(state.me.gerente2) : "";
      if (!Array.isArray(state.me.centros)) {
        state.me.centros = parseCentrosList(state.me.centros);
      }
    }
  } catch (_ignored) {
    state.me = null;
  }
}

async function logout() {
  await api("/logout", { method: "POST" });
  state.me = null;
  state.items = [];
  sessionStorage.removeItem("solicitudDraft");
  window.location.href = "index.html";
}

async function addItem() {
  const codeInput = $("#codeSearch");
  const descInput = $("#descSearch");
  const codeSuggest = $("#suggestCode");
  const descSuggest = $("#suggestDesc");
  const code = codeInput?.value.trim() || "";
  const desc = descInput?.value.trim() || "";

  let material = state.selected ? { ...state.selected } : null;

  if (!material) {
    if (!code && !desc) {
      toast("Buscá un material por código o descripción");
      return;
    }
    try {
  const params = new URLSearchParams({ limit: String(MATERIAL_SUGGESTION_LIMIT) });
      if (code) params.set("codigo", code);
      if (desc) params.set("descripcion", desc);
      const results = await api(`/materiales?${params.toString()}`);
      if (!results.length) {
        toast("No se encontraron materiales con ese criterio");
        return;
      }
      if (results.length > 1) {
        toast("Seleccioná un material de la lista sugerida");
        if (code) state.cache.set(`codigo:${code.toLowerCase()}`, results);
        if (desc) state.cache.set(`descripcion:${desc.toLowerCase()}`, results);
        showMaterialSuggestions(codeSuggest, results, codeSuggest, descSuggest);
        showMaterialSuggestions(descSuggest, results, codeSuggest, descSuggest);
        return;
      }
      material = normalizeMaterial(results[0]);
    } catch (err) {
      toast(err.message);
      return;
    }
  }

  if (!material) {
    toast("Seleccioná un material válido");
    return;
  }

  const existing = state.items.findIndex((item) => item.codigo === material.codigo);
  if (existing >= 0) {
    state.items[existing].cantidad = Math.max(1, Number(state.items[existing].cantidad) || 1) + 1;
  } else {
    state.items.push({
      codigo: material.codigo,
      descripcion: material.descripcion,
      unidad: material.unidad || "",
      precio: Number(material.precio || 0),
      cantidad: 1,
    });
  }

  if (codeInput) codeInput.value = "";
  if (descInput) descInput.value = "";
  hide(codeSuggest);
  hide(descSuggest);
  state.selected = null;
  updateMaterialDetailButton();
  renderCart(state.items);
}

async function recreateDraft(latestDraft, latestUserId) {
  if (!latestDraft?.header || !latestUserId) {
    return null;
  }
  const almacenVirtual =
  latestDraft.header.almacen_virtual || getDefaultAlmacenValue() || "";
  if (!almacenVirtual) {
    toast("No se pudo determinar el almacén virtual del borrador");
    return null;
  }
  const criticidad = latestDraft.header.criticidad || "Normal";
  const fechaNecesidad =
    latestDraft.header.fecha_necesidad || new Date().toISOString().split("T")[0];
  try {
    const payload = {
      id_usuario: latestUserId,
      centro: latestDraft.header.centro,
      sector: latestDraft.header.sector,
      justificacion: latestDraft.header.justificacion,
      centro_costos: latestDraft.header.centro_costos,
      almacen_virtual: almacenVirtual,
      criticidad,
      fecha_necesidad: fechaNecesidad,
    };
    const resp = await api("/solicitudes/drafts", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    const header = {
      ...latestDraft.header,
      almacen_virtual: almacenVirtual,
      criticidad,
      fecha_necesidad: fechaNecesidad,
    };
    const newDraft = {
      id: resp.id,
      header,
      items: cloneItems(state.items),
      user: latestUserId,
    };
    setDraft(newDraft);
    const idDisplay = $("#solicitudIdDisplay");
    if (idDisplay) {
      idDisplay.textContent = `#${resp.id}`;
    }
    toast("Se recreó la solicitud. Intentá nuevamente.", true);
    return resp.id;
  } catch (err) {
    toast(err.message);
    return null;
  }
}

async function saveDraft(isRetry = false) {
  const latestDraft = getDraft();
  if (!latestDraft || !latestDraft.header) {
    toast("No se encontró el encabezado de la solicitud");
    return;
  }
  const latestUserId = currentUserId();
  if (!latestUserId) {
    toast("No se pudo identificar al usuario actual");
    return;
  }
  const almacenVirtual =
  latestDraft.header.almacen_virtual || getDefaultAlmacenValue() || "";
  if (!almacenVirtual) {
    toast("Seleccioná un almacén virtual en el paso anterior");
    return;
  }
  const criticidad = latestDraft.header.criticidad || "Normal";
  const fechaNecesidad =
    latestDraft.header.fecha_necesidad || new Date().toISOString().split("T")[0];
  const payloadItems = state.items.map((item) => ({
    codigo: item.codigo,
    descripcion: item.descripcion,
    cantidad: Math.max(1, Number(item.cantidad) || 1),
    precio_unitario: Number(item.precio ?? 0),
    unidad: item.unidad || "",
  }));
  const body = {
    id_usuario: latestUserId,
    centro: latestDraft.header.centro,
    sector: latestDraft.header.sector,
    justificacion: latestDraft.header.justificacion,
    centro_costos: latestDraft.header.centro_costos,
    almacen_virtual: almacenVirtual,
    criticidad,
    fecha_necesidad: fechaNecesidad,
    items: payloadItems,
  };
  const btn = $("#btnSaveDraft");
  if (btn) btn.disabled = true;
  try {
    await api(`/solicitudes/${latestDraft.id}/draft`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
    setDraft({
      ...latestDraft,
      header: {
        ...latestDraft.header,
        almacen_virtual: almacenVirtual,
        criticidad,
        fecha_necesidad: fechaNecesidad,
      },
      items: cloneItems(state.items),
    });
    toast("Borrador guardado", true);
  } catch (err) {
    if (!isRetry && isNotFoundError(err)) {
      const recreatedId = await recreateDraft(latestDraft, latestUserId);
      if (recreatedId) {
        await saveDraft(true);
        return;
      }
    }
    toast(err.message);
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function refresh() {
  try {
    const resp = await api("/solicitudes");
    renderList(resp);
    return resp;
  } catch (err) {
    toast(err.message);
    return null;
  }
}

function renderSolicitudDetail(detail) {
  const idEl = $("#detailId");
  const statusEl = $("#detailStatus");
  const centroEl = $("#detailCentro");
  const sectorEl = $("#detailSector");
  const centroCostosEl = $("#detailCentroCostos");
  const almacenEl = $("#detailAlmacen");
  const criticidadEl = $("#detailCriticidad");
  const fechaEl = $("#detailFechaNecesidad");
  const justEl = $("#detailJustificacion");
  const createdEl = $("#detailCreated");
  const updatedEl = $("#detailUpdated");
  const totalEl = $("#detailTotal");
    const cancelInfo = $("#detailCancelInfo"); // This line is unchanged
  const itemsTbody = $("#detailItems tbody");
  if (!itemsTbody) return;

  idEl.textContent = `#${detail.id}`;
  statusEl.innerHTML = statusBadge(detail.status);
  centroEl.textContent = detail.centro || "—";
  sectorEl.textContent = detail.sector || "—";
  centroCostosEl.textContent = detail.centro_costos || "—";
  if (almacenEl) {
    almacenEl.textContent = detail.almacen_virtual || "—";
  }
  if (criticidadEl) {
    criticidadEl.textContent = detail.criticidad || "—";
  }
  if (fechaEl) {
    if (detail.fecha_necesidad) {
      const fecha = new Date(detail.fecha_necesidad);
      fechaEl.textContent = Number.isNaN(fecha.getTime())
        ? detail.fecha_necesidad
        : fecha.toLocaleDateString();
    } else {
      fechaEl.textContent = "—";
    }
  }
  justEl.textContent = detail.justificacion || "—";
  createdEl.textContent = detail.created_at ? new Date(detail.created_at).toLocaleString() : "—";
  updatedEl.textContent = detail.updated_at ? new Date(detail.updated_at).toLocaleString() : "—";
  totalEl.textContent = formatCurrency(detail.total_monto || 0);

  const cancelRequest = detail.cancel_request || null;
  cancelInfo.classList.add("hide");
  cancelInfo.textContent = "";
  if (detail.status === "cancelada") {
    const reason = detail.cancel_reason ? `Motivo: ${detail.cancel_reason}` : "Sin motivo indicado";
    const when = detail.cancelled_at ? ` · ${formatDateTime(detail.cancelled_at)}` : "";
    cancelInfo.textContent = `${reason}${when}`;
    cancelInfo.classList.remove("hide");
  } else if (cancelRequest && cancelRequest.status === "pendiente") {
    const when = cancelRequest.requested_at ? formatDateTime(cancelRequest.requested_at) : "";
    const reason = cancelRequest.reason ? `Motivo: ${cancelRequest.reason}` : "Sin motivo indicado";
    cancelInfo.textContent = `Cancelación solicitada${when ? ` el ${when}` : ""}. ${reason}. Pendiente de planificador.`;
    cancelInfo.classList.remove("hide");
  } else if (cancelRequest && cancelRequest.status === "rechazada") {
    const when = cancelRequest.decision_at ? formatDateTime(cancelRequest.decision_at) : "";
    const comment = cancelRequest.decision_comment ? ` Motivo del rechazo: ${cancelRequest.decision_comment}.` : "";
    cancelInfo.textContent = `Se rechazó la cancelación${when ? ` el ${when}` : ""}.${comment}`;
    cancelInfo.classList.remove("hide");
  }

  itemsTbody.innerHTML = "";
  if (!detail.items || !detail.items.length) {
    const emptyRow = document.createElement("tr");
    emptyRow.innerHTML = '<td colspan="6" class="muted">Sin ítems registrados</td>';
    itemsTbody.appendChild(emptyRow);
  } else {
    detail.items.forEach((item) => {
      const tr = document.createElement("tr");
      const cantidad = Number(item.cantidad ?? 0);
      const cantidadFmt = Number.isFinite(cantidad)
        ? cantidad.toLocaleString("es-AR")
        : item.cantidad || "—";
      tr.innerHTML = `
        <td>${item.codigo || "—"}</td>
        <td>${item.descripcion || ""}</td>
        <td>${item.unidad || "—"}</td>
        <td>${formatCurrency(item.precio_unitario)}</td>
        <td>${cantidadFmt}</td>
        <td>${formatCurrency(item.subtotal)}</td>
      `;
      itemsTbody.appendChild(tr);
    });
  }

  refreshSortableTables(itemsTbody.closest("table"));

  const cancelBtn = $("#btnRequestCancel");
  if (cancelBtn) {
    if (detail.status === "cancelada") {
      cancelBtn.disabled = true;
      cancelBtn.textContent = "Solicitud cancelada";
    } else if (detail.status === "cancelacion_pendiente") {
      cancelBtn.disabled = true;
      cancelBtn.textContent = "Cancelación pendiente";
    } else if (detail.status === "draft") {
      cancelBtn.disabled = true;
      cancelBtn.textContent = "Enviá la solicitud para cancelarla";
    } else {
      cancelBtn.disabled = false;
      cancelBtn.textContent = "Solicitar cancelación";
    }
  }

  const editDraftBtn = $("#btnEditDraft");
  if (editDraftBtn) {
    const canEditDraft = detail.status === "draft";
    editDraftBtn.classList.toggle("hide", !canEditDraft);
    editDraftBtn.disabled = !canEditDraft;
  }
}

async function openSolicitudDetail(id) {
  const modal = $("#solicitudDetailModal");
  if (!modal) return;
  modal.classList.remove("hide");
  const itemsTbody = $("#detailItems tbody");
  if (itemsTbody) {
    itemsTbody.innerHTML = '<tr><td colspan="5" class="muted">Cargando...</td></tr>';
  }
  try {
    const response = await api(`/solicitudes/${id}`);
    const detail = response?.solicitud && typeof response.solicitud === "object"
      ? response.solicitud
      : response; // fallback for legacy/direct responses
    if (!detail || typeof detail !== "object") {
      throw new Error("No se pudo cargar la solicitud");
    }
    state.selectedSolicitud = detail;
    renderSolicitudDetail(detail);
  } catch (err) {
    toast(err.message);
    closeSolicitudDetailModal();
  }
}

function closeSolicitudDetailModal() {
  const modal = $("#solicitudDetailModal");
  if (!modal) return;
  modal.classList.add("hide");
  state.selectedSolicitud = null;
  const cancelBtn = $("#btnRequestCancel");
  if (cancelBtn) {
    cancelBtn.disabled = false;
    cancelBtn.textContent = "Solicitar cancelación";
  }
  const editBtn = $("#btnEditDraft");
  if (editBtn) {
    editBtn.classList.add("hide");
    editBtn.disabled = false;
  }
  const itemsTbody = $("#detailItems tbody");
  if (itemsTbody) {
    itemsTbody.innerHTML = "";
  }
}

async function requestCancelSelectedSolicitud() {
  const detail = state.selectedSolicitud;
  if (!detail) return;
  if (detail.status === "cancelada") {
    toast("La solicitud ya está cancelada");
    return;
  }
  const reason = prompt("Motivo de cancelación (opcional):", detail.cancel_reason || "");
  if (reason === null) {
    return;
  }
  const cancelBtn = $("#btnRequestCancel");
  if (cancelBtn) cancelBtn.disabled = true;
  try {
    const response = await api(`/solicitudes/${detail.id}/cancel`, {
      method: "PATCH",
      body: JSON.stringify({ reason }),
    });
    if (response?.status === "cancelacion_pendiente") {
      toast("Cancelación enviada. Pendiente de aprobación del planificador.", true);
    } else {
      toast("Solicitud cancelada", true);
    }
    const updatedResponse = await api(`/solicitudes/${detail.id}`);
    const updated = updatedResponse?.solicitud && typeof updatedResponse.solicitud === "object"
      ? updatedResponse.solicitud
      : updatedResponse;
    state.selectedSolicitud = updated;
    renderSolicitudDetail(updated);
    refresh();
  } catch (err) {
    toast(err.message);
  } finally {
    if (cancelBtn) cancelBtn.disabled = false;
  }
}

function resumeDraftFromDetail() {
  const detail = state.selectedSolicitud;
  if (!detail || detail.status !== "draft") {
    toast("Solo podés editar solicitudes en borrador");
    return;
  }
  const userId = currentUserId();
  if (!userId) {
    toast("No se pudo identificar al usuario actual");
    return;
  }
  const header = {
    centro: detail.centro || "",
    sector: detail.sector || "",
    justificacion: detail.justificacion || "",
    centro_costos: detail.centro_costos || "",
    almacen_virtual: detail.almacen_virtual || "",
    criticidad: detail.criticidad || "Normal",
    fecha_necesidad: detail.fecha_necesidad || new Date().toISOString().split("T")[0],
  };
  const items = Array.isArray(detail.items)
    ? detail.items.map((item) => ({
        codigo: item.codigo,
        descripcion: item.descripcion,
        unidad: item.unidad || "",
        precio: Number(item.precio_unitario ?? item.precio ?? 0),
        cantidad: Math.max(1, Number(item.cantidad) || 1),
      }))
    : [];
  setDraft({ id: detail.id, header, items, user: userId });
  closeSolicitudDetailModal();
  toast(`Borrador ${detail.id} listo para editar`, true);
  window.location.href = "agregar-materiales.html";
}

function showMaterialSuggestions(container, items, codeSuggest, descSuggest) {
  if (!container) return;
  container.innerHTML = "";
  if (!items || !items.length) {
    hide(container);
    return;
  }
  const codeInput = $("#codeSearch");
  const descInput = $("#descSearch");
  if (items.length === 1) {
    const single = normalizeMaterial(items[0]);
    state.selected = single;
    if (codeInput) codeInput.value = single.codigo;
    if (descInput) descInput.value = single.descripcion;
    updateMaterialDetailButton();
  }
  items.forEach((material) => {
    const normalized = normalizeMaterial(material);
    const option = document.createElement("div");
    option.textContent = `${normalized.codigo} · ${normalized.descripcion}`;
    option.onclick = () => {
      if (codeInput) codeInput.value = normalized.codigo;
      if (descInput) descInput.value = normalized.descripcion;
      state.selected = normalized;
      updateMaterialDetailButton();
      hide(container);
      if (container !== codeSuggest) hide(codeSuggest);
      if (container !== descSuggest) hide(descSuggest);
    };
    container.appendChild(option);
  });
  show(container);
}

function setupMaterialSearch() {
  const codeInput = $("#codeSearch");
  const descInput = $("#descSearch");
  const codeSuggest = $("#suggestCode");
  const descSuggest = $("#suggestDesc");

  const attach = (input, suggest, key) => {
    if (!input || !suggest) return;
    let debounceId = null;
    input.addEventListener("input", (event) => {
      const term = event.target.value.trim();
      state.selected = null;
      updateMaterialDetailButton();
  if (!term || term.length < 1) {
        hide(suggest);
        return;
      }
      clearTimeout(debounceId);
      debounceId = setTimeout(async () => {
        try {
          const cacheKey = `${key}:${term.toLowerCase()}`;
          if (state.cache.has(cacheKey)) {
            showMaterialSuggestions(suggest, state.cache.get(cacheKey), codeSuggest, descSuggest);
            return;
          }
          const params = new URLSearchParams({ limit: String(MATERIAL_SUGGESTION_LIMIT) });
          params.set(key, term);
          const items = await api(`/materiales?${params.toString()}`);
          state.cache.set(cacheKey, items);
          showMaterialSuggestions(suggest, items, codeSuggest, descSuggest);
        } catch (_ignored) {
          hide(suggest);
        }
      }, 220);
    });

    input.addEventListener("focus", () => {
      const term = input.value.trim();
      if (!term) return;
      const cacheKey = `${key}:${term.toLowerCase()}`;
      if (state.cache.has(cacheKey)) {
        showMaterialSuggestions(suggest, state.cache.get(cacheKey), codeSuggest, descSuggest);
      }
    });
  };

  attach(codeInput, codeSuggest, "codigo");
  attach(descInput, descSuggest, "descripcion");
}

function openMaterialDetailModal() {
  const material = state.selected;
  if (!material || !material.descripcion_larga?.trim()) {
    toast("Seleccioná un material con detalle disponible");
    return;
  }
  const modal = $("#materialDetailModal");
  const title = $("#materialDetailTitle");
  const body = $("#materialDetailBody");
  if (!modal || !title || !body) {
    return;
  }
  title.textContent = `${material.codigo} · ${material.descripcion}`;
  body.textContent = material.descripcion_larga;
  modal.classList.remove("hide");
}

function closeMaterialDetailModal() {
  const modal = $("#materialDetailModal");
  if (!modal) return;
  modal.classList.add("hide");
}

function accountSupportMail(subject, bodyLines) {
  const to = "manuelremon@live.com.ar";
  const body = encodeURIComponent((bodyLines || []).filter(Boolean).join("\n"));
  const mailto = `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${body}`;
  window.location.href = mailto;
}

function requestPasswordChange() {
  if (!state.me) {
    toast("Iniciá sesión para gestionar tu contraseña");
    return;
  }
  const identifier = state.me.id || state.me.id_spm || "";
  accountSupportMail("Solicitud de cambio de contraseña SPM", [
    "Hola equipo SPM,",
    "Quisiera gestionar un cambio de contraseña.",
    identifier ? `ID SPM: ${identifier}` : "",
    state.me.mail ? `Correo registrado: ${state.me.mail}` : "",
  ]);
}

function requestAccountDeletion() {
  if (!state.me) {
    toast("Iniciá sesión para gestionar tu cuenta");
    return;
  }
  const identifier = state.me.id || state.me.id_spm || "";
  accountSupportMail("Solicitud de baja de cuenta SPM", [
    "Hola equipo SPM,",
    "Solicito eliminar mi cuenta de SPM.",
    identifier ? `ID SPM: ${identifier}` : "",
    state.me.mail ? `Correo registrado: ${state.me.mail}` : "",
  ]);
}

async function handleEditPhone() {
  if (!state.me) {
    toast("Iniciá sesión para gestionar tu teléfono");
    return;
  }
  const current = state.me.telefono || "";
  const nextValue = prompt("Actualizá tu número de contacto", current);
  if (nextValue === null) {
    return;
  }
  const trimmed = nextValue.trim();
  if (!trimmed) {
    toast("Ingresá un teléfono válido");
    return;
  }
  try {
    const sanitized = trimmed.replace(/\s+/g, " ");
    const resp = await api("/me/telefono", {
      method: "POST",
      body: JSON.stringify({ telefono: sanitized }),
    });
    state.me.telefono = resp.telefono || sanitized;
    renderAccountDetails();
    toast("Teléfono actualizado", true);
  } catch (err) {
    toast(err.message);
  }
}

async function handleRequestAdditionalCenters() {
  if (!state.me) {
    toast("Iniciá sesión para solicitar centros");
    return;
  }
  const centros = prompt("Indicá los centros adicionales que necesitás (separados por coma)");
  if (centros === null) {
    return;
  }
  const trimmedCentros = centros.trim();
  if (!trimmedCentros) {
    toast("Ingresá al menos un centro");
    return;
  }
  const motivo = prompt("Motivo o contexto de la solicitud (opcional)");
  const trimmedMotivo = motivo?.trim() || null;
  try {
    await api("/me/centros/solicitud", {
      method: "POST",
      body: JSON.stringify({ centros: trimmedCentros, motivo: trimmedMotivo }),
    });
    toast("Solicitud enviada al equipo administrador", true);
  } catch (err) {
    toast(err.message);
  }
}

function renderAccountDetails() {
  const container = document.getElementById("accountDetails");
  if (!container || !state.me) {
    return;
  }

  const emailValue = state.me.mail ? String(state.me.mail).trim() : "";
  const phoneValue = state.me.telefono ? String(state.me.telefono).trim() : "";
  const phoneHref = phoneValue ? `tel:${phoneValue.replace(/\s+/g, "")}` : null;

  const details = [
    { label: "ID SPM", value: state.me.id || state.me.id_spm || "—" },
    {
      label: "Nombre y Apellido",
      value: [state.me.nombre, state.me.apellido].filter(Boolean).join(" ") || "—",
    },
    {
      label: "Posición",
      value: state.me.posicion || "—",
    },
    {
      label: "Mail",
      value: emailValue || "—",
      href: emailValue ? `mailto:${emailValue}` : null,
    },
    {
      label: "ID Red",
      value: state.me.id_red || "—",
    },
    {
      label: "Teléfono",
      value: phoneValue || "—",
      href: phoneHref,
    },
    {
      label: "Sector",
      value: state.me.sector || "—",
    },
    {
      label: "Jefe",
      value: state.me.jefe || "—",
      href: state.me.jefe && state.me.jefe.includes("@") ? `mailto:${state.me.jefe}` : null,
    },
    {
      label: "Gerente 1",
      value: state.me.gerente1 || "—",
      href: state.me.gerente1 && state.me.gerente1.includes("@") ? `mailto:${state.me.gerente1}` : null,
    },
    {
      label: "Gerente 2",
      value: state.me.gerente2 || "—",
      href: state.me.gerente2 && state.me.gerente2.includes("@") ? `mailto:${state.me.gerente2}` : null,
    },
  ];

  const detailItems = details
    .map(({ label, value, href }) => {
      const safeLabel = escapeHtml(label);
      const safeValue = escapeHtml(value || "—");
      const valueMarkup = href
        ? `<a class="account-details__link" href="${href}">${safeValue}</a>`
        : `<span class="account-details__value">${safeValue}</span>`;
      return `
        <div class="account-details-grid__item">
          <span class="account-details-grid__label">${safeLabel}</span>
          ${valueMarkup}
        </div>
      `;
    })
    .join("");

  const centersMarkup = Array.isArray(state.me.centros) && state.me.centros.length
    ? state.me.centros
        .map((centro) => `<li>${escapeHtml(String(centro))}</li>`)
        .join("")
    : '<li class="account-details-centers__empty">Sin centros habilitados</li>';

  container.innerHTML = `
    <div class="account-details-grid">
      ${detailItems}
      <div class="account-details-grid__item">
        <span class="account-details-grid__label">Centros habilitados</span>
        <ul class="account-details-centers">${centersMarkup}</ul>
      </div>
    </div>
    <div class="account-details-actions">
      <button type="button" class="btn sec" id="accountEditPhone">Actualizar teléfono</button>
      <button type="button" class="btn sec" id="accountRequestCenters">Solicitar centros adicionales</button>
      <button type="button" class="btn sec" id="accountChangePassword">Cambiar contraseña</button>
      <button type="button" class="btn danger" id="accountDeleteAccount">Eliminar cuenta</button>
    </div>
  `;

  on(document.getElementById("accountEditPhone"), "click", (ev) => {
    ev.preventDefault();
    handleEditPhone();
  });
  on(document.getElementById("accountRequestCenters"), "click", (ev) => {
    ev.preventDefault();
    handleRequestAdditionalCenters();
  });
  on(document.getElementById("accountChangePassword"), "click", (ev) => {
    ev.preventDefault();
    requestPasswordChange();
  });
  on(document.getElementById("accountDeleteAccount"), "click", (ev) => {
    ev.preventDefault();
    requestAccountDeletion();
  });
}

function loadUserPreferences() {
  try {
    const raw = localStorage.getItem(PREFS_STORAGE_KEY);
    if (!raw) {
      return { ...DEFAULT_PREFERENCES };
    }
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_PREFERENCES, ...parsed };
  } catch (_err) {
    return { ...DEFAULT_PREFERENCES };
  }
}

function saveUserPreferences(prefs) {
  try {
    localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(prefs));
    return true;
  } catch (_err) {
    return false;
  }
}

function resolveTheme(theme) {
  if (theme === "dark" || theme === "light") {
    return theme;
  }
  if (SYSTEM_THEME_MEDIA && typeof SYSTEM_THEME_MEDIA.matches === "boolean") {
    return SYSTEM_THEME_MEDIA.matches ? "dark" : "light";
  }
  return "dark";
}

function detachSystemThemeListener() {
  if (SYSTEM_THEME_MEDIA && systemThemeListener) {
    SYSTEM_THEME_MEDIA.removeEventListener("change", systemThemeListener);
    systemThemeListener = null;
  }
}

function attachSystemThemeListener() {
  if (!SYSTEM_THEME_MEDIA || systemThemeListener) {
    return;
  }
  systemThemeListener = () => {
    if ((state.preferences?.theme || "auto") === "auto") {
      document.body.dataset.theme = resolveTheme("auto");
    }
  };
  SYSTEM_THEME_MEDIA.addEventListener("change", systemThemeListener);
}

function handleGlobalShortcuts(event) {
  if (!state.preferences?.keyboardShortcuts) {
    return;
  }
  const target = event.target;
  const tag = target?.tagName;
  const isEditable = tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable;
  if (isEditable && !event.metaKey && !event.ctrlKey) {
    return;
  }
  const key = event.key.toLowerCase();
  const modifiers = {
    ctrl: event.ctrlKey || event.metaKey,
    shift: event.shiftKey,
  };
  if (modifiers.ctrl && modifiers.shift && key === "n") {
    event.preventDefault();
    window.location.href = "crear-solicitud.html";
    return;
  }
  if (modifiers.ctrl && modifiers.shift && key === "m") {
    event.preventDefault();
    window.location.href = "mis-solicitudes.html";
    return;
  }
  if ((event.ctrlKey || event.metaKey) && !event.shiftKey && (key === "," || key === "p")) {
    event.preventDefault();
    window.location.href = "preferencias.html";
  }
}

function updateKeyboardShortcutsBinding() {
  if (state.preferences?.keyboardShortcuts) {
    if (!keyboardHandler) {
      keyboardHandler = handleGlobalShortcuts;
      document.addEventListener("keydown", keyboardHandler);
    }
  } else if (keyboardHandler) {
    document.removeEventListener("keydown", keyboardHandler);
    keyboardHandler = null;
  }
}

function applyPreferences() {
  const prefs = state.preferences || loadUserPreferences();
  state.preferences = prefs;

  if (!document.body) {
    return;
  }

  const resolvedTheme = resolveTheme(prefs.theme);
  document.body.dataset.theme = resolvedTheme;
  if (prefs.theme === "auto") {
    attachSystemThemeListener();
  } else {
    detachSystemThemeListener();
  }

  const allowedDensities = new Set(["compact", "comfortable", "extended"]);
  const density = allowedDensities.has(prefs.density) ? prefs.density : "comfortable";
  document.body.dataset.density = density;

  updateKeyboardShortcutsBinding();

  if (!prefs.rememberFilters) {
    clearAllStoredFilters();
  }
}

applyPreferences();

function renderPreferencesPage() {
  const emailCheckbox = $("#prefEmailAlerts");
  const realtimeCheckbox = $("#prefRealtimeToasts");
  const digestCheckbox = $("#prefApprovalDigest");
  const digestHourInput = $("#prefDigestHour");
  const themeSelect = $("#prefTheme");
  const densitySelect = $("#prefDensity");
  const rememberCheckbox = $("#prefRememberFilters");
  const keyboardCheckbox = $("#prefKeyboardShortcuts");
  const statusLabel = $("#prefStatus");
  const inputs = [
    emailCheckbox,
    realtimeCheckbox,
    digestCheckbox,
    digestHourInput,
    themeSelect,
    densitySelect,
    rememberCheckbox,
    keyboardCheckbox,
  ].filter(Boolean);

  const applyToForm = (current) => {
    if (emailCheckbox) emailCheckbox.checked = Boolean(current.emailAlerts);
    if (realtimeCheckbox) realtimeCheckbox.checked = Boolean(current.realtimeToasts);
    if (digestCheckbox) digestCheckbox.checked = Boolean(current.approvalDigest);
    if (digestHourInput) digestHourInput.value = current.digestHour || DEFAULT_PREFERENCES.digestHour;
    if (digestHourInput) digestHourInput.disabled = !Boolean(current.approvalDigest);
    if (themeSelect) themeSelect.value = current.theme || DEFAULT_PREFERENCES.theme;
    if (densitySelect) densitySelect.value = current.density || DEFAULT_PREFERENCES.density;
    if (rememberCheckbox) rememberCheckbox.checked = Boolean(current.rememberFilters);
    if (keyboardCheckbox) keyboardCheckbox.checked = Boolean(current.keyboardShortcuts);
  };

  let currentPrefs = { ...(state.preferences || loadUserPreferences()) };
  applyToForm(currentPrefs);
  if (statusLabel) statusLabel.textContent = "No hay cambios pendientes.";

  const markDirty = () => {
    if (statusLabel) statusLabel.textContent = "Cambios sin guardar.";
  };

  inputs.forEach((input) => {
    input.addEventListener("change", markDirty);
    if (input === digestCheckbox) {
      input.addEventListener("change", () => {
        if (digestHourInput) {
          digestHourInput.disabled = !digestCheckbox.checked;
        }
      });
    }
  });

  const saveBtn = $("#prefSave");
  if (saveBtn) {
    saveBtn.addEventListener("click", (ev) => {
      ev.preventDefault();
      const updated = {
        emailAlerts: Boolean(emailCheckbox?.checked),
        realtimeToasts: Boolean(realtimeCheckbox?.checked),
        approvalDigest: Boolean(digestCheckbox?.checked),
        digestHour: digestHourInput?.value || DEFAULT_PREFERENCES.digestHour,
        theme: themeSelect?.value || DEFAULT_PREFERENCES.theme,
        density: densitySelect?.value || DEFAULT_PREFERENCES.density,
        rememberFilters: Boolean(rememberCheckbox?.checked),
        keyboardShortcuts: Boolean(keyboardCheckbox?.checked),
      };
      const ok = saveUserPreferences(updated);
      if (ok) {
        currentPrefs = updated;
        state.preferences = { ...updated };
        applyPreferences();
        if (statusLabel) statusLabel.textContent = "Preferencias guardadas.";
        toast("Preferencias actualizadas", true);
      } else if (statusLabel) {
        statusLabel.textContent = "No se pudieron guardar las preferencias.";
      }
    });
  }

  const resetBtn = $("#prefReset");
  if (resetBtn) {
    resetBtn.addEventListener("click", (ev) => {
      ev.preventDefault();
      currentPrefs = { ...DEFAULT_PREFERENCES };
      applyToForm(currentPrefs);
      saveUserPreferences(currentPrefs);
      state.preferences = { ...currentPrefs };
      applyPreferences();
      if (statusLabel) statusLabel.textContent = "Valores restablecidos.";
      toast("Preferencias restablecidas", true);
    });
  }
}

function renderAdminNav() {
  const adminMenuItem = document.getElementById("adminMenuItem");
  if (!adminMenuItem) {
    return;
  }

  if (!isAdmin()) {
    adminMenuItem.classList.add("hide");
    adminMenuItem.innerHTML = "";
    closeSubmenu(adminMenuItem);
    return;
  }

  const current = window.location.pathname.split("/").pop();
  const sections = [
    {
      title: "Paneles y reportes",
      items: [
        { href: "admin-dashboard.html", label: "Panel de control" },
        { href: "admin-reportes.html", label: "Reportes y auditoría" },
      ],
    },
    {
      title: "Gestión operativa",
      items: [
        { href: "admin-solicitudes.html", label: "Solicitudes" },
        { href: "admin-materiales.html", label: "Materiales" },
        { href: "admin-centros.html", label: "Centros" },
        { href: "admin-almacenes.html", label: "Almacenes" },
      ],
    },
    {
      title: "Usuarios y configuración",
      items: [
        { href: "admin-usuarios.html", label: "Usuarios" },
        { href: "admin-configuracion.html", label: "Configuración" },
      ],
    },
  ];

  const groupsHtml = sections
    .map((section) => {
      const links = section.items
        .map((item) => {
          const isActive = current === item.href;
          const activeAttr = isActive ? " data-active=\"true\"" : "";
          return `<a href="${item.href}" class="app-submenu__link" role="menuitem"${activeAttr}>${item.label}</a>`;
        })
        .join("");
      return `
        <div class="app-submenu__item" role="none">
          <p class="app-submenu__title" role="presentation">${section.title}</p>
          ${links}
        </div>
      `;
    })
    .join("");

  adminMenuItem.innerHTML = `
    <button type="button" class="app-menu__trigger" aria-haspopup="true" aria-expanded="false">
      <span>Administración</span>
      <span class="app-menu__caret" aria-hidden="true"></span>
    </button>
    <div class="app-submenu" role="menu" hidden aria-hidden="true">
      ${groupsHtml}
    </div>
  `;

  adminMenuItem.classList.remove("hide");
  adminMenuItem.classList.add("has-submenu");

  const submenu = adminMenuItem.querySelector(":scope > .app-submenu");
  setSubmenuTabState(submenu, false);
  closeSubmenu(adminMenuItem);
}

function isAdmin() {
  return typeof state.me?.rol === "string" && state.me.rol.toLowerCase().includes("admin");
}

function isBudgetManager() {
  const posicion = (state.me?.posicion || "").toLowerCase();
  const role = (state.me?.rol || "").toLowerCase();
  if (!posicion && !role) {
    return false;
  }
  return (
    posicion.includes("gerente") ||
    posicion.includes("jefe") ||
    role.includes("presupuesto") ||
    role.includes("administrador")
  );
}

function canAccessBudgetModule() {
  return isAdmin() || isBudgetManager();
}

function canRequestBudgetIncrease() {
  const posicion = (state.me?.posicion || "").toLowerCase();
  const role = (state.me?.rol || "").toLowerCase();
  return posicion.includes("jefe") || posicion.includes("gerente1") || role.includes("gerente1");
}

function canApproveBudgetIncrease() {
  const posicion = (state.me?.posicion || "").toLowerCase();
  const role = (state.me?.rol || "").toLowerCase();
  return posicion.includes("gerente2") || role.includes("administrador");
}

function configureRoleNavigation() {
  const budgetLink = document.getElementById("navPresupuesto");
  if (!budgetLink) {
    return;
  }
  if (canAccessBudgetModule()) {
    budgetLink.classList.remove("hide");
    const current = window.location.pathname.split("/").pop();
    if (budgetLink.dataset.active === "true" || current === "presupuesto.html") {
      budgetLink.classList.add("active");
    }
  } else {
    budgetLink.classList.add("hide");
    budgetLink.classList.remove("active");
  }
}

function enforceAdminAccess() {
  if (isAdmin()) {
    return true;
  }
  toast("Necesitás permisos de administrador para acceder.");
  window.location.href = "home.html";
  return false;
}

async function loadAdminDashboard() {
  try {
    const data = await api("/admin/summary");
    if (!data?.ok) {
      throw new Error(data?.error?.message || "No se pudo cargar el resumen");
    }
    renderAdminDashboard(data);
  } catch (err) {
    console.error(err);
    toast(err.message || "Error al cargar el resumen");
  }
}

function renderAdminDashboard(data) {
  const totals = data?.totals || {};
  const roles = Array.isArray(data?.roles) ? data.roles : [];
  const recientes = Array.isArray(data?.recientes) ? data.recientes : [];
  const topCentros = Array.isArray(data?.top_centros) ? data.top_centros : [];

  const totalSpan = $("#metricTotalSolicitudes");
  if (totalSpan) {
    totalSpan.textContent = String(totals.solicitudes ?? "0");
  }
  const detalle = $("#metricSolicitudesDetalle");
  if (detalle) {
    const pendientes = totals.pendientes ?? 0;
    const finalizadas = totals.finalizadas ?? 0;
    detalle.textContent = `Pendientes: ${pendientes} · Finalizadas: ${finalizadas}`;
  }
  const usuariosSpan = $("#metricUsuarios");
  if (usuariosSpan) {
    usuariosSpan.textContent = String(totals.usuarios ?? "0");
  }
  const rolesDetalle = $("#metricRolesDetalle");
  if (rolesDetalle) {
    const topRol = roles?.[0]?.rol || "—";
    rolesDetalle.textContent = roles.length ? `${topRol} lidera el total` : "Sin datos";
  }
  const matSpan = $("#metricMateriales");
  if (matSpan) {
    matSpan.textContent = String(totals.materiales ?? "0");
  }

  const rolesList = $("#adminRolesList");
  const rolesEmpty = $("#adminRolesEmpty");
  if (rolesList) {
    rolesList.innerHTML = "";
    if (roles.length) {
      roles.forEach((item) => {
        const li = document.createElement("li");
        li.innerHTML = `<span>${item.rol}</span><strong>${item.cantidad}</strong>`;
        rolesList.appendChild(li);
      });
      if (rolesEmpty) rolesEmpty.style.display = "none";
    } else if (rolesEmpty) {
      rolesEmpty.style.display = "block";
    }
  }

  const recentBody = document.querySelector("#adminRecentTable tbody");
  const recentEmpty = $("#adminRecentEmpty");
  if (recentBody) {
    recentBody.innerHTML = "";
    if (recientes.length) {
      recientes.forEach((row) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>#${row.id}</td>
          <td>${row.solicitante || row.id_usuario || "—"}</td>
          <td>${row.centro || "—"}</td>
          <td>${statusBadge(row.status)}</td>
          <td>${formatCurrency(row.total_monto || 0)}</td>
          <td>${row.created_at ? new Date(row.created_at).toLocaleString() : "—"}</td>
        `;
        recentBody.appendChild(tr);
      });
      if (recentEmpty) recentEmpty.style.display = "none";
    } else if (recentEmpty) {
      recentEmpty.style.display = "block";
    }
  }

  const centrosBody = document.querySelector("#adminTopCentros tbody");
  const centrosEmpty = $("#adminTopCentrosEmpty");
  if (centrosBody) {
    centrosBody.innerHTML = "";
    if (topCentros.length) {
      topCentros.forEach((row) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>${row.centro}</td>
          <td>${row.total ?? 0}</td>
          <td>${formatCurrency(row.monto || 0)}</td>
        `;
        centrosBody.appendChild(tr);
      });
      if (centrosEmpty) centrosEmpty.style.display = "none";
    } else if (centrosEmpty) {
      centrosEmpty.style.display = "block";
    }
  }

  refreshSortableTables();
}

async function loadAdminUsers(query = "") {
  try {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    params.set("limit", "150");
    const data = await api(`/admin/usuarios?${params.toString()}`);
    if (!data?.ok) {
      throw new Error(data?.error?.message || "No se pudo cargar usuarios");
    }
    renderAdminUsers(data);
  } catch (err) {
    console.error(err);
    toast(err.message || "Error al cargar usuarios");
  }
}

function renderAdminUsers(data) {
  const tbody = document.querySelector("#adminUsersTable tbody");
  const empty = $("#adminUsersEmpty");
  const totalLabel = $("#adminUserTotal");
  if (totalLabel) {
    totalLabel.textContent = `Mostrando ${data?.items?.length || 0} de ${data?.total || 0}`;
  }
  if (!tbody) return;
  tbody.innerHTML = "";
  const items = Array.isArray(data?.items) ? data.items : [];
  state.admin.users = items;
  const selectedId = state.admin.selectedUser?.id || state.admin.originalUser?.id || null;
  if (!items.length) {
    if (empty) empty.style.display = "block";
    selectAdminUser(null, { fromRender: true });
    return;
  }
  if (empty) empty.style.display = "none";
  items.forEach((user) => {
    const centros = parseCentrosList(user.centros).join(", ") || "—";
    const approvers = [user.jefe, user.gerente1, user.gerente2].filter(Boolean);
    const mailLine = user.mail
      ? `<div class="muted" style="font-size:.78rem;">${user.mail}</div>`
      : "";
    const approversLine = approvers.length
      ? `<div class="muted" style="font-size:.78rem;">Aprobadores: ${approvers.join(", ")}</div>`
      : "";
    const name = [user.nombre, user.apellido].filter(Boolean).join(" ") || user.id;
    const posicion = user.posicion || "—";
    const tr = document.createElement("tr");
    tr.classList.add("clickable-row");
    tr.dataset.userId = user.id;
    if (selectedId && user.id === selectedId) {
      tr.classList.add("is-selected");
    }
    tr.innerHTML = `
      <td>${user.id}</td>
      <td>${name}${mailLine}</td>
      <td>${user.rol || "—"}</td>
      <td>${posicion}</td>
      <td>${user.sector || "—"}</td>
      <td>${centros}</td>
      <td>${approversLine || "—"}</td>
    `;
    tr.addEventListener("click", () => selectAdminUser(user));
    tbody.appendChild(tr);
  });

  if (selectedId) {
    const refreshed = items.find((item) => item.id === selectedId);
    const formHasChanges = hasAdminUserChanges(getAdminUserFormValues());
    if (refreshed) {
      if (formHasChanges) {
        highlightSelectedAdminUserRow(selectedId);
      } else {
        selectAdminUser(refreshed, { fromRender: true });
      }
    } else if (!formHasChanges) {
      selectAdminUser(null, { fromRender: true });
    } else {
      highlightSelectedAdminUserRow(null);
    }
  }

  refreshSortableTables();
}

function cloneAdminUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    nombre: user.nombre || "",
    apellido: user.apellido || "",
    rol: user.rol || "",
    posicion: user.posicion || "",
    mail: user.mail || "",
    sector: user.sector || "",
    centros: parseCentrosList(user.centros),
    jefe: user.jefe || "",
    gerente1: user.gerente1 || "",
    gerente2: user.gerente2 || "",
  };
}

function highlightSelectedAdminUserRow(userId) {
  document.querySelectorAll("#adminUsersTable tbody tr").forEach((row) => {
    if (userId && row.dataset.userId === userId) {
      row.classList.add("is-selected");
    } else {
      row.classList.remove("is-selected");
    }
  });
}

function resetAdminUserForm() {
  const form = $("#adminUserForm");
  if (form) {
    form.reset();
  }
  [
    "adminUserId",
    "adminUserMail",
    "adminUserNombre",
    "adminUserApellido",
    "adminUserRol",
  "adminUserPosicion",
    "adminUserSector",
    "adminUserCentros",
    "adminUserJefe",
    "adminUserGerente1",
    "adminUserGerente2",
    "adminUserPassword",
    "adminUserPasswordConfirm",
  ].forEach((id) => {
    const input = $(`#${id}`);
    if (input) {
      if (input.tagName === "TEXTAREA" || input.tagName === "INPUT") {
        input.value = "";
      }
    }
  });
  const hint = $("#adminUserHint");
  if (hint) {
    hint.textContent = "Seleccioná un usuario para editarlo.";
  }
  const title = $("#adminUserTitle");
  if (title) {
    title.textContent = "Perfil sin selección";
  }
  const pill = $("#adminUserRolePill");
  if (pill) {
    pill.style.display = "none";
  }
  const saveBtn = $("#adminUserGuardar");
  if (saveBtn) {
    saveBtn.disabled = true;
  }
  const resetBtn = $("#adminUserReset");
  if (resetBtn) {
    resetBtn.disabled = true;
  }
  highlightSelectedAdminUserRow(null);
}

function selectAdminUser(user, options = {}) {
  const normalized = cloneAdminUser(user);
  if (!normalized) {
    state.admin.selectedUser = null;
    state.admin.originalUser = null;
    resetAdminUserForm();
    return;
  }
  state.admin.selectedUser = cloneAdminUser(normalized);
  state.admin.originalUser = cloneAdminUser(normalized);
  const setValue = (id, value) => {
    const el = $(`#${id}`);
    if (el) {
      el.value = value || "";
    }
  };
  setValue("adminUserId", normalized.id);
  setValue("adminUserMail", normalized.mail);
  setValue("adminUserNombre", normalized.nombre);
  setValue("adminUserApellido", normalized.apellido);
  setValue("adminUserRol", normalized.rol);
  setValue("adminUserPosicion", normalized.posicion);
  setValue("adminUserSector", normalized.sector);
  const centrosInput = $("#adminUserCentros");
  if (centrosInput) {
    centrosInput.value = normalized.centros.join(", ");
  }
  setValue("adminUserJefe", normalized.jefe);
  setValue("adminUserGerente1", normalized.gerente1);
  setValue("adminUserGerente2", normalized.gerente2);
  setValue("adminUserPassword", "");
  setValue("adminUserPasswordConfirm", "");
  const title = $("#adminUserTitle");
  if (title) {
    const label = [normalized.nombre, normalized.apellido].filter(Boolean).join(" ") || normalized.id;
    title.textContent = label;
  }
  const pill = $("#adminUserRolePill");
  if (pill) {
    if (normalized.rol) {
      pill.textContent = normalized.rol;
      pill.style.display = "inline-flex";
    } else {
      pill.style.display = "none";
    }
  }
  const hint = $("#adminUserHint");
  if (hint) {
    hint.textContent = `Editando ${normalized.id}`;
  }
  highlightSelectedAdminUserRow(normalized.id);
  updateAdminUserSaveState({ initial: true });
}

function getAdminUserFormValues() {
  return {
    id: $("#adminUserId")?.value?.trim() || "",
    mail: $("#adminUserMail")?.value?.trim() || "",
    nombre: $("#adminUserNombre")?.value?.trim() || "",
    apellido: $("#adminUserApellido")?.value?.trim() || "",
    rol: $("#adminUserRol")?.value?.trim() || "",
  posicion: $("#adminUserPosicion")?.value?.trim() || "",
    sector: $("#adminUserSector")?.value?.trim() || "",
    centros: parseCentrosList($("#adminUserCentros")?.value),
    jefe: $("#adminUserJefe")?.value?.trim() || "",
    gerente1: $("#adminUserGerente1")?.value?.trim() || "",
    gerente2: $("#adminUserGerente2")?.value?.trim() || "",
    password: $("#adminUserPassword")?.value || "",
    password_confirm: $("#adminUserPasswordConfirm")?.value || "",
  };
}

function hasAdminUserChanges(values) {
  const base = state.admin.originalUser;
  if (!base) return false;
  const normalize = (value) => (value || "").trim();
  const simpleFields = ["nombre", "apellido", "rol", "posicion", "sector"];
  for (const field of simpleFields) {
    if (normalize(values[field]) !== normalize(base[field])) {
      return true;
    }
  }
  const mailNew = normalize(values.mail).toLowerCase();
  const mailOld = normalize(base.mail).toLowerCase();
  if (mailNew !== mailOld) {
    return true;
  }
  const centrosOld = Array.isArray(base.centros) ? base.centros.map((c) => c.trim()).filter(Boolean) : [];
  const centrosNew = Array.isArray(values.centros) ? values.centros.map((c) => c.trim()).filter(Boolean) : [];
  if (centrosOld.join("|") !== centrosNew.join("|")) {
    return true;
  }
  for (const approverField of ["jefe", "gerente1", "gerente2"]) {
    const newVal = normalize(values[approverField]).toLowerCase();
    const oldVal = normalize(base[approverField]).toLowerCase();
    if (newVal !== oldVal) {
      return true;
    }
  }
  if (values.password && values.password.length) {
    return true;
  }
  return false;
}

function updateAdminUserSaveState(options = {}) {
  const saveBtn = $("#adminUserGuardar");
  const resetBtn = $("#adminUserReset");
  const values = getAdminUserFormValues();
  const hasChanges = options.initial ? false : hasAdminUserChanges(values);
  if (saveBtn) {
    saveBtn.disabled = !hasChanges;
  }
  if (resetBtn) {
    resetBtn.disabled = !hasChanges;
  }
  return { hasChanges, values };
}

function bindAdminUserForm() {
  const form = $("#adminUserForm");
  if (!form || form.dataset.bound) {
    return;
  }
  form.dataset.bound = "true";
  form.addEventListener("input", () => updateAdminUserSaveState());
  form.addEventListener("change", () => updateAdminUserSaveState());
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    await saveAdminUser();
  });
  const resetBtn = $("#adminUserReset");
  if (resetBtn) {
    resetBtn.addEventListener("click", (ev) => {
      ev.preventDefault();
      if (state.admin.originalUser) {
        selectAdminUser(cloneAdminUser(state.admin.originalUser), { fromReset: true });
      } else {
        resetAdminUserForm();
      }
    });
  }
}

async function saveAdminUser() {
  if (!state.admin.selectedUser || !state.admin.originalUser) {
    toast("Seleccioná un usuario primero");
    return;
  }
  const { hasChanges, values } = updateAdminUserSaveState();
  if (!hasChanges) {
    toast("No hay cambios para guardar");
    return;
  }
  if (values.password && values.password !== values.password_confirm) {
    toast("Las contraseñas no coinciden");
    return;
  }
  if (values.mail && !values.mail.includes("@")) {
    toast("Ingresá un correo válido");
    return;
  }
  const payload = {};
  const base = state.admin.originalUser;
  const normalize = (value) => (value || "").trim();
  for (const field of ["nombre", "apellido", "rol", "posicion", "sector"]) {
    const newVal = normalize(values[field]);
    const oldVal = normalize(base[field]);
    if (newVal !== oldVal) {
      payload[field] = newVal;
    }
  }
  const mailNew = normalize(values.mail).toLowerCase();
  const mailOld = normalize(base.mail).toLowerCase();
  if (mailNew !== mailOld) {
    payload.mail = mailNew;
  }
  const centrosNew = Array.isArray(values.centros) ? values.centros.map((c) => c.trim()).filter(Boolean) : [];
  const centrosOld = Array.isArray(base.centros) ? base.centros.map((c) => c.trim()).filter(Boolean) : [];
  if (centrosNew.join("|") !== centrosOld.join("|")) {
    payload.centros = centrosNew;
  }
  for (const approverField of ["jefe", "gerente1", "gerente2"]) {
    const newVal = normalize(values[approverField]).toLowerCase();
    const oldVal = normalize(base[approverField]).toLowerCase();
    if (newVal !== oldVal) {
      payload[approverField] = newVal;
    }
  }
  if (values.password && values.password.length) {
    if (values.password.length < 6) {
      toast("La contraseña debe tener al menos 6 caracteres");
      return;
    }
    payload.password = values.password;
  }
  if (!Object.keys(payload).length) {
    toast("No hay cambios para guardar");
    updateAdminUserSaveState();
    return;
  }
  const saveBtn = $("#adminUserGuardar");
  const resetBtn = $("#adminUserReset");
  const originalLabel = saveBtn ? saveBtn.textContent : "";
  if (saveBtn) {
    saveBtn.textContent = "Guardando...";
    saveBtn.disabled = true;
  }
  if (resetBtn) {
    resetBtn.disabled = true;
  }
  const userId = encodeURIComponent(state.admin.selectedUser.id);
  try {
  const res = await api(`/admin/usuarios/${userId}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    });
    if (!res?.ok) {
      throw new Error(res?.error?.message || "No se pudo guardar");
    }
    toast("Usuario actualizado", true);
    const updated = cloneAdminUser(res.usuario);
    state.admin.selectedUser = cloneAdminUser(updated);
    state.admin.originalUser = cloneAdminUser(updated);
    selectAdminUser(updated, { fromSave: true });
    const currentQuery = $("#adminUserSearch")?.value?.trim() || "";
    await loadAdminUsers(currentQuery);
  } catch (err) {
    console.error(err);
    toast(err.message || "Error al guardar usuario");
  } finally {
    if (saveBtn) {
      saveBtn.textContent = originalLabel || "Guardar cambios";
    }
    updateAdminUserSaveState();
  }
}

async function loadAdminSolicitudes({ status = "todos", query = "" } = {}) {
  try {
    const params = new URLSearchParams();
    params.set("limit", "150");
    if (status && status !== "todos") params.set("status", status);
    if (query) params.set("q", query);
    const data = await api(`/admin/solicitudes?${params.toString()}`);
    if (!data?.ok) {
      throw new Error(data?.error?.message || "No se pudo cargar solicitudes");
    }
    renderAdminSolicitudes(data);
  } catch (err) {
    console.error(err);
    toast(err.message || "Error al cargar solicitudes");
  }
}

function renderAdminSolicitudes(data) {
  const tbody = document.querySelector("#adminSolicitudesTable tbody");
  const empty = $("#adminSolicitudesEmpty");
  const totalLabel = $("#adminSolicitudesTotal");
  if (totalLabel) {
    totalLabel.textContent = `Mostrando ${data?.items?.length || 0} de ${data?.total || 0}`;
  }
  if (!tbody) return;
  tbody.innerHTML = "";
  const items = Array.isArray(data?.items) ? data.items : [];
  if (!items.length) {
    if (empty) empty.style.display = "block";
    return;
  }
  if (empty) empty.style.display = "none";
  items.forEach((item) => {
    const tr = document.createElement("tr");
    const planner = item.planner || item.planner_id || "—";
    tr.innerHTML = `
      <td>#${item.id}</td>
      <td>${item.solicitante || item.id_usuario}</td>
      <td>${item.centro || "—"}</td>
      <td>${statusBadge(item.status)}</td>
      <td>${formatCurrency(item.total_monto || 0)}</td>
      <td>${item.created_at ? new Date(item.created_at).toLocaleString() : "—"}</td>
      <td>${item.aprobador || item.aprobador_id || "—"}</td>
      <td>${planner}</td>
    `;
    tbody.appendChild(tr);
  });

  refreshSortableTables();
}

async function loadAdminMateriales(query = "") {
  try {
    const params = new URLSearchParams();
    params.set("limit", "200");
    if (query) params.set("q", query);
    const data = await api(`/admin/materiales?${params.toString()}`);
    if (!data?.ok) {
      throw new Error(data?.error?.message || "No se pudo cargar materiales");
    }
    renderAdminMateriales(data);
  } catch (err) {
    console.error(err);
    toast(err.message || "Error al cargar materiales");
  }
}

function renderAdminMateriales(data) {
  const tbody = document.querySelector("#adminMaterialTable tbody");
  const empty = $("#adminMaterialEmpty");
  const totalLabel = $("#adminMaterialTotal");
  if (totalLabel) {
    totalLabel.textContent = `Mostrando ${data?.items?.length || 0} de ${data?.total || 0}`;
  }
  if (!tbody) return;
  tbody.innerHTML = "";
  const items = Array.isArray(data?.items) ? data.items : [];
  if (!items.length) {
    if (empty) empty.style.display = "block";
    resetAdminMaterialForm();
    return;
  }
  if (empty) empty.style.display = "none";
  items.forEach((material) => {
    const tr = document.createElement("tr");
    tr.classList.add("clickable-row");
    tr.innerHTML = `
      <td>${material.codigo}</td>
      <td>${material.descripcion}</td>
      <td>${material.unidad || "—"}</td>
      <td>${formatCurrency(material.precio_usd || 0)}</td>
      <td>${material.centro || "—"}</td>
      <td>${material.sector || "—"}</td>
    `;
    tr.addEventListener("click", () => selectAdminMaterial(material));
    tbody.appendChild(tr);
  });

  refreshSortableTables();
}

function adminConfigLabel(resource) {
  return ADMIN_CONFIG_LABELS[resource] || "registro";
}

function getAdminConfigItems(resource) {
  const data = state.admin?.config?.data || {};
  const items = data[resource];
  return Array.isArray(items) ? items : [];
}

function highlightAdminConfigRow(resource, id) {
  const numericId = Number(id);
  document.querySelectorAll(`table[data-config-table="${resource}"] tbody tr`).forEach((row) => {
    const rowId = Number(row.dataset.id);
    if (numericId && rowId === numericId) {
      row.classList.add("is-editing");
    } else {
      row.classList.remove("is-editing");
    }
  });
}

function resetAdminConfigForm(resource) {
  const form = document.querySelector(`.config-form[data-resource="${resource}"]`);
  if (!form) {
    return;
  }
  form.reset();
  form.removeAttribute("data-editing-id");
  const submitBtn = form.querySelector('[data-role="submit"]');
  if (submitBtn) {
    submitBtn.textContent = "Agregar";
  }
  const cancelBtn = form.querySelector('[data-role="cancel"]');
  if (cancelBtn) {
    cancelBtn.hidden = true;
  }
  const activoInput = form.querySelector('input[name="activo"]');
  if (activoInput) {
    activoInput.checked = true;
  }
  if (state.admin?.config?.editing && state.admin.config.editing.resource === resource) {
    state.admin.config.editing = null;
  }
  highlightAdminConfigRow(resource, null);
}

function populateAdminConfigForm(resource, item) {
  const form = document.querySelector(`.config-form[data-resource="${resource}"]`);
  if (!form) {
    return;
  }
  ADMIN_CONFIG_FIELDS[resource]?.forEach((field) => {
    if (field === "activo") {
      const checkbox = form.querySelector('input[name="activo"]');
      if (checkbox) {
        checkbox.checked = Boolean(item.activo);
      }
      return;
    }
    const input = form.querySelector(`[name="${field}"]`);
    if (input) {
      input.value = item[field] ?? "";
    }
  });
  form.dataset.editingId = String(item.id);
  const submitBtn = form.querySelector('[data-role="submit"]');
  if (submitBtn) {
    submitBtn.textContent = "Guardar cambios";
  }
  const cancelBtn = form.querySelector('[data-role="cancel"]');
  if (cancelBtn) {
    cancelBtn.hidden = false;
  }
  state.admin.config.editing = { resource, id: Number(item.id) };
  highlightAdminConfigRow(resource, item.id);
}

function renderAdminConfigSection(resource, rows) {
  const tbody = document.querySelector(`table[data-config-table="${resource}"] tbody`);
  const empty = document.querySelector(`[data-config-empty="${resource}"]`);
  if (!tbody) {
    return;
  }
  tbody.innerHTML = "";
  const items = Array.isArray(rows) ? rows : [];
  if (!items.length) {
    if (empty) {
      empty.style.display = "block";
    }
    highlightAdminConfigRow(resource, null);
    return;
  }
  if (empty) {
    empty.style.display = "none";
  }
  const fields = ADMIN_CONFIG_TABLE_FIELDS[resource] || [];
  items.forEach((item) => {
    const tr = document.createElement("tr");
    tr.dataset.id = String(item.id);
    const cells = fields
      .map((field) => {
        if (field === "activo") {
          return `<td>${item.activo ? "Activo" : "Inactivo"}</td>`;
        }
        const value = item[field];
        return `<td>${escapeHtml(value ?? "—")}</td>`;
      })
      .join("");
    tr.innerHTML = `${cells}<td>
      <div class="admin-config-actions">
        <button type="button" class="btn sec btn-sm" data-config-action="edit" data-resource="${resource}" data-id="${item.id}">Editar</button>
        <button type="button" class="btn sec btn-sm" data-config-action="delete" data-resource="${resource}" data-id="${item.id}">Eliminar</button>
      </div>
    </td>`;
    tbody.appendChild(tr);
  });
  const editing = state.admin?.config?.editing;
  if (editing && editing.resource === resource) {
    const exists = items.some((row) => Number(row.id) === Number(editing.id));
    if (exists) {
      highlightAdminConfigRow(resource, editing.id);
    } else {
      resetAdminConfigForm(resource);
    }
  }

  refreshSortableTables(tbody.closest("table"));
}

function renderAdminConfig() {
  const data = state.admin?.config?.data || {};
  Object.keys(ADMIN_CONFIG_FIELDS).forEach((resource) => {
    const rows = Array.isArray(data[resource]) ? data[resource] : [];
    renderAdminConfigSection(resource, rows);
  });
}

async function loadAdminConfig(resource = null, options = {}) {
  const { silent = false, message } = options;
  try {
    if (resource) {
      const data = await api(`/admin/config/${resource}`);
      if (!data?.ok) {
        throw new Error(data?.error?.message || "No se pudo recuperar el catálogo");
      }
      state.admin.config.data[resource] = Array.isArray(data.items) ? data.items : [];
      renderAdminConfigSection(resource, state.admin.config.data[resource]);
      if (!silent) {
        const label = adminConfigLabel(resource);
        toast(message || `Catálogo de ${label} actualizado`, true);
      }
      await loadCatalogData(resource, { silent: true });
    } else {
      const data = await api("/admin/config");
      if (!data?.ok) {
        throw new Error(data?.error?.message || "No se pudo recuperar la configuración");
      }
      state.admin.config.data = data.data || {};
      Object.keys(ADMIN_CONFIG_FIELDS).forEach((key) => {
        if (!Array.isArray(state.admin.config.data[key])) {
          state.admin.config.data[key] = [];
        }
      });
      renderAdminConfig();
      if (!silent) {
        toast(message || "Catálogos actualizados", true);
      }
      await loadCatalogData(null, { silent: true });
    }
  } catch (err) {
    console.error(err);
    toast(err.message || "No se pudo cargar la configuración");
  }
}

function bindAdminConfigForms() {
  document.querySelectorAll(".config-form").forEach((form) => {
    if (form.dataset.bound === "true") {
      return;
    }
    form.dataset.bound = "true";
    const resource = form.dataset.resource;
    if (!resource) {
      return;
    }
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const fields = ADMIN_CONFIG_FIELDS[resource] || [];
      const payload = {};
      fields.forEach((field) => {
        if (field === "activo") {
          const checkbox = form.querySelector('input[name="activo"]');
          if (checkbox) {
            payload.activo = checkbox.checked;
          }
          return;
        }
        const input = form.querySelector(`[name="${field}"]`);
        if (!input) {
          return;
        }
        const value = input.value?.trim();
        payload[field] = value ? value : null;
      });
      const editingId = form.dataset.editingId ? Number(form.dataset.editingId) : null;
      const method = editingId ? "PUT" : "POST";
      const url = editingId
        ? `/admin/config/${resource}/${editingId}`
        : `/admin/config/${resource}`;
      const submitBtn = form.querySelector('[data-role="submit"]');
      const originalLabel = submitBtn ? submitBtn.textContent : "";
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = editingId ? "Guardando..." : "Agregando...";
      }
      try {
        const response = await api(url, {
          method,
          body: JSON.stringify(payload),
        });
        if (!response?.ok) {
          throw new Error(response?.error?.message || "No se pudo guardar");
        }
        const label = adminConfigLabel(resource);
        if (editingId) {
          toast(`${label.charAt(0).toUpperCase()}${label.slice(1)} actualizado`, true);
        } else {
          toast(`${label.charAt(0).toUpperCase()}${label.slice(1)} agregado`, true);
        }
        resetAdminConfigForm(resource);
        await loadAdminConfig(resource, { silent: true });
      } catch (err) {
        console.error(err);
        toast(err.message || "No se pudo guardar el registro");
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = originalLabel || (editingId ? "Guardar cambios" : "Agregar");
        }
      }
    });
    const cancelBtn = form.querySelector('[data-role="cancel"]');
    if (cancelBtn) {
      cancelBtn.addEventListener("click", (ev) => {
        ev.preventDefault();
        resetAdminConfigForm(resource);
      });
    }
  });
}

function bindAdminConfigTables() {
  document.querySelectorAll("table[data-config-table]").forEach((table) => {
    if (table.dataset.bound === "true") {
      return;
    }
    table.dataset.bound = "true";
    table.addEventListener("click", async (ev) => {
      const target = ev.target instanceof HTMLElement ? ev.target.closest("button[data-config-action]") : null;
      if (!target) {
        return;
      }
      ev.preventDefault();
      const action = target.dataset.configAction;
      const resource = target.dataset.resource;
      const itemId = Number(target.dataset.id);
      if (!resource || !itemId) {
        return;
      }
      const items = getAdminConfigItems(resource);
      const current = items.find((row) => Number(row.id) === itemId);
      if (action === "edit") {
        if (!current) {
          toast("No encontramos el registro seleccionado");
          return;
        }
        populateAdminConfigForm(resource, current);
        const form = document.querySelector(`.config-form[data-resource="${resource}"]`);
        if (form) {
          form.scrollIntoView({ behavior: "smooth", block: "start" });
        }
        return;
      }
      if (action === "delete") {
        const label = adminConfigLabel(resource);
        const confirmed = window.confirm(`¿Eliminar este ${label}? Esta acción no se puede deshacer.`);
        if (!confirmed) {
          return;
        }
        try {
          const response = await api(`/admin/config/${resource}/${itemId}`, {
            method: "DELETE",
          });
          if (!response?.ok) {
            throw new Error(response?.error?.message || "No se pudo eliminar");
          }
          toast(`${label.charAt(0).toUpperCase()}${label.slice(1)} eliminado`, true);
          if (state.admin?.config?.editing && state.admin.config.editing.resource === resource && Number(state.admin.config.editing.id) === itemId) {
            resetAdminConfigForm(resource);
          }
          await loadAdminConfig(resource, { silent: true });
        } catch (err) {
          console.error(err);
          toast(err.message || "No se pudo eliminar el registro");
        }
      }
    });
  });
}

async function setupAdminConfigPage() {
  bindAdminConfigForms();
  bindAdminConfigTables();

  const refreshAllBtn = $("#adminConfigRefreshAll");
  if (refreshAllBtn) {
    refreshAllBtn.addEventListener("click", async (ev) => {
      ev.preventDefault();
      await loadAdminConfig(null, { message: "Catálogos actualizados" });
    });
  }

  document.querySelectorAll("[data-config-refresh]").forEach((btn) => {
    btn.addEventListener("click", async (ev) => {
      ev.preventDefault();
      const resource = btn.getAttribute("data-config-refresh");
      if (!resource) {
        return;
      }
      const label = adminConfigLabel(resource);
      await loadAdminConfig(resource, { message: `Catálogo de ${label} actualizado` });
    });
  });

  await loadAdminConfig(null, { silent: true });
}

function resetAdminMaterialForm() {
  state.admin.selectedMaterial = null;
  const form = $("#adminMaterialForm");
  if (!form) return;
  form.reset();
  const codeInput = $("#adminMaterialCodigo");
  if (codeInput) codeInput.value = "";
  const saveBtn = $("#adminMaterialGuardar");
  if (saveBtn) saveBtn.disabled = true;
  const hint = $("#adminMaterialHint");
  if (hint) hint.textContent = "Seleccioná un material para editarlo.";
}

function selectAdminMaterial(material) {
  state.admin.selectedMaterial = material;
  const codeInput = $("#adminMaterialCodigo");
  const descInput = $("#adminMaterialDescripcion");
  const unidadInput = $("#adminMaterialUnidad");
  const precioInput = $("#adminMaterialPrecio");
  const largaInput = $("#adminMaterialDescripcionLarga");
  const saveBtn = $("#adminMaterialGuardar");
  const hint = $("#adminMaterialHint");
  if (codeInput) codeInput.value = material.codigo || "";
  if (descInput) descInput.value = material.descripcion || "";
  if (unidadInput) unidadInput.value = material.unidad || "";
  if (precioInput) precioInput.value = material.precio_usd ?? "";
  if (largaInput) largaInput.value = material.descripcion_larga || "";
  if (saveBtn) saveBtn.disabled = false;
  if (hint) hint.textContent = `Editando ${material.codigo}`;
}

function bindAdminMaterialForm() {
  const form = $("#adminMaterialForm");
  if (!form || form.dataset.bound) {
    return;
  }
  form.dataset.bound = "true";
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    await saveAdminMaterial();
  });
}

async function saveAdminMaterial() {
  if (!state.admin.selectedMaterial) {
    return;
  }
  const codigo = $("#adminMaterialCodigo")?.value?.trim();
  const descripcion = $("#adminMaterialDescripcion")?.value?.trim();
  const unidad = $("#adminMaterialUnidad")?.value?.trim();
  const precioRaw = $("#adminMaterialPrecio")?.value;
  const descripcionLarga = $("#adminMaterialDescripcionLarga")?.value || null;
  if (!codigo || !descripcion) {
    toast("Completá los campos obligatorios");
    return;
  }
  const payload = {
    descripcion,
    unidad,
    precio_usd: precioRaw,
    descripcion_larga: descripcionLarga,
  };
  try {
    const res = await api(`/admin/materiales/${encodeURIComponent(codigo)}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    });
    if (!res?.ok) {
      throw new Error(res?.error?.message || "No se pudo guardar");
    }
    toast("Material actualizado", true);
    state.admin.selectedMaterial = res.material;
    selectAdminMaterial(res.material);
    const currentQuery = $("#adminMaterialSearch")?.value?.trim() || "";
    await loadAdminMateriales(currentQuery);
  } catch (err) {
    console.error(err);
    toast(err.message || "Error al guardar material");
  }
}

async function loadAdminCentros() {
  try {
    const data = await api("/admin/centros");
    if (!data?.ok) {
      throw new Error(data?.error?.message || "No se pudo cargar centros");
    }
    renderAdminCentros(data);
  } catch (err) {
    console.error(err);
    toast(err.message || "Error al cargar centros");
  }
}

function renderAdminCentros(data) {
  const usoBody = document.querySelector("#adminCentrosSolicitudes tbody");
  const usoEmpty = $("#adminCentrosSolicitudesEmpty");
  if (usoBody) {
    const items = Array.isArray(data?.solicitudes) ? data.solicitudes : [];
    usoBody.innerHTML = "";
    if (!items.length) {
      if (usoEmpty) usoEmpty.style.display = "block";
    } else {
      items.forEach((row) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>${row.centro}</td>
          <td>${row.total ?? 0}</td>
          <td>${formatCurrency(row.monto || 0)}</td>
        `;
        usoBody.appendChild(tr);
      });
      if (usoEmpty) usoEmpty.style.display = "none";
    }
  }

  const presupuestosBody = document.querySelector("#adminCentrosPresupuestos tbody");
  const presupuestosEmpty = $("#adminCentrosPresupuestosEmpty");
  if (presupuestosBody) {
    const rows = Array.isArray(data?.presupuestos) ? data.presupuestos : [];
    presupuestosBody.innerHTML = "";
    if (!rows.length) {
      if (presupuestosEmpty) presupuestosEmpty.style.display = "block";
    } else {
      rows.forEach((row) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>${row.centro}</td>
          <td>${row.sector || "—"}</td>
          <td>${formatCurrency(row.monto_usd || 0)}</td>
          <td>${formatCurrency(row.saldo_usd || 0)}</td>
        `;
        presupuestosBody.appendChild(tr);
      });
      if (presupuestosEmpty) presupuestosEmpty.style.display = "none";
    }
  }
}

async function loadAdminAlmacenes() {
  try {
    const data = await api("/admin/almacenes");
    if (!data?.ok) {
      throw new Error(data?.error?.message || "No se pudo cargar almacenes");
    }
    renderAdminAlmacenes(data);
  } catch (err) {
    console.error(err);
    toast(err.message || "Error al cargar almacenes");
  }
}

function renderAdminAlmacenes(data) {
  const tbody = document.querySelector("#adminAlmacenesTable tbody");
  const empty = $("#adminAlmacenesEmpty");
  if (!tbody) return;
  const rows = Array.isArray(data?.items) ? data.items : [];
  tbody.innerHTML = "";
  if (!rows.length) {
    if (empty) empty.style.display = "block";
    return;
  }
  if (empty) empty.style.display = "none";
  rows.forEach((row) => {
    const label = row.almacen || "(sin especificar)";
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${label}</td>
      <td>${row.total ?? 0}</td>
      <td>${formatCurrency(row.monto || 0)}</td>
    `;
    tbody.appendChild(tr);
  });

  refreshSortableTables();
}

async function loadAdminReportes() {
  try {
    const data = await api("/admin/summary");
    if (!data?.ok) {
      throw new Error(data?.error?.message || "No se pudo cargar indicadores");
    }
    const totals = data.totals || {};
    const pendientes = $("#reportPendientes");
    if (pendientes) pendientes.textContent = String(totals.pendientes ?? "0");
    const finalizadas = $("#reportFinalizadas");
    if (finalizadas) finalizadas.textContent = String(totals.finalizadas ?? "0");
    const canceladas = $("#reportCanceladas");
    if (canceladas) canceladas.textContent = String(totals.canceladas ?? "0");
  } catch (err) {
    console.error(err);
    toast(err.message || "Error al cargar indicadores");
  }
}

let budgetLoading = false;

function renderBudgetIncreases(payload) {
  state.budget.increases = payload || null;
  const info = payload || {};

  const requestPane = document.getElementById("budgetIncreaseRequestPane");
  const canRequest = Boolean(info.puede_solicitar ?? canRequestBudgetIncrease());
  if (requestPane) {
    requestPane.classList.toggle("hide", !canRequest);
    if (canRequest) {
      const centrosUsuario = parseCentrosList(state.me?.centros);
      const budgetCentros = (state.budget.data?.presupuestos || []).map((item) => item?.centro).filter(Boolean);
      const uniqueCentros = Array.from(new Set([...centrosUsuario, ...budgetCentros])).filter(Boolean).sort();
      const centroSelect = document.getElementById("budgetIncreaseCentro");
      if (centroSelect) {
        const previous = centroSelect.value;
        centroSelect.innerHTML = '<option value="" disabled selected>Seleccioná un centro</option>';
        uniqueCentros.forEach((centro) => {
          const option = document.createElement("option");
          option.value = centro;
          option.textContent = centro;
          centroSelect.appendChild(option);
        });
        if (previous && uniqueCentros.includes(previous)) {
          centroSelect.value = previous;
        }
      }

      const myBody = document.querySelector("#budgetIncreaseMyTable tbody");
      const myEmpty = document.getElementById("budgetIncreaseMyEmpty");
      if (myBody) {
        myBody.innerHTML = "";
        const items = Array.isArray(info.mis) ? info.mis : [];
        if (items.length) {
          items.forEach((row) => {
            const tr = document.createElement("tr");
            const estado = statusBadge(row.estado);
            tr.innerHTML = `
              <td>${formatDateTime(row.created_at)}</td>
              <td>${escapeHtml(row.centro)}</td>
              <td>${escapeHtml(row.sector || "—")}</td>
              <td>${formatCurrency(row.monto)}</td>
              <td>${estado}</td>
              <td>${row.resolved_at ? formatDateTime(row.resolved_at) : "—"}</td>
            `;
            myBody.appendChild(tr);
          });
          if (myEmpty) myEmpty.style.display = "none";
        } else if (myEmpty) {
          myEmpty.style.display = "block";
        }
      }
    }
  }

  const approvalsPane = document.getElementById("budgetIncreaseApprovalsPane");
  const canApprove = Boolean(info.puede_aprobar ?? canApproveBudgetIncrease());
  if (approvalsPane) {
    approvalsPane.classList.toggle("hide", !canApprove);
    if (canApprove) {
      const approvalsBody = document.querySelector("#budgetApprovalsTable tbody");
      const approvalsEmpty = document.getElementById("budgetApprovalsEmpty");
      if (approvalsBody) {
        approvalsBody.innerHTML = "";
        const pendientes = Array.isArray(info.pendientes) ? info.pendientes : [];
        if (pendientes.length) {
          pendientes.forEach((row) => {
            const tr = document.createElement("tr");
            tr.dataset.id = String(row.id);
            tr.innerHTML = `
              <td>${formatDateTime(row.created_at)}</td>
              <td>${escapeHtml(row.solicitante_id)}</td>
              <td>${escapeHtml(row.centro)}</td>
              <td>${escapeHtml(row.sector || "—")}</td>
              <td>${formatCurrency(row.monto)}</td>
              <td>${escapeHtml(row.motivo || "—")}</td>
              <td>
                <div style="display:flex;gap:8px;flex-wrap:wrap;">
                  <button class="btn pri" data-action="aprobar" data-id="${row.id}">Aprobar</button>
                  <button class="btn sec" data-action="rechazar" data-id="${row.id}">Rechazar</button>
                </div>
              </td>
            `;
            approvalsBody.appendChild(tr);
          });
          if (approvalsEmpty) approvalsEmpty.style.display = "none";
        } else if (approvalsEmpty) {
          approvalsEmpty.style.display = "block";
        }
      }
    }
  }

  const historyPane = document.getElementById("budgetIncreaseHistoryPane");
  if (historyPane) {
    const historyBody = document.querySelector("#budgetIncreaseHistoryTable tbody");
    const historyEmpty = document.getElementById("budgetIncreaseHistoryEmpty");
    const rows = Array.isArray(info.todas) ? info.todas : [];
    historyPane.classList.toggle("hide", rows.length === 0 && !canRequest && !canApprove);
    if (historyBody) {
      historyBody.innerHTML = "";
      if (rows.length) {
        rows.forEach((row) => {
          const tr = document.createElement("tr");
          const estado = statusBadge(row.estado);
          tr.innerHTML = `
            <td>${formatDateTime(row.created_at)}</td>
            <td>${escapeHtml(row.centro)}</td>
            <td>${escapeHtml(row.sector || "—")}</td>
            <td>${formatCurrency(row.monto)}</td>
            <td>${estado}</td>
            <td>${escapeHtml(row.solicitante_id || "—")}</td>
            <td>${row.resolved_at ? formatDateTime(row.resolved_at) : "—"}</td>
          `;
          historyBody.appendChild(tr);
        });
        if (historyEmpty) historyEmpty.style.display = "none";
      } else if (historyEmpty) {
        historyEmpty.style.display = "block";
      }
    }
  }
}

async function submitBudgetIncrease(ev) {
  ev.preventDefault();
  if (budgetLoading) {
    return;
  }
  const centro = document.getElementById("budgetIncreaseCentro")?.value?.trim();
  const sectorRaw = document.getElementById("budgetIncreaseSector")?.value || "";
  const montoRaw = document.getElementById("budgetIncreaseMonto")?.value || "";
  const motivo = document.getElementById("budgetIncreaseMotivo")?.value?.trim() || "";
  const monto = Number(String(montoRaw).replace(",", "."));
  if (!centro) {
    toast("Seleccioná un centro", false);
    return;
  }
  if (!Number.isFinite(monto) || monto <= 0) {
    toast("Ingresá un monto mayor a cero", false);
    return;
  }
  if (motivo && motivo.length < 3) {
    toast("El motivo debe tener al menos 3 caracteres", false);
    return;
  }
  try {
    await api("/presupuestos/incorporaciones", {
      method: "POST",
      body: JSON.stringify({ centro, sector: sectorRaw.trim() || null, monto, motivo: motivo || null }),
    });
    const form = document.getElementById("budgetIncreaseForm");
    if (form) {
      form.reset();
    }
    toast("Solicitud enviada para aprobación", true);
    await loadBudgetOverview(true);
  } catch (err) {
    toast(err.message || "No se pudo registrar la solicitud");
  }
}

async function resolveBudgetIncrease(id, action, comentario) {
  if (!id || !action) {
    return;
  }
  try {
    await api(`/presupuestos/incorporaciones/${id}/resolver`, {
      method: "POST",
      body: JSON.stringify({ accion: action, comentario: comentario || null }),
    });
    const successMsg = action === "aprobar" ? "Incorporación aprobada" : "Solicitud rechazada";
    toast(successMsg, true);
    await loadBudgetOverview(true);
  } catch (err) {
    toast(err.message || "No se pudo procesar la solicitud");
  }
}

function renderBudgetOverview(data) {
  state.budget.data = data || null;

  const summary = data?.summary || {};
  const presupuestos = Array.isArray(data?.presupuestos) ? data.presupuestos : [];
  const history = Array.isArray(data?.historial) ? data.historial : [];
  const deadlines = Array.isArray(data?.proximos_vencimientos) ? data.proximos_vencimientos : [];
  const increases = data?.incorporaciones || null;

  const lastUpdateLabel = $("#budgetLastUpdate");
  if (lastUpdateLabel) {
    const fallbackHistory = history[0];
    const lastUpdateSource =
      summary.ultima_actualizacion || fallbackHistory?.updated_at || fallbackHistory?.created_at || null;
    const formatted = lastUpdateSource ? formatDateTime(lastUpdateSource) : "—";
    lastUpdateLabel.textContent = `Última actualización: ${formatted}`;
  }

  const summaryCards = $("#budgetSummaryCards");
  const summaryEmpty = $("#budgetSummaryEmpty");
  if (summaryCards) {
    if (presupuestos.length) {
      const cards = [
        {
          label: "Centros presupuestados",
          value: String(summary.total_presupuestos ?? presupuestos.length ?? 0),
          helper: "Centros asociados a tu perfil",
        },
        {
          label: "Monto asignado",
          value: formatCurrency(summary.monto_total ?? 0),
          helper: "Total en USD",
        },
        {
          label: "Consumido",
          value: formatCurrency(summary.utilizado_total ?? 0),
          helper: "Gasto acumulado",
        },
        {
          label: "Saldo disponible",
          value: formatCurrency(summary.saldo_total ?? 0),
          helper: "Fondos pendientes",
        },
      ];
      summaryCards.innerHTML = cards
        .map(
          (card) => `
          <article class="metric-card">
            <span class="metric-label">${card.label}</span>
            <span class="metric-value">${card.value}</span>
            <span class="metric-sub">${card.helper}</span>
          </article>`
        )
        .join("");
      summaryCards.style.display = "grid";
      if (summaryEmpty) summaryEmpty.style.display = "none";
    } else {
      summaryCards.innerHTML = "";
      summaryCards.style.display = "none";
      if (summaryEmpty) summaryEmpty.style.display = "block";
    }
  }

  const tableBody = $("#budgetTable")?.querySelector("tbody");
  const tableEmpty = $("#budgetTableEmpty");
  if (tableBody) {
    tableBody.innerHTML = "";
    if (presupuestos.length) {
      presupuestos.forEach((entry, index) => {
        const tr = document.createElement("tr");
        const lastUpdated =
          entry.ultima_actualizacion || entry.historial?.[0]?.updated_at || entry.historial?.[0]?.created_at;
        tr.dataset.index = String(index);
        tr.innerHTML = `
          <td>${entry.centro || "—"}</td>
          <td>${entry.sector || "—"}</td>
          <td>${formatCurrency(entry.monto_total ?? entry.monto_usd ?? 0)}</td>
          <td>${formatCurrency(entry.utilizado ?? 0)}</td>
          <td>${formatCurrency(entry.saldo ?? 0)}</td>
          <td>${formatPercentage(entry.avance)}</td>
          <td>${lastUpdated ? formatDateOnly(lastUpdated) : "—"}</td>
        `;
        tableBody.appendChild(tr);
      });
      if (tableEmpty) tableEmpty.style.display = "none";
    } else if (tableEmpty) {
      tableEmpty.style.display = "block";
    }
  }

  const historyBody = $("#budgetHistoryTable")?.querySelector("tbody");
  const historyEmpty = $("#budgetHistoryEmpty");
  if (historyBody) {
    historyBody.innerHTML = "";
    if (history.length) {
      history.forEach((item) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>#${item.id}</td>
          <td>${item.centro || "—"}</td>
          <td>${item.sector || "—"}</td>
          <td>${statusBadge(item.status)}</td>
          <td>${formatCurrency(item.total_monto)}</td>
          <td>${formatDateTime(item.created_at)}</td>
          <td>${formatDateTime(item.updated_at)}</td>
        `;
        historyBody.appendChild(tr);
      });
      if (historyEmpty) historyEmpty.style.display = "none";
    } else if (historyEmpty) {
      historyEmpty.style.display = "block";
    }
  }

  const deadlinesBody = $("#budgetDeadlinesTable")?.querySelector("tbody");
  const deadlinesEmpty = $("#budgetDeadlinesEmpty");
  if (deadlinesBody) {
    deadlinesBody.innerHTML = "";
    if (deadlines.length) {
      deadlines.forEach((item) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>${formatDateOnly(item.fecha)}</td>
          <td>#${item.id}</td>
          <td>${item.centro || "—"}</td>
          <td>${item.sector || "—"}</td>
          <td>${statusBadge(item.status)}</td>
          <td>${formatCurrency(item.monto)}</td>
        `;
        deadlinesBody.appendChild(tr);
      });
      if (deadlinesEmpty) deadlinesEmpty.style.display = "none";
    } else if (deadlinesEmpty) {
      deadlinesEmpty.style.display = "block";
    }
  }
  refreshSortableTables();
  renderBudgetIncreases(increases);
}

async function loadBudgetOverview(manualTrigger = false) {
  if (budgetLoading) {
    return;
  }
  budgetLoading = true;

  const refreshBtn = $("#budgetRefresh");
  if (refreshBtn) {
    refreshBtn.disabled = true;
  }

  const summaryCards = $("#budgetSummaryCards");
  const summaryEmpty = $("#budgetSummaryEmpty");
  if (summaryCards && !manualTrigger) {
    summaryCards.innerHTML = `
      <article class="metric-card">
        <span class="metric-label">Cargando información</span>
        <span class="metric-value">...</span>
        <span class="metric-sub">Consultando el servicio de presupuesto</span>
      </article>
    `;
    summaryCards.style.display = "grid";
    if (summaryEmpty) summaryEmpty.style.display = "none";
  }

  try {
    const response = await api("/presupuestos/mis");
    if (response?.ok === false) {
      throw new Error(response?.error?.message || "No se pudo recuperar el presupuesto");
    }
    renderBudgetOverview(response);
    state.budget.lastLoadedAt = Date.now();
    if (manualTrigger) {
      toast("Datos de presupuesto actualizados", true);
    }
  } catch (err) {
    console.error(err);
    toast(err.message || "No se pudo cargar el presupuesto");
    if (!manualTrigger) {
      renderBudgetOverview({
        summary: {},
        presupuestos: [],
        historial: [],
        proximos_vencimientos: [],
        incorporaciones: {
          puede_solicitar: canRequestBudgetIncrease(),
          puede_aprobar: canApproveBudgetIncrease(),
          mis: [],
          pendientes: [],
          todas: [],
        },
      });
    }
    const message = String(err?.message || "").toLowerCase();
    if (message.includes("permiso") || message.includes("autentic")) {
      setTimeout(() => {
        window.location.href = "home.html";
      }, 1600);
    }
  } finally {
    if (refreshBtn) {
      refreshBtn.disabled = false;
    }
    budgetLoading = false;
  }
}

async function setupBudgetPage() {
  const refreshBtn = $("#budgetRefresh");
  if (refreshBtn) {
    refreshBtn.addEventListener("click", async (ev) => {
      ev.preventDefault();
      await loadBudgetOverview(true);
    });
  }
  const requestForm = document.getElementById("budgetIncreaseForm");
  if (requestForm) {
    requestForm.addEventListener("submit", submitBudgetIncrease);
  }
  const approvalsTable = document.getElementById("budgetApprovalsTable");
  if (approvalsTable) {
    approvalsTable.addEventListener("click", (ev) => {
      const target = ev.target instanceof HTMLElement ? ev.target.closest("button[data-action]") : null;
      if (!target) {
        return;
      }
      ev.preventDefault();
      const action = target.getAttribute("data-action") || "";
      const id = Number(target.getAttribute("data-id"));
      if (!id) {
        return;
      }
      if (action === "rechazar") {
        const comentario = prompt("Ingresá un comentario para el rechazo (opcional)") || "";
        resolveBudgetIncrease(id, action, comentario.trim());
      } else {
        resolveBudgetIncrease(id, action, "");
      }
    });
  }
  await loadBudgetOverview(false);
}

function attachGlobalNav() {
  const logoutLink = $("#menuCerrarSesion");
  if (logoutLink) {
    logoutLink.addEventListener("click", (ev) => {
      ev.preventDefault();
      logout();
    });
  }
  const helpLink = $("#menuAyuda");
  if (helpLink) {
    helpLink.addEventListener("click", (ev) => {
      ev.preventDefault();
      help();
    });
  }
  const chatLink = $("#menuChatbot");
  if (chatLink) {
    chatLink.addEventListener("click", (ev) => {
      ev.preventDefault();
      toggleChatbotPanel(true);
    });
  }

  renderAdminNav();
  configureRoleNavigation();
  initChatbotWidget();
}

// --- Router y lógica de inicialización ---
document.addEventListener("DOMContentLoaded", async () => {
  const path = window.location.pathname.split("/").pop() || "index.html";
  applyPreferences();

  if (path === "index.html" || path === "") {
    await me();
    if (state.me) {
      window.location.href = "home.html";
      return;
    }
    sessionStorage.removeItem("solicitudDraft");
    on($("#login"), "click", (ev) => {
      ev.preventDefault();
      login();
    });
    on($("#register"), "click", (ev) => {
      ev.preventDefault();
      register();
    });
    on($("#recover"), "click", (ev) => {
      ev.preventDefault();
      recover();
    });
    on($("#help"), "click", (ev) => {
      ev.preventDefault();
      help();
    });
    finalizePage();
    return;
  }

  await me();
  if (!state.me) {
    window.location.href = "index.html";
    return;
  }

  await loadCatalogData(null, { silent: true });
  attachGlobalNav();

  const notificationsData = await loadNotificationsSummary({
    markAsRead: path === "notificaciones.html",
  });

  if (path === "home.html") {
    const userNameSpan = $("#userName");
    if (userNameSpan) {
      userNameSpan.textContent = state.me.nombre;
    }
    initHomeHero(state.me?.nombre || "");
    finalizePage();
    return;
  }

  if (path === "notificaciones.html") {
    renderNotificationsPage(notificationsData);
    finalizePage();
    return;
  }

  if (path === "preferencias.html") {
    renderPreferencesPage();
    finalizePage();
    return;
  }

  const adminPages = new Set([
    "admin-dashboard.html",
    "admin-usuarios.html",
    "admin-solicitudes.html",
    "admin-materiales.html",
    "admin-centros.html",
    "admin-almacenes.html",
    "admin-reportes.html",
    "admin-configuracion.html",
  ]);

  if (adminPages.has(path)) {
    if (!enforceAdminAccess()) {
      return;
    }
    switch (path) {
      case "admin-dashboard.html":
        await loadAdminDashboard();
        break;
      case "admin-usuarios.html": {
        bindAdminUserForm();
        resetAdminUserForm();
        refreshCatalogConsumers();
        const filtersKey = "adminUsers";
        const userSearch = $("#adminUserSearch");
        if (userSearch && state.preferences?.rememberFilters) {
          const stored = loadStoredFilters(filtersKey, { query: "" });
          if (stored.query) {
            userSearch.value = stored.query;
          }
        }
        const runSearch = async (query) => {
          const value = query?.trim() || "";
          if (state.preferences?.rememberFilters) {
            saveStoredFilters(filtersKey, { query: value });
          }
          await loadAdminUsers(value);
        };
        on($("#adminUserSearchBtn"), "click", async (ev) => {
          ev.preventDefault();
          const query = $("#adminUserSearch")?.value || "";
          await runSearch(query);
        });
        on($("#adminUserResetBtn"), "click", async (ev) => {
          ev.preventDefault();
          const input = $("#adminUserSearch");
          if (input) input.value = "";
          clearStoredFilters(filtersKey);
          await loadAdminUsers("");
        });
        if (userSearch) {
          userSearch.addEventListener("keydown", async (ev) => {
            if (ev.key === "Enter") {
              ev.preventDefault();
              await runSearch(userSearch.value);
            }
          });
        }
        await runSearch(userSearch?.value || "");
        break;
      }
      case "admin-solicitudes.html": {
        const filtersKey = "adminSolicitudes";
        const statusSelect = $("#adminSolicitudesStatus");
        const searchInput = $("#adminSolicitudesSearch");
        if (state.preferences?.rememberFilters) {
          const stored = loadStoredFilters(filtersKey, { status: "todos", query: "" });
          if (statusSelect && stored.status) {
            statusSelect.value = stored.status;
          }
          if (searchInput && stored.query) {
            searchInput.value = stored.query;
          }
        }
        const applyFilters = async () => {
          const status = statusSelect?.value || "todos";
          const query = searchInput?.value?.trim() || "";
          if (state.preferences?.rememberFilters) {
            saveStoredFilters(filtersKey, { status, query });
          }
          await loadAdminSolicitudes({ status, query });
        };
        on($("#adminSolicitudesRefresh"), "click", (ev) => {
          ev.preventDefault();
          applyFilters();
        });
        if (statusSelect) {
          statusSelect.addEventListener("change", applyFilters);
        }
        if (searchInput) {
          searchInput.addEventListener("keydown", (ev) => {
            if (ev.key === "Enter") {
              ev.preventDefault();
              applyFilters();
            }
          });
        }
        await applyFilters();
        break;
      }
      case "admin-materiales.html": {
        bindAdminMaterialForm();
        resetAdminMaterialForm();
        const filtersKey = "adminMateriales";
        const searchInput = $("#adminMaterialSearch");
        if (searchInput && state.preferences?.rememberFilters) {
          const stored = loadStoredFilters(filtersKey, { query: "" });
          if (stored.query) {
            searchInput.value = stored.query;
          }
        }
        const triggerLoad = async () => {
          const query = searchInput?.value?.trim() || "";
          if (state.preferences?.rememberFilters) {
            saveStoredFilters(filtersKey, { query });
          }
          await loadAdminMateriales(query);
        };
        on($("#adminMaterialSearchBtn"), "click", (ev) => {
          ev.preventDefault();
          triggerLoad();
        });
        on($("#adminMaterialResetBtn"), "click", async (ev) => {
          ev.preventDefault();
          if (searchInput) searchInput.value = "";
          resetAdminMaterialForm();
          clearStoredFilters(filtersKey);
          await loadAdminMateriales("");
        });
        if (searchInput) {
          searchInput.addEventListener("keydown", (ev) => {
            if (ev.key === "Enter") {
              ev.preventDefault();
              triggerLoad();
            }
          });
        }
        await triggerLoad();
        break;
      }
      case "admin-centros.html":
        await loadAdminCentros();
        break;
      case "admin-almacenes.html":
        await loadAdminAlmacenes();
        break;
      case "admin-reportes.html":
        await loadAdminReportes();
        break;
      case "admin-configuracion.html":
        await setupAdminConfigPage();
        break;
      default:
        break;
    }
    finalizePage();
    return;
  }

  if (path === "presupuesto.html") {
    if (!canAccessBudgetModule()) {
      toast("No tenés permisos para el módulo de presupuesto");
      setTimeout(() => {
        window.location.href = "home.html";
      }, 1600);
      return;
    }
    await setupBudgetPage();
    finalizePage();
    return;
  }

  if (path === "crear-solicitud.html") {
    state.items = [];
    const draft = getDraft();
    const idHidden = $("#solicitudId");
    const centroSelect = $("#centro");
    const almacenSelect = $("#almacenVirtual");
    const sectorInput = $("#sector");
    const centroCostosInput = $("#centroDeCostos");
    const justTextarea = $("#just");
    const criticidadSelect = $("#criticidad");
    const fechaNecesidadInput = $("#fechaNecesidad");

    const centrosUsuario = Array.isArray(state.me?.centros)
      ? state.me.centros
      : parseCentrosList(state.me?.centros);
    const centroOptions = buildCentroOptions();
    const autoCentro = centrosUsuario.length === 1 ? centrosUsuario[0] : centroOptions[0]?.value || "";

    if (centroSelect) {
      centroSelect.innerHTML = '<option value="" disabled selected>Seleccioná un centro</option>';
      centroOptions.forEach(({ value, label }) => {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = label;
        centroSelect.appendChild(option);
      });
    }

    if (almacenSelect) {
      almacenSelect.innerHTML = '<option value="" disabled selected>Seleccioná un almacén virtual</option>';
      buildAlmacenOptions().forEach(({ value, label }) => {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = label;
        almacenSelect.appendChild(option);
      });
    }

    if (sectorInput) {
      sectorInput.value = draft?.header?.sector || state.me?.sector || "";
      sectorInput.readOnly = true;
    }

    if (criticidadSelect) {
      criticidadSelect.value = draft?.header?.criticidad || "Normal";
    }

    if (fechaNecesidadInput) {
      const storedDate = draft?.header?.fecha_necesidad;
      const todayIso = new Date().toISOString().split("T")[0];
      fechaNecesidadInput.value = storedDate || todayIso;
    }

    if (draft?.id) {
      if (idHidden) idHidden.value = draft.id;
    }

    if (draft?.header) {
      if (centroSelect) centroSelect.value = draft.header.centro || centroSelect.value;
      if (almacenSelect) almacenSelect.value = draft.header.almacen_virtual || almacenSelect.value;
      if (centroCostosInput) centroCostosInput.value = draft.header.centro_costos || "";
      if (justTextarea) justTextarea.value = draft.header.justificacion || "";
    } else {
      if (autoCentro && centroSelect) {
        centroSelect.value = autoCentro;
      }
      if (criticidadSelect) {
        criticidadSelect.value = "Normal";
      }
    }

    const continueBtn = $("#btnContinuar");
    if (continueBtn) {
      continueBtn.addEventListener("click", async (ev) => {
        ev.preventDefault();
        const centro = (centroSelect?.value || "").trim();
        const almacen = (almacenSelect?.value || "").trim();
        const sector = (sectorInput?.value || "").trim();
        const just = (justTextarea?.value || "").trim();
        const centro_costos = (centroCostosInput?.value || "").trim();
        const criticidad = (criticidadSelect?.value || "Normal").trim();
        const fechaNecesidad = (fechaNecesidadInput?.value || "").trim();

        const fechaValida = fechaNecesidad && !Number.isNaN(Date.parse(fechaNecesidad));

        if (!centro || !sector || !almacen || just.length < 5 || !centro_costos || !criticidad || !fechaValida) {
          toast("Completá todos los campos (justificación > 5 caracteres)");
          return;
        }

        const header = {
          centro,
          sector,
          justificacion: just,
          centro_costos,
          almacen_virtual: almacen,
          criticidad,
          fecha_necesidad: fechaNecesidad,
        };
        const existingDraft = getDraft();
        const userId = currentUserId();
        if (!userId) {
          toast("No se pudo identificar al usuario actual");
          return;
        }

        if (existingDraft?.id) {
          setDraft({ ...existingDraft, header, user: existingDraft.user || userId });
          toast(`Continuando solicitud ${existingDraft.id}`, true);
          window.location.href = "agregar-materiales.html";
          return;
        }

        continueBtn.disabled = true;
        try {
          const body = { id_usuario: userId, ...header };
          const resp = await api("/solicitudes/drafts", {
            method: "POST",
            body: JSON.stringify(body),
          });
          const newDraft = { id: resp.id, header, items: [], user: userId };
          setDraft(newDraft);
          if (idHidden) idHidden.value = resp.id;
          toast(`Solicitud ${resp.id} creada. Continúa con los materiales.`, true);
          setTimeout(() => {
            window.location.href = "agregar-materiales.html";
          }, 600);
        } catch (err) {
          toast(err.message);
        } finally {
          continueBtn.disabled = false;
        }
      });
    }
    finalizePage();
    return;
  }

  if (path === "agregar-materiales.html") {
    const draft = getDraft();
    if (!draft || !draft.id) {
      toast("No se encontró la información de la solicitud. Volviendo al paso 1.");
      setTimeout(() => (window.location.href = "crear-solicitud.html"), 2000);
      return;
    }

    const userId = currentUserId();
    if (draft.user && userId && draft.user !== userId) {
      setDraft(null);
      toast("La sesión cambió. Iniciá nuevamente la solicitud.");
      setTimeout(() => (window.location.href = "crear-solicitud.html"), 2000);
      return;
    }

    state.selected = null;
    state.cache = new Map();
    state.items = Array.isArray(draft.items)
      ? draft.items.map((item) => ({
          codigo: item.codigo,
          descripcion: item.descripcion,
          unidad: item.unidad || item.uom || item.unidad_medida || "",
          precio: Number(item.precio ?? item.precio_unitario ?? 0),
          cantidad: Math.max(1, Number(item.cantidad) || 1),
        }))
      : [];
    renderCart(state.items);
    setupMaterialSearch();
    updateMaterialDetailButton();

    const idDisplay = $("#solicitudIdDisplay");
    if (idDisplay) {
      idDisplay.textContent = `#${draft.id}`;
    }

    const detailBtn = $("#btnShowMaterialDetail");
    if (detailBtn) {
      detailBtn.addEventListener("click", (ev) => {
        ev.preventDefault();
        openMaterialDetailModal();
      });
    }

    const modal = $("#materialDetailModal");
    const closeBtn = $("#materialDetailClose");
    if (modal) {
      modal.addEventListener("click", (ev) => {
        if (ev.target === modal) {
          closeMaterialDetailModal();
        }
      });
    }
    if (closeBtn) {
      closeBtn.addEventListener("click", (ev) => {
        ev.preventDefault();
        closeMaterialDetailModal();
      });
    }

    const escHandler = (ev) => {
      if (ev.key === "Escape") {
        closeMaterialDetailModal();
      }
    };
    document.addEventListener("keydown", escHandler);

    on($("#btnAdd"), "click", (ev) => {
      ev.preventDefault();
      addItem();
    });

    const sendButton = $("#btnSend");
    if (sendButton) {
      const submitSolicitud = async (isRetry = false) => {
        if (state.items.length === 0) {
          toast("Agregá al menos un ítem");
          return;
        }
        const latestDraft = getDraft();
        if (!latestDraft || !latestDraft.header) {
          toast("No se encontró el encabezado de la solicitud");
          return;
        }
        const latestUserId = currentUserId();
        if (!latestUserId) {
          toast("No se pudo identificar al usuario actual");
          return;
        }
        const almacenVirtual = latestDraft.header.almacen_virtual || getDefaultAlmacenValue() || "";
        const criticidad = latestDraft.header.criticidad || "Normal";
        const fechaNecesidad =
          latestDraft.header.fecha_necesidad || new Date().toISOString().split("T")[0];
        if (!almacenVirtual) {
          toast("Seleccioná un almacén virtual en el paso anterior");
          return;
        }
        const payloadItems = state.items.map((item) => ({
          codigo: item.codigo,
          descripcion: item.descripcion,
          cantidad: item.cantidad,
          precio_unitario: Number(item.precio ?? 0),
          unidad: item.unidad || "",
        }));
        const body = {
          id_usuario: latestUserId,
          centro: latestDraft.header.centro,
          sector: latestDraft.header.sector,
          justificacion: latestDraft.header.justificacion,
          centro_costos: latestDraft.header.centro_costos,
          almacen_virtual: almacenVirtual,
          criticidad,
          fecha_necesidad: fechaNecesidad,
          items: payloadItems,
        };
        const finalize = async (draftId) => {
          await api(`/solicitudes/${draftId}`, {
            method: "PUT",
            body: JSON.stringify(body),
          });
          state.items = [];
          renderCart(state.items);
          setDraft(null);
          toast(`Solicitud ${draftId} enviada 🚀`, true);
          setTimeout(() => {
            window.location.href = "mis-solicitudes.html";
          }, 1500);
        };

        sendButton.disabled = true;
        try {
          await finalize(latestDraft.id);
        } catch (err) {
          if (!isRetry && isNotFoundError(err)) {
            const recreatedId = await recreateDraft(latestDraft, latestUserId);
            if (recreatedId) {
              body.id_usuario = latestUserId;
              await finalize(recreatedId);
              return;
            }
          }
          toast(err.message);
        } finally {
          sendButton.disabled = false;
        }
      };

      sendButton.addEventListener("click", (ev) => {
        ev.preventDefault();
        submitSolicitud();
      });
    }

    const draftButton = $("#btnSaveDraft");
    if (draftButton) {
      draftButton.addEventListener("click", (ev) => {
        ev.preventDefault();
        saveDraft();
      });
    }
    return;
  }

  if (path === "mis-solicitudes.html") {
    on($("#btnRefresh"), "click", (ev) => {
      ev.preventDefault();
      refresh();
    });
  const modal = $("#solicitudDetailModal");
  const closeBtn = $("#detailClose");
  const closeFooterBtn = $("#btnCloseDetail");
    if (modal) {
      modal.addEventListener("click", (ev) => {
        if (ev.target === modal) {
          closeSolicitudDetailModal();
        }
      });
    }
    if (closeBtn) {
      closeBtn.addEventListener("click", (ev) => {
        ev.preventDefault();
        closeSolicitudDetailModal();
      });
    }
    if (closeFooterBtn) {
      closeFooterBtn.addEventListener("click", (ev) => {
        ev.preventDefault();
        closeSolicitudDetailModal();
      });
    }
    const cancelBtn = $("#btnRequestCancel");
    if (cancelBtn) {
      cancelBtn.addEventListener("click", (ev) => {
        ev.preventDefault();
        requestCancelSelectedSolicitud();
      });
    }
    const editDraftBtn = $("#btnEditDraft");
    if (editDraftBtn) {
      editDraftBtn.addEventListener("click", (ev) => {
        ev.preventDefault();
        resumeDraftFromDetail();
      });
    }
    document.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape") {
        closeSolicitudDetailModal();
      }
    });
    await refresh();
    const pendingSolicitudId = sessionStorage.getItem(PENDING_SOLICITUD_KEY);
    if (pendingSolicitudId) {
      sessionStorage.removeItem(PENDING_SOLICITUD_KEY);
      await openSolicitudDetail(Number(pendingSolicitudId));
    }
    return;
  }

  if (path === "mi-cuenta.html") {
    renderAccountDetails();
    return;
  }
});

