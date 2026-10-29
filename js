
const SUPABASE_URL = "https://laidorinfjhrqstedjxp.supabase.co";

const SUPABASE_ANON_KEY = "sb_publishable_eJJE3FuWiFwH5sZK6hzMtQ_Plmaxtzm";

const supabaseClient = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_ANON_KEY
);

// ============================================================
// Mouse Mayhem — Arena / combat logic
// ------------------------------------------------------------
// Design note on "authority":
// This is a pure client/Supabase-Realtime game with no game
// server, so full server-side authority (like a dedicated game
// server would give you) isn't possible here. To stop a client
// from just declaring itself the winner, each player's HP is
// owned ONLY by that player's own browser:
//   - Attacks are broadcast as "I fired a projectile from here,
//     in this direction, at this time."
//   - The RECEIVING client simulates that projectile against its
//     OWN cursor position and decides for itself whether it got
//     hit, then broadcasts its own updated HP.
//   - A client can broadcast fake "I'm defeated" messages for
//     itself (griefing its own score), but it cannot set the
//     opponent's HP or declare the opponent defeated.
// This is "reasonably hard to cheat for the opponent," not
// cryptographically secure — a truly cheat-proof version would
// need a real backend (e.g. a Supabase Edge Function) as the
// referee. Flagging that clearly rather than pretending otherwise.
// ============================================================

const ARENA_CONFIG = {
  maxHP: 100,
  projectileSpeed: 900,       // px per second
  projectileRadius: 9,
  hitRadius: 20,               // cursor hit radius
  damage: 14,
  cooldownMs: 450,
  flightMaxMs: 1400,
  cursorBroadcastMs: 45,
};

let arenaEl, cursorMeEl, cursorOppEl;
let myHP = ARENA_CONFIG.maxHP;
let oppHP = ARENA_CONFIG.maxHP;
let myPos = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
let oppPos = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
let lastFireTime = 0;
let matchOver = false;
let cursorBroadcastTimer = null;

const activeProjectiles = []; // { id, el, x, y, dx, dy, owner }

function initArena() {
  arenaEl = document.getElementById("arena");
  cursorMeEl = document.getElementById("cursor-me");
  cursorOppEl = document.getElementById("cursor-opp");

  document.getElementById("hp-name-me").textContent = MM.playerName + " (you)";
  document.getElementById("hp-name-opp").textContent = MM.opponentName || "Opponent";
  cursorMeEl.querySelector(".cursor-label").textContent = MM.playerName;
  cursorOppEl.querySelector(".cursor-label").textContent = MM.opponentName || "Opponent";
  cursorOppEl.style.display = "block";

  cursorMeEl.className = `cursor cursor-${MM.myColor}`;
  cursorOppEl.className = `cursor cursor-${MM.oppColor}`;

  myHP = ARENA_CONFIG.maxHP;
  oppHP = ARENA_CONFIG.maxHP;
  matchOver = false;
  updateHPBars();
  setConnectionIndicator(true);

  arenaEl.addEventListener("mousemove", onMouseMove);
  arenaEl.addEventListener("click", onClick);

  cursorBroadcastTimer = setInterval(broadcastCursor, ARENA_CONFIG.cursorBroadcastMs);

  document.getElementById("play-again-btn").addEventListener("click", () => {
    window.location.reload();
  }, { once: true });
}

function onMouseMove(e) {
  const rect = arenaEl.getBoundingClientRect();
  myPos.x = e.clientX - rect.left;
  myPos.y = e.clientY - rect.top;
  cursorMeEl.style.left = myPos.x + "px";
  cursorMeEl.style.top = myPos.y + "px";
}

function broadcastCursor() {
  if (!MM.channel || matchOver) return;
  MM.channel.send({
    type: "broadcast",
    event: "cursor",
    payload: { x: myPos.x, y: myPos.y },
  });
}

function onClick() {
  if (matchOver) return;
  const now = Date.now();
  if (now - lastFireTime < ARENA_CONFIG.cooldownMs) return;
  lastFireTime = now;

  // Aim towards the opponent's last known position.
  const dx = oppPos.x - myPos.x;
  const dy = oppPos.y - myPos.y;
  const len = Math.hypot(dx, dy) || 1;
  const dirX = dx / len;
  const dirY = dy / len;

  spawnLocalProjectile(myPos.x, myPos.y, dirX, dirY, "me");

  if (MM.channel) {
    MM.channel.send({
      type: "broadcast",
      event: "attack",
      payload: {
        x: myPos.x,
        y: myPos.y,
        dx: dirX,
        dy: dirY,
        t: now,
      },
    });
  }
}

// Visual-only projectile for the SHOOTER's own screen.
function spawnLocalProjectile(x, y, dx, dy, owner) {
  const el = document.createElement("div");
  el.className = `projectile projectile-${owner === "me" ? MM.myColor : MM.oppColor}`;
  arenaEl.appendChild(el);
  const proj = { id: Math.random().toString(36).slice(2), el, x, y, dx, dy, owner, start: performance.now() };
  activeProjectiles.push(proj);
}

function animateProjectiles(now) {
  for (let i = activeProjectiles.length - 1; i >= 0; i--) {
    const p = activeProjectiles[i];
    const elapsed = (now - p.start) / 1000;
    const dist = ARENA_CONFIG.projectileSpeed * elapsed;
    const x = p.x + p.dx * dist;
    const y = p.y + p.dy * dist;
    p.el.style.left = x + "px";
    p.el.style.top = y + "px";

    const offscreen = x < -20 || y < -20 || x > window.innerWidth + 20 || y > window.innerHeight + 20;
    const expired = (now - p.start) > ARENA_CONFIG.flightMaxMs;
    if (offscreen || expired) {
      p.el.remove();
      activeProjectiles.splice(i, 1);
    }
  }
  requestAnimationFrame(animateProjectiles);
}
requestAnimationFrame(animateProjectiles);

// --------------------------------------------------------------
// Incoming realtime events (wired up from main.js before subscribe)
// --------------------------------------------------------------
function attachGameListeners(channel) {
  channel.on("broadcast", { event: "cursor" }, ({ payload }) => {
    oppPos.x = payload.x;
    oppPos.y = payload.y;
    if (cursorOppEl) {
      cursorOppEl.style.left = oppPos.x + "px";
      cursorOppEl.style.top = oppPos.y + "px";
    }
  });

  channel.on("broadcast", { event: "attack" }, ({ payload }) => {
    if (matchOver || !arenaEl) return;
    // Render the opponent's projectile on my screen.
    spawnLocalProjectile(payload.x, payload.y, payload.dx, payload.dy, "opp");
    // Simulate the flight against MY OWN current/predicted position
    // to decide, locally and authoritatively for myself, whether I got hit.
    simulateIncomingAttack(payload);
  });

  channel.on("broadcast", { event: "health" }, ({ payload }) => {
    // Only trust health updates about the OPPONENT, reported by the
    // opponent about themselves. We never let a remote message set
    // our own HP.
    if (payload.role !== MM.role) {
      oppHP = payload.hp;
      updateHPBars();
      if (oppHP <= 0) handleOpponentDefeated();
    }
  });

  channel.on("broadcast", { event: "defeat" }, ({ payload }) => {
    if (payload.role !== MM.role) {
      handleOpponentDefeated();
    }
  });

  channel.on("presence", { event: "leave" }, ({ key }) => {
    if (key !== MM.role && !matchOver) {
      setConnectionIndicator(false);
      document.getElementById("conn-text").textContent = "opponent disconnected";
    }
  });
  channel.on("presence", { event: "join" }, ({ key }) => {
    if (key !== MM.role) {
      setConnectionIndicator(true);
    }
  });
}
window.attachGameListeners = attachGameListeners;

function simulateIncomingAttack(payload) {
  const startTime = performance.now();
  const serverLagEstimate = Math.max(0, Date.now() - payload.t); // rough, assumes clocks close enough
  const step = () => {
    if (matchOver) return;
    const elapsed = (performance.now() - startTime + serverLagEstimate) / 1000;
    if (elapsed > ARENA_CONFIG.flightMaxMs / 1000) return; // missed, projectile expired

    const px = payload.x + payload.dx * ARENA_CONFIG.projectileSpeed * elapsed;
    const py = payload.y + payload.dy * ARENA_CONFIG.projectileSpeed * elapsed;
    const dist = Math.hypot(px - myPos.x, py - myPos.y);

    if (dist <= ARENA_CONFIG.hitRadius + ARENA_CONFIG.projectileRadius) {
      applyDamageToSelf(ARENA_CONFIG.damage);
      return; // hit registered, stop checking this projectile
    }
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function applyDamageToSelf(amount) {
  if (matchOver) return;
  myHP = Math.max(0, myHP - amount);
  updateHPBars();
  flashHit();

  if (MM.channel) {
    MM.channel.send({
      type: "broadcast",
      event: "health",
      payload: { role: MM.role, hp: myHP },
    });
  }

  if (myHP <= 0) {
    matchOver = true;
    if (MM.channel) {
      MM.channel.send({ type: "broadcast", event: "defeat", payload: { role: MM.role } });
    }
    showVictoryScreen(false);
  }
}

function handleOpponentDefeated() {
  if (matchOver) return;
  matchOver = true;
  showVictoryScreen(true);
}

function flashHit() {
  arenaEl.classList.remove("hit-flash");
  void arenaEl.offsetWidth; // restart animation
  arenaEl.classList.add("hit-flash");
}

function updateHPBars() {
  document.getElementById("hp-fill-me").style.width = (myHP / ARENA_CONFIG.maxHP) * 100 + "%";
  document.getElementById("hp-fill-opp").style.width = (oppHP / ARENA_CONFIG.maxHP) * 100 + "%";
  if (myHP <= 30) {
    document.getElementById("hp-fill-me").style.background = "#ff5c5c";
  }
}

function setConnectionIndicator(connected) {
  const dot = document.getElementById("conn-dot");
  const text = document.getElementById("conn-text");
  if (!dot) return;
  dot.classList.toggle("connected", connected);
  text.textContent = connected ? "connected" : "reconnecting…";
}

function showVictoryScreen(won) {
  clearInterval(cursorBroadcastTimer);
  const title = document.getElementById("victory-title");
  const sub = document.getElementById("victory-sub");
  title.textContent = won ? "VICTORY" : "DEFEATED";
  title.className = won ? "win" : "lose";
  sub.textContent = won
    ? `You defeated ${MM.opponentName || "your opponent"}!`
    : `${MM.opponentName || "Your opponent"} got the better of you this time.`;
  showScreen("victory");
}

window.initArena = initArena;

// ============================================================
// Mouse Mayhem — Menu / Room logic
// Handles: name entry, room creation, room joining, validation,
// duplicate-slot prevention, and handing off to the arena (game.js)
// ============================================================

// Shared mutable state used by game.js too.
const MM = {
  playerName: "",
  roomCode: "",
  role: null,           // "p1" or "p2"
  opponentName: "",
  channel: null,
  myColor: null,        // "blue" | "orange"
  oppColor: null,
};

const screens = {
  menu: document.getElementById("menu-screen"),
  waiting: document.getElementById("waiting-screen"),
  arena: document.getElementById("arena-screen"),
  victory: document.getElementById("victory-screen"),
};

function showScreen(name) {
  Object.values(screens).forEach(s => s.classList.remove("active"));
  screens[name].classList.add("active");
}

const nameInput = document.getElementById("player-name");
const roomInput = document.getElementById("room-code");
const createBtn = document.getElementById("create-room-btn");
const joinBtn = document.getElementById("join-room-btn");
const menuStatus = document.getElementById("menu-status");
const menuError = document.getElementById("menu-error");
const waitingCodeEl = document.getElementById("waiting-room-code");
const waitingStatus = document.getElementById("waiting-status");
const cancelWaitingBtn = document.getElementById("cancel-waiting-btn");

function setError(msg) {
  menuError.textContent = msg || "";
}

function generateRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I to avoid confusion
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function getName() {
  const name = nameInput.value.trim();
  return name.length ? name.slice(0, 14) : null;
}

function setBusy(busy) {
  createBtn.disabled = busy;
  joinBtn.disabled = busy;
}

// --------------------------------------------------------------
// CREATE ROOM
// --------------------------------------------------------------
createBtn.addEventListener("click", async () => {
  setError("");
  const name = getName();
  if (!name) return setError("Enter your name first.");

  setBusy(true);
  const code = generateRoomCode();

  try {
    const { error } = await supabaseClient
      .from("rooms")
      .insert({ id: code, player1_name: name, status: "waiting" });

    if (error) {
      console.error(error);
      setError("Could not create room. Check Supabase setup.");
      setBusy(false);
      return;
    }

    MM.playerName = name;
    MM.roomCode = code;
    MM.role = "p1";
    MM.myColor = "blue";
    MM.oppColor = "orange";

    waitingCodeEl.textContent = code;
    waitingStatus.textContent = "Waiting for opponent to join…";
    showScreen("waiting");
    joinRealtimeChannel();
  } catch (err) {
    console.error(err);
    setError("Unexpected error creating room.");
  } finally {
    setBusy(false);
  }
});

// --------------------------------------------------------------
// JOIN ROOM
// --------------------------------------------------------------
joinBtn.addEventListener("click", async () => {
  setError("");
  const name = getName();
  if (!name) return setError("Enter your name first.");

  const code = roomInput.value.trim().toUpperCase();
  if (!code) return setError("Enter a room code.");

  setBusy(true);
  try {
    // Look the room up first for a clear "invalid code" message.
    const { data: existing, error: fetchErr } = await supabaseClient
      .from("rooms")
      .select("*")
      .eq("id", code)
      .maybeSingle();

    if (fetchErr) {
      console.error(fetchErr);
      setError("Could not reach the server.");
      setBusy(false);
      return;
    }
    if (!existing) {
      setError("That room code doesn't exist.");
      setBusy(false);
      return;
    }
    if (existing.status === "full" || existing.status === "closed") {
      setError("That room is already full.");
      setBusy(false);
      return;
    }

    // Atomic claim: only succeeds if the room is still "waiting".
    // This is what prevents two people from both becoming player 2.
    const { data: claimed, error: claimErr } = await supabaseClient
      .from("rooms")
      .update({ player2_name: name, status: "full" })
      .eq("id", code)
      .eq("status", "waiting")
      .select()
      .maybeSingle();

    if (claimErr) {
      console.error(claimErr);
      setError("Could not join the room.");
      setBusy(false);
      return;
    }
    if (!claimed) {
      setError("Someone just filled that room — try another code.");
      setBusy(false);
      return;
    }

    MM.playerName = name;
    MM.roomCode = code;
    MM.role = "p2";
    MM.myColor = "orange";
    MM.oppColor = "blue";
    MM.opponentName = claimed.player1_name;

    joinRealtimeChannel();
  } catch (err) {
    console.error(err);
    setError("Unexpected error joining room.");
  } finally {
    setBusy(false);
  }
});

cancelWaitingBtn.addEventListener("click", async () => {
  if (MM.channel) {
    await supabaseClient.removeChannel(MM.channel);
    MM.channel = null;
  }
  if (MM.roomCode && MM.role === "p1") {
    await supabaseClient.from("rooms").delete().eq("id", MM.roomCode);
  }
  resetToMenu();
});

function resetToMenu() {
  MM.roomCode = "";
  MM.role = null;
  MM.opponentName = "";
  menuStatus.textContent = "Not connected";
  setError("");
  showScreen("menu");
}

// --------------------------------------------------------------
// REALTIME CHANNEL (presence handles "both players here" + duplicate
// slot protection on the realtime layer; the DB update above is the
// authoritative claim).
// --------------------------------------------------------------
function joinRealtimeChannel() {
  const channel = supabaseClient.channel(`room:${MM.roomCode}`, {
    config: { presence: { key: MM.role } },
  });
  MM.channel = channel;

  channel.on("presence", { event: "sync" }, () => {
    const state = channel.presenceState();
    const p1 = state["p1"]?.[0];
    const p2 = state["p2"]?.[0];

    if (MM.role === "p1" && p2 && !MM.opponentName) {
      MM.opponentName = p2.name;
    }
    if (MM.role === "p2" && p1 && !MM.opponentName) {
      MM.opponentName = p1.name;
    }

    if (p1 && p2) {
      // Both players present — start the match.
      startMatch();
    } else if (screens.waiting.classList.contains("active")) {
      waitingStatus.textContent = "Waiting for opponent to join…";
    }
  });

  // Game events are wired up in game.js via MM.channel.on("broadcast", ...)
  attachGameListeners(channel);

  channel.subscribe(async (status) => {
    if (status === "SUBSCRIBED") {
      await channel.track({ name: MM.playerName, role: MM.role });
      menuStatus.textContent = "Connected";
    } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
      setConnectionIndicator(false);
    }
  });
}

let matchStarted = false;
function startMatch() {
  if (matchStarted) return;
  matchStarted = true;
  showScreen("arena");
  initArena();
}

// Expose for game.js
window.MM = MM;
window.showScreen = showScreen;
window.resetToMenu = resetToMenu;
