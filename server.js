const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const TOTAL_TABLES = 17;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

let occupiedTables = TOTAL_TABLES;
let callSeq = 0;
let stateVersion = 1;
const waitingList = [];
let activeCall = null;

function bumpVersion() {
  stateVersion += 1;
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
  return {
    version: stateVersion,
    totalTables: TOTAL_TABLES,
    occupiedTables,
    freeTables: TOTAL_TABLES - occupiedTables,
    waitingList: getSortedWaitingList(),
    activeCall,
    callActive: Boolean(activeCall),
    callSeq,
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

app.post("/api/waiting/add", (req, res) => {
  const guestName = String(req.body.guestName || "").trim();
  const waitNo = String(req.body.waitNo || "").trim();

  if (!guestName) {
    return res.status(400).json({ error: "Name darf nicht leer sein." });
  }
  if (!waitNo) {
    return res.status(400).json({ error: "Wartenummer darf nicht leer sein." });
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

  bumpVersion();
  return res.json(getState());
});

app.post("/api/waiting/remove", (req, res) => {
  const id = String(req.body.id || "");
  const index = waitingList.findIndex((item) => item.id === id);

  if (index === -1) {
    return res.status(404).json({ error: "Eintrag nicht gefunden." });
  }

  waitingList.splice(index, 1);
  bumpVersion();
  return res.json(getState());
});

app.post("/api/tables/increment", (_req, res) => {
  if (occupiedTables >= TOTAL_TABLES) {
    return res.status(400).json({ error: "Es sind bereits alle 17 Tische als besetzt markiert." });
  }

  occupiedTables += 1;
  bumpVersion();
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
  bumpVersion();
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

  bumpVersion();
  return res.json(getState());
});

app.post("/api/call/repeat", (_req, res) => {
  if (!activeCall) {
    return res.status(404).json({ error: "Kein aktiver Aufruf vorhanden." });
  }

  activeCall.repeatCount += 1;
  activeCall.createdAt = Date.now();
  bumpVersion();
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

  bumpVersion();
  return res.json(getState());
});

app.post("/api/call/clear", (_req, res) => {
  if (!activeCall) {
    return res.status(404).json({ error: "Kein aktiver Aufruf vorhanden." });
  }

  occupiedTables = Math.max(0, occupiedTables - 1);
  activeCall = null;

  bumpVersion();
  return res.json(getState());
});

app.listen(PORT, () => {
  console.log(`Billiard waiting system running on http://localhost:${PORT}`);
});

