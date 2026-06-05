const syncStatus = document.querySelector("#syncStatus");
let lastCheckedStatus = document.querySelector("#lastCheckedStatus");
if (!lastCheckedStatus && syncStatus) {
  lastCheckedStatus = document.createElement("p");
  lastCheckedStatus.id = "lastCheckedStatus";
  lastCheckedStatus.className = "lastCheckedStatus";
  lastCheckedStatus.textContent = "Last checked: loading...";
  syncStatus.insertAdjacentElement("afterend", lastCheckedStatus);
}
const menuButton = document.querySelector("#menuButton");
const pageMenu = document.querySelector("#pageMenu");
const refreshButton = document.querySelector("#refreshButton");
const searchButton = document.querySelector("#searchButton");
const nameInput = document.querySelector("#nameInput");
const nameSuggestions = document.querySelector("#nameSuggestions");
const emptyState = document.querySelector("#emptyState");
const memberPanel = document.querySelector("#memberPanel");
const memberInfo = document.querySelector("#memberInfo");
const memberName = document.querySelector("#memberName");
const membershipStatus = document.querySelector("#membershipStatus");
const liabilityWaiverStatus = document.querySelector("#liabilityWaiverStatus");
const hireStatus = document.querySelector("#hireStatus");
const memberEmail = document.querySelector("#memberEmail");
const memberPhone = document.querySelector("#memberPhone");
const emergencyName = document.querySelector("#emergencyName");
const emergencyRelationship = document.querySelector("#emergencyRelationship");
const emergencyPhone = document.querySelector("#emergencyPhone");
const emergencyPhone2 = document.querySelector("#emergencyPhone2");
const purchaseSearchInput = document.querySelector("#purchaseSearchInput");
const categoryFilter = document.querySelector("#categoryFilter");
const monthYearFilter = document.querySelector("#monthYearFilter");
const paidFilter = document.querySelector("#paidFilter");
const clearFiltersButton = document.querySelector("#clearFiltersButton");
const filterEmptyState = document.querySelector("#filterEmptyState");
const purchaseGroups = document.querySelector("#purchaseGroups");

let currentMemberPayload = null;
let availableNames = [];
let tableSorts = {};
let memberSearchSequence = 0;
const FRESHNESS_WINDOW_MS = 15 * 60 * 1000;
const initialLastCheckedAt = lastCheckedStatus?.dataset?.lastCheckedAt || "";
const initialLastCheckedAtMs = initialLastCheckedAt ? Date.parse(initialLastCheckedAt) : NaN;
let lastCheckedAtMs = Number.isFinite(initialLastCheckedAtMs) ? initialLastCheckedAtMs : null;

function applyFreshnessTone() {
  if (!lastCheckedStatus) return;

  if (!lastCheckedAtMs) {
    lastCheckedStatus.style.color = "hsl(120, 72%, 45%)";
    return;
  }

  const elapsed = Math.max(0, Date.now() - lastCheckedAtMs);
  const ratio = Math.min(1, elapsed / FRESHNESS_WINDOW_MS);
  const hue = Math.round(120 * (1 - ratio));
  lastCheckedStatus.style.color = `hsl(${hue}, 72%, 45%)`;
}

const swRegister = () => {
  if (!("serviceWorker" in navigator)) {
    return;
  }
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/static/service-worker.js").catch(() => {});
  });
};

swRegister();

const sortableColumns = [
  { key: "date", label: "Date", firstDirection: "desc" },
  { key: "paid", label: "Paid", firstDirection: "asc" },
  { key: "total", label: "Total", firstDirection: "desc" },
  { key: "items", label: "Items", firstDirection: "asc" },
];

function setMenuOpen(open) {
  pageMenu.classList.toggle("hidden", !open);
  menuButton.setAttribute("aria-expanded", String(open));
}

function closeMenu() {
  setMenuOpen(false);
}

function text(value) {
  return value && String(value).trim() ? String(value).trim() : "Not supplied";
}

function escapeAttribute(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function statusMarkup(isCurrent, label, type = "membership") {
  const visible = type === "boat"
    ? '<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><path d="M4 13.2 6.4 7.8h6.9l4.2 5.4H20l-1.7 4.1c-.8.4-1.6.6-2.4.6-1 0-1.8-.3-2.6-.8-.8.5-1.6.8-2.6.8s-1.8-.3-2.6-.8c-.8.5-1.6.8-2.6.8-.7 0-1.4-.2-2.1-.5L2 13.2h2Zm3.7-1.4h7.4l-2.4-3.1H9.1l-1.4 3.1Z" fill="currentColor"></path></svg>'
    : type === "membership"
      ? '<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><path d="M5 6.2c0-1 .8-1.8 1.8-1.8h10.4c1 0 1.8.8 1.8 1.8v11.6c0 1-.8 1.8-1.8 1.8H6.8c-1 0-1.8-.8-1.8-1.8V6.2Zm3.2 3.1h7.6V7.8H8.2v1.5Zm0 3.2h7.6V11H8.2v1.5Zm0 3.2h4.9v-1.5H8.2v1.5Z" fill="currentColor"></path></svg>'
      : type === "liability"
        ? '<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><path d="M7 3.8h7.8L19 8v12.2H7V3.8Zm7 1.9v3h3L14 5.7ZM9 11h8V9.6H9V11Zm0 3.2h8v-1.4H9v1.4Zm0 3.2h5.5V16H9v1.4Z" fill="currentColor"></path></svg>'
        : '<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><path d="M9 4.8h6v2.1h1.4v2H15v10.3c0 1.1-.9 2-2 2h-2c-1.1 0-2-.9-2-2V8.9H7.6v-2H9V4.8Zm1.8 0v2.1h2.4V4.8h-2.4Zm-.1 4.1v10.3c0 .2.1.3.3.3h2c.2 0 .3-.1.3-.3V8.9h-2.6Zm6.9 1.1h1.8v5.6h-1.8V10Z" fill="currentColor"></path></svg>';
  const caption = type === "boat" && !isCurrent ? "overdue" : type === "membership" ? "Member" : type === "liability" ? "Liability" : type === "hire" ? "Gear" : "";
  const captionText = caption ? `<small class="statusBadgeCaption">${caption}</small>` : "";
  const title = label;
  const safeTitle = escapeAttribute(title);
  return `<span class="statusBadgeWrap" title="${safeTitle}" data-tooltip="${safeTitle}" aria-label="${safeTitle}" tabindex="0"><span class="statusBadge statusBadge--${type}" aria-hidden="true">${visible}</span>${captionText}</span>`;
}

function setStatus(payload) {
  const when = payload.at ? new Date(payload.at).toLocaleString() : "never";
  const prefix = payload.ok === false ? "Refresh issue" : "Purchase store";
  syncStatus.textContent = `${prefix}: ${payload.rows || 0} rows. ${payload.message || ""}`;
  lastCheckedStatus.textContent = `Last checked: ${when}`;
  const parsedLastCheckedAt = payload.at ? Date.parse(payload.at) : NaN;
  lastCheckedAtMs = Number.isFinite(parsedLastCheckedAt) ? parsedLastCheckedAt : null;
  applyFreshnessTone();
}

async function refreshStore() {
  refreshButton.disabled = true;
  refreshButton.textContent = "Refreshing";
  try {
    const response = await fetch("/api/refresh", { method: "POST" });
    setStatus(await response.json());
    await loadNames();
  } finally {
    refreshButton.disabled = false;
    refreshButton.textContent = "Refresh";
    closeMenu();
  }
}

async function loadNames() {
  const response = await fetch("/api/names");
  const payload = await response.json();
  availableNames = payload.names;
  renderNameSuggestions();
}

async function loadDefaultTransactions() {
  try {
    const response = await fetch("/api/recent-transactions?days=7");
    const payload = await response.json();
    if (payload?.found) {
      renderMember(payload);
    }
  } catch {
    // no-op on first-load failure
  }
}

function paidClass(value) {
  return String(value).trim().toUpperCase() === "YES" ? "paidYes" : "paidNo";
}

function purchaseMatches(row, category) {
  const query = purchaseSearchInput.value.trim().toLowerCase();
  const selectedCategory = categoryFilter.value;
  const selectedMonthYear = monthYearFilter.value;
  const selectedPaid = paidFilter.value;
  if (currentMemberPayload?.scope === "global_last_week") {
    const timestamp = Date.parse(row.date);
    if (!Number.isFinite(timestamp)) return false;
    const cutoff = Date.now() - (Number(currentMemberPayload.days || 7) * 24 * 60 * 60 * 1000);
    if (timestamp < cutoff || timestamp > Date.now()) return false;
  }
  const rowText = [row.date, row.paid, row.total, row.items].map(text).join(" ").toLowerCase();
  const paidValue = String(row.paid || "").trim().toUpperCase();

  return (
    (!query || rowText.includes(query)) &&
    (!selectedCategory || category === selectedCategory) &&
    (!selectedMonthYear || monthYearKey(row.date) === selectedMonthYear) &&
    (!selectedPaid || paidValue === selectedPaid)
  );
}

function monthYearKey(value) {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return "";
  return new Date(timestamp).toISOString().slice(0, 7);
}

function monthYearLabel(key) {
  if (!key) return "";
  const [year, month] = key.split("-");
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, 1));
  return date.toLocaleString(undefined, { month: "long", year: "numeric", timeZone: "UTC" });
}

function parseDate(value) {
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function parseMoney(value) {
  const amount = Number.parseFloat(String(value || "").replace(/[^0-9.-]/g, ""));
  return Number.isNaN(amount) ? 0 : amount;
}

function sortValue(row, key) {
  if (key === "date") return parseDate(row.date);
  if (key === "total") return parseMoney(row.total);
  return String(row[key] || "").trim().toLowerCase();
}

function sortedRows(category, rows) {
  const sort = tableSorts[category];
  if (!sort) return rows;

  return [...rows].sort((left, right) => {
    const leftValue = sortValue(left, sort.key);
    const rightValue = sortValue(right, sort.key);
    let comparison = 0;

    if (typeof leftValue === "number" && typeof rightValue === "number") {
      comparison = leftValue - rightValue;
    } else {
      comparison = leftValue.localeCompare(rightValue);
    }

    return sort.direction === "asc" ? comparison : -comparison;
  });
}

function closeNameSuggestions() {
  nameSuggestions.classList.add("hidden");
}

function renderNameSuggestions() {
  const query = nameInput.value.trim().toLowerCase();
  const matches = query
    ? availableNames.filter((name) => name.toLowerCase().includes(query))
    : availableNames;

  if (!matches.length) {
    closeNameSuggestions();
    return;
  }

  nameSuggestions.replaceChildren(
    ...matches.map((name) => {
      const button = document.createElement("button");
      button.className = "nameSuggestion";
      button.type = "button";
      button.setAttribute("role", "option");
      button.textContent = name;
      button.addEventListener("click", () => {
        nameInput.value = name;
        closeNameSuggestions();
        searchMember();
      });
      return button;
    })
  );
  nameSuggestions.classList.remove("hidden");
}

function pickFirstRenderedSuggestion() {
  if (nameSuggestions.classList.contains("hidden") || !nameSuggestions.children.length) return false;
  const firstSuggestion = nameSuggestions.querySelector(".nameSuggestion");
  if (firstSuggestion && firstSuggestion.textContent) {
    nameInput.value = firstSuggestion.textContent;
    return true;
  }
  return false;
}

function renderCategoryOptions(categories) {
  categoryFilter.replaceChildren(
    Object.assign(document.createElement("option"), {
      textContent: "All categories",
      value: "",
    }),
    ...categories.map((category) =>
      Object.assign(document.createElement("option"), {
        textContent: category,
        value: category,
      })
    )
  );
}

function renderMonthYearOptions(categories) {
  const monthKeys = [
    ...new Set(Object.values(categories).flat().map((row) => monthYearKey(row.date)).filter(Boolean)),
  ].sort().reverse();

  monthYearFilter.replaceChildren(
    Object.assign(document.createElement("option"), {
      textContent: "All months",
      value: "",
    }),
    ...monthKeys.map((key) =>
      Object.assign(document.createElement("option"), {
        textContent: monthYearLabel(key),
        value: key,
      })
    )
  );
}

function tableCell(value) {
  const cell = document.createElement("td");
  cell.textContent = text(value);
  return cell;
}

function renderTableHead(category) {
  const thead = document.createElement("thead");
  const tr = document.createElement("tr");
  const activeSort = tableSorts[category];

  sortableColumns.forEach((column) => {
    const th = document.createElement("th");
    const button = document.createElement("button");
    const isActive = activeSort?.key === column.key;
    const indicator = isActive ? (activeSort.direction === "asc" ? " ↑" : " ↓") : "";

    button.className = `sortButton${isActive ? " activeSort" : ""}`;
    button.type = "button";
    button.textContent = `${column.label}${indicator}`;
    button.setAttribute("aria-label", `Sort ${category} by ${column.label}`);
    button.addEventListener("click", () => {
      const currentSort = tableSorts[category];
      tableSorts[category] = {
        key: column.key,
        direction:
          currentSort?.key === column.key && currentSort.direction === column.firstDirection
            ? column.firstDirection === "asc"
              ? "desc"
              : "asc"
            : column.firstDirection,
      };
      renderPurchases();
    });

    th.append(button);
    tr.append(th);
  });

  thead.append(tr);
  return thead;
}

function renderPurchases() {
  if (!currentMemberPayload?.found) return;

  purchaseGroups.replaceChildren();
  const categories = Object.keys(currentMemberPayload.categories);
  let visibleRows = 0;

  categories.forEach((category) => {
    const rows = sortedRows(
      category,
      currentMemberPayload.categories[category].filter((row) => purchaseMatches(row, category))
    );
    if (!rows.length) return;

    const section = document.createElement("section");
    section.className = "panel categorySection";

    const heading = document.createElement("h3");
    heading.textContent = category;
    section.append(heading);

    const table = document.createElement("table");
    table.append(renderTableHead(category), document.createElement("tbody"));
    const tbody = table.querySelector("tbody");
    rows.forEach((row) => {
      const tr = document.createElement("tr");
      const paidCell = document.createElement("td");
      const paidBadge = document.createElement("span");
      paidBadge.className = `paidBadge ${paidClass(row.paid)}`;
      paidBadge.textContent = text(row.paid);

      paidCell.append(paidBadge);
      tr.append(tableCell(row.date), paidCell, tableCell(row.total), tableCell(row.items));
      tbody.append(tr);
      visibleRows += 1;
    });
    section.append(table);
    purchaseGroups.append(section);
  });

  filterEmptyState.classList.toggle("hidden", visibleRows > 0);
}

function renderMember(payload) {
  currentMemberPayload = payload;
  [membershipStatus, liabilityWaiverStatus, hireStatus].forEach((statusElement) => {
    statusElement.classList.remove("isCurrentMember", "isNotCurrentMember");
    statusElement.innerHTML = "";
  });
  hireStatus.classList.add("hidden");

  if (!payload.found) {
    memberPanel.classList.add("hidden");
    emptyState.classList.remove("hidden");
    emptyState.textContent = "No exact member match found. Pick a name from the suggestions.";
    return;
  }

  emptyState.classList.add("hidden");
  memberPanel.classList.remove("hidden");
  memberInfo.open = false;
  memberName.textContent = payload.name;
  const isGlobalView = payload.scope === "global_last_week";
  memberInfo.classList.toggle("hidden", isGlobalView);
  const isCurrentMember = Boolean(payload.membership_status?.is_current);
  if (isGlobalView) {
    membershipStatus.classList.add("hidden");
    liabilityWaiverStatus.classList.add("hidden");
  } else {
    membershipStatus.classList.remove("hidden");
    liabilityWaiverStatus.classList.remove("hidden");
    membershipStatus.classList.toggle("isCurrentMember", isCurrentMember);
    membershipStatus.classList.toggle("isNotCurrentMember", !isCurrentMember);
    membershipStatus.innerHTML = statusMarkup(
      isCurrentMember,
      payload.membership_status?.label || "Membership",
      "membership"
    );
  }
  const hasCurrentLiabilityWaiver = Boolean(payload.liability_waiver_status?.is_current);
  if (!isGlobalView) {
    liabilityWaiverStatus.classList.toggle("isCurrentMember", hasCurrentLiabilityWaiver);
    liabilityWaiverStatus.classList.toggle("isNotCurrentMember", !hasCurrentLiabilityWaiver);
    liabilityWaiverStatus.innerHTML = statusMarkup(
      hasCurrentLiabilityWaiver,
      payload.liability_waiver_status?.label || "Liability Waiver",
      "liability"
    );
  }
  memberEmail.textContent = text(payload.contact?.email);
  memberPhone.textContent = text(payload.contact?.phone);
  emergencyName.textContent = text(payload.emergency.emergency_contact_name);
  emergencyRelationship.textContent = text(payload.emergency.emergency_contact_relationship);
  emergencyPhone.textContent = text(payload.emergency.emergency_contact_phone);
  emergencyPhone2.textContent = text(payload.emergency.emergency_contact_phone_2);

  const isCurrentHire = Boolean(payload.hire_status?.is_current);
  if (isCurrentHire) {
    hireStatus.classList.add("isCurrentMember");
    hireStatus.innerHTML = statusMarkup(true, payload.hire_status?.label || "Hire", "hire");
    if (!isGlobalView) {
      hireStatus.classList.remove("hidden");
    }
  }

  purchaseSearchInput.value = "";
  categoryFilter.value = "";
  monthYearFilter.value = "";
  paidFilter.value = "";
  tableSorts = {};
  renderCategoryOptions(Object.keys(payload.categories));
  renderMonthYearOptions(payload.categories);
  renderPurchases();
}

async function searchMember() {
  const name = nameInput.value.trim();
  if (!name) return;
  const searchSequence = (memberSearchSequence += 1);
  const response = await fetch(`/api/member/${encodeURIComponent(name)}`);
  const payload = await response.json();
  if (searchSequence !== memberSearchSequence) return;
  renderMember(payload);
}

menuButton.addEventListener("click", (event) => {
  event.stopPropagation();
  setMenuOpen(pageMenu.classList.contains("hidden"));
});
pageMenu.addEventListener("click", (event) => {
  if (event.target.matches("[data-theme-toggle]")) closeMenu();
});
document.addEventListener("click", (event) => {
  if (!pageMenu.classList.contains("hidden") && !event.target.closest(".menuWrap")) {
    closeMenu();
  }
  if (!event.target.closest(".autocompleteWrap")) {
    closeNameSuggestions();
  }
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeMenu();
    closeNameSuggestions();
  }
});
refreshButton.addEventListener("click", refreshStore);
searchButton.addEventListener("click", searchMember);
purchaseSearchInput.addEventListener("input", renderPurchases);
categoryFilter.addEventListener("change", renderPurchases);
monthYearFilter.addEventListener("change", renderPurchases);
paidFilter.addEventListener("change", renderPurchases);
clearFiltersButton.addEventListener("click", () => {
  purchaseSearchInput.value = "";
  categoryFilter.value = "";
  monthYearFilter.value = "";
  paidFilter.value = "";
  renderPurchases();
});
nameInput.addEventListener("input", renderNameSuggestions);
nameInput.addEventListener("focus", renderNameSuggestions);
nameInput.addEventListener("change", searchMember);
nameInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    pickFirstRenderedSuggestion();
    closeNameSuggestions();
    searchMember();
  }
});

async function loadStatus() {
  const response = await fetch("/api/status");
  if (!response.ok) return;
  const payload = await response.json();
  setStatus(payload);
}

async function initApp() {
  try {
    await loadStatus();
  } catch {
    applyFreshnessTone();
  }

  try {
    await loadNames();
  } catch {
    availableNames = [];
  }
  await loadDefaultTransactions();
  applyFreshnessTone();
  setInterval(applyFreshnessTone, 10000);
}

initApp();
