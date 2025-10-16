// Calcula la URL base del backend. Preferimos hablar con el mismo origen
// para evitar problemas de CSP/CORS cuando se sirve tras Nginx.
window.addEventListener('error', (e) => {
  const box = document.createElement('div');
  Object.assign(box.style, {
    position:'fixed', bottom:'0', left:'0', right:'0',
    background:'#300', color:'#fff', padding:'8px', font:'12px/1.4 monospace', zIndex:99999
  });
  box.textContent = 'JS error: ' + (e?.error?.stack || e.message || e.toString());
  document.body.appendChild(box);
});
const API = (function () {
  if (location.protocol === "file:") {
    return "http://127.0.0.1:5000/api";
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

const ICONS = {
  pencil: `
    <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
      <path d="M3 17.25V21h3.75l11-11-3.75-3.75-11 11ZM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83Z"></path>
    </svg>
  `,
  plus: `
    <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
      <path d="M13 11V5a1 1 0 0 0-2 0v6H5a1 1 0 0 0 0 2h6v6a1 1 0 0 0 2 0v-6h6a1 1 0 0 0 0-2Z"></path>
    </svg>
  `,
};

const centersRequestState = {
  modal: null,
  selected: new Set(),
  options: [],
  existing: new Set(),
  keyListenerBound: false,
};

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
let authPageInitialized = false;

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
    admin: null,
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
    state.notifications.admin = resp.admin || null;
    updateNotificationBadge();

    // Show notification popup for unread notifications
    if (state.notifications.unread > 0 && !options.markAsRead) {
      const latestUnread = state.notifications.items.find(item => !item.leido);
      if (latestUnread) {
        showNotificationPopup(`Tienes ${state.notifications.unread} notificación(es) pendiente(s)`);
      }
    }

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

function showNotificationPopup(message) {
  const popup = $("#notificationPopup");
  const textEl = $("#notificationText");
  const closeBtn = $("#notificationClose");
  
  if (!popup || !textEl) return;
  
  textEl.textContent = message;
  popup.classList.remove("hide");
  
  // Auto-hide after 5 seconds
  setTimeout(() => {
    hideNotificationPopup();
  }, 5000);
  
  // Close button handler
  if (closeBtn) {
    closeBtn.onclick = hideNotificationPopup;
  }
}

function hideNotificationPopup() {
  const popup = $("#notificationPopup");
  if (popup) {
    popup.classList.add("hide");
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
    
    // Si hay una solicitud abierta en el modal de detalles, recargar sus detalles
    if (state.selectedSolicitud && state.selectedSolicitud.id === numericId && status === "en_tratamiento") {
      await openSolicitudDetail(numericId);
    }
  } catch (err) {
    toast(err.message || "No se pudo registrar la decisión");
  } finally {
    if (triggerBtn) {
      triggerBtn.disabled = false;
    }
  }
}

async function decideCentroRequest(id, action, triggerBtn) {
  if (!id || !action) {
    return;
  }
  const numericId = Number(id);
  if (!Number.isFinite(numericId) || numericId <= 0) {
    return;
  }

  let comentario = null;
  if (action === "aprobar") {
    const confirmed = window.confirm(`¿Confirmás aprobar la solicitud de centros #${numericId}?`);
    if (!confirmed) {
      return;
    }
  } else if (action === "rechazar") {
    const reason = window.prompt(
      `Motivo del rechazo para la solicitud de centros #${numericId} (opcional):`,
      ""
    );
    if (reason === null) {
      return;
    }
    comentario = reason.trim() || null;
    const confirmed = window.confirm(`¿Confirmás rechazar la solicitud de centros #${numericId}?`);
    if (!confirmed) {
      return;
    }
  } else {
    return;
  }

  if (triggerBtn) {
    triggerBtn.disabled = true;
    triggerBtn.setAttribute("aria-busy", "true");
  }

  try {
    const body = { accion: action };
    if (comentario) {
      body.comentario = comentario;
    }
    const resp = await api(`/notificaciones/centros/${numericId}/decision`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    if (!resp?.ok) {
      throw new Error(resp?.error?.message || "No se pudo registrar la decisión");
    }
    const estado = (resp.estado || "").toLowerCase();
    let okMsg = "Decisión registrada";
    if (estado === "aprobado") {
      okMsg = "Solicitud de centros aprobada";
    } else if (estado === "rechazado") {
      okMsg = "Solicitud de centros rechazada";
    }
    toast(okMsg, true);
    const updated = await loadNotificationsSummary();
    renderNotificationsPage(updated);
  } catch (err) {
    toast(err.message || "No se pudo registrar la decisión");
  } finally {
    if (triggerBtn) {
      triggerBtn.disabled = false;
      triggerBtn.removeAttribute("aria-busy");
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

function bindCentroRequestActions() {
  const container = document.getElementById("adminCentroRequestsContainer");
  if (!container || container.dataset.actionsBound === "1") {
    return;
  }
  container.dataset.actionsBound = "1";
  container.addEventListener("click", async (event) => {
    const button = event.target?.closest?.("button[data-center-request-id][data-action]");
    if (!button) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const action = button.dataset.action;
    const id = button.dataset.centerRequestId;
    await decideCentroRequest(id, action, button);
  });
}

function renderNotificationsPage(data) {
  const adminData = data?.admin ?? state.notifications.admin;
  const isAdmin = Boolean(adminData?.is_admin);
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
  const pendingHelper = pendingSection?.querySelector(".helper");
  const isAprobador = typeof state.me?.rol === "string" && state.me.rol.toLowerCase().includes("aprobador");
  const shouldShowPending = (isAprobador || isAdmin) && pending && pending.length;

  if (pendingSection) {
    if (pendingHelper) {
      pendingHelper.textContent = isAdmin
        ? "Todas las solicitudes pendientes de aprobacion."
        : "Estas solicitudes requieren tu accion como aprobador.";
    }
    if (!shouldShowPending) {
      pendingSection.style.display = "none";
    } else {
      pendingSection.style.display = "block";
    }
  }
  if (pendingTable) {
    pendingTable.innerHTML = "";
  }

  if (shouldShowPending && pendingSection) {
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
  } else if (pendingSection) {
    const tableWrapper = document.getElementById("pendingApprovalsTable");
    if (tableWrapper) tableWrapper.style.display = "none";
    if (pendingEmpty) pendingEmpty.style.display = "block";
  }

  bindPendingApprovalActions();
  if (pendingSection) {
    refreshSortableTables(pendingSection);
  }

  const centroSection = document.getElementById("adminCentroRequestsSection");
  const centroContainer = document.getElementById("adminCentroRequestsContainer");
  const centroEmpty = document.getElementById("adminCentroRequestsEmpty");
  if (centroSection) {
    if (!isAdmin) {
      centroSection.style.display = "none";
    } else {
      const requests = Array.isArray(adminData?.centro_requests) ? adminData.centro_requests : [];
      if (centroContainer) {
        centroContainer.innerHTML = "";
      }
      if (requests.length && centroContainer) {
        requests.forEach((request) => {
          const card = document.createElement("article");
          card.className = "admin-request-card";
          const centers = Array.isArray(request.centros) ? request.centros : [];
          const centersMarkup = centers.length
            ? `<ul class="admin-request-card__centers">${centers
                .map((value) => `<li>${escapeHtml(String(value))}</li>`)
                .join("")}</ul>`
            : "";
          const motivoMarkup = request.motivo
            ? `<div class="admin-request-card__body"><p>${escapeHtml(String(request.motivo))}</p></div>`
            : `<div class="admin-request-card__body"><p class="muted">Sin motivo proporcionado.</p></div>`;
          const metaParts = [];
          if (request.mail) {
            metaParts.push(escapeHtml(String(request.mail)));
          }
          metaParts.push(formatDateTime(request.created_at));
          const actionsMarkup = `
            <div class="admin-request-card__actions">
              <button type="button" class="btn pri" data-center-request-id="${escapeHtml(
                String(request.id)
              )}" data-action="aprobar">Aprobar</button>
              <button type="button" class="btn danger" data-center-request-id="${escapeHtml(
                String(request.id)
              )}" data-action="rechazar">Rechazar</button>
            </div>
          `;
          card.innerHTML = `
            <div class="admin-request-card__header">
              <span class="admin-request-card__title">${escapeHtml(request.solicitante || request.usuario_id || "Usuario")}</span>
              <div class="admin-request-card__meta">
                <span>ID ${escapeHtml(String(request.id))}</span>
                ${metaParts.map((part) => `<span>${part}</span>`).join("")}
              </div>
            </div>
            ${centersMarkup}
            ${motivoMarkup}
            ${actionsMarkup}
          `;
          centroContainer.appendChild(card);
        });
        centroSection.style.display = "block";
        if (centroEmpty) centroEmpty.style.display = "none";
      } else {
        centroSection.style.display = "block";
        if (centroEmpty) centroEmpty.style.display = "block";
      }
    }
  }

  bindCentroRequestActions();
  const newUsersSection = document.getElementById("adminNewUsersSection");
  const newUsersContainer = document.getElementById("adminNewUsersContainer");
  const newUsersEmpty = document.getElementById("adminNewUsersEmpty");
  if (newUsersSection) {
    if (!isAdmin) {
      newUsersSection.style.display = "none";
    } else {
      const users = Array.isArray(adminData?.new_users) ? adminData.new_users : [];
      if (newUsersContainer) {
        newUsersContainer.innerHTML = "";
      }
      if (users.length && newUsersContainer) {
        users.forEach((user) => {
          const card = document.createElement("article");
          card.className = "admin-request-card";
          const status = (user.estado || "Pendiente").trim();
          const metaParts = [];
          if (user.mail) {
            metaParts.push(escapeHtml(String(user.mail)));
          }
          metaParts.push(escapeHtml(String(user.rol || "")));
          card.innerHTML = `
            <div class="admin-request-card__header">
              <span class="admin-request-card__title">${escapeHtml(`${user.nombre || ""} ${user.apellido || ""}`.trim() || user.id || "Usuario")}</span>
              <div class="admin-request-card__meta">
                <span>ID ${escapeHtml(String(user.id || ""))}</span>
                ${metaParts.map((part) => `<span>${part}</span>`).join("")}
                <span class="admin-request-card__badge">${escapeHtml(status)}</span>
              </div>
            </div>
          `;
          newUsersContainer.appendChild(card);
        });
        newUsersSection.style.display = "block";
        if (newUsersEmpty) newUsersEmpty.style.display = "none";
      } else {
        newUsersSection.style.display = "block";
        if (newUsersEmpty) newUsersEmpty.style.display = "block";
      }
    }
  }
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
  // Mostrar modal de registro
  $("#registerModal").classList.remove("hide");
  $("#registerId").focus();
}

async function submitRegister() {
  const id = $("#registerId").value.trim();
  const password = $("#registerPassword").value;
  const nombre = $("#registerNombre").value.trim();
  const apellido = $("#registerApellido").value.trim();
  const rol = $("#registerRol").value;

  if (!id || !password || !nombre || !apellido) {
    toast("Todos los campos son requeridos");
    return;
  }

  if (password.length < 6) {
    toast("La contraseña debe tener al menos 6 caracteres");
    return;
  }

  try {
    await api("/register", {
      method: "POST",
      body: JSON.stringify({ id, password, nombre, apellido, rol }),
    });
    toast("Usuario registrado ✅. Ahora puede iniciar sesión.", true);
    closeRegisterModal();
  } catch (err) {
    toast(err.message);
  }
}

function closeRegisterModal() {
  $("#registerModal").classList.add("hide");
  $("#registerForm").reset();
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
  const aprobadorEl = $("#detailAprobador");
  const planificadorEl = $("#detailPlanificador");
  const cancelInfo = $("#detailCancelInfo");
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
  if (aprobadorEl) {
    aprobadorEl.textContent = detail.aprobador_nombre || "—";
  }
  if (planificadorEl) {
    planificadorEl.textContent = detail.planner_nombre || "—";
  }

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

function normalizeCentroCode(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function buildCentersRequestOptions() {
  const ownedValues = parseCentrosList(state.me?.centros);
  const owned = new Set(ownedValues.map(normalizeCentroCode).filter(Boolean));
  centersRequestState.existing = owned;
  const seen = new Set();
  const options = [];
  const pushOption = (code, name, description) => {
    const normalized = normalizeCentroCode(code);
    if (!normalized || seen.has(normalized)) {
      return;
    }
    const cleanName = name ? String(name).trim() : "";
    const cleanDescription = description ? String(description).trim() : "";
    const parts = [normalized];
    if (cleanName && cleanName.toUpperCase() !== normalized) {
      parts.push(cleanName);
    }
    const display = parts.join(" - ");
    options.push({
      code: normalized,
      name: cleanName,
      description: cleanDescription,
      label: display,
      disabled: owned.has(normalized),
    });
    seen.add(normalized);
  };
  const catalogCentros = getCatalogItems("centros", { activeOnly: true });
  catalogCentros.forEach((item) => pushOption(item?.codigo, item?.nombre, item?.descripcion));
  if (!options.length) {
    DEFAULT_CENTROS.forEach((code) => pushOption(code, null, null));
  }
  options.sort((a, b) => a.code.localeCompare(b.code, "es", { numeric: true, sensitivity: "base" }));
  return options;
}

function ensureCentersRequestModal() {
  if (centersRequestState.modal) {
    return centersRequestState.modal;
  }
  const modal = document.createElement("div");
  modal.id = "centersRequestModal";
  modal.className = "modal hide";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("aria-labelledby", "centersModalTitle");
  modal.innerHTML = `
    <div class="modal-content centers-modal" role="document">
      <button type="button" class="modal-close" id="centersModalClose" aria-label="Cerrar">&times;</button>
      <h2 id="centersModalTitle">Solicitar acceso a centros</h2>
      <p class="centers-modal__intro">Selecciona uno o mas centros disponibles y enviaremos la solicitud al equipo administrador.</p>
      <div class="centers-modal__controls">
        <label class="centers-modal__search" for="centersModalSearch">
          <span class="sr-only">Buscar centros</span>
          <input type="search" id="centersModalSearch" placeholder="Buscar por codigo o nombre" autocomplete="off"/>
        </label>
        <span class="centers-modal__summary"><span id="centersSelectedCount">0</span> seleccionados</span>
      </div>
      <div class="centers-cascade" id="centersCascadeList" role="listbox" aria-multiselectable="true"></div>
      <label class="centers-modal__reason-label" for="centersModalReason">Motivo (opcional)</label>
      <textarea id="centersModalReason" placeholder="Describe por que necesitas acceso a estos centros..." rows="3"></textarea>
      <div class="centers-modal__footer">
        <button type="button" class="btn sec" id="centersModalCancel">Cancelar</button>
        <button type="button" class="btn pri" id="centersModalSubmit" disabled>Solicitar</button>
      </div>
    </div>
  `;
  modal.addEventListener("click", (ev) => {
    if (ev.target === modal) {
      closeCentersRequestModal();
    }
  });
  document.body.appendChild(modal);
  modal.querySelector("#centersModalClose")?.addEventListener("click", () => {
    closeCentersRequestModal();
  });
  modal.querySelector("#centersModalCancel")?.addEventListener("click", (ev) => {
    ev.preventDefault();
    closeCentersRequestModal();
  });
  modal.querySelector("#centersModalSubmit")?.addEventListener("click", (ev) => {
    ev.preventDefault();
    submitCentersRequest();
  });
  modal.querySelector("#centersModalSearch")?.addEventListener("input", (ev) => {
    renderCentersCascade(ev.target.value || "");
  });
  if (!centersRequestState.keyListenerBound) {
    document.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape" && centersRequestState.modal && !centersRequestState.modal.classList.contains("hide")) {
        closeCentersRequestModal();
      }
    });
    centersRequestState.keyListenerBound = true;
  }
  centersRequestState.modal = modal;
  return modal;
}

function updateCentersSelectionSummary() {
  const count = centersRequestState.selected.size;
  const summary = document.getElementById("centersSelectedCount");
  if (summary) {
    summary.textContent = String(count);
  }
  const submitBtn = document.getElementById("centersModalSubmit");
  if (submitBtn && !submitBtn.dataset.loading) {
    submitBtn.disabled = count === 0;
    submitBtn.textContent = count > 0 ? `Solicitar (${count})` : "Solicitar";
  }
}

function renderCentersCascade(searchTerm = "") {
  const list = document.getElementById("centersCascadeList");
  if (!list) {
    return;
  }
  const query = String(searchTerm || "").trim().toLowerCase();
  const options = centersRequestState.options || [];
  const filtered = options.filter((opt) => {
    const haystack = `${opt.code} ${opt.name} ${opt.description}`.toLowerCase();
    return !query || haystack.includes(query);
  });
  if (!filtered.length) {
    list.innerHTML = '<div class="centers-cascade__empty">No encontramos centros que coincidan con la busqueda.</div>';
    updateCentersSelectionSummary();
    return;
  }
  const markup = filtered
    .map((opt) => {
      const isSelected = centersRequestState.selected.has(opt.code);
      const disabled = opt.disabled;
      const classes = ["centers-cascade__option"];
      if (disabled) classes.push("is-disabled");
      if (isSelected) classes.push("is-selected");
      const nameMarkup = opt.name
        ? `<span class="centers-cascade__name">${escapeHtml(opt.name)}</span>`
        : "";
      const descriptionMarkup =
        opt.description && opt.description !== opt.name
          ? `<span class="centers-cascade__description">${escapeHtml(opt.description)}</span>`
          : "";
      const statusMarkup = disabled ? '<span class="centers-cascade__badge">Ya asignado</span>' : "";
      return `
        <label class="${classes.join(" ")}">
          <div class="centers-cascade__content">
            <div class="centers-cascade__row">
              <span class="centers-cascade__code">${escapeHtml(opt.code)}</span>
              ${nameMarkup}
              ${statusMarkup}
            </div>
            ${descriptionMarkup}
          </div>
          <div class="centers-cascade__control">
            <input type="checkbox" value="${escapeHtml(opt.code)}" ${isSelected ? "checked" : ""} ${disabled ? "disabled" : ""}/>
            <span class="centers-cascade__indicator" aria-hidden="true"></span>
          </div>
        </label>
      `;
    })
    .join("");
  list.innerHTML = markup;
  list.querySelectorAll('input[type="checkbox"]').forEach((input) => {
    input.addEventListener("change", () => {
      const value = normalizeCentroCode(input.value);
      if (!value) {
        return;
      }
      if (input.checked) {
        centersRequestState.selected.add(value);
      } else {
        centersRequestState.selected.delete(value);
      }
      const option = input.closest(".centers-cascade__option");
      if (option) {
        option.classList.toggle("is-selected", input.checked);
      }
      updateCentersSelectionSummary();
    });
  });
  updateCentersSelectionSummary();
}

function openCentersRequestModal() {
  const modal = ensureCentersRequestModal();
  centersRequestState.selected = new Set();
  centersRequestState.options = buildCentersRequestOptions();
  const searchInput = document.getElementById("centersModalSearch");
  if (searchInput) {
    searchInput.value = "";
  }
  const reasonInput = document.getElementById("centersModalReason");
  if (reasonInput) {
    reasonInput.value = "";
  }
  renderCentersCascade("");
  modal.classList.remove("hide");
  if (searchInput) {
    searchInput.focus({ preventScroll: true });
  }
}

function closeCentersRequestModal() {
  if (!centersRequestState.modal) {
    return;
  }
  centersRequestState.modal.classList.add("hide");
  centersRequestState.selected.clear();
  updateCentersSelectionSummary();
}

async function submitCentersRequest() {
  if (!state.me) {
    toast("Inicia sesion para solicitar centros");
    return;
  }
  const count = centersRequestState.selected.size;
  if (count === 0) {
    toast("Selecciona al menos un centro");
    return;
  }
  const centros = Array.from(centersRequestState.selected).join(", ");
  const reasonInput = document.getElementById("centersModalReason");
  const motivo = reasonInput ? reasonInput.value.trim() : "";
  const submitBtn = document.getElementById("centersModalSubmit");
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.dataset.loading = "1";
    submitBtn.textContent = "Enviando...";
  }
  try {
    await api("/me/centros/solicitud", {
      method: "POST",
      body: JSON.stringify({ centros, motivo: motivo || null }),
    });
    toast("Solicitud enviada al equipo administrador", true);
    closeCentersRequestModal();
  } catch (err) {
    toast(err.message);
  } finally {
    if (submitBtn) {
      delete submitBtn.dataset.loading;
      updateCentersSelectionSummary();
    }
  }
}

// Funciones para gestión de solicitudes de perfil por administradores

async function loadProfileRequests() {
  try {
    const response = await api("/admin/profile-requests");
    if (!response.ok) {
      throw new Error(response.error?.message || "Error al cargar solicitudes");
    }

    const requests = response.items || [];
    renderProfileRequests(requests);

    // Actualizar contador
    const totalElement = $("#profileRequestsTotal");
    if (totalElement) {
      totalElement.textContent = `${requests.length} solicitud${requests.length !== 1 ? 'es' : ''} pendiente${requests.length !== 1 ? 's' : ''}`;
    }
  } catch (error) {
    console.error(error);
    toast(error.message || "Error al cargar solicitudes de perfil");
  }
}

function renderProfileRequests(requests) {
  const container = $("#profile-requests-container");
  if (!container) return;

  if (requests.length === 0) {
    container.innerHTML = '<div class="no-data">No hay solicitudes pendientes</div>';
    return;
  }

  const html = requests.map(request => `
    <div class="request-card" data-id="${request.id}">
      <div class="request-header">
        <div class="request-info">
          <strong>${request.solicitante}</strong>
          <span class="request-mail">${request.mail || ''}</span>
        </div>
        <div class="request-date">${new Date(request.created_at).toLocaleDateString()}</div>
      </div>
      <div class="request-details">
        <div class="field-info">
          <span class="field-label">Campo:</span> ${request.field_label}
        </div>
        <div class="value-info">
          <div class="current-value">
            <span class="value-label">Valor actual:</span> ${request.current_value || 'No definido'}
          </div>
          <div class="new-value">
            <span class="value-label">Valor solicitado:</span> ${request.new_value}
          </div>
        </div>
        ${request.justification ? `
          <div class="justification">
            <span class="justification-label">Justificación:</span> ${request.justification}
          </div>
        ` : ''}
      </div>
      <div class="request-actions">
        <button class="btn btn-success btn-sm" onclick="processProfileRequest(${request.id}, 'approve')">
          <i class="fas fa-check"></i> Aprobar
        </button>
        <button class="btn btn-danger btn-sm" onclick="processProfileRequest(${request.id}, 'reject')">
          <i class="fas fa-times"></i> Rechazar
        </button>
      </div>
    </div>
  `).join('');

  container.innerHTML = html;
}

async function processProfileRequest(requestId, action) {
  const confirmMessage = action === 'approve'
    ? '¿Estás seguro de aprobar esta solicitud?'
    : '¿Estás seguro de rechazar esta solicitud?';

  if (!confirm(confirmMessage)) return;

  try {
    const response = await api(`/admin/profile-requests/${requestId}`, {
      method: "POST",
      body: JSON.stringify({ action })
    });

    if (response.ok) {
      toast(response.message || `Solicitud ${action === 'approve' ? 'aprobada' : 'rechazada'} correctamente`);
      loadProfileRequests(); // Recargar la lista
    } else {
      throw new Error(response.error?.message || "Error al procesar la solicitud");
    }
  } catch (error) {
    console.error(error);
    toast(error.message || "Error al procesar la solicitud");
  }
}

// Inicializar carga de solicitudes cuando se carga la página de administración
function initAuthPage() {
  if (authPageInitialized) return;
  const authContainer = document.getElementById("auth");
  if (!authContainer) return;

  authPageInitialized = true;

  const handleLogin = (event) => {
    event.preventDefault();
    login();
  };

  const idInput = document.getElementById("id");
  const passwordInput = document.getElementById("pw");
  on(document.getElementById("login"), "click", handleLogin);
  [idInput, passwordInput].forEach((input) => {
    if (input) {
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          login();
        }
      });
    }
  });

  on(document.getElementById("register"), "click", (event) => {
    event.preventDefault();
    register();
  });

  on(document.getElementById("recover"), "click", (event) => {
    event.preventDefault();
    recover();
  });

  on(document.getElementById("help"), "click", (event) => {
    event.preventDefault();
    help();
  });

  const registerForm = document.getElementById("registerForm");
  if (registerForm) {
    registerForm.addEventListener("submit", (event) => {
      event.preventDefault();
      submitRegister();
    });
  }

  [document.getElementById("registerModalClose"), document.getElementById("registerModalCancel")]
    .filter(Boolean)
    .forEach((button) => {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        closeRegisterModal();
      });
    });

  const registerModal = document.getElementById("registerModal");
  if (registerModal) {
    registerModal.addEventListener("click", (event) => {
      if (event.target === registerModal) {
        closeRegisterModal();
      }
    });
  }

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      const modal = document.getElementById("registerModal");
      if (modal && !modal.classList.contains("hide")) {
        event.preventDefault();
        closeRegisterModal();
      }
    }
  });

  if (idInput) idInput.focus();
}

document.addEventListener("DOMContentLoaded", () => {
  const rawPage = window.location.pathname.split("/").pop();
  const currentPage = rawPage && rawPage.length ? rawPage : "index.html";

  if (currentPage === "index.html") {
    initAuthPage();
  } else {
    me().then(() => {
      if (!state.me) {
        window.location.href = "index.html";
        return;
      }

      if (currentPage === "home.html") {
        const userName = `${state.me.nombre} ${state.me.apellido}`.trim();
        const userNameNode = document.getElementById("userName");
        if (userNameNode) userNameNode.textContent = userName;
        initHomeHero(userName);
      }

      if (currentPage === "admin-solicitudes.html") {
        loadProfileRequests();
      }
    }).catch(() => {
      window.location.href = "index.html";
    });
  }
});

// Controlar visibilidad del menú de administración
function updateAdminMenuVisibility() {
  const adminMenuItem = document.getElementById("adminMenuItem");
  if (!adminMenuItem) return;

  const isAdmin = Boolean(state.notifications?.admin?.is_admin);
  if (isAdmin) {
    adminMenuItem.classList.remove("hide");
  } else {
    adminMenuItem.classList.add("hide");
  }
}

// Llamar a la función cuando se actualiza el estado de las notificaciones
const originalRenderNotificationsPage = renderNotificationsPage;
renderNotificationsPage = function(data) {
  originalRenderNotificationsPage(data);
  updateAdminMenuVisibility();
};

// ====== SHIMS DE COMPATIBILIDAD (parche rápido) ======
var fmtMoney   = typeof fmtMoney   === "function" ? fmtMoney   : (v) => formatCurrency(v);
var fmtDateTime= typeof fmtDateTime=== "function" ? fmtDateTime: (v) => formatDateTime(v);
var fmtNumber  = typeof fmtNumber  === "function" ? fmtNumber  : (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString("es-AR") : String(v ?? "");
};
var esc        = typeof esc        === "function" ? esc        : (s) => escapeHtml(s);

var toastOk    = typeof toastOk    === "function" ? toastOk    : (m) => toast(m, true);
var toastErr   = typeof toastErr   === "function" ? toastErr   : (e) => {
  const msg = e?.message || String(e || "Error");
  toast(msg);
  console.error(e);
};
var toastInfo  = typeof toastInfo  === "function" ? toastInfo  : (m) => toast(m);

var skeletonize = typeof skeletonize === "function" ? skeletonize : (sel, opts) => showTableSkeleton(sel, opts);
// =====================================================

// Módulo Planificador
(function initPlanificador() {
  if (!/planificador\.html$/.test(location.pathname)) return;

  const state = {
    pageMias: 0, pagePend: 0, limit: 20,
    filtros: { centro:"", sector:"", almacen:"", criticidad:"", q:"" },
    detalle: null // { id, solicitud, tratamiento, dirty: Set(item_index) }
  };

  // UI refs
  const tblMias = $("#tblMias tbody");
  const tblPend = $("#tblPend tbody");
  const dlg = $("#dlgDetalle");
  const detMsg = $("#detMsg");
  const detId = $("#detId");
  const detMeta = $("#detMeta");
  const tblItems = $("#tblItems tbody");

  // Eventos de filtros y paginación
  $("#frmFilters").addEventListener("submit", (e)=>{ e.preventDefault(); state.pageMias=0; state.pagePend=0; loadQueues(); });
  $("#btnLimpiar").addEventListener("click", ()=>{ /* limpia inputs y reload */ loadQueues(); });
  $("#pgPrevMias").onclick = ()=>{ state.pageMias = Math.max(0, state.pageMias-1); loadQueues({only:"mias"}); };
  $("#pgNextMias").onclick = ()=>{ state.pageMias += 1; loadQueues({only:"mias"}); };
  $("#pgPrevPend").onclick = ()=>{ state.pagePend = Math.max(0, state.pagePend-1); loadQueues({only:"pend"}); };
  $("#pgNextPend").onclick = ()=>{ state.pagePend += 1; loadQueues({only:"pend"}); };

  async function loadQueues(opts={}) {
    skeletonize("#tblMias", {rows:8});
    skeletonize("#tblPend", {rows:8});
    const q = new URLSearchParams({
      limit: state.limit,
      offset_mias: state.pageMias*state.limit,
      offset_pend: state.pagePend*state.limit,
      centro: $("#fCentro").value.trim(),
      sector: $("#fSector").value.trim(),
      almacen_virtual: $("#fAlmacen").value.trim(),
      criticidad: $("#fCriticidad").value,
      q: $("#fQ").value.trim()
    });
    const data = await api(`/planificador/queue?${q.toString()}`);
    renderQueue(data, opts.only);
  }

  function renderQueue(data, only) {
    if (!only || only==="mias") {
      tblMias.innerHTML = data.mias.map(rowToHtml).join("");
      attachRowActions("#tblMias");
      $("#pgInfoMias").textContent = `${data.count.mias} total`;
    }
    if (!only || only==="pend") {
      tblPend.innerHTML = data.pendientes.map(rowToHtml).join("");
      attachRowActions("#tblPend", {pendientes:true});
      $("#pgInfoPend").textContent = `${data.count.pendientes} total`;
    }
    refreshSortableTables();
  }

  function rowToHtml(r) {
    const btn = r.planner_id ?
      `<button class="btn sm view" data-action="ver" data-id="${r.id}">Ver/Editar</button>
       <button class="btn sm ghost liberar" data-action="liberar" data-id="${r.id}">Liberar</button>` :
      `<button class="btn sm take" data-action="tomar" data-id="${r.id}">Tomar</button>`;
    return `
      <tr>
        <td>${r.id}</td>
        <td>${esc(r.centro)}</td>
        <td>${esc(r.sector)}</td>
        <td>${esc(r.criticidad || "-")}</td>
        <td class="num">${fmtMoney(r.total_monto)}</td>
        <td>${fmtDateTime(r.updated_at)}</td>
        <td class="end">${btn}</td>
      </tr>`;
  }

  function attachRowActions(sel, opts={}) {
    document.querySelectorAll(`${sel} [data-action]`).forEach((btn)=>{
      btn.addEventListener("click", async ()=>{
        const id = Number(btn.dataset.id);
        const action = btn.dataset.action;
        try {
          if (action==="tomar") {
            await api(`/planificador/solicitudes/${id}/tomar`, {method:"PATCH"});
            await loadQueues({only:"pend"});
            await openDetalle(id);
          } else if (action==="liberar") {
            await api(`/planificador/solicitudes/${id}/liberar`, {method:"PATCH"});
            await loadQueues({only:"mias"});
          } else if (action==="ver") {
            await openDetalle(id);
          }
        } catch (err) { toastErr(err); }
      });
    });
  }

  async function openDetalle(id) {
    detMsg.textContent = "";
    const data = await api(`/planificador/solicitudes/${id}/tratamiento`);
    state.detalle = { id, data, dirty: new Set() };
    detId.textContent = `#${id}`;
    detMeta.innerHTML = renderMeta(data.solicitud);
    tblItems.innerHTML = data.solicitud.items.map((it, idx)=>itemRow(it, idx, data.tratamiento)).join("");
    dlg.classList.remove("hide");
    bindItemInputs();
  }

  function renderMeta(s) {
    return `
      <div><b>Centro:</b> ${esc(s.centro)} | <b>Sector:</b> ${esc(s.sector)} | <b>Criticidad:</b> ${esc(s.criticidad || "-")}</div>
      <div><b>Justificación:</b> ${esc(s.justificacion || "-")}</div>
      <div><b>Total estimado:</b> <span id="detTotal">${fmtMoney(s.total_monto || 0)}</span></div>
    `;
  }

  function itemRow(it, idx, trat=[]) {
    const tr = trat.find(x=>x.item_index===idx) || {};
    return `
      <tr data-index="${idx}">
        <td>${idx+1}</td>
        <td>${esc(it.codigo)}</td>
        <td>${esc(it.descripcion || "")}</td>
        <td>${esc(it.unidad || "")}</td>
        <td class="num">${fmtNumber(it.cantidad)}</td>
        <td class="num">${fmtMoney(it.precio_unitario || 0)}</td>
        <td>
          <select class="decision">
            ${opt("stock", tr.decision)}${opt("compra", tr.decision)}${opt("servicio", tr.decision)}${opt("equivalente", tr.decision)}
          </select>
        </td>
        <td><input class="cantAprob" type="number" min="0.0001" step="0.0001" value="${tr.cantidad_aprobada ?? it.cantidad}"/></td>
        <td><input class="eqvCodigo" value="${esc(tr.codigo_equivalente || "")}"/></td>
        <td><input class="proveedor" value="${esc(tr.proveedor_sugerido || "")}"/></td>
        <td><input class="precioEst" type="number" min="0" step="0.0001" value="${tr.precio_unitario_estimado ?? (it.precio_unitario || 0)}"/></td>
        <td><input class="comentario" value="${esc(tr.comentario || "")}"/></td>
      </tr>`;
  }
  const opt = (v, cur)=>`<option value="${v}" ${cur===v?"selected":""}>${v}</option>`;

  function bindItemInputs() {
    tblItems.querySelectorAll("input,select").forEach(inp=>{
      inp.addEventListener("change", ()=>{
        const tr = inp.closest("tr"); const idx = Number(tr.dataset.index);
        state.detalle.dirty.add(idx);
        recalcTotal();
      });
    });
    $("#btnGuardarItems").onclick = saveItems;
    $("#btnFinalizar").onclick = finalizar;
    $("#btnRechazar").onclick = rechazar;
    $("#btnLiberar").onclick = liberar;
    $("#btnCerrar").onclick = ()=> dlg.classList.add("hide");
    $("#btnAISuggestions").onclick = loadAISuggestions;
  }

  async function loadAISuggestions() {
    const id = state.detalle.id;
    try {
      const data = await api(`/ai/suggest/solicitud/${id}`);
      renderAISuggestions(data.suggestions);
      $("#aiPanel").classList.remove("hide");
    } catch (err) {
      toastErr(err);
    }
  }

  function renderAISuggestions(suggestions) {
    const container = $("#aiSuggestions");
    container.innerHTML = suggestions.map(s => `
      <div class="ai-suggestion ${getConfidenceClass(s.confidence)}">
        <div class="ai-suggestion__header">
          <div class="ai-suggestion__title">${esc(s.title)}</div>
          <div class="ai-suggestion__confidence">${Math.round(s.confidence * 100)}%</div>
        </div>
        <div class="ai-suggestion__reason">${esc(s.reason)}</div>
        <div class="ai-suggestion__sources">
          ${s.sources.map(src => `<span class="ai-suggestion__source">${esc(src)}</span>`).join("")}
        </div>
        <div class="ai-suggestion__actions">
          <button class="ai-suggestion__apply" data-type="${s.type}" data-payload='${JSON.stringify(s.payload)}' data-item-index="${s.item_index}">Aplicar</button>
          <button class="ai-suggestion__reject" data-type="${s.type}" data-item-index="${s.item_index}">Descartar</button>
        </div>
      </div>
    `).join("");

    // Bind events
    container.querySelectorAll(".ai-suggestion__apply").forEach(btn => {
      btn.onclick = () => applyAISuggestion(btn.dataset.type, JSON.parse(btn.dataset.payload), Number(btn.dataset.itemIndex));
    });
    container.querySelectorAll(".ai-suggestion__reject").forEach(btn => {
      btn.onclick = () => rejectAISuggestion(btn.dataset.type, Number(btn.dataset.itemIndex));
    });
  }

  function getConfidenceClass(conf) {
    if (conf >= 0.8) return "high-confidence";
    if (conf >= 0.6) return "medium-confidence";
    return "low-confidence";
  }

  async function applyAISuggestion(type, payload, itemIndex) {
    const id = state.detalle.id;
    try {
      await api("/ai/suggest/accept", {
        method: "POST",
        body: JSON.stringify({ solicitud_id: id, item_index: itemIndex, type, payload })
      });
      toastOk("Sugerencia aplicada");
      // Refresh detalle
      await openDetalle(id);
    } catch (err) {
      toastErr(err);
    }
  }

  async function rejectAISuggestion(type, itemIndex) {
    const id = state.detalle.id;
    try {
      await api("/ai/suggest/reject", {
        method: "POST",
        body: JSON.stringify({ solicitud_id: id, item_index: itemIndex, type })
      });
      toastOk("Sugerencia descartada");
      // Remove from UI
      const suggestion = event.target.closest(".ai-suggestion");
      if (suggestion) suggestion.remove();
    } catch (err) {
      toastErr(err);
    }
  }

  function recalcTotal() {
    let total = 0;
    tblItems.querySelectorAll("tr").forEach(tr=>{
      const dec = tr.querySelector(".decision").value;
      const cant = Number(tr.querySelector(".cantAprob").value || 0);
      const precio = Number(tr.querySelector(".precioEst").value || 0);
      if (dec==="compra" || dec==="equivalente") total += cant * precio;
    });
    $("#detTotal").textContent = fmtMoney(total);
  }

  async function saveItems() {
    const id = state.detalle.id;
    const items = [];
    state.detalle.dirty.forEach(idx=>{
      const tr = tblItems.querySelector(`tr[data-index="${idx}"]`);
      items.push({
        item_index: idx,
        decision: tr.querySelector(".decision").value,
        cantidad_aprobada: Number(tr.querySelector(".cantAprob").value),
        codigo_equivalente: tr.querySelector(".eqvCodigo").value.trim() || null,
        proveedor_sugerido: tr.querySelector(".proveedor").value.trim() || null,
        precio_unitario_estimado: Number(tr.querySelector(".precioEst").value || 0),
        comentario: tr.querySelector(".comentario").value.trim() || null
      });
    });
    if (!items.length) { toastInfo("No hay cambios"); return; }
    await api(`/planificador/solicitudes/${id}/tratamiento/items`, {
      method:"PATCH",
      body: JSON.stringify({ items })
    });
    state.detalle.dirty.clear();
    toastOk("Cambios guardados");
  }

  async function finalizar() {
    const id = state.detalle.id;
    if (!confirm("¿Finalizar tratamiento?")) return;
    await api(`/planificador/solicitudes/${id}/finalizar`, { method:"POST" });
    dlg.classList.add("hide");
    await loadQueues();
  }

  async function rechazar() {
    const id = state.detalle.id;
    const motivo = prompt("Motivo de rechazo (3..500 caracteres):") || "";
    if (motivo.trim().length < 3) return;
    await api(`/planificador/solicitudes/${id}/rechazar`, {
      method:"POST",
      body: JSON.stringify({ motivo })
    });
    dlg.classList.add("hide");
    await loadQueues();
  }

  async function liberar() {
    const id = state.detalle.id;
    await api(`/planificador/solicitudes/${id}/liberar`, { method:"PATCH" });
    dlg.classList.add("hide");
    await loadQueues();
  }

  // Estadísticas
  $("#frmStats").addEventListener("submit", async (e)=>{
    e.preventDefault();
    await loadStats();
  });

  async function loadStats() {
    const qs = new URLSearchParams({
      desde: $("#sDesde").value || "",
      hasta: $("#sHasta").value || ""
    });
    const data = await api(`/planificador/estadisticas?${qs.toString()}`);
    renderStats(data);
  }

  function renderStats(d) {
    $("#statsCards").innerHTML = `
      <div class="card"><div class="k">En tratamiento</div><div class="v">${d.kpis.en_tratamiento}</div></div>
      <div class="card"><div class="k">Finalizadas</div><div class="v">${d.kpis.finalizadas}</div></div>
      <div class="card"><div class="k">Rechazadas</div><div class="v">${d.kpis.rechazadas}</div></div>
      <div class="card"><div class="k">Tiempo prom. (h)</div><div class="v">${fmtNumber(d.kpis.t_hrs_promedio)}</div></div>
    `;
    $("#tblTopCentros tbody").innerHTML = d.top_centros.map(c=>`
      <tr><td>${esc(c.centro)}</td><td class="num">${c.count}</td><td class="num">${fmtMoney(c.monto)}</td></tr>
    `).join("");
  }

  // init
  loadQueues();
  loadStats();
})();