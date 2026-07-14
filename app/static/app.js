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
const recentTransactionsButton = document.querySelector("#recentTransactionsButton");
const nameInput = document.querySelector("#nameInput");
const nameSuggestions = document.querySelector("#nameSuggestions");
const emptyState = document.querySelector("#emptyState");
const memberPanel = document.querySelector("#memberPanel");
const memberInfo = document.querySelector("#memberInfo");
const memberName = document.querySelector("#memberName");
const membershipStatus = document.querySelector("#membershipStatus");
const liabilityWaiverStatus = document.querySelector("#liabilityWaiverStatus");
const hireStatus = document.querySelector("#hireStatus");
const commentStatus = document.querySelector("#commentStatus");
const memberStatusRow = document.querySelector(".memberStatusRow");
const memberCommentPanel = document.querySelector("#memberCommentPanel");
const memberCommentInput = document.querySelector("#memberCommentInput");
const memberEmail = document.querySelector("#memberEmail");
const memberPhone = document.querySelector("#memberPhone");
const memberProfileMembershipType = document.querySelector("#memberProfileMembershipType");
const memberDiveCertification = document.querySelector("#memberDiveCertification");
const memberDivingHistory = document.querySelector("#memberDivingHistory");
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
const serverRecentTransactions = document.querySelector("#serverRecentTransactions");

let currentMemberPayload = null;
let availableNames = [];
let tableSorts = {};
let memberSearchSequence = 0;
let memberSearchActive = false;
let memberCommentSaveTimer = null;
const FRESHNESS_WINDOW_MS = 15 * 60 * 1000;
const initialLastCheckedAt = lastCheckedStatus && lastCheckedStatus.dataset ? lastCheckedStatus.dataset.lastCheckedAt || "" : "";
const initialLastCheckedAtMs = initialLastCheckedAt ? Date.parse(initialLastCheckedAt) : NaN;
let lastCheckedAtMs = Number.isFinite(initialLastCheckedAtMs) ? initialLastCheckedAtMs : null;
const copiedIcon =
  '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M9.2 16.6 4.9 12.3l1.4-1.4 2.9 2.9 8.5-8.5 1.4 1.4-9.9 9.9Z" fill="currentColor"></path></svg>';

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
    navigator.serviceWorker.register("/static/service-worker.js").catch(function () {});
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

async function copyText(value, button) {
  const copied = String(value || "").trim();
  if (!copied || copied === "Not supplied") return;

  try {
    await navigator.clipboard.writeText(copied);
  } catch (error) {
    const textarea = document.createElement("textarea");
    textarea.value = copied;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.parentNode.removeChild(textarea);
  }

  if (!button) return;
  const previousTitle = button.title;
  const previousHtml = button.innerHTML;
  button.classList.add("isCopied");
  button.title = "Copied";
  button.innerHTML = copiedIcon;
  window.setTimeout(() => {
    button.classList.remove("isCopied");
    button.title = previousTitle;
    button.innerHTML = previousHtml;
  }, 1200);
}

function escapeAttribute(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function getMembershipOverride(name) {
  if (!currentMemberPayload || currentMemberPayload.name !== name) return null;
  const savedData = currentMemberPayload.saved_member_data || {};
  const override = savedData.membership_override;
  return override && typeof override === "object" ? override : null;
}

function getMemberComment(name) {
  if (!currentMemberPayload || currentMemberPayload.name !== name) return "";
  const savedData = currentMemberPayload.saved_member_data || {};
  return String(savedData.comment || "");
}

async function saveMemberData(name, changes) {
  const response = await fetch(`/api/member/${encodeURIComponent(name)}/saved-data`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(changes),
  });
  if (!response.ok) return null;
  return response.json();
}

async function setMembershipOverride(name, isCurrent) {
  const savedData = await saveMemberData(name, {
    membership_override: {
      is_current: Boolean(isCurrent),
    },
  });
  if (!savedData || !currentMemberPayload || currentMemberPayload.name !== name) return;
  currentMemberPayload.saved_member_data = savedData;
  renderMember(currentMemberPayload);
}

function setMemberComment(name, comment) {
  if (!currentMemberPayload || currentMemberPayload.name !== name) return;
  currentMemberPayload.saved_member_data = currentMemberPayload.saved_member_data || {};
  currentMemberPayload.saved_member_data.comment = String(comment || "").trim();
  if (memberCommentSaveTimer) window.clearTimeout(memberCommentSaveTimer);
  memberCommentSaveTimer = window.setTimeout(async () => {
    const savedData = await saveMemberData(name, { comment });
    if (!savedData || !currentMemberPayload || currentMemberPayload.name !== name) return;
    currentMemberPayload.saved_member_data = savedData;
    renderCommentStatus(currentMemberPayload, false);
  }, 250);
}

function membershipStatusForPayload(payload, membershipStatusPayload) {
  const override = getMembershipOverride(payload.name);
  if (!override) {
    return {
      isCurrent: Boolean(membershipStatusPayload.is_current),
      label: membershipStatusPayload.label || "Membership",
      isOverride: false,
    };
  }

  const overrideText = override.is_current ? "Member" : "Not member";
  return {
    isCurrent: Boolean(override.is_current),
    label: `Membership manually set: ${overrideText}`,
    isOverride: true,
  };
}

function statusMarkup(isCurrent, label, type = "membership", options = {}) {
  const visible = type === "boat"
    ? '<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><path d="M4 13.2 6.4 7.8h6.9l4.2 5.4H20l-1.7 4.1c-.8.4-1.6.6-2.4.6-1 0-1.8-.3-2.6-.8-.8.5-1.6.8-2.6.8s-1.8-.3-2.6-.8c-.8.5-1.6.8-2.6.8-.7 0-1.4-.2-2.1-.5L2 13.2h2Zm3.7-1.4h7.4l-2.4-3.1H9.1l-1.4 3.1Z" fill="currentColor"></path></svg>'
    : type === "cert" || type === "role"
      ? escapeAttribute(options.code || "")
    : type === "comment"
      ? '<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><path d="M11 5h2v9h-2V5Zm0 11h2v2h-2v-2Z" fill="currentColor"></path></svg>'
    : type === "membership"
      ? '<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><path d="M5 6.2c0-1 .8-1.8 1.8-1.8h10.4c1 0 1.8.8 1.8 1.8v11.6c0 1-.8 1.8-1.8 1.8H6.8c-1 0-1.8-.8-1.8-1.8V6.2Zm3.2 3.1h7.6V7.8H8.2v1.5Zm0 3.2h7.6V11H8.2v1.5Zm0 3.2h4.9v-1.5H8.2v1.5Z" fill="currentColor"></path></svg>'
      : type === "liability"
        ? '<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><path d="M7 3.8h7.8L19 8v12.2H7V3.8Zm7 1.9v3h3L14 5.7ZM9 11h8V9.6H9V11Zm0 3.2h8v-1.4H9v1.4Zm0 3.2h5.5V16H9v1.4Z" fill="currentColor"></path></svg>'
        : '<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><path d="M9 4.8h6v2.1h1.4v2H15v10.3c0 1.1-.9 2-2 2h-2c-1.1 0-2-.9-2-2V8.9H7.6v-2H9V4.8Zm1.8 0v2.1h2.4V4.8h-2.4Zm-.1 4.1v10.3c0 .2.1.3.3.3h2c.2 0 .3-.1.3-.3V8.9h-2.6Zm6.9 1.1h1.8v5.6h-1.8V10Z" fill="currentColor"></path></svg>';
  const caption = type === "boat" && !isCurrent ? "overdue" : type === "membership" ? "Member" : type === "liability" ? "Liability" : type === "hire" ? "Gear" : type === "comment" ? "Note" : "";
  const captionText = caption ? `<small class="statusBadgeCaption">${caption}</small>` : "";
  const title = label;
  const safeTitle = escapeAttribute(title);
  const classes = `statusBadgeWrap${options.button ? " statusBadgeButton" : ""}${options.isOverride ? " statusBadgeWrap--override" : ""}`;
  if (options.button) {
    const safeAction = escapeAttribute(options.actionLabel || safeTitle);
    return `<button class="${classes}" type="button" title="${safeTitle}" data-tooltip="${safeTitle}" aria-label="${safeAction}"><span class="statusBadge statusBadge--${type}" aria-hidden="true">${visible}</span>${captionText}</button>`;
  }
  return `<span class="${classes}" title="${safeTitle}" data-tooltip="${safeTitle}" aria-label="${safeTitle}" tabindex="0"><span class="statusBadge statusBadge--${type}" aria-hidden="true">${visible}</span>${captionText}</span>`;
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
  refreshButton.classList.add("isRefreshing");
  refreshButton.setAttribute("aria-label", "Refreshing");
  refreshButton.title = "Refreshing";
  try {
    const response = await fetch("/api/refresh", { method: "POST" });
    setStatus(await response.json());
    await loadNames();
  } finally {
    refreshButton.disabled = false;
    refreshButton.classList.remove("isRefreshing");
    refreshButton.setAttribute("aria-label", "Refresh");
    refreshButton.title = "Refresh";
    closeMenu();
  }
}

async function loadNames() {
  const response = await fetch("/api/names");
  const payload = await response.json();
  availableNames = payload.names;
  closeNameSuggestions();
}

async function loadDefaultTransactions(force = false) {
  const searchSequence = memberSearchSequence;
  try {
    const response = await fetch("/api/recent-transactions?days=30");
    const payload = await response.json();
    if (!force && memberSearchActive) return;
    if (!force && searchSequence !== memberSearchSequence) return;
    if (payload && payload.found) {
      renderMember(payload);
    }
  } catch (error) {
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
  if (currentMemberPayload && currentMemberPayload.scope === "global_last_week") {
    const timestamp = parseDateTimestamp(row.date);
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
  const timestamp = parseDateTimestamp(value);
  if (Number.isNaN(timestamp)) return "";
  return new Date(timestamp).toISOString().slice(0, 7);
}

function monthYearLabel(key) {
  if (!key) return "";
  const [year, month] = key.split("-");
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, 1));
  return date.toLocaleString(undefined, { month: "long", year: "numeric", timeZone: "UTC" });
}

function parseDateTimestamp(value) {
  const dateText = String(value || "").trim();
  let match = dateText.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (match) {
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).getTime();
  }

  match = dateText.match(/^(\d{4})-([A-Za-z]{3,})-(\d{1,2})/);
  if (match) {
    const monthIndex = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(
      match[2].slice(0, 3).toLowerCase()
    );
    if (monthIndex >= 0) {
      return new Date(Number(match[1]), monthIndex, Number(match[3])).getTime();
    }
  }

  match = dateText.match(/^(\d{1,2})[/. -](\d{1,2})[/. -](\d{2,4})/);
  if (match) {
    const year = Number(match[3].length === 2 ? "20" + match[3] : match[3]);
    return new Date(year, Number(match[2]) - 1, Number(match[1])).getTime();
  }

  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? NaN : timestamp;
}

function parseDate(value) {
  const timestamp = parseDateTimestamp(value);
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

function setChildren(element, children) {
  while (element.firstChild) {
    element.removeChild(element.firstChild);
  }
  children.forEach((child) => {
    element.appendChild(child);
  });
}

function renderNameSuggestions() {
  const query = nameInput.value.trim().toLowerCase();
  if (!query) {
    closeNameSuggestions();
    return;
  }

  const matches = availableNames.filter((name) => name.toLowerCase().includes(query));

  if (!matches.length) {
    closeNameSuggestions();
    return;
  }

  setChildren(
    nameSuggestions,
    matches.map((name) => {
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
  const options = [
    Object.assign(document.createElement("option"), {
      textContent: "All categories",
      value: "",
    }),
  ].concat(
    categories.map((category) =>
      Object.assign(document.createElement("option"), {
        textContent: category,
        value: category,
      })
    )
  );
  setChildren(categoryFilter, options);
}

function categoryRows(categories) {
  return Object.keys(categories || {}).reduce((rows, category) => rows.concat(categories[category] || []), []);
}

function renderMonthYearOptions(categories) {
  const seenMonthKeys = {};
  const monthKeys = categoryRows(categories)
    .map((row) => monthYearKey(row.date))
    .filter(Boolean)
    .filter((key) => {
      if (seenMonthKeys[key]) return false;
      seenMonthKeys[key] = true;
      return true;
    })
    .sort()
    .reverse();

  const options = [
    Object.assign(document.createElement("option"), {
      textContent: "All months",
      value: "",
    }),
  ].concat(
    monthKeys.map((key) =>
      Object.assign(document.createElement("option"), {
        textContent: monthYearLabel(key),
        value: key,
      })
    )
  );
  setChildren(monthYearFilter, options);
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
  const isGlobalView = currentMemberPayload && currentMemberPayload.scope === "global_last_week";
  const columns = isGlobalView
    ? [{ key: "name", label: "Name", firstDirection: "asc" }].concat(sortableColumns)
    : sortableColumns;

  columns.forEach((column) => {
    const th = document.createElement("th");
    const button = document.createElement("button");
    const isActive = activeSort && activeSort.key === column.key;
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
          currentSort && currentSort.key === column.key && currentSort.direction === column.firstDirection
            ? column.firstDirection === "asc"
              ? "desc"
              : "asc"
            : column.firstDirection,
      };
      renderPurchases();
    });

    th.appendChild(button);
    tr.appendChild(th);
  });

  thead.appendChild(tr);
  return thead;
}

function renderPurchases() {
  if (!currentMemberPayload || !currentMemberPayload.found) return;

  setChildren(purchaseGroups, []);
  const categories = Object.keys(currentMemberPayload.categories);
  const isGlobalView = currentMemberPayload && currentMemberPayload.scope === "global_last_week";
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
    section.appendChild(heading);

    const table = document.createElement("table");
    table.classList.add("searchTransactionTable");
    table.classList.toggle("hasNameColumn", isGlobalView);
    table.appendChild(renderTableHead(category));
    table.appendChild(document.createElement("tbody"));
    const tbody = table.querySelector("tbody");
    rows.forEach((row) => {
      const tr = document.createElement("tr");
      const paidCell = document.createElement("td");
      const paidBadge = document.createElement("span");
      paidBadge.className = `paidBadge ${paidClass(row.paid)}`;
      paidBadge.textContent = text(row.paid);

      paidCell.appendChild(paidBadge);
      if (isGlobalView) {
        tr.appendChild(tableCell(row.name));
        tr.appendChild(tableCell(row.date));
        tr.appendChild(paidCell);
        tr.appendChild(tableCell(row.total));
        tr.appendChild(tableCell(row.items));
      } else {
        tr.appendChild(tableCell(row.date));
        tr.appendChild(paidCell);
        tr.appendChild(tableCell(row.total));
        tr.appendChild(tableCell(row.items));
      }
      tbody.appendChild(tr);
      visibleRows += 1;
    });
    section.appendChild(table);
    purchaseGroups.appendChild(section);
  });

  filterEmptyState.classList.toggle("hidden", visibleRows > 0);
  if (serverRecentTransactions) {
    if (isGlobalView) {
      serverRecentTransactions.classList.toggle("hidden", visibleRows > 0);
    } else {
      serverRecentTransactions.classList.add("hidden");
    }
  }
}

function renderCommentStatus(payload, syncInput = true) {
  if (!commentStatus || !memberCommentPanel || !memberCommentInput) return;
  const isGlobalView = payload.scope === "global_last_week";
  const comment = getMemberComment(payload.name);
  memberCommentPanel.classList.toggle("hidden", isGlobalView);
  if (syncInput) {
    memberCommentInput.value = comment;
  }
  commentStatus.classList.toggle("hidden", isGlobalView || !comment);
  commentStatus.classList.toggle("isCommented", Boolean(comment));
  commentStatus.innerHTML = comment ? statusMarkup(true, "Comment saved", "comment") : "";
}

function clearProfileStatusIcons() {
  document.querySelectorAll(".profileStatus").forEach((element) => element.remove());
}

function renderProfileStatusIcons(payload) {
  clearProfileStatusIcons();
  if (!memberStatusRow || payload.scope === "global_last_week") return;
  const profile = payload.member_profile || {};
  const statuses = []
    .concat(profile.certification_statuses || [])
    .map((status) => ({ ...status, type: "cert" }))
    .concat((profile.role_statuses || []).map((status) => ({ ...status, type: "role" })));
  statuses.forEach((status) => {
    const wrapper = document.createElement("span");
    wrapper.className = `membershipStatus profileStatus ${status.type === "cert" ? "isCertificationStatus" : "isRoleStatus"}`;
    wrapper.innerHTML = statusMarkup(true, status.label || status.code, status.type, { code: status.code });
    memberStatusRow.appendChild(wrapper);
  });
}

function renderMember(payload) {
  if (serverRecentTransactions && payload.scope !== "global_last_week") {
    serverRecentTransactions.classList.add("hidden");
  }
  currentMemberPayload = payload;
  [membershipStatus, liabilityWaiverStatus, hireStatus, commentStatus].forEach((statusElement) => {
    statusElement.classList.remove("isCurrentMember", "isNotCurrentMember");
    statusElement.innerHTML = "";
  });
  clearProfileStatusIcons();
  hireStatus.classList.add("hidden");
  if (commentStatus) {
    commentStatus.classList.add("hidden");
    commentStatus.classList.remove("isCommented");
  }

  if (!payload.found) {
    memberPanel.classList.add("hidden");
    if (memberCommentPanel) memberCommentPanel.classList.add("hidden");
    emptyState.classList.remove("hidden");
    emptyState.textContent = "No exact member match found. Pick a name from the suggestions.";
    return;
  }

  emptyState.classList.add("hidden");
  memberPanel.classList.remove("hidden");
  memberName.textContent = payload.name;
  const isGlobalView = payload.scope === "global_last_week";
  memberInfo.classList.toggle("hidden", isGlobalView);
  memberInfo.open = false;
  const membershipStatusPayload = payload.membership_status || {};
  const liabilityWaiverStatusPayload = payload.liability_waiver_status || {};
  const contactPayload = payload.contact || {};
  const emergencyPayload = payload.emergency || {};
  const hireStatusPayload = payload.hire_status || {};
  const memberProfilePayload = payload.member_profile || {};
  renderCommentStatus(payload);
  renderProfileStatusIcons(payload);
  const membershipViewStatus = membershipStatusForPayload(payload, membershipStatusPayload);
  const isCurrentMember = membershipViewStatus.isCurrent;
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
      membershipViewStatus.label,
      "membership",
      {
        button: true,
        isOverride: membershipViewStatus.isOverride,
        actionLabel: `${membershipViewStatus.label}. Click to toggle membership status.`,
      }
    );
    const membershipButton = membershipStatus.querySelector(".statusBadgeButton");
    if (membershipButton) {
      membershipButton.addEventListener("click", () => {
        setMembershipOverride(payload.name, !isCurrentMember);
      });
    }
  }
  const hasCurrentLiabilityWaiver = Boolean(liabilityWaiverStatusPayload.is_current);
  if (!isGlobalView) {
    liabilityWaiverStatus.classList.toggle("isCurrentMember", hasCurrentLiabilityWaiver);
    liabilityWaiverStatus.classList.toggle("isNotCurrentMember", !hasCurrentLiabilityWaiver);
    liabilityWaiverStatus.innerHTML = statusMarkup(
      hasCurrentLiabilityWaiver,
      liabilityWaiverStatusPayload.label || "Liability Waiver",
      "liability"
    );
  }
  memberEmail.textContent = text(contactPayload.email);
  memberPhone.textContent = text(contactPayload.phone);
  emergencyName.textContent = text(emergencyPayload.emergency_contact_name);
  emergencyRelationship.textContent = text(emergencyPayload.emergency_contact_relationship);
  emergencyPhone.textContent = text(emergencyPayload.emergency_contact_phone);
  emergencyPhone2.textContent = text(emergencyPayload.emergency_contact_phone_2);
  memberProfileMembershipType.textContent = text(memberProfilePayload.membership_type);
  memberDiveCertification.textContent = text(memberProfilePayload.dive_certification);
  memberDivingHistory.textContent = text(memberProfilePayload.diving_history);

  const isCurrentHire = Boolean(hireStatusPayload.is_current);
  if (isCurrentHire) {
    hireStatus.classList.add("isCurrentMember");
    hireStatus.innerHTML = statusMarkup(true, hireStatusPayload.label || "Hire", "hire");
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
  memberSearchActive = true;
  const searchSequence = (memberSearchSequence += 1);
  if (serverRecentTransactions) {
    serverRecentTransactions.classList.add("hidden");
  }
  setChildren(purchaseGroups, []);
  filterEmptyState.classList.add("hidden");
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
recentTransactionsButton.addEventListener("click", () => {
  memberSearchActive = false;
  loadDefaultTransactions(true);
});
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
document.querySelectorAll("[data-copy-target]").forEach((button) => {
  button.addEventListener("click", () => {
    const target = document.querySelector(`#${button.dataset.copyTarget}`);
    copyText(target ? target.textContent : "", button);
  });
});
if (memberCommentInput) {
  memberCommentInput.addEventListener("input", () => {
    if (!currentMemberPayload || !currentMemberPayload.found || currentMemberPayload.scope === "global_last_week") return;
    setMemberComment(currentMemberPayload.name, memberCommentInput.value);
    renderCommentStatus(currentMemberPayload, false);
  });
}
nameInput.addEventListener("input", renderNameSuggestions);
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
  } catch (error) {
    applyFreshnessTone();
  }

  try {
    await loadNames();
  } catch (error) {
    availableNames = [];
  }
  await loadDefaultTransactions();
  applyFreshnessTone();
  setInterval(applyFreshnessTone, 10000);
}

initApp();
