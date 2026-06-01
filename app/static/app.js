const syncStatus = document.querySelector("#syncStatus");
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
const purchaseGroups = document.querySelector("#purchaseGroups");

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

function renderMember(payload) {
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

  purchaseGroups.replaceChildren();
  Object.entries(payload.categories).forEach(([category, rows]) => {
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
      tr.innerHTML = `
        <td>${text(row.date)}</td>
        <td><span class="paidBadge ${paidClass(row.paid)}">${text(row.paid)}</span></td>
        <td>${text(row.total)}</td>
        <td>${text(row.items)}</td>
      `;
      tbody.append(tr);
    });
    section.append(table);
    purchaseGroups.append(section);
  });
}

async function searchMember() {
  const name = nameInput.value.trim();
  if (!name) return;
  const response = await fetch(`/api/member/${encodeURIComponent(name)}`);
  renderMember(await response.json());
}

refreshButton.addEventListener("click", refreshStore);
searchButton.addEventListener("click", searchMember);
nameInput.addEventListener("change", searchMember);
nameInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") searchMember();
});

refreshStore();
