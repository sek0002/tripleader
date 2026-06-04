const tripDateInput = document.querySelector("#tripDateInput");
const tripTypeInput = document.querySelector("#tripTypeInput");
const tripTitleInput = document.querySelector("#tripTitleInput");
const createTripButton = document.querySelector("#createTripButton");
const tripCards = document.querySelector("#tripCards");
const tripEmptyState = document.querySelector("#tripEmptyState");
const tripCardTemplate = document.querySelector("#tripCardTemplate");

let availableNames = [];
let trips = [];
let countdownTimer = null;

function text(value) {
  return value && String(value).trim() ? String(value).trim() : "Not supplied";
}

function statusMarkup(isCurrent, label) {
  const icon = isCurrent
    ? '<span class="membershipIcon" aria-hidden="true"><svg viewBox="0 0 20 20" focusable="false"><circle cx="10" cy="10" r="8.5" fill="none" stroke="currentColor" stroke-width="2"></circle><path d="M5.8 10.4 9 13.4 14.3 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path></svg></span>'
    : '<span class="membershipIcon" aria-hidden="true"><svg viewBox="0 0 20 20" focusable="false"><circle cx="10" cy="10" r="8.5" fill="none" stroke="currentColor" stroke-width="2"></circle><path d="M6.5 6.5 13.5 13.5M13.5 6.5 6.5 13.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path></svg></span>';
  return `${icon}<span>${label}</span>`;
}

function appendTitleSuggestion(input, suggestion) {
  const current = input.value.trim();
  input.value = current ? `${current} ${suggestion}` : suggestion;
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function normalizeTripType(value) {
  const normalized = String(value || "").trim();
  return ["Boat", "Shore", "Other"].includes(normalized) ? normalized : "";
}

function ensureTitleHasType(title, tripType) {
  const cleanedTitle = String(title || "").trim() || "Trip";
  if (!tripType) return cleanedTitle;
  return cleanedTitle.toLowerCase().includes(tripType.toLowerCase())
    ? cleanedTitle
    : `${tripType} ${cleanedTitle}`;
}

function isBoatTrip(trip) {
  return normalizeTripType(trip.trip_type) === "Boat" || String(trip.title || "").toLowerCase().includes("boat");
}

function countdownLabel(tripDate) {
  if (!tripDate) return "No date selected";
  const target = new Date(`${tripDate}T00:00:00`);
  if (Number.isNaN(target.getTime())) return "No date selected";
  const diff = target.getTime() - Date.now();
  if (diff <= 0) return "Trip date reached";
  const days = Math.floor(diff / (24 * 60 * 60 * 1000));
  const hours = Math.floor((diff / (60 * 60 * 1000)) % 24);
  const minutes = Math.floor((diff / (60 * 1000)) % 60);
  return `${days}d ${hours}h ${minutes}m`;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  if (!response.ok) throw new Error(`Request failed: ${response.status}`);
  return response.json();
}

async function saveTrip(trip) {
  const saved = await api(`/api/trips/${encodeURIComponent(trip.id)}`, {
    method: "PUT",
    body: JSON.stringify(trip),
  });
  trips = trips.map((existing) => (existing.id === saved.id ? saved : existing));
  return saved;
}

async function loadNames() {
  const payload = await api("/api/names");
  availableNames = payload.names || [];
}

async function loadTrips() {
  const payload = await api("/api/trips");
  trips = payload.trips || [];
  renderTrips();
}

function closeSuggestions(suggestions) {
  suggestions.classList.add("hidden");
}

function renderSuggestions(input, suggestions, onPick) {
  const query = input.value.trim().toLowerCase();
  const matches = query
    ? availableNames.filter((name) => name.toLowerCase().includes(query))
    : availableNames;

  if (!matches.length) {
    closeSuggestions(suggestions);
    return;
  }

  suggestions.replaceChildren(
    ...matches.slice(0, 30).map((name) => {
      const button = document.createElement("button");
      button.className = "nameSuggestion";
      button.type = "button";
      button.setAttribute("role", "option");
      button.textContent = name;
      button.addEventListener("click", () => {
        input.value = "";
        closeSuggestions(suggestions);
        onPick(name);
      });
      return button;
    })
  );
  suggestions.classList.remove("hidden");
}

function renderTrips() {
  if (countdownTimer) clearInterval(countdownTimer);
  tripCards.replaceChildren();
  tripEmptyState.classList.toggle("hidden", trips.length > 0);

  trips.forEach((trip) => renderTripCard(trip));
  updateCountdowns();
  countdownTimer = setInterval(updateCountdowns, 60000);
}

function updateCountdowns() {
  document.querySelectorAll("[data-trip-date]").forEach((element) => {
    element.textContent = countdownLabel(element.dataset.tripDate);
  });
}

function renderTripCard(trip) {
  const card = tripCardTemplate.content.firstElementChild.cloneNode(true);
  const titleInput = card.querySelector(".tripTitleEdit");
  const dateInput = card.querySelector(".tripDateEdit");
  const typeInput = card.querySelector(".tripTypeEdit");
  const countdown = card.querySelector(".tripCountdown");
  const pinButton = card.querySelector(".pinButton");
  const pinMenu = card.querySelector(".pinMenu");
  const memberInput = card.querySelector(".tripMemberInput");
  const suggestions = card.querySelector(".nameSuggestions");

  titleInput.value = trip.title || "Trip";
  dateInput.value = trip.date || "";
  trip.trip_type = normalizeTripType(trip.trip_type) || (isBoatTrip(trip) ? "Boat" : "Other");
  typeInput.value = trip.trip_type;
  countdown.dataset.tripDate = trip.date || "";

  titleInput.addEventListener("change", async () => {
    trip.title = ensureTitleHasType(titleInput.value, trip.trip_type);
    titleInput.value = trip.title;
    await saveTrip(trip);
    await renderTripMembers(card, trip);
  });

  typeInput.addEventListener("change", async () => {
    trip.trip_type = normalizeTripType(typeInput.value) || "Other";
    trip.title = ensureTitleHasType(titleInput.value, trip.trip_type);
    titleInput.value = trip.title;
    await saveTrip(trip);
    await renderTripMembers(card, trip);
  });

  dateInput.addEventListener("change", async () => {
    trip.date = dateInput.value;
    countdown.dataset.tripDate = trip.date || "";
    updateCountdowns();
    await saveTrip(trip);
    await renderTripMembers(card, trip);
  });

  card.querySelectorAll("[data-title-suggestion]").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.dataset.titleSuggestion === "Boat" || button.dataset.titleSuggestion === "Shore") {
        typeInput.value = button.dataset.titleSuggestion;
        typeInput.dispatchEvent(new Event("change", { bubbles: true }));
      } else {
        appendTitleSuggestion(titleInput, button.dataset.titleSuggestion);
      }
    });
  });

  pinButton.addEventListener("click", () => {
    pinMenu.classList.toggle("hidden");
    pinButton.setAttribute("aria-expanded", String(!pinMenu.classList.contains("hidden")));
  });

  card.querySelector(".deleteTripButton").addEventListener("click", async () => {
    await api(`/api/trips/${encodeURIComponent(trip.id)}`, { method: "DELETE" });
    trips = trips.filter((existing) => existing.id !== trip.id);
    renderTrips();
  });

  const addMember = async (name) => {
    if (!name || trip.members.includes(name)) return;
    trip.members.push(name);
    await saveTrip(trip);
    await renderTripMembers(card, trip);
  };

  memberInput.addEventListener("input", () => renderSuggestions(memberInput, suggestions, addMember));
  memberInput.addEventListener("focus", () => renderSuggestions(memberInput, suggestions, addMember));
  memberInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      addMember(memberInput.value.trim());
      memberInput.value = "";
      closeSuggestions(suggestions);
    }
  });
  card.querySelector(".addTripMemberButton").addEventListener("click", () => {
    addMember(memberInput.value.trim());
    memberInput.value = "";
    closeSuggestions(suggestions);
  });

  tripCards.append(card);
  renderTripMembers(card, trip);
}

async function renderTripMembers(card, trip) {
  const memberList = card.querySelector(".tripMembers");
  const transactionSection = card.querySelector(".tripTransactions");
  memberList.replaceChildren();
  transactionSection.replaceChildren();

  const details = await Promise.all(
    trip.members.map((name) =>
      api(`/api/trip-member/${encodeURIComponent(name)}?trip_date=${encodeURIComponent(trip.date || "")}&boat=${isBoatTrip(trip)}`)
    )
  );

  details.forEach((detail, index) => {
    const storedName = trip.members[index];
    const row = document.createElement("div");
    row.className = "tripMemberRow";

    const name = document.createElement("strong");
    name.textContent = detail.name || "Unknown member";

    const statuses = document.createElement("div");
    statuses.className = "memberStatusRow tripMemberStatuses";
    appendStatus(statuses, Boolean(detail.membership_status?.is_current), "Current Member");
    appendStatus(statuses, Boolean(detail.liability_waiver_status?.is_current), detail.liability_waiver_status?.label || "Liability Waiver");
    if (detail.hire_status?.is_current) appendStatus(statuses, true, detail.hire_status.label || "Hire");
    if (detail.boat_payment_status) appendStatus(statuses, Boolean(detail.boat_payment_status.is_current), detail.boat_payment_status.label);

    const remove = document.createElement("button");
    remove.className = "secondaryButton removeTripMemberButton";
    remove.type = "button";
    remove.textContent = "Remove";
    remove.addEventListener("click", async () => {
      trip.members = trip.members.filter((member) => member !== storedName);
      await saveTrip(trip);
      await renderTripMembers(card, trip);
    });

    row.append(name, statuses, remove);
    memberList.append(row);
  });

  renderTransactions(transactionSection, details.flatMap((detail) => detail.transactions || []));
}

function appendStatus(container, isCurrent, label) {
  const status = document.createElement("span");
  status.className = `membershipStatus ${isCurrent ? "isCurrentMember" : "isNotCurrentMember"}`;
  status.innerHTML = statusMarkup(isCurrent, label);
  container.append(status);
}

function renderTransactions(container, transactions) {
  if (!transactions.length) {
    const empty = document.createElement("section");
    empty.className = "empty";
    empty.textContent = "No transactions found for selected members.";
    container.append(empty);
    return;
  }

  const table = document.createElement("table");
  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  ["Name", "Date", "Paid", "Total", "Items"].forEach((label) => {
    const th = document.createElement("th");
    th.textContent = label;
    headRow.append(th);
  });
  thead.append(headRow);

  const tbody = document.createElement("tbody");
  transactions.forEach((transaction) => {
    const row = document.createElement("tr");
    ["name", "date", "paid", "total", "items"].forEach((key) => {
      const td = document.createElement("td");
      td.textContent = text(transaction[key]);
      row.append(td);
    });
    tbody.append(row);
  });

  table.append(thead, tbody);
  container.append(table);
}

createTripButton.addEventListener("click", async () => {
  const tripType = normalizeTripType(tripTypeInput.value);
  if (!tripType) {
    tripTypeInput.reportValidity();
    return;
  }
  const trip = await api("/api/trips", {
    method: "POST",
    body: JSON.stringify({
      date: tripDateInput.value,
      title: ensureTitleHasType(tripTitleInput.value, tripType),
      trip_type: tripType,
      members: [],
    }),
  });
  trips = [trip, ...trips];
  tripTitleInput.value = "Trip";
  tripTypeInput.value = "";
  renderTrips();
});

document.querySelectorAll("[data-title-suggestion]").forEach((button) => {
  if (button.closest("template")) return;
  button.addEventListener("click", () => {
    if (button.dataset.titleSuggestion === "Boat" || button.dataset.titleSuggestion === "Shore") {
      tripTypeInput.value = button.dataset.titleSuggestion;
      tripTitleInput.value = ensureTitleHasType(tripTitleInput.value, button.dataset.titleSuggestion);
    } else {
      appendTitleSuggestion(tripTitleInput, button.dataset.titleSuggestion);
    }
  });
});

document.addEventListener("click", (event) => {
  document.querySelectorAll(".pinMenu").forEach((menu) => {
    if (!menu.closest(".pinWrap").contains(event.target)) menu.classList.add("hidden");
  });
  document.querySelectorAll(".nameSuggestions").forEach((suggestions) => {
    if (!suggestions.closest(".autocompleteWrap").contains(event.target)) closeSuggestions(suggestions);
  });
});

async function initTrips() {
  await loadNames();
  await loadTrips();
}

initTrips();
