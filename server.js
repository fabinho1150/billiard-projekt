const express = require("express");
const fs = require("fs");
const os = require("os");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const TOTAL_TABLES = 17;
const IS_VERCEL = Boolean(process.env.VERCEL);
const DATA_DIR = IS_VERCEL ? path.join(os.tmpdir(), "billiard-display-state") : path.join(__dirname, "data");
const STATE_FILE = path.join(DATA_DIR, "state.json");
const FOOD_ASSET_DIR = path.join(__dirname, "public", "assets", "koo-essen");
const FOOD_ASSET_URL_BASE = "/assets/koo-essen";
const FOOD_SLIDE_MS = 5000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

function defaultState() {
  return {
    occupiedTables: TOTAL_TABLES,
    callSeq: 0,
    stateVersion: 1,
    waitingList: [],
    activeCall: null,
    activePromo: null,
  };
}

function clampNumber(value, min, max, fallback) {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

function normalizeWaitingEntry(entry, index) {
  if (!entry || typeof entry !== "object") return null;

  const guestName = String(entry.guestName || "").trim();
  const waitNo = String(entry.waitNo || "").trim();
  if (!guestName || !waitNo) return null;

  const createdAt = Number.isFinite(entry.createdAt) ? entry.createdAt : Date.now();
  const id = String(entry.id || `w_restored_${createdAt}_${index}`).trim();

  return {
    id,
    guestName,
    waitNo,
    createdAt,
  };
}

function normalizeActiveCall(activeCall) {
  if (!activeCall || typeof activeCall !== "object") return null;

  const guestId = String(activeCall.guestId || "").trim();
  const guestName = String(activeCall.guestName || "").trim();
  const waitNo = String(activeCall.waitNo || "").trim();
  if (!guestId || !guestName || !waitNo) return null;

  const seq = Number.isFinite(activeCall.seq) ? activeCall.seq : 0;
  const createdAt = Number.isFinite(activeCall.createdAt) ? activeCall.createdAt : Date.now();
  const repeatCount = Number.isFinite(activeCall.repeatCount) ? activeCall.repeatCount : 0;

  return {
    id: String(activeCall.id || `call_${seq || 0}`),
    seq,
    guestId,
    guestName,
    waitNo,
    createdAt,
    repeatCount,
  };
}

function normalizeActivePromo(activePromo) {
  if (!activePromo || typeof activePromo !== "object") return null;

  const type = String(activePromo.type || "").trim();
  const startedAt = Number(activePromo.startedAt);
  const slideMs = Number(activePromo.slideMs);
  const images = Array.isArray(activePromo.images)
    ? activePromo.images
        .map((image) => {
          if (!image || typeof image !== "object") return null;
          const src = String(image.src || "").trim();
          const name = String(image.name || "").trim();
          return src && name ? { src, name } : null;
        })
        .filter(Boolean)
    : [];

  if (!type || !Number.isFinite(startedAt) || !Number.isFinite(slideMs) || !images.length) {
    return null;
  }

  return {
    id: String(activePromo.id || `promo_${startedAt}`),
    type,
    startedAt,
    slideMs,
    images,
  };
}

function getFoodSlides() {
  if (!fs.existsSync(FOOD_ASSET_DIR)) {
    return [];
  }

  return fs
    .readdirSync(FOOD_ASSET_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((fileName) => /\.(png|jpe?g|webp|avif)$/i.test(fileName))
    .sort((a, b) => a.localeCompare(b, "de", { sensitivity: "base", numeric: true }))
    .map((fileName) => ({
      src: `${FOOD_ASSET_URL_BASE}/${encodeURIComponent(fileName)}`,
      name: path.parse(fileName).name.replace(/[_-]+/g, " ").trim(),
    }));
}

function clearExpiredPromo() {
  if (!activePromo) return;

  const durationMs = activePromo.images.length * activePromo.slideMs;
  if (Date.now() >= activePromo.startedAt + durationMs) {
    activePromo = null;
    commitMutation();
  }
}

function loadState() {
  if (!fs.existsSync(STATE_FILE)) {
    return defaultState();
  }

  try {
    const raw = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    const waitingList = Array.isArray(raw.waitingList)
      ? raw.waitingList
          .map((entry, index) => normalizeWaitingEntry(entry, index))
          .filter(Boolean)
      : [];

    const uniqueWaitNos = new Set();
    const dedupedWaitingList = waitingList.filter((entry) => {
      const key = entry.waitNo.toLowerCase();
      if (uniqueWaitNos.has(key)) return false;
      uniqueWaitNos.add(key);
      return true;
    });

    const activeCall = normalizeActiveCall(raw.activeCall);
    const occupiedTables = clampNumber(raw.occupiedTables, 0, TOTAL_TABLES, TOTAL_TABLES);
    const callSeq = clampNumber(raw.callSeq, 0, Number.MAX_SAFE_INTEGER, 0);
    const stateVersion = clampNumber(raw.stateVersion, 1, Number.MAX_SAFE_INTEGER, 1);
    const activePromo = normalizeActivePromo(raw.activePromo);

    return {
      occupiedTables,
      callSeq,
      stateVersion,
      waitingList: dedupedWaitingList,
      activeCall,
      activePromo,
    };
  } catch {
    return defaultState();
  }
}

function writeStateFile(snapshot) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tempFile = `${STATE_FILE}.tmp`;
  fs.writeFileSync(tempFile, JSON.stringify(snapshot, null, 2), "utf8");
  fs.renameSync(tempFile, STATE_FILE);
}

let {
  occupiedTables,
  callSeq,
  stateVersion,
  waitingList,
  activeCall,
  activePromo,
} = loadState();

function saveCurrentState() {
  try {
    writeStateFile({
      occupiedTables,
      callSeq,
      stateVersion,
      waitingList,
      activeCall,
      activePromo,
    });
  } catch (error) {
    console.error("State persistence failed:", error.message);
  }
}

function commitMutation() {
  stateVersion += 1;
  saveCurrentState();
}

function getSortedWaitingList() {
  return waitingList.slice().sort((a, b) => a.createdAt - b.createdAt);
}

function estimateWaitRange() {
  const groups = waitingList.length;
  if (occupiedTables < TOTAL_TABLES || groups === 0) {
    return null;
  }

  const min = 10 + Math.max(0, groups - 1) * 5;
  const max = min + 10;
  return { min, max };
}

function getState() {
  clearExpiredPromo();

  return {
    version: stateVersion,
    totalTables: TOTAL_TABLES,
    occupiedTables,
    freeTables: TOTAL_TABLES - occupiedTables,
    waitingList: getSortedWaitingList(),
    activeCall,
    callActive: Boolean(activeCall),
    callSeq,
    activePromo,
    estimatedWait: estimateWaitRange(),
    serverTime: Date.now(),
  };
}

app.get("/controller", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "controller.html"));
});

app.get("/display", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "display.html"));
});

app.get("/api/state", (_req, res) => {
  res.json(getState());
});

app.get("/api/promo/slides", (_req, res) => {
  res.json({ slides: getFoodSlides(), slideMs: FOOD_SLIDE_MS });
});

app.post("/api/waiting/add", (req, res) => {
  const guestName = String(req.body.guestName || "").trim();
  const waitNo = String(req.body.waitNo || "").trim();

  if (!guestName) {
    return res.status(400).json({ error: "Name darf nicht leer sein." });
  }
  if (!waitNo) {
    return res.status(400).json({ error: "Wartenummer darf nicht leer sein." });
  }
  if (guestName.length > 40) {
    return res.status(400).json({ error: "Name darf maximal 40 Zeichen lang sein." });
  }
  if (waitNo.length > 20) {
    return res.status(400).json({ error: "Wartenummer darf maximal 20 Zeichen lang sein." });
  }
  if (waitingList.some((item) => item.waitNo.toLowerCase() === waitNo.toLowerCase())) {
    return res.status(400).json({ error: "Diese Wartenummer ist bereits in der Warteliste." });
  }

  waitingList.push({
    id: `w_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    guestName,
    waitNo,
    createdAt: Date.now(),
  });

  commitMutation();
  return res.json(getState());
});

app.post("/api/waiting/remove", (req, res) => {
  const id = String(req.body.id || "");
  const index = waitingList.findIndex((item) => item.id === id);

  if (index === -1) {
    return res.status(404).json({ error: "Eintrag nicht gefunden." });
  }
  if (activeCall && activeCall.guestId === id) {
    return res.status(400).json({ error: "Der aktuell aufgerufene Eintrag kann nicht manuell entfernt werden." });
  }

  waitingList.splice(index, 1);
  commitMutation();
  return res.json(getState());
});

app.post("/api/tables/increment", (_req, res) => {
  if (occupiedTables >= TOTAL_TABLES) {
    return res.status(400).json({ error: "Es sind bereits alle 17 Tische als besetzt markiert." });
  }

  occupiedTables += 1;
  commitMutation();
  return res.json(getState());
});

app.post("/api/tables/decrement", (_req, res) => {
  if (activeCall) {
    return res.status(400).json({ error: "Aktiven Aufruf erst bestätigen oder löschen." });
  }
  if (occupiedTables <= 0) {
    return res.status(400).json({ error: "Es sind bereits 0 Tische als besetzt markiert." });
  }

  occupiedTables -= 1;
  commitMutation();
  return res.json(getState());
});

app.post("/api/call/next", (_req, res) => {
  if (activeCall) {
    return res.status(400).json({ error: "Es gibt bereits einen aktiven Aufruf." });
  }
  if (occupiedTables >= TOTAL_TABLES) {
    return res.status(400).json({ error: "Kein Billardtisch frei. Erst einen Tisch frei melden." });
  }

  const nextGuest = getSortedWaitingList()[0];
  if (!nextGuest) {
    return res.status(400).json({ error: "Keine wartenden Gäste vorhanden." });
  }

  callSeq += 1;
  occupiedTables += 1;
  activeCall = {
    id: `call_${callSeq}`,
    seq: callSeq,
    guestId: nextGuest.id,
    guestName: nextGuest.guestName,
    waitNo: nextGuest.waitNo,
    createdAt: Date.now(),
    repeatCount: 0,
  };

  commitMutation();
  return res.json(getState());
});

app.post("/api/call/repeat", (_req, res) => {
  if (!activeCall) {
    return res.status(404).json({ error: "Kein aktiver Aufruf vorhanden." });
  }

  activeCall.repeatCount += 1;
  activeCall.createdAt = Date.now();
  commitMutation();
  return res.json(getState());
});

app.post("/api/call/confirm", (_req, res) => {
  if (!activeCall) {
    return res.status(404).json({ error: "Kein aktiver Aufruf vorhanden." });
  }

  const index = waitingList.findIndex((item) => item.id === activeCall.guestId);
  if (index >= 0) {
    waitingList.splice(index, 1);
  }
  activeCall = null;

  commitMutation();
  return res.json(getState());
});

app.post("/api/call/clear", (_req, res) => {
  if (!activeCall) {
    return res.status(404).json({ error: "Kein aktiver Aufruf vorhanden." });
  }

  occupiedTables = Math.max(0, occupiedTables - 1);
  activeCall = null;

  commitMutation();
  return res.json(getState());
});

app.post("/api/promo/start", (_req, res) => {
  const type = String(req.body.type || "pizza").trim().toLowerCase();
  if (type !== "pizza") {
    return res.status(400).json({ error: "Unbekannter Werbetyp." });
  }

  const images = getFoodSlides();
  if (!images.length) {
    return res.status(400).json({
      error: 'Keine Bilder gefunden. Bitte Bilder in "public/assets/koo-essen" ablegen.',
    });
  }

  activePromo = {
    id: `promo_${Date.now()}`,
    type,
    startedAt: Date.now(),
    slideMs: FOOD_SLIDE_MS,
    images,
  };

  commitMutation();
  return res.json(getState());
});

app.post("/api/promo/clear", (_req, res) => {
  if (!activePromo) {
    return res.status(404).json({ error: "Keine aktive Werbung vorhanden." });
  }

  activePromo = null;
  commitMutation();
  return res.json(getState());
});

saveCurrentState();

app.listen(PORT, () => {
  console.log(`Billiard waiting system running on http://localhost:${PORT}`);
});
