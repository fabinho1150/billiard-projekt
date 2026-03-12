(() => {
  const page = document.body.dataset.page;
  const pollMs = page === "display" ? 700 : 1000;
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
      throw new Error(payload.error || "Request failed");
    }

    return response.json();
  }

  function waitingList() {
    return (state.waitingList || []).slice().sort((a, b) => a.createdAt - b.createdAt);
  }

  function timeSince(timestamp) {
    const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
    const minutes = String(Math.floor(seconds / 60)).padStart(2, "0");
    const secs = String(seconds % 60).padStart(2, "0");
    return `${minutes}:${secs}`;
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
    const node = document.getElementById("controller-message");
    if (!node) return;
    node.textContent = text;
    node.style.color = error ? "#ff8b95" : "#80f3a6";
    setTimeout(() => {
      if (node.textContent === text) node.textContent = "";
    }, 3000);
  }

  function statBox(value, label) {
    return `<div class="stat-box"><strong>${value}</strong><span>${label}</span></div>`;
  }

  function renderControllerStats() {
    const host = document.getElementById("controller-stats");
    if (!host) return;

    host.innerHTML = [
      statBox(state.occupiedTables, "Besetzt"),
      statBox(state.freeTables, "Frei"),
      statBox(waitingList().length, "Warteliste"),
      statBox(state.activeCall ? state.activeCall.waitNo : "-", "Aktueller Aufruf"),
    ].join("");

    document.getElementById("occupied-count").textContent = state.occupiedTables;
    document.getElementById("occupancy-label").textContent = state.freeTables > 0 ? "Billardtische sind frei" : "Aktuell alle Tische besetzt";
    document.getElementById("free-count-label").textContent = `${state.freeTables} Tische frei`;
  }

  function renderWaitingListController() {
    const host = document.getElementById("waiting-list");
    if (!host) return;

    const list = waitingList();
    if (!list.length) {
      host.innerHTML = '<div class="waiting-empty">Noch keine Gaeste in der Warteliste</div>';
      return;
    }

    host.innerHTML = "";
    list.forEach((item) => {
      const row = document.createElement("div");
      row.className = "waiting-row";
      row.innerHTML = `
        <div class="waiting-row-cell waiting-row-name">${item.guestName}</div>
        <div class="waiting-row-cell">${item.waitNo}</div>
        <div class="waiting-row-cell">${timeSince(item.createdAt)}</div>
        <button class="waiting-row-remove" data-id="${item.id}">Entfernen</button>
      `;
      host.appendChild(row);
    });

    host.querySelectorAll(".waiting-row-remove").forEach((button) => {
      button.addEventListener("click", async () => {
        try {
          state = await api("/api/waiting/remove", "POST", { id: button.dataset.id });
          renderController();
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
      card.textContent = "Kein aktiver Aufruf";
      repeatBtn.disabled = true;
      confirmBtn.disabled = true;
      clearBtn.disabled = true;
      return;
    }

    card.className = "active-call-card";
    card.innerHTML = `
      <span class="call-waitno">${state.activeCall.waitNo}</span>
      <div class="call-main-name">${state.activeCall.guestName}</div>
      <div class="lead">Aufruf seit ${timeSince(state.activeCall.createdAt)} | Wiederholt ${state.activeCall.repeatCount}x</div>
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
    document.getElementById("display-headline").textContent = isFull
      ? "AKTUELL ALLE BILLARDTISCHE BESETZT"
      : "ES SIND BILLARDTISCHE FREI";
    document.getElementById("display-subline").textContent = isFull
      ? "BITTE VORNE ZUR REZEPTION, UM SICH FUER DIE WARTELISTE ANZUMELDEN"
      : "BITTE VORNE ZUR REZEPTION KOMMEN";
    document.getElementById("display-note").textContent = isFull
      ? "Sobald ein Tisch frei wird, wird die naechste Wartenummer aufgerufen."
      : "Freie Tische sind verfuegbar. Die naechste Gruppe kann direkt zur Rezeption kommen.";

    document.getElementById("side-status-title").textContent = isFull ? "Alle Tische besetzt" : "Tische frei";
    document.getElementById("side-status-copy").textContent = isFull
      ? "Bitte vorne zur Rezeption kommen."
      : `${state.freeTables} freie Tische stehen aktuell zur Verfuegung.`;
  }

  function renderDisplayStats() {
    document.getElementById("stat-free").textContent = state.freeTables;
    document.getElementById("stat-occupied").textContent = state.occupiedTables;
    document.getElementById("stat-queue").textContent = waitingList().length;
    document.getElementById("display-groups").textContent = `${waitingList().length} Gruppen warten`;

    const estimate = document.getElementById("display-estimate");
    if (state.estimatedWait && state.occupiedTables === state.totalTables) {
      estimate.textContent = `CA. ${state.estimatedWait.min}-${state.estimatedWait.max} MINUTEN`;
      estimate.classList.remove("hidden");
    } else {
      estimate.classList.add("hidden");
    }
  }

  function renderDisplayPriority() {
    const host = document.getElementById("display-priority");
    const next = waitingList()[0];

    if (!next) {
      host.innerHTML = `
        <div class="priority-card">
          <div class="priority-label">NAECHSTER AUFRUF</div>
          <div class="priority-main">
            <div class="priority-left">
              <span class="priority-chip">POSITION 1</span>
              <span class="priority-primary">Zurzeit keine Warteliste</span>
            </div>
            <div class="priority-time">--:--</div>
          </div>
        </div>
      `;
      return;
    }

    host.innerHTML = `
      <div class="priority-card">
        <div class="priority-label">NAECHSTER AUFRUF</div>
        <div class="priority-main">
          <div class="priority-left">
            <span class="priority-chip">POSITION 1</span>
            <span class="priority-primary">${next.guestName}</span>
            <span class="priority-primary">${next.waitNo}</span>
          </div>
          <div class="priority-time">${timeSince(next.createdAt)}</div>
        </div>
      </div>
    `;
  }

  function renderDisplayWaitingList() {
    const host = document.getElementById("display-waiting-list");
    if (!host) return;

    const list = waitingList();
    if (!list.length) {
      host.innerHTML = `
        <div class="display-waiting-row">
          <div class="display-waiting-cell">Keine wartenden Gaeste</div>
          <div class="display-waiting-cell">-</div>
          <div class="display-waiting-cell">-</div>
        </div>
      `;
      return;
    }

    host.innerHTML = "";
    list.slice(0, 10).forEach((item) => {
      const row = document.createElement("div");
      row.className = "display-waiting-row";
      row.innerHTML = `
        <div class="display-waiting-cell">${item.guestName}</div>
        <div class="display-waiting-cell">${item.waitNo}</div>
        <div class="display-waiting-cell">${timeSince(item.createdAt)}</div>
      `;
      host.appendChild(row);
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
    document.getElementById("call-copy").textContent = "Bitte vorkommen zur Rezeption";
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
    updateClock();
    renderDisplayHero();
    renderDisplayStats();
    renderDisplayPriority();
    renderDisplayWaitingList();
    renderCallOverlay();
  }

  async function refreshState(force = false) {
    const nextState = await api("/api/state");
    state = nextState;

    if (force || state.version !== lastVersion) {
      lastVersion = state.version;
      if (page === "controller") {
        renderController();
      } else {
        renderDisplay();
      }
      return;
    }

    if (page === "controller") {
      renderWaitingListController();
      renderActiveCallController();
    } else {
      renderDisplay();
    }
  }

  async function handleAddGuest(event) {
    event.preventDefault();
    const guestName = document.getElementById("guest-name").value;
    const waitNo = document.getElementById("wait-no").value;

    try {
      state = await api("/api/waiting/add", "POST", { guestName, waitNo });
      document.getElementById("guest-name").value = "";
      document.getElementById("wait-no").value = "";
      renderController();
      showMessage("Gast zur Warteliste hinzugefuegt.");
      document.getElementById("guest-name").focus();
    } catch (error) {
      showMessage(error.message, true);
    }
  }

  async function handleOccupiedPlus() {
    try {
      state = await api("/api/tables/increment", "POST");
      renderController();
    } catch (error) {
      showMessage(error.message, true);
    }
  }

  async function handleOccupiedMinus() {
    try {
      state = await api("/api/tables/decrement", "POST");
      renderController();
    } catch (error) {
      showMessage(error.message, true);
    }
  }

  async function handleCallNext() {
    try {
      state = await api("/api/call/next", "POST");
      renderController();
      showMessage(`Aufruf gestartet: ${state.activeCall.guestName} / ${state.activeCall.waitNo}`);
    } catch (error) {
      showMessage(error.message, true);
    }
  }

  async function handleRepeatCall() {
    try {
      state = await api("/api/call/repeat", "POST");
      renderController();
      showMessage("Aufruf wiederholt.");
    } catch (error) {
      showMessage(error.message, true);
    }
  }

  async function handleConfirmCall() {
    try {
      state = await api("/api/call/confirm", "POST");
      renderController();
      showMessage("Aufruf bestaetigt.");
    } catch (error) {
      showMessage(error.message, true);
    }
  }

  async function handleClearCall() {
    try {
      state = await api("/api/call/clear", "POST");
      renderController();
      showMessage("Aufruf geloescht.");
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

  async function start() {
    await refreshState(true);
    if (page === "controller") {
      wireController();
    } else {
      configureDisplayMode();
      updateClock();
      setInterval(updateClock, 1000);
      window.addEventListener("resize", configureDisplayMode);
    }

    setInterval(() => {
      refreshState().catch(() => {});
    }, pollMs);
  }

  start().catch(() => {
    if (page === "controller") {
      showMessage("Server nicht erreichbar.", true);
    }
  });
})();






