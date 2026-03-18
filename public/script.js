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
    return (state.waitingList || []).slice().sort((a, b) => a.createdAt - b.createdAt);
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatWaitDuration(timestamp) {
    const elapsedMinutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60000));

    if (elapsedMinutes < 1) {
      return "unter 1 min";
    }
    if (elapsedMinutes < 60) {
      return `${elapsedMinutes} min`;
    }

    const hours = Math.floor(elapsedMinutes / 60);
    const minutes = elapsedMinutes % 60;
    if (minutes === 0) {
      return `${hours} h`;
    }

    return `${hours} h ${minutes} min`;
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
      return;
    }

    renderDisplay();
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
    document.getElementById("occupancy-label").textContent = state.freeTables > 0 ? "Billardtische sind verfügbar" : "Aktuell sind alle Tische belegt";
    document.getElementById("free-count-label").textContent = `${state.freeTables} Tische verfügbar`;
  }

  function renderWaitingListController() {
    const host = document.getElementById("waiting-list");
    if (!host) return;

    const list = waitingList();
    if (!list.length) {
      host.innerHTML = '<div class="waiting-empty">Derzeit befinden sich keine Gäste auf der Warteliste</div>';
      return;
    }

    host.innerHTML = "";
    list.forEach((item) => {
      const row = document.createElement("div");
      row.className = "waiting-row";
      row.innerHTML = `
        <div class="waiting-row-cell waiting-row-name">${escapeHtml(item.guestName)}</div>
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
          showMessage("Eintrag entfernt.");
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
      <div class="call-main-name">${escapeHtml(state.activeCall.guestName)}</div>
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
    renderJoinQr();
  }

  function renderJoinQr() {
    const qrImage = document.getElementById("join-qr-image");
    const urlLabel = document.getElementById("join-url-label");
    if (!qrImage || !urlLabel) return;

    const joinUrl = `${window.location.origin}/join`;
    qrImage.src = `https://quickchart.io/qr?text=${encodeURIComponent(joinUrl)}&size=280&margin=2&dark=0A1722&light=FFFFFF`;
    urlLabel.textContent = joinUrl.replace(/^https?:\/\//, "");
  }

  function renderDisplayHero() {
    const isFull = state.occupiedTables === state.totalTables;

    document.getElementById("display-headline").textContent = isFull ? "ALLE TISCHE BELEGT" : "TISCHE VERFÜGBAR";
    document.getElementById("display-subline").textContent = isFull ? "Bitte an der Rezeption für die Warteliste anmelden" : "Bitte an der Rezeption melden";
    document.getElementById("display-note").textContent = isFull ? "Sobald ein Tisch frei wird, ruft das Personal die nächste Wartenummer manuell auf." : `${state.freeTables} Tische sind im Moment frei.`;
  }

  function renderDisplayStats() {
    document.getElementById("display-groups").textContent = `${waitingList().length} Gruppen warten`;

    const estimate = document.getElementById("display-estimate");
    if (state.estimatedWait && state.occupiedTables === state.totalTables) {
      estimate.textContent = `Ca. ${state.estimatedWait.min}-${state.estimatedWait.max} Minuten`;
      estimate.classList.remove("hidden");
    } else {
      estimate.classList.add("hidden");
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
    copy.textContent = "Aktuell wartet noch niemand. Neue Gruppen werden an der Rezeption aufgenommen.";
  }

  function renderDisplayPriority() {
    const host = document.getElementById("display-priority");
    const next = waitingList()[0];

    if (!next) {
      host.innerHTML = `
        <div class="priority-card priority-card-empty">
          <div class="priority-label">Als Nächstes dran</div>
          <div class="priority-queue-number">-</div>
          <div class="priority-primary">Zurzeit liegt keine Warteliste vor</div>
          <div class="priority-time">Neue Gruppen melden sich an der Rezeption.</div>
        </div>
      `;
      return;
    }

    host.innerHTML = `
      <div class="priority-card">
        <div class="priority-label">Als Nächstes dran</div>
        <div class="priority-queue-number">${escapeHtml(next.waitNo)}</div>
        <div class="priority-primary">${escapeHtml(next.guestName)}</div>
        <div class="priority-time">Wartet seit ${formatWaitDuration(next.createdAt)}</div>
      </div>
    `;
  }

  function renderDisplayWaitingList() {
    const host = document.getElementById("display-waiting-list");
    if (!host) return;
    const panel = host.closest(".display-upcoming-panel");

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
        <div class="display-upcoming-name">${escapeHtml(item.guestName)}</div>
        <div class="display-upcoming-time">${formatWaitDuration(item.createdAt)}</div>
      `;
      host.appendChild(card);
    });
  }

  function playCallSound() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;

    const ctx = new AC();
    const now = ctx.currentTime;

    const cueClick = ctx.createOscillator();
    const cueClickGain = ctx.createGain();
    cueClick.type = "square";
    cueClick.frequency.setValueAtTime(980, now + 0.02);
    cueClick.frequency.exponentialRampToValueAtTime(360, now + 0.08);
    cueClickGain.gain.setValueAtTime(0.0001, now + 0.02);
    cueClickGain.gain.exponentialRampToValueAtTime(0.13, now + 0.03);
    cueClickGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.09);
    cueClick.connect(cueClickGain);
    cueClickGain.connect(ctx.destination);
    cueClick.start(now + 0.02);
    cueClick.stop(now + 0.1);

    const rollOsc = ctx.createOscillator();
    const rollGain = ctx.createGain();
    const rollFilter = ctx.createBiquadFilter();
    rollOsc.type = "triangle";
    rollOsc.frequency.setValueAtTime(240, now + 0.09);
    rollOsc.frequency.exponentialRampToValueAtTime(120, now + 0.42);
    rollFilter.type = "lowpass";
    rollFilter.frequency.value = 620;
    rollGain.gain.setValueAtTime(0.0001, now + 0.09);
    rollGain.gain.exponentialRampToValueAtTime(0.08, now + 0.16);
    rollGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.44);
    rollOsc.connect(rollFilter);
    rollFilter.connect(rollGain);
    rollGain.connect(ctx.destination);
    rollOsc.start(now + 0.09);
    rollOsc.stop(now + 0.46);

    const impactThump = ctx.createOscillator();
    const impactGain = ctx.createGain();
    impactThump.type = "sine";
    impactThump.frequency.setValueAtTime(140, now + 0.47);
    impactThump.frequency.exponentialRampToValueAtTime(56, now + 0.68);
    impactGain.gain.setValueAtTime(0.0001, now + 0.47);
    impactGain.gain.exponentialRampToValueAtTime(0.3, now + 0.5);
    impactGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.72);
    impactThump.connect(impactGain);
    impactGain.connect(ctx.destination);
    impactThump.start(now + 0.47);
    impactThump.stop(now + 0.74);

    [760, 920, 640].forEach((freq, index) => {
      const chime = ctx.createOscillator();
      const chimeGain = ctx.createGain();
      chime.type = index === 1 ? "triangle" : "sine";
      chime.frequency.value = freq;
      chimeGain.gain.setValueAtTime(0.0001, now + 0.5 + index * 0.05);
      chimeGain.gain.exponentialRampToValueAtTime(0.12, now + 0.53 + index * 0.05);
      chimeGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.76 + index * 0.05);
      chime.connect(chimeGain);
      chimeGain.connect(ctx.destination);
      chime.start(now + 0.5 + index * 0.05);
      chime.stop(now + 0.8 + index * 0.05);
    });

    setTimeout(() => ctx.close(), 1600);
  }

  function renderCallOverlay() {
    const overlay = document.getElementById("call-overlay");
    if (!overlay) return;

    if (!state.activeCall) {
      overlay.classList.add("hidden");
      return;
    }

    document.getElementById("call-name").textContent = state.activeCall.guestName;
    document.getElementById("call-number").textContent = state.activeCall.waitNo;
    document.getElementById("call-copy").textContent = "Bitte zur Rezeption kommen";
    overlay.classList.remove("hidden");

    const card = overlay.querySelector(".call-overlay-card");
    const key = `${state.activeCall.id}:${state.activeCall.createdAt}:${state.activeCall.repeatCount}`;

    if (key !== lastCallKey) {
      lastCallKey = key;
      if (callAnimationTimer) clearTimeout(callAnimationTimer);
      overlay.classList.remove("animate-flash");
      card.classList.remove("animate");
      void card.offsetWidth;
      overlay.classList.add("animate-flash");
      card.classList.add("animate");
      callAnimationTimer = setTimeout(() => {
        overlay.classList.remove("animate-flash");
      }, 700);

      const video = document.getElementById("call-video");
      if (video) {
        video.currentTime = 0;
        const playAttempt = video.play();
        if (playAttempt && typeof playAttempt.catch === "function") {
          playAttempt.catch(() => {});
        }
      }

      playCallSound();
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
    const guestName = document.getElementById("guest-name").value;
    const waitNo = document.getElementById("wait-no").value;

    try {
      commitState(await api("/api/waiting/add", "POST", { guestName, waitNo }));
      document.getElementById("guest-name").value = "";
      document.getElementById("wait-no").value = "";
      showMessage("Gast erfolgreich zur Warteliste hinzugefügt.");
      document.getElementById("guest-name").focus();
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
      showMessage(`Aufruf gestartet: ${state.activeCall.guestName} / ${state.activeCall.waitNo}`);
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
    const nameInput = document.getElementById("join-name");
    const successBox = document.getElementById("join-success");
    const successNumber = document.getElementById("join-success-number");
    const successName = document.getElementById("join-success-name");
    const successCopy = document.getElementById("join-success-copy");

    try {
      const result = await api("/api/public/join", "POST", { guestName: nameInput.value });
      nameInput.value = "";
      if (successBox) successBox.classList.remove("hidden");
      if (successNumber) successNumber.textContent = result.waitNo;
      if (successName) successName.textContent = result.guestName;
      if (successCopy) successCopy.textContent = `Deine Position: ${result.position}`;
      showMessage("Anmeldung erfolgreich.");
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

    renderDisplay();
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
    if (page === "controller") {
      showMessage("Server nicht erreichbar.", true);
    }
  });
})();

