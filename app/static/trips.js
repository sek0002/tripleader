const tripDateInput = document.querySelector("#tripDateInput");
const tripTypeInput = document.querySelector("#tripTypeInput");
const tripTitleInput = document.querySelector("#tripTitleInput");
const tripOrganizerInput = document.querySelector("#tripOrganizerInput");
const tripOrganizerSuggestions = document.querySelector("#tripOrganizerSuggestions");
const createTripButton = document.querySelector("#createTripButton");
const tripCards = document.querySelector("#tripCards");
const tripEmptyState = document.querySelector("#tripEmptyState");
const tripCardTemplate = document.querySelector("#tripCardTemplate");
const tripSortToggle = document.querySelector("#tripSortToggle");
const menuButton = document.querySelector("#menuButton");
const pageMenu = document.querySelector("#pageMenu");
const refreshButton = document.querySelector("#refreshButton");
const isArchivePage = document.body.dataset.tripArchive === "true";

let availableNames = [];
let trips = [];
let tripSortDirection = "asc";
let countdownTimer = null;
const DEFAULT_TRIP_TITLE = "Name Your Trip";
const copiedIcon =
  '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M9.2 16.6 4.9 12.3l1.4-1.4 2.9 2.9 8.5-8.5 1.4 1.4-9.9 9.9Z" fill="currentColor"></path></svg>';
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

async function copyText(value, button) {
  const copied = String(value || "").trim();
  if (!copied || copied === "Not supplied") return;

  try {
    await navigator.clipboard.writeText(copied);
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = copied;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.append(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
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

function copyButton(value, label, type = "copy") {
  const button = document.createElement("button");
  button.className = "copyValueButton";
  button.type = "button";
  button.setAttribute("aria-label", label);
  button.title = label.replace(/^Copy\s+/i, "Copy ");
  button.innerHTML = type === "email"
    ? '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 6h16c1.1 0 2 .9 2 2v8c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V8c0-1.1.9-2 2-2Zm0 3.1V16h16V9.1l-8 5.2-8-5.2Zm1.2-1.1 6.8 4.4L18.8 8H5.2Z" fill="currentColor"></path></svg>'
    : '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M8 7.2c0-1.1.9-2 2-2h7c1.1 0 2 .9 2 2v9.5c0 1.1-.9 2-2 2h-7c-1.1 0-2-.9-2-2V7.2Zm2-.2v9.7h7V7h-7ZM5 10.2h2v2H5v7h8v2H5c-1.1 0-2-.9-2-2v-7c0-1.1.9-2 2-2Z" fill="currentColor"></path></svg>';
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    copyText(value, button);
  });
  return button;
}

function contactLine(label, value, type) {
  const line = document.createElement("span");
  line.className = "copyValueLine tripContactLine";
  const textNode = document.createElement("span");
  textNode.textContent = `${label}: ${text(value)}`;
  line.append(textNode, copyButton(value, `Copy ${label.toLowerCase()}`, type));
  return line;
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
  return `<span class="statusBadgeWrap" title="${safeTitle}" data-tooltip="${safeTitle}" aria-label="${safeTitle}" tabindex="0"><span class="statusBadge statusBadge--${type}" aria-hidden="true">${visible}</span>${captionText}</span>`;
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
    .replace(new RegExp(`^${DEFAULT_TRIP_TITLE}$`, "i"), "")
    .replace(/^\s*(boat|shore|other)\b[\s:.-]*/i, "")
    .trim();
  const titleBody = cleanedTitle.toLowerCase() === "trip" ? "" : cleanedTitle;
  return tripType ? `${tripType}${titleBody ? ` ${titleBody}` : ""}` : titleBody || DEFAULT_TRIP_TITLE;
}

function isBoatTrip(trip) {
  return normalizeTripType(trip.trip_type) === "Boat" || String(trip.title || "").toLowerCase().includes("boat");
}

function orderedTripMembers(trip) {
  const members = Array.isArray(trip.members) ? [...trip.members] : [];
  if (!trip.organizer) return members;
  return [trip.organizer, ...members.filter((member) => member !== trip.organizer)];
}

function randomTripPattern() {
  const values = [
    12 + Math.floor(Math.random() * 76),
    10 + Math.floor(Math.random() * 78),
    12 + Math.floor(Math.random() * 76),
    10 + Math.floor(Math.random() * 78),
    12 + Math.floor(Math.random() * 76),
    10 + Math.floor(Math.random() * 78),
    Math.floor(Math.random() * 180),
  ];
  return `r-${values.join("-")}`;
}

function fallbackTripPattern(tripId) {
  const source = String(tripId || "trip");
  const seed = [...source].reduce((total, character, index) => total + character.charCodeAt(0) * (index + 1), 0);
  return `r-${12 + (seed % 76)}-${10 + (Math.floor(seed / 3) % 78)}-${12 + (Math.floor(seed / 5) % 76)}-${10 + (Math.floor(seed / 7) % 78)}-${12 + (Math.floor(seed / 11) % 76)}-${10 + (Math.floor(seed / 13) % 78)}-${seed % 180}`;
}

function applyTripPattern(card, trip) {
  const pattern = /^r(?:-\d{1,3}){7}$/.test(trip.pattern || "") ? trip.pattern : fallbackTripPattern(trip.id);
  const [, p1x, p1y, p2x, p2y, p3x, p3y, angle] = pattern.split("-").map(Number);
  card.style.setProperty("--p1x", `${p1x}%`);
  card.style.setProperty("--p1y", `${p1y}%`);
  card.style.setProperty("--p2x", `${p2x}%`);
  card.style.setProperty("--p2y", `${p2y}%`);
  card.style.setProperty("--p3x", `${p3x}%`);
  card.style.setProperty("--p3y", `${p3y}%`);
  card.style.setProperty("--shimmer-angle", `${angle}deg`);
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

function tripDateSortValue(trip) {
  const timestamp = Date.parse(trip.date || "");
  return Number.isFinite(timestamp) ? timestamp : Number.MAX_SAFE_INTEGER;
}

function sortedTrips() {
  return [...trips].sort((left, right) => {
    const comparison = tripDateSortValue(left) - tripDateSortValue(right);
    return tripSortDirection === "asc" ? comparison : -comparison;
  });
}

async function refreshStore() {
  refreshButton.disabled = true;
  refreshButton.classList.add("isRefreshing");
  refreshButton.setAttribute("aria-label", "Refreshing");
  refreshButton.title = "Refreshing";
  try {
    await api("/api/refresh", { method: "POST" });
    await loadNames();
    await loadTrips();
  } finally {
    refreshButton.disabled = false;
    refreshButton.classList.remove("isRefreshing");
    refreshButton.setAttribute("aria-label", "Refresh");
    refreshButton.title = "Refresh";
  }
}

function closeSuggestions(suggestions) {
  suggestions.classList.add("hidden");
}

function setChildren(element, children = []) {
  while (element.firstChild) {
    element.removeChild(element.firstChild);
  }
  children.forEach((child) => {
    element.appendChild(child);
  });
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

  setChildren(
    suggestions,
    matches.slice(0, 30).map((name) => {
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

function pickFirstSuggestion(input, suggestions, onPick) {
  if (suggestions.classList.contains("hidden") || !suggestions.children.length) return false;
  const firstSuggestion = suggestions.querySelector(".nameSuggestion");
  const value = firstSuggestion && firstSuggestion.textContent ? firstSuggestion.textContent.trim() : "";
  if (!value) return false;
  input.value = value;
  onPick(value);
  return true;
}

function renderTrips() {
  if (countdownTimer) clearInterval(countdownTimer);
  setChildren(tripCards);
  tripEmptyState.classList.toggle("hidden", trips.length > 0);

  sortedTrips().forEach((trip) => renderTripCard(trip));
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
  const addMemberToggleButton = card.querySelector(".addMemberToggleButton");
  const memberLookup = card.querySelector(".tripMemberLookup");
  const memberInput = card.querySelector(".tripMemberInput");
  const suggestions = card.querySelector(".tripMemberLookup .nameSuggestions");

  applyTripPattern(card, trip);
  titleInput.value = trip.title || "Name Your Trip";
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
      if (!pickFirstSuggestion(organizerInput, organizerSuggestions, setOrganizer)) {
        setOrganizer(organizerInput.value.trim());
      }
      closeSuggestions(organizerSuggestions);
    }
  });

  dateInput.addEventListener("change", async () => {
    trip.date = dateInput.value;
    countdown.dataset.tripDate = trip.date || "";
    updateCountdowns();
    await saveTrip(trip);
    renderTrips();
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
    const isOpen = !pinMenu.classList.contains("hidden");
    card.classList.toggle("tripCard--menuOpen", isOpen);
    pinButton.setAttribute("aria-expanded", String(isOpen));
  });

  card.querySelector(".deleteTripButton").addEventListener("click", async () => {
    await api(`/api/trips/${encodeURIComponent(trip.id)}`, { method: "DELETE" });
    trips = trips.filter((existing) => existing.id !== trip.id);
    renderTrips();
  });

  const archiveButton = card.querySelector(".archiveTripButton");
  if (archiveButton) {
    archiveButton.classList.toggle("hidden", isArchivePage);
    archiveButton.addEventListener("click", async () => {
      trip.archived = true;
      await saveTrip(trip);
      trips = trips.filter((existing) => existing.id !== trip.id);
      renderTrips();
    });
  }

  const addMember = async (name) => {
    if (!name || trip.members.includes(name)) return;
    trip.members.push(name);
    trip.members = orderedTripMembers(trip);
    await saveTrip(trip);
    await renderTripMembers(card, trip);
    memberLookup.classList.add("hidden");
    addMemberToggleButton.setAttribute("aria-expanded", "false");
  };

  addMemberToggleButton.addEventListener("click", () => {
    const isHidden = memberLookup.classList.toggle("hidden");
    addMemberToggleButton.setAttribute("aria-expanded", String(!isHidden));
    if (!isHidden) memberInput.focus();
  });

  memberInput.addEventListener("input", () => renderSuggestions(memberInput, suggestions, addMember));
  memberInput.addEventListener("focus", () => renderSuggestions(memberInput, suggestions, addMember));
  memberInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      if (!pickFirstSuggestion(memberInput, suggestions, addMember)) {
        addMember(memberInput.value.trim());
      }
      memberInput.value = "";
      closeSuggestions(suggestions);
    }
  });
  tripCards.append(card);
  renderTripMembers(card, trip);
}

async function renderTripMembers(card, trip) {
  const memberList = card.querySelector(".tripMembers");
  const addMemberBar = card.querySelector(".tripMemberAddBar");
  const transactionSection = card.querySelector(".tripTransactions");
  setChildren(memberList);
  setChildren(transactionSection);

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
    const contactPayload = detail.contact || {};
    contact.appendChild(contactLine("Phone", contactPayload.phone, "phone"));
    contact.appendChild(contactLine("Email", contactPayload.email, "email"));
    nameButton.addEventListener("click", () => contact.classList.toggle("hidden"));

    const statuses = document.createElement("div");
    statuses.className = "memberStatusRow tripMemberStatuses";
    const membershipStatusPayload = detail.membership_status || {};
    const liabilityWaiverStatusPayload = detail.liability_waiver_status || {};
    const hireStatusPayload = detail.hire_status || {};
    const savedMemberData = detail.saved_member_data || {};
    const membershipOverride = savedMemberData.membership_override || null;
    const membershipIsCurrent =
      membershipOverride && typeof membershipOverride === "object"
        ? Boolean(membershipOverride.is_current)
        : Boolean(membershipStatusPayload.is_current);
    const membershipLabel =
      membershipOverride && typeof membershipOverride === "object"
        ? `Membership manually set: ${membershipIsCurrent ? "Member" : "Not member"}`
        : membershipStatusPayload.label || "Membership";
    const memberComment = String(savedMemberData.comment || "").trim();
    appendStatus(statuses, membershipIsCurrent, membershipLabel, "membership");
    appendStatus(statuses, Boolean(liabilityWaiverStatusPayload.is_current), liabilityWaiverStatusPayload.label || "Liability Waiver", "liability");
    if (hireStatusPayload.is_current) appendStatus(statuses, true, hireStatusPayload.label || "Hire", "hire");
    if (detail.boat_payment_status) appendStatus(statuses, Boolean(detail.boat_payment_status.is_current), detail.boat_payment_status.label, "boat");
    if (memberComment) appendStatus(statuses, true, memberComment, "comment");

    const remove = document.createElement("button");
    remove.className = "removeTripMemberButton";
    remove.type = "button";
    remove.textContent = "×";
    remove.setAttribute("aria-label", `Remove ${text(detail.name || storedName || "member")}`);
    remove.title = "Remove";
    remove.addEventListener("click", async () => {
      trip.members = trip.members.filter((member) => member !== storedName);
      if (trip.organizer === storedName) trip.organizer = "";
      await saveTrip(trip);
      await renderTripMembers(card, trip);
    });

    const identity = document.createElement("div");
    identity.className = "tripMemberIdentity";
    identity.appendChild(nameButton);
    identity.appendChild(contact);

    row.appendChild(identity);
    row.appendChild(statuses);
    row.appendChild(remove);
    memberList.appendChild(row);
  });

  memberList.appendChild(addMemberBar);
  const transactions = details.reduce((rows, detail) => rows.concat(detail.transactions || []), []);
  renderTransactions(transactionSection, transactions);
}

function appendStatus(container, isCurrent, label, type = "membership") {
  const status = document.createElement("span");
  status.className = `membershipStatus ${type === "comment" ? "isCommented" : isCurrent ? "isCurrentMember" : "isNotCurrentMember"}`;
  status.innerHTML = statusMarkup(isCurrent, label, type);
  container.appendChild(status);
}

function transactionCategory(itemText) {
  const lowered = String(itemText || "").toLowerCase();
  const category = TRANSACTION_CATEGORIES.find((entry) => entry.needles.some((needle) => lowered.includes(needle)));
  return category ? category.name : "";
}

function parseTransactionDate(value) {
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

  const timestamp = Date.parse(dateText);
  return Number.isNaN(timestamp) ? NaN : timestamp;
}

function recentTripTransactions(transactions) {
  const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
  return transactions.filter((transaction) => {
    const timestamp = parseTransactionDate(transaction.date);
    return Number.isFinite(timestamp) && timestamp >= cutoff;
  });
}

function renderTransactions(container, transactions) {
  const recentTransactions = recentTripTransactions(transactions);
  const details = document.createElement("details");
  details.className = "searchDropdown tripTransactionSummary";
  const summary = document.createElement("summary");
  summary.className = "searchDropdownSummary";
  summary.textContent = "Transactions (past 2 weeks)";
  details.append(summary);

  if (!recentTransactions.length) {
    const empty = document.createElement("section");
    empty.className = "empty";
    empty.textContent = "No transactions found for selected members in the last 2 weeks.";
    details.append(empty);
    container.append(details);
    return;
  }

  const filterInput = document.createElement("input");
  filterInput.className = "tripTransactionFilter";
  filterInput.type = "search";
  filterInput.autocomplete = "off";
  filterInput.placeholder = "Filter transactions";
  details.append(filterInput);

  const transactionRows = document.createElement("div");
  transactionRows.className = "tripTransactionRows";
  details.append(transactionRows);

  const renderFilteredTransactions = () => {
    setChildren(transactionRows);
    const query = filterInput.value.trim().toLowerCase();
    const filteredTransactions = query
      ? recentTransactions.filter((transaction) =>
          [transaction.name, transaction.date, transaction.paid, transaction.total, transaction.items]
            .map(text)
            .join(" ")
            .toLowerCase()
            .includes(query)
        )
      : recentTransactions;

    if (!filteredTransactions.length) {
      const empty = document.createElement("section");
      empty.className = "empty";
      empty.textContent = "No transactions match this filter.";
      transactionRows.append(empty);
      return;
    }

  const grouped = new Map(TRANSACTION_CATEGORIES.map((category) => [category.name, []]));
  filteredTransactions.forEach((transaction) => {
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
    section.appendChild(heading);
    section.appendChild(transactionTable(rows));
    renderedRows += rows.length;
    transactionRows.append(section);
  });

  if (!renderedRows) {
    const empty = document.createElement("section");
    empty.className = "empty";
    empty.textContent = "No categorized transactions found for selected members.";
    transactionRows.append(empty);
  }
  };

  filterInput.addEventListener("input", renderFilteredTransactions);
  renderFilteredTransactions();

  container.append(details);
}

function transactionTable(transactions) {
  const table = document.createElement("table");
  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  ["Name", "Date", "Paid", "Total", "Items"].forEach((label) => {
    const th = document.createElement("th");
    th.textContent = label;
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);

  const tbody = document.createElement("tbody");
  transactions.forEach((transaction) => {
    const row = document.createElement("tr");
    ["name", "date", "paid", "total", "items"].forEach((key) => {
      const td = document.createElement("td");
      td.textContent = text(transaction[key]);
      row.appendChild(td);
    });
    tbody.appendChild(row);
  });

  table.appendChild(thead);
  table.appendChild(tbody);
  return table;
}

if (createTripButton) {
  tripTitleInput.addEventListener("focus", () => {
    if (tripTitleInput.value.trim() === DEFAULT_TRIP_TITLE) {
      tripTitleInput.value = "";
    }
  });

  createTripButton.addEventListener("click", async () => {
    const tripType = normalizeTripType(tripTypeInput.value);
  if (!tripType) {
    tripTypeInput.reportValidity();
    return;
  }
  if (!tripOrganizerInput.value.trim()) {
    tripOrganizerInput.reportValidity();
    tripOrganizerInput.focus();
    return;
  }
    const trip = await api("/api/trips", {
      method: "POST",
      body: JSON.stringify({
        date: tripDateInput.value,
        title: ensureTitleHasType(tripTitleInput.value, tripType),
      trip_type: tripType,
      organizer: tripOrganizerInput.value.trim(),
      pattern: randomTripPattern(),
      members: [],
    }),
    });
    trips = [trip, ...trips];
    tripTitleInput.value = "";
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
      if (!pickFirstSuggestion(tripOrganizerInput, tripOrganizerSuggestions, (name) => {
        tripOrganizerInput.value = name;
      })) {
        tripOrganizerInput.value = tripOrganizerInput.value.trim();
      }
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
    if (!menu.closest(".pinWrap").contains(event.target)) {
      menu.classList.add("hidden");
      const card = menu.closest(".tripCard");
      if (card) card.classList.remove("tripCard--menuOpen");
    }
  });
  document.querySelectorAll(".nameSuggestions").forEach((suggestions) => {
    if (!suggestions.closest(".autocompleteWrap").contains(event.target)) closeSuggestions(suggestions);
  });
  document.querySelectorAll(".tripMemberAddBar").forEach((bar) => {
    if (bar.contains(event.target)) return;
    const lookup = bar.querySelector(".tripMemberLookup");
    const toggle = bar.querySelector(".addMemberToggleButton");
    lookup.classList.add("hidden");
    toggle.setAttribute("aria-expanded", "false");
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
tripSortToggle.addEventListener("click", () => {
  tripSortDirection = tripSortDirection === "asc" ? "desc" : "asc";
  const isAscending = tripSortDirection === "asc";
  tripSortToggle.textContent = isAscending ? "↑" : "↓";
  tripSortToggle.setAttribute("aria-label", `Sort by date ${isAscending ? "ascending" : "descending"}`);
  tripSortToggle.title = `Sort by date ${isAscending ? "ascending" : "descending"}`;
  renderTrips();
});

async function initTrips() {
  await loadNames();
  await loadTrips();
}

initTrips();
