const tripDateInput = document.querySelector("#tripDateInput");
const tripTypeInput = document.querySelector("#tripTypeInput");
const tripTitleInput = document.querySelector("#tripTitleInput");
const tripOrganizerInput = document.querySelector("#tripOrganizerInput");
const tripOrganizerSuggestions = document.querySelector("#tripOrganizerSuggestions");
const createTripButton = document.querySelector("#createTripButton");
const tripCards = document.querySelector("#tripCards");
const tripEmptyState = document.querySelector("#tripEmptyState");
const tripCardTemplate = document.querySelector("#tripCardTemplate");
const menuButton = document.querySelector("#menuButton");
const pageMenu = document.querySelector("#pageMenu");
const refreshButton = document.querySelector("#refreshButton");
const isArchivePage = document.body.dataset.tripArchive === "true";

let availableNames = [];
let trips = [];
let countdownTimer = null;
const TRANSACTION_CATEGORIES = [
  { name: "Hire", needles: ["hire"] },
  { name: "Car Fee", needles: ["car fee"] },
  { name: "Boat Dive/Exclusive", needles: ["boat dive", "exclusive"] },
  { name: "Air Fills/Tank Fills", needles: ["air fill", "air fills", "tank fill", "tank fills", "nitrox"] },
  { name: "Course", needles: ["course"] },
  { name: "Membership", needles: ["membership"] },
];

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
  if (["OW", "AOW", "Tech"].includes(suggestion)) {
    appendCourseSuggestion(input, suggestion);
    return;
  }
  const current = input.value.trim();
  input.value = current ? `${current} ${suggestion}` : suggestion;
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function appendCourseSuggestion(input, suggestion) {
  const current = input.value.trim();
  const coursePattern = /\b(?:OW|AOW|Tech)(?:\/(?:OW|AOW|Tech))*\b/i;
  const match = current.match(coursePattern);
  if (match) {
    const selected = match[0].split("/").map((value) => value.toLowerCase());
    if (!selected.includes(suggestion.toLowerCase())) {
      input.value = current.replace(coursePattern, `${match[0]}/${suggestion}`);
    }
  } else {
    input.value = current ? `${current} ${suggestion}` : suggestion;
  }
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function normalizeTripType(value) {
  const normalized = String(value || "").trim();
  return ["Boat", "Shore", "Other"].includes(normalized) ? normalized : "";
}

function ensureTitleHasType(title, tripType) {
  const cleanedTitle = String(title || "")
    .replace(/^\s*(boat|shore|other)\b[\s:.-]*/i, "")
    .trim();
  const titleBody = cleanedTitle.toLowerCase() === "trip" ? "" : cleanedTitle;
  return tripType ? `${tripType}${titleBody ? ` ${titleBody}` : ""}` : titleBody || "Trip";
}

function isBoatTrip(trip) {
  return normalizeTripType(trip.trip_type) === "Boat" || String(trip.title || "").toLowerCase().includes("boat");
}

function orderedTripMembers(trip) {
  const members = Array.isArray(trip.members) ? [...trip.members] : [];
  if (!trip.organizer) return members;
  return [trip.organizer, ...members.filter((member) => member !== trip.organizer)];
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

function countdownColor(tripDate) {
  if (!tripDate) return "";
  const target = new Date(`${tripDate}T00:00:00`);
  if (Number.isNaN(target.getTime())) return "";
  const hoursUntilTrip = (target.getTime() - Date.now()) / (60 * 60 * 1000);
  if (hoursUntilTrip > 72) return "";
  if (hoursUntilTrip <= 24) return "hsl(0, 72%, 48%)";
  const progress = Math.max(0, Math.min(1, (72 - hoursUntilTrip) / 48));
  const hue = Math.round(32 * (1 - progress));
  return `hsl(${hue}, 78%, 50%)`;
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
  const payload = await api(`/api/trips${isArchivePage ? "?archived=true" : ""}`);
  trips = payload.trips || [];
  renderTrips();
}

async function refreshStore() {
  refreshButton.disabled = true;
  refreshButton.textContent = "Refreshing";
  try {
    await api("/api/refresh", { method: "POST" });
    await loadNames();
    await loadTrips();
  } finally {
    refreshButton.disabled = false;
    refreshButton.textContent = "Refresh";
  }
}

function closeSuggestions(suggestions) {
  suggestions.classList.add("hidden");
}

function setMenuOpen(open) {
  pageMenu.classList.toggle("hidden", !open);
  menuButton.setAttribute("aria-expanded", String(open));
}

function closeMenu() {
  setMenuOpen(false);
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
    element.style.color = countdownColor(element.dataset.tripDate);
  });
}

function renderTripCard(trip) {
  const card = tripCardTemplate.content.firstElementChild.cloneNode(true);
  const titleInput = card.querySelector(".tripTitleEdit");
  const dateInput = card.querySelector(".tripDateEdit");
  const typeInput = card.querySelector(".tripTypeEdit");
  const organizerInput = card.querySelector(".tripOrganizerEdit");
  const organizerSuggestions = card.querySelector(".tripOrganizerEditWrap .nameSuggestions");
  const countdown = card.querySelector(".tripCountdown");
  const pinButton = card.querySelector(".pinButton");
  const pinMenu = card.querySelector(".pinMenu");
  const memberInput = card.querySelector(".tripMemberInput");
  const suggestions = card.querySelector(".tripMemberLookup .nameSuggestions");

  titleInput.value = trip.title || "Trip";
  dateInput.value = trip.date || "";
  trip.trip_type = normalizeTripType(trip.trip_type) || (isBoatTrip(trip) ? "Boat" : "Other");
  typeInput.value = trip.trip_type;
  organizerInput.value = trip.organizer || "";
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

  const setOrganizer = async (name) => {
    if (!name) return;
    trip.organizer = name;
    trip.members = orderedTripMembers({ ...trip, organizer: name });
    organizerInput.value = name;
    await saveTrip(trip);
    await renderTripMembers(card, trip);
  };

  organizerInput.addEventListener("input", () => renderSuggestions(organizerInput, organizerSuggestions, setOrganizer));
  organizerInput.addEventListener("focus", () => renderSuggestions(organizerInput, organizerSuggestions, setOrganizer));
  organizerInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      setOrganizer(organizerInput.value.trim());
      closeSuggestions(organizerSuggestions);
    }
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
      if (normalizeTripType(button.dataset.titleSuggestion)) {
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
    trip.members = orderedTripMembers(trip);
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

  const memberNames = orderedTripMembers(trip);
  const details = await Promise.all(
    memberNames.map((name) =>
      api(`/api/trip-member/${encodeURIComponent(name)}?trip_date=${encodeURIComponent(trip.date || "")}&boat=${isBoatTrip(trip)}`)
    )
  );

  details.forEach((detail, index) => {
    const storedName = memberNames[index];
    const isOrganizer = storedName === trip.organizer;
    const row = document.createElement("div");
    row.className = "tripMemberRow";
    if (isOrganizer) row.classList.add("tripOrganizerRow");

    const nameButton = document.createElement("button");
    nameButton.className = "tripMemberNameButton";
    nameButton.type = "button";
    if (isOrganizer) {
      const star = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      star.classList.add("organizerStar");
      star.setAttribute("aria-hidden", "true");
      star.setAttribute("viewBox", "0 0 20 20");
      const starPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
      starPath.setAttribute("d", "M10 1.8 12.6 7 18.4 7.8 14.2 11.9 15.2 17.6 10 14.9 4.8 17.6 5.8 11.9 1.6 7.8 7.4 7 10 1.8Z");
      starPath.setAttribute("fill", "currentColor");
      star.append(starPath);
      nameButton.append(star);
    }
    const nameText = document.createElement("strong");
    nameText.textContent = text(detail.name || storedName || "Unknown member");
    nameButton.append(nameText);

    const contact = document.createElement("div");
    contact.className = "tripMemberContact hidden";
    const phone = document.createElement("span");
    phone.textContent = `Phone: ${text(detail.contact?.phone)}`;
    const email = document.createElement("span");
    email.textContent = `Email: ${text(detail.contact?.email)}`;
    contact.append(phone, email);
    nameButton.addEventListener("click", () => contact.classList.toggle("hidden"));

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
      if (trip.organizer === storedName) trip.organizer = "";
      await saveTrip(trip);
      await renderTripMembers(card, trip);
    });

    const identity = document.createElement("div");
    identity.className = "tripMemberIdentity";
    identity.append(nameButton, contact);

    row.append(identity, statuses, remove);
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

function transactionCategory(itemText) {
  const lowered = String(itemText || "").toLowerCase();
  const category = TRANSACTION_CATEGORIES.find((entry) => entry.needles.some((needle) => lowered.includes(needle)));
  return category?.name || "";
}

function renderTransactions(container, transactions) {
  const details = document.createElement("details");
  details.className = "searchDropdown tripTransactionSummary";
  const summary = document.createElement("summary");
  summary.className = "searchDropdownSummary";
  summary.textContent = "Transactions";
  details.append(summary);

  if (!transactions.length) {
    const empty = document.createElement("section");
    empty.className = "empty";
    empty.textContent = "No transactions found for selected members.";
    details.append(empty);
    container.append(details);
    return;
  }

  const grouped = new Map(TRANSACTION_CATEGORIES.map((category) => [category.name, []]));
  transactions.forEach((transaction) => {
    const category = transactionCategory(transaction.items);
    if (category) grouped.get(category).push(transaction);
  });

  let renderedRows = 0;
  grouped.forEach((rows, category) => {
    if (!rows.length) return;
    const section = document.createElement("section");
    section.className = "panel categorySection";
    const heading = document.createElement("h3");
    heading.textContent = category;
    section.append(heading, transactionTable(rows));
    renderedRows += rows.length;
    details.append(section);
  });

  if (!renderedRows) {
    const empty = document.createElement("section");
    empty.className = "empty";
    empty.textContent = "No categorized transactions found for selected members.";
    details.append(empty);
  }

  container.append(details);
}

function transactionTable(transactions) {
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
  return table;
}

if (createTripButton) {
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
        organizer: tripOrganizerInput.value.trim(),
        members: [],
      }),
    });
    trips = [trip, ...trips];
    tripTitleInput.value = "Trip";
    tripTypeInput.value = "";
    tripOrganizerInput.value = "";
    renderTrips();
  });
}

if (tripOrganizerInput && tripOrganizerSuggestions) {
  tripOrganizerInput.addEventListener("input", () =>
    renderSuggestions(tripOrganizerInput, tripOrganizerSuggestions, (name) => {
      tripOrganizerInput.value = name;
      closeSuggestions(tripOrganizerSuggestions);
    })
  );

  tripOrganizerInput.addEventListener("focus", () =>
    renderSuggestions(tripOrganizerInput, tripOrganizerSuggestions, (name) => {
      tripOrganizerInput.value = name;
      closeSuggestions(tripOrganizerSuggestions);
    })
  );

  tripOrganizerInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      closeSuggestions(tripOrganizerSuggestions);
    }
  });
}

document.querySelectorAll("[data-title-suggestion]").forEach((button) => {
  if (button.closest("template")) return;
  button.addEventListener("click", () => {
    if (normalizeTripType(button.dataset.titleSuggestion)) {
      tripTypeInput.value = button.dataset.titleSuggestion;
      tripTitleInput.value = ensureTitleHasType(tripTitleInput.value, button.dataset.titleSuggestion);
    } else {
      appendTitleSuggestion(tripTitleInput, button.dataset.titleSuggestion);
    }
  });
});

document.addEventListener("click", (event) => {
  if (!pageMenu.classList.contains("hidden") && !event.target.closest(".menuWrap")) {
    closeMenu();
  }
  document.querySelectorAll(".pinMenu").forEach((menu) => {
    if (!menu.closest(".pinWrap").contains(event.target)) menu.classList.add("hidden");
  });
  document.querySelectorAll(".nameSuggestions").forEach((suggestions) => {
    if (!suggestions.closest(".autocompleteWrap").contains(event.target)) closeSuggestions(suggestions);
  });
});

menuButton.addEventListener("click", (event) => {
  event.stopPropagation();
  setMenuOpen(pageMenu.classList.contains("hidden"));
});

pageMenu.addEventListener("click", (event) => {
  if (event.target.matches("[data-theme-toggle]")) closeMenu();
});

refreshButton.addEventListener("click", refreshStore);

async function initTrips() {
  await loadNames();
  await loadTrips();
}

initTrips();
