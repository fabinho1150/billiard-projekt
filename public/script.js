(() => {
  const page = document.body.dataset.page;
  const pollMs = page === "display" ? 1200 : 1500;
  let state = null;
  let lastVersion = -1;
  let lastCallKey = "";
  let callAnimationTimer = null;

  async function api(url, method = "GET", body) {
    const response = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || "Anfrage fehlgeschlagen");
    }

    return response.json();
  }

  function waitingList() {
    return (state?.waitingList || []).slice().sort((a, b) => a.createdAt - b.createdAt);
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatWaitDuration(timestamp) {
    const elapsedMinutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60000));

    if (elapsedMinutes < 1) return "unter 1 min";
    if (elapsedMinutes < 60) return `${elapsedMinutes} min`;

    const hours = Math.floor(elapsedMinutes / 60);
    const minutes = elapsedMinutes % 60;
    return minutes === 0 ? `${hours} h` : `${hours} h ${minutes} min`;
  }

  function updateClock() {
    const node = document.getElementById("display-clock");
    if (!node) return;

    node.textContent = new Intl.DateTimeFormat("de-AT", {
      hour: "2-digit",
      minute: "2-digit",
      weekday: "long",
      day: "2-digit",
      month: "long",
    }).format(new Date()).toUpperCase();
  }

  function configureDisplayMode() {
    if (page !== "display") return;

    const params = new URLSearchParams(window.location.search);
    const forcedTvMode = params.get("tv") === "1";
    const userAgent = navigator.userAgent || "";
    const smartTvPattern = /smart-tv|smarttv|googletv|appletv|hbbtv|netcast|viera|tizen|web0s|webos|roku|aft|bravia/i;
    const largeTvViewport = window.innerWidth >= 2500 && window.innerHeight >= 1300;
    const autoTvMode = smartTvPattern.test(userAgent) || largeTvViewport;

    document.body.classList.toggle("tv-mode", forcedTvMode || autoTvMode);
  }

  function showMessage(text, error = false) {
    const node = document.getElementById("controller-message") || document.getElementById("join-message");
    if (!node) return;

    node.textContent = text;
    node.style.color = error ? "#ff8b95" : "#d8c29a";

    setTimeout(() => {
      if (node.textContent === text) node.textContent = "";
    }, 3200);
  }

  function statBox(value, label) {
    return `<div class="stat-box"><strong>${value}</strong><span>${label}</span></div>`;
  }

  function commitState(nextState) {
    state = nextState;
    lastVersion = nextState.version;

    if (page === "controller") {
      renderController();
    } else if (page === "display") {
      renderDisplay();
    }
  }

  function renderControllerStats() {
    const host = document.getElementById("controller-stats");
    if (!host) return;

    host.innerHTML = [
      statBox(state.occupiedTables, "Besetzt"),
      statBox(state.freeTables, "Frei"),
      statBox(waitingList().length, "Warteliste"),
      statBox(state.activeCall ? escapeHtml(state.activeCall.waitNo) : "-", "Aktiver Aufruf"),
    ].join("");

    document.getElementById("occupied-count").textContent = state.occupiedTables;
    document.getElementById("occupancy-label").textContent = state.freeTables > 0
      ? "Billardtische sind verfügbar"
      : "Aktuell sind alle Tische belegt";
    document.getElementById("free-count-label").textContent = `${state.freeTables} Tische frei`;
  }

  function renderWaitingListController() {
    const host = document.getElementById("waiting-list");
    if (!host) return;

    const list = waitingList();
    if (!list.length) {
      host.innerHTML = '<div class="waiting-empty">Derzeit befinden sich keine Nummern auf der Warteliste.</div>';
      return;
    }

    host.innerHTML = "";
    list.forEach((item) => {
      const row = document.createElement("div");
      row.className = "waiting-row";
      row.innerHTML = `
        <div class="waiting-row-cell">${escapeHtml(item.waitNo)}</div>
        <div class="waiting-row-cell">${formatWaitDuration(item.createdAt)}</div>
        <button class="waiting-row-remove" data-id="${item.id}">Entfernen</button>
      `;
      host.appendChild(row);
    });

    host.querySelectorAll(".waiting-row-remove").forEach((button) => {
      button.addEventListener("click", async () => {
        try {
          commitState(await api("/api/waiting/remove", "POST", { id: button.dataset.id }));
          showMessage("Wartenummer entfernt.");
        } catch (error) {
          showMessage(error.message, true);
        }
      });
    });
  }

  function renderActiveCallController() {
    const card = document.getElementById("active-call-card");
    if (!card) return;

    const repeatBtn = document.getElementById("btn-repeat-call");
    const confirmBtn = document.getElementById("btn-confirm-call");
    const clearBtn = document.getElementById("btn-clear-call");

    if (!state.activeCall) {
      card.className = "active-call-card empty-card";
      card.textContent = "Derzeit kein aktiver Aufruf";
      repeatBtn.disabled = true;
      confirmBtn.disabled = true;
      clearBtn.disabled = true;
      return;
    }

    card.className = "active-call-card";
    card.innerHTML = `
      <span class="call-waitno">${escapeHtml(state.activeCall.waitNo)}</span>
      <div class="call-main-name">Aktuell aufgerufene Nummer</div>
      <div class="lead">Wartet seit ${formatWaitDuration(state.activeCall.createdAt)} | Wiederholt ${state.activeCall.repeatCount}x</div>
    `;
    repeatBtn.disabled = false;
    confirmBtn.disabled = false;
    clearBtn.disabled = false;
  }

  function renderController() {
    renderControllerStats();
    renderWaitingListController();
    renderActiveCallController();
  }

  function renderDisplayHero() {
    const isFull = state.occupiedTables === state.totalTables;

    document.getElementById("display-headline").textContent = isFull ? "ALLE TISCHE BELEGT" : "TISCHE VERFÜGBAR";
    document.getElementById("display-subline").textContent = isFull
      ? "Bitte an der Rezeption eine Wartenummer ziehen"
      : "Bitte direkt an der Rezeption melden";
    document.getElementById("display-note").textContent = isFull
      ? "Sobald ein Tisch frei wird, ruft das Personal die nächste Wartenummer manuell auf."
      : `${state.freeTables} Tische sind im Moment frei.`;
  }

  function renderDisplayStats() {
    const groupsNode = document.getElementById("display-groups");
    const estimateNode = document.getElementById("display-estimate");
    if (!groupsNode || !estimateNode) return;

    groupsNode.textContent = `${waitingList().length} Gruppen warten`;

    if (state.estimatedWait && state.occupiedTables === state.totalTables) {
      estimateNode.textContent = `Ca. ${state.estimatedWait.min}-${state.estimatedWait.max} Minuten`;
      estimateNode.classList.remove("hidden");
    } else {
      estimateNode.classList.add("hidden");
    }
  }

  function renderDisplayEmptyState() {
    const emptyState = document.getElementById("display-empty-state");
    if (!emptyState) return;

    const hasWaitingList = waitingList().length > 0;
    const headline = document.getElementById("display-empty-headline");
    const copy = document.getElementById("display-empty-copy");

    document.body.classList.toggle("display-no-waiting-list", !hasWaitingList);
    emptyState.classList.toggle("hidden", hasWaitingList);

    if (hasWaitingList) return;

    if (state.freeTables > 0) {
      headline.textContent = `${state.freeTables} Tische frei`;
      copy.textContent = "Zurzeit gibt es keine Warteliste. Bitte direkt an der Rezeption melden.";
      return;
    }

    headline.textContent = "Derzeit keine Warteliste";
    copy.textContent = "Aktuell wartet noch niemand. Neue Wartenummern werden an der Rezeption aufgenommen.";
  }

  function renderDisplayPriority() {
    const host = document.getElementById("display-priority");
    const next = waitingList()[0];
    if (!host) return;

    if (!next) {
      host.innerHTML = `
        <div class="priority-card priority-card-empty">
          <div class="priority-label">Als Nächstes dran</div>
          <div class="priority-queue-number">-</div>
          <div class="priority-primary">Zurzeit liegt keine Warteliste vor</div>
          <div class="priority-time">Neue Wartenummern werden an der Rezeption ausgegeben.</div>
        </div>
      `;
      return;
    }

    host.innerHTML = `
      <div class="priority-card">
        <div class="priority-label">Als Nächstes dran</div>
        <div class="priority-queue-number">${escapeHtml(next.waitNo)}</div>
        <div class="priority-time">Wartet seit ${formatWaitDuration(next.createdAt)}</div>
      </div>
    `;
  }

  function renderDisplayWaitingList() {
    const host = document.getElementById("display-waiting-list");
    const panel = host?.closest(".display-upcoming-panel");
    if (!host) return;

    const list = waitingList().slice(1);
    if (!list.length) {
      host.classList.add("is-empty");
      panel?.classList.add("panel-empty");
      host.innerHTML = '<div class="display-upcoming-empty">Derzeit keine weiteren Positionen in der Warteliste.</div>';
      return;
    }

    host.classList.remove("is-empty");
    panel?.classList.remove("panel-empty");

    const visibleItems = document.body.classList.contains("tv-mode") ? list.slice(0, 3) : list.slice(0, 5);
    host.innerHTML = "";

    visibleItems.forEach((item, index) => {
      const card = document.createElement("article");
      card.className = "display-upcoming-card";
      card.innerHTML = `
        <div class="display-upcoming-position">Position ${index + 2}</div>
        <div class="display-upcoming-number">${escapeHtml(item.waitNo)}</div>
        <div class="display-upcoming-time">${formatWaitDuration(item.createdAt)}</div>
      `;
      host.appendChild(card);
    });
  }

  function renderCallOverlay() {
    const overlay = document.getElementById("call-overlay");
    const video = document.getElementById("call-video");
    if (!overlay) return;

    if (!state.activeCall) {
      overlay.classList.add("hidden");
      return;
    }

    document.getElementById("call-number").textContent = state.activeCall.waitNo;
    document.getElementById("call-copy").textContent = "Bitte zur Rezeption kommen";
    overlay.classList.remove("hidden");

    const key = `${state.activeCall.id}:${state.activeCall.createdAt}:${state.activeCall.repeatCount}`;
    if (key === lastCallKey) return;
    lastCallKey = key;

    if (callAnimationTimer) clearTimeout(callAnimationTimer);
    overlay.classList.remove("animate-flash");
    void overlay.offsetWidth;
    overlay.classList.add("animate-flash");
    callAnimationTimer = setTimeout(() => overlay.classList.remove("animate-flash"), 700);

    if (video) {
      video.currentTime = 0;
      const attempt = video.play();
      if (attempt && typeof attempt.catch === "function") {
        attempt.catch(() => {});
      }
    }
  }

  function renderDisplay() {
    renderDisplayHero();
    renderDisplayStats();
    renderDisplayEmptyState();
    renderDisplayPriority();
    renderDisplayWaitingList();
    renderCallOverlay();
  }

  async function refreshState(force = false) {
    const nextState = await api("/api/state");
    if (force || nextState.version > lastVersion) {
      commitState(nextState);
    }
  }

  async function handleAddGuest(event) {
    event.preventDefault();
    const waitNo = document.getElementById("wait-no").value;

    try {
      commitState(await api("/api/waiting/add", "POST", { waitNo }));
      document.getElementById("wait-no").value = "";
      showMessage("Wartenummer erfolgreich hinzugefügt.");
      document.getElementById("wait-no").focus();
    } catch (error) {
      showMessage(error.message, true);
    }
  }

  async function handleOccupiedPlus() {
    try {
      commitState(await api("/api/tables/increment", "POST"));
    } catch (error) {
      showMessage(error.message, true);
    }
  }

  async function handleOccupiedMinus() {
    try {
      commitState(await api("/api/tables/decrement", "POST"));
    } catch (error) {
      showMessage(error.message, true);
    }
  }

  async function handleCallNext() {
    try {
      commitState(await api("/api/call/next", "POST"));
      showMessage(`Aufruf gestartet: Nummer ${state.activeCall.waitNo}`);
    } catch (error) {
      showMessage(error.message, true);
    }
  }

  async function handleRepeatCall() {
    try {
      commitState(await api("/api/call/repeat", "POST"));
      showMessage("Aufruf wiederholt.");
    } catch (error) {
      showMessage(error.message, true);
    }
  }

  async function handleConfirmCall() {
    try {
      commitState(await api("/api/call/confirm", "POST"));
      showMessage("Aufruf bestätigt.");
    } catch (error) {
      showMessage(error.message, true);
    }
  }

  async function handleClearCall() {
    try {
      commitState(await api("/api/call/clear", "POST"));
      showMessage("Aufruf beendet.");
    } catch (error) {
      showMessage(error.message, true);
    }
  }

  async function handlePublicJoin(event) {
    event.preventDefault();
    const successBox = document.getElementById("join-success");
    const successNumber = document.getElementById("join-success-number");
    const successCopy = document.getElementById("join-success-copy");

    try {
      const result = await api("/api/public/join", "POST");
      if (successBox) successBox.classList.remove("hidden");
      if (successNumber) successNumber.textContent = result.waitNo;
      if (successCopy) successCopy.textContent = `Deine Position: ${result.position}. Bitte diese Nummer an der Rezeption vorzeigen.`;
      showMessage("Wartenummer erfolgreich gezogen.");
    } catch (error) {
      showMessage(error.message, true);
    }
  }

  function wireController() {
    document.getElementById("add-form").addEventListener("submit", handleAddGuest);
    document.getElementById("btn-occupied-plus").addEventListener("click", handleOccupiedPlus);
    document.getElementById("btn-occupied-minus").addEventListener("click", handleOccupiedMinus);
    document.getElementById("btn-call-next").addEventListener("click", handleCallNext);
    document.getElementById("btn-repeat-call").addEventListener("click", handleRepeatCall);
    document.getElementById("btn-confirm-call").addEventListener("click", handleConfirmCall);
    document.getElementById("btn-clear-call").addEventListener("click", handleClearCall);
  }

  function wireJoin() {
    document.getElementById("join-form").addEventListener("submit", handlePublicJoin);
  }

  function refreshRelativeTimes() {
    if (!state) return;

    if (page === "controller") {
      renderController();
      return;
    }

    if (page === "display") {
      renderDisplay();
    }
  }

  async function start() {
    if (page === "controller") {
      await refreshState(true);
      wireController();
    } else if (page === "join") {
      wireJoin();
    } else {
      await refreshState(true);
      configureDisplayMode();
      updateClock();
      setInterval(updateClock, 30000);
      window.addEventListener("resize", configureDisplayMode);
    }

    if (page !== "join") {
      setInterval(refreshRelativeTimes, 30000);
      setInterval(() => {
        refreshState().catch(() => {});
      }, pollMs);
    }
  }

  start().catch(() => {
    showMessage("Server nicht erreichbar.", true);
  });
})();
