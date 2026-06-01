const syncStatus = document.querySelector("#syncStatus");
const menuButton = document.querySelector("#menuButton");
const pageMenu = document.querySelector("#pageMenu");
const refreshButton = document.querySelector("#refreshButton");
const searchButton = document.querySelector("#searchButton");
const nameInput = document.querySelector("#nameInput");
const nameSuggestions = document.querySelector("#nameSuggestions");
const emptyState = document.querySelector("#emptyState");
const memberPanel = document.querySelector("#memberPanel");
const memberName = document.querySelector("#memberName");
const emergencyName = document.querySelector("#emergencyName");
const emergencyRelationship = document.querySelector("#emergencyRelationship");
const emergencyPhone = document.querySelector("#emergencyPhone");
const emergencyPhone2 = document.querySelector("#emergencyPhone2");
const purchaseSearchInput = document.querySelector("#purchaseSearchInput");
const categoryFilter = document.querySelector("#categoryFilter");
const paidFilter = document.querySelector("#paidFilter");
const clearFiltersButton = document.querySelector("#clearFiltersButton");
const filterEmptyState = document.querySelector("#filterEmptyState");
const purchaseGroups = document.querySelector("#purchaseGroups");

let currentMemberPayload = null;

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
  nameSuggestions.replaceChildren(
    ...payload.names.map((name) => {
      const option = document.createElement("option");
      option.value = name;
      return option;
    })
  );
}

function paidClass(value) {
  return String(value).trim().toUpperCase() === "YES" ? "paidYes" : "paidNo";
}

function purchaseMatches(row, category) {
  const query = purchaseSearchInput.value.trim().toLowerCase();
  const selectedCategory = categoryFilter.value;
  const selectedPaid = paidFilter.value;
  const rowText = [row.date, row.paid, row.total, row.items].map(text).join(" ").toLowerCase();
  const paidValue = String(row.paid || "").trim().toUpperCase();

  return (
    (!query || rowText.includes(query)) &&
    (!selectedCategory || category === selectedCategory) &&
    (!selectedPaid || paidValue === selectedPaid)
  );
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

function tableCell(value) {
  const cell = document.createElement("td");
  cell.textContent = text(value);
  return cell;
}

function renderPurchases() {
  if (!currentMemberPayload?.found) return;

  purchaseGroups.replaceChildren();
  const categories = Object.keys(currentMemberPayload.categories);
  let visibleRows = 0;

  categories.forEach((category) => {
    const rows = currentMemberPayload.categories[category].filter((row) => purchaseMatches(row, category));
    if (!rows.length) return;

    const section = document.createElement("section");
    section.className = "panel purchasePanel";

    const heading = document.createElement("h3");
    heading.textContent = category;
    section.append(heading);

    const table = document.createElement("table");
    table.innerHTML = `
      <thead>
        <tr>
          <th>Date</th>
          <th>Paid</th>
          <th>Total</th>
          <th>Items</th>
        </tr>
      </thead>
      <tbody></tbody>
    `;
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
  emergencyName.textContent = text(payload.emergency.emergency_contact_name);
  emergencyRelationship.textContent = text(payload.emergency.emergency_contact_relationship);
  emergencyPhone.textContent = text(payload.emergency.emergency_contact_phone);
  emergencyPhone2.textContent = text(payload.emergency.emergency_contact_phone_2);

  purchaseSearchInput.value = "";
  categoryFilter.value = "";
  paidFilter.value = "";
  renderCategoryOptions(Object.keys(payload.categories));
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
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeMenu();
});
refreshButton.addEventListener("click", refreshStore);
searchButton.addEventListener("click", searchMember);
purchaseSearchInput.addEventListener("input", renderPurchases);
categoryFilter.addEventListener("change", renderPurchases);
paidFilter.addEventListener("change", renderPurchases);
clearFiltersButton.addEventListener("click", () => {
  purchaseSearchInput.value = "";
  categoryFilter.value = "";
  paidFilter.value = "";
  renderPurchases();
});
nameInput.addEventListener("change", searchMember);
nameInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") searchMember();
});

refreshStore();
