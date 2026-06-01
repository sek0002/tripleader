const syncStatus = document.querySelector("#syncStatus");
const dateRangeStatus = document.querySelector("#dateRangeStatus");
const menuButton = document.querySelector("#menuButton");
const pageMenu = document.querySelector("#pageMenu");
const refreshButton = document.querySelector("#refreshButton");
const searchButton = document.querySelector("#searchButton");
const nameInput = document.querySelector("#nameInput");
const nameSuggestions = document.querySelector("#nameSuggestions");
const emptyState = document.querySelector("#emptyState");
const memberPanel = document.querySelector("#memberPanel");
const memberName = document.querySelector("#memberName");
const membershipStatus = document.querySelector("#membershipStatus");
const memberEmail = document.querySelector("#memberEmail");
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

function setStatus(payload) {
  const when = payload.at ? new Date(payload.at).toLocaleString() : "never";
  const prefix = payload.ok === false ? "Refresh issue" : "Purchase store";
  syncStatus.textContent = `${prefix}: ${payload.rows || 0} rows, last checked ${when}. ${payload.message || ""}`;
  dateRangeStatus.textContent = payload.date_range?.label || "Available date range: unavailable";
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

function paidClass(value) {
  return String(value).trim().toUpperCase() === "YES" ? "paidYes" : "paidNo";
}

function purchaseMatches(row, category) {
  const query = purchaseSearchInput.value.trim().toLowerCase();
  const selectedCategory = categoryFilter.value;
  const selectedMonthYear = monthYearFilter.value;
  const selectedPaid = paidFilter.value;
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
    section.className = "panel purchasePanel";

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
  if (!payload.found) {
    memberPanel.classList.add("hidden");
    emptyState.classList.remove("hidden");
    emptyState.textContent = "No exact member match found. Pick a name from the suggestions.";
    return;
  }

  emptyState.classList.add("hidden");
  memberPanel.classList.remove("hidden");
  memberName.textContent = payload.name;
  const isCurrentMember = Boolean(payload.membership_status?.is_current);
  const memberLabel = isCurrentMember ? "Current Member" : "Not Current Member";
  const icon = isCurrentMember ? "✓" : "✗";
  membershipStatus.classList.toggle("isCurrentMember", isCurrentMember);
  membershipStatus.classList.toggle("isNotCurrentMember", !isCurrentMember);
  membershipStatus.textContent = `${icon} ${memberLabel}`;
  memberEmail.textContent = text(payload.contact?.email);
  emergencyName.textContent = text(payload.emergency.emergency_contact_name);
  emergencyRelationship.textContent = text(payload.emergency.emergency_contact_relationship);
  emergencyPhone.textContent = text(payload.emergency.emergency_contact_phone);
  emergencyPhone2.textContent = text(payload.emergency.emergency_contact_phone_2);

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
  const response = await fetch(`/api/member/${encodeURIComponent(name)}`);
  renderMember(await response.json());
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
    closeNameSuggestions();
    searchMember();
  }
});

refreshStore();
