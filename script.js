// Core gameplay state --------------------------------------------------------

let health = 100;
let score = 0;
let highScore = 0;
let level = 1;
let maliciousBias = 0.35; // base chance that a generated request is malicious
let gameRunning = false;
let currentRequest = null;
let requestTimeoutId = null;
let levelIntervalId = null;
let startTime = null;
let uptimeTimerId = null;

// Cached DOM elements for performance ---------------------------------------

const healthBarEl = document.getElementById("health-bar-inner");
const healthTextEl = document.getElementById("health-text");
const scoreEl = document.getElementById("score");
const highScoreEl = document.getElementById("high-score");
const levelEl = document.getElementById("level");
const uptimeEl = document.getElementById("uptime");

const reqIpEl = document.getElementById("req-ip");
const reqTypeEl = document.getElementById("req-type");
const reqPortEl = document.getElementById("req-port");
const reqRateEl = document.getElementById("req-rate");
const requestDetailsEl = document.getElementById("request-details");
const requestTagEl = document.getElementById("request-tag");

const decisionFeedbackEl = document.getElementById("decision-feedback");
const logListEl = document.getElementById("log-list");

const allowBtn = document.getElementById("allow-btn");
const blockBtn = document.getElementById("block-btn");

const overlayEl = document.getElementById("game-over-overlay");
const finalScoreEl = document.getElementById("final-score");
const finalHighScoreEl = document.getElementById("final-high-score");
const finalLevelEl = document.getElementById("final-level");
const restartBtn = document.getElementById("restart-btn");

// Utility: simple sound feedback using Web Audio API ------------------------

/**
 * Plays a short tone when the player makes a decision.
 * This keeps the project self-contained without external audio files.
 */
function playBeep(isGood) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "square";
    osc.frequency.value = isGood ? 880 : 220;
    gain.gain.value = 0.07;

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + 0.12);
  } catch (e) {
    // Audio is optional; silently ignore errors.
  }
}

// Initialization -------------------------------------------------------------

/**
 * Loads the best score seen across sessions from localStorage and updates UI.
 */
function loadHighScore() {
  const stored = localStorage.getItem("defendServerHighScore");
  highScore = stored ? parseInt(stored, 10) || 0 : 0;
  highScoreEl.textContent = highScore;
}

/**
 * Saves a new high score to localStorage.
 */
function saveHighScore() {
  localStorage.setItem("defendServerHighScore", String(highScore));
}

/**
 * Resets core game state for a fresh run.
 */
function resetState() {
  health = 100;
  score = 0;
  level = 1;
  maliciousBias = 0.35;
  currentRequest = null;
  gameRunning = true;
  startTime = Date.now();
}

/**
 * Attaches event listeners and starts the game.
 */
function initGame() {
  loadHighScore();
  resetState();
  updateHealth(0); // refresh UI
  updateScore(0);
  updateLevelUI();
  decisionFeedbackEl.textContent = "Analyze traffic and decide.";
  requestTagEl.textContent = "SCANNING...";
  requestTagEl.style.color = "#cdd9ff";
  logListEl.innerHTML = "";

  allowBtn.disabled = false;
  blockBtn.disabled = false;

  // Event handlers
  allowBtn.onclick = () => evaluateDecision("allow");
  blockBtn.onclick = () => evaluateDecision("block");
  restartBtn.onclick = restartGame;

  // Timers
  scheduleNextRequest();
  levelIntervalId = setInterval(levelUp, 60_000);
  uptimeTimerId = setInterval(updateUptime, 1000);
  updateUptime();
}

// Request generation ---------------------------------------------------------

const REQUEST_TYPES = [
  { label: "Normal Traffic", malicious: false },
  { label: "Brute Force Attempt", malicious: true },
  { label: "DDoS Attack", malicious: true },
  { label: "SQL Injection Attempt", malicious: true }
];

const PORTS = [80, 443, 22, 3306, 8080, 25];
const RATES = ["Low", "Medium", "High"];

/**
 * Generates a realistic-looking IPv4 address.
 */
function randomIp() {
  const octet = () => Math.floor(Math.random() * 256);
  return `${octet()}.${octet()}.${octet()}.${octet()}`;
}

/**
 * Generates a random request object based on current difficulty / level.
 */
function generateRequest() {
  // Decide if this request should be malicious or normal
  const roll = Math.random();
  const isMalicious = roll < maliciousBias;

  // Select a request type that matches the malicious flag.
  const candidateTypes = REQUEST_TYPES.filter(t => t.malicious === isMalicious);
  const type = candidateTypes[Math.floor(Math.random() * candidateTypes.length)];

  // Port and rate add a bit of flavor to how suspicious it looks.
  const port = PORTS[Math.floor(Math.random() * PORTS.length)];
  const rateIndexBias = isMalicious ? 1 : 0; // malicious more likely higher rate
  const rateIndex = Math.min(
    RATES.length - 1,
    Math.floor(Math.random() * (RATES.length - rateIndexBias)) + rateIndexBias
  );
  const rate = RATES[rateIndex];

  const req = {
    ip: randomIp(),
    type: type.label,
    port,
    rate,
    malicious: isMalicious
  };

  currentRequest = req;
  updateRequestUI(req);
}

/**
 * Updates the Incoming Request panel and animates it in.
 */
function updateRequestUI(req) {
  reqIpEl.textContent = req.ip;
  reqTypeEl.textContent = req.type;
  reqPortEl.textContent = req.port;
  reqRateEl.textContent = req.rate;

  // Tag & color give hints without revealing "malicious" directly.
  if (req.malicious) {
    requestTagEl.textContent = "POTENTIAL THREAT";
    requestTagEl.style.color = "#ff8ea0";
  } else {
    requestTagEl.textContent = "NORMAL TRAFFIC";
    requestTagEl.style.color = "#8dffcf";
  }

  // Trigger fade-in animation
  requestDetailsEl.classList.remove("fade-in");
  // Force reflow so animation can restart
  void requestDetailsEl.offsetWidth;
  requestDetailsEl.classList.add("fade-in");
}

/**
 * Schedules the next random request, with faster cadence at higher levels.
 */
function scheduleNextRequest() {
  if (!gameRunning) return;

  // Shorter intervals on higher levels (down to ~1.2s)
  const baseMin = 2000;
  const baseMax = 3000;
  const speedupFactor = Math.min(0.5, (level - 1) * 0.08); // cap at 50% faster
  const minDelay = baseMin * (1 - speedupFactor);
  const maxDelay = baseMax * (1 - speedupFactor);

  const delay = Math.random() * (maxDelay - minDelay) + minDelay;

  clearTimeout(requestTimeoutId);
  requestTimeoutId = setTimeout(() => {
    generateRequest();
    scheduleNextRequest();
  }, delay);
}

// Decision evaluation --------------------------------------------------------

/**
 * Applies the scoring and health rules for player's choice.
 */
function evaluateDecision(decision) {
  if (!gameRunning || !currentRequest) return;

  const { malicious, type } = currentRequest;

  // Determine point and health impact based on the rules.
  let pointsChange = 0;
  let healthChange = 0;
  let message = "";
  let goodDecision = false;

  if (decision === "block") {
    if (malicious) {
      // Correct: blocked malicious
      pointsChange = +10;
      message = "Blocked malicious request. Server safe.";
      goodDecision = true;
    } else {
      // Incorrect: blocked normal
      healthChange = -5;
      message = "You blocked normal traffic. Availability impacted.";
    }
  } else if (decision === "allow") {
    if (malicious) {
      // Incorrect: allowed malicious
      healthChange = -15;
      message = "Malicious traffic allowed! Server integrity damaged.";
    } else {
      // Correct: allowed normal
      pointsChange = +5;
      message = "Normal traffic allowed. Services running smoothly.";
      goodDecision = true;
    }
  }

  updateScore(pointsChange);
  updateHealth(healthChange);
  appendLogEntry(decision, currentRequest, pointsChange, healthChange, goodDecision);
  showDecisionFeedback(message, goodDecision);
  playBeep(goodDecision);
}

/**
 * Updates the score and high score UI.
 */
function updateScore(delta) {
  if (delta !== 0) {
    score += delta;
    if (score < 0) score = 0;
  }
  scoreEl.textContent = score;

  if (score > highScore) {
    highScore = score;
    highScoreEl.textContent = highScore;
    saveHighScore();
  }
}

/**
 * Updates server health, animates bar, and ends game if needed.
 */
function updateHealth(delta) {
  if (delta !== 0) {
    health += delta;
  }
  health = Math.max(0, Math.min(100, health));
  healthTextEl.textContent = `${health}%`;

  // Animated width and color are handled via CSS transitions.
  healthBarEl.style.width = `${health}%`;

  if (health > 60) {
    healthBarEl.style.background = "linear-gradient(90deg, #25ffb8, #00ff6e, #d7f72b)";
    healthBarEl.style.boxShadow =
      "0 0 12px rgba(0, 255, 163, 0.9), 0 0 24px rgba(0, 255, 163, 0.6)";
  } else if (health > 30) {
    healthBarEl.style.background = "linear-gradient(90deg, #f2ff5d, #ffb74d)";
    healthBarEl.style.boxShadow =
      "0 0 12px rgba(255, 193, 7, 0.9), 0 0 24px rgba(255, 193, 7, 0.6)";
  } else {
    healthBarEl.style.background = "linear-gradient(90deg, #ff6f6f, #ff1744)";
    healthBarEl.style.boxShadow =
      "0 0 12px rgba(255, 82, 82, 0.9), 0 0 24px rgba(255, 23, 68, 0.6)";
  }

  if (health <= 0 && gameRunning) {
    endGame();
  }
}

/**
 * Visually communicates whether the latest decision was good or bad.
 */
function showDecisionFeedback(message, good) {
  decisionFeedbackEl.textContent = message;
  decisionFeedbackEl.style.color = good ? "#bfffe5" : "#ffd0da";

  // Small pulse effect on the request panel when action is taken
  const panel = requestDetailsEl;
  panel.classList.remove("pulse-good", "pulse-bad");
  void panel.offsetWidth; // force reflow
  panel.classList.add(good ? "pulse-good" : "pulse-bad");
}

/**
 * Appends a new line to the Security Event Log panel.
 */
function appendLogEntry(decision, req, pointDelta, healthDelta, goodDecision) {
  const logEntry = document.createElement("div");
  logEntry.className = "log-entry " + (goodDecision ? "good" : "bad");

  const timeSpan = document.createElement("span");
  timeSpan.className = "time";
  timeSpan.textContent = new Date().toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });

  const messageSpan = document.createElement("span");
  messageSpan.className = "message";
  messageSpan.textContent = `[${decision.toUpperCase()}] ${req.type} from ${req.ip} on port ${
    req.port
  } (Rate: ${req.rate})`;

  const impactSpan = document.createElement("span");
  impactSpan.className = "impact";
  const scoreStr = pointDelta ? `${pointDelta > 0 ? "+" : ""}${pointDelta} pts` : "";
  const healthStr = healthDelta
    ? `${healthDelta > 0 ? "+" : ""}${healthDelta} HP`
    : "";
  impactSpan.textContent = [scoreStr, healthStr].filter(Boolean).join(" / ");

  logEntry.appendChild(timeSpan);
  logEntry.appendChild(messageSpan);
  logEntry.appendChild(impactSpan);

  logListEl.prepend(logEntry);

  // Limit log length for readability.
  const maxEntries = 40;
  while (logListEl.children.length > maxEntries) {
    logListEl.removeChild(logListEl.lastChild);
  }
}

// Leveling and difficulty ----------------------------------------------------

/**
 * Increases game difficulty and updates level counter.
 */
function levelUp() {
  if (!gameRunning) return;
  level += 1;

  // Shift bias toward malicious requests, up to a reasonable max.
  maliciousBias = Math.min(0.8, maliciousBias + 0.08);
  updateLevelUI();

  appendSystemLog(`Level up! Threat activity increased. (Level ${level})`);
}

/**
 * Updates level number display.
 */
function updateLevelUI() {
  levelEl.textContent = level;
}

/**
 * Adds a non-player event to the log (e.g., level transition).
 */
function appendSystemLog(message) {
  const logEntry = document.createElement("div");
  logEntry.className = "log-entry";

  const timeSpan = document.createElement("span");
  timeSpan.className = "time";
  timeSpan.textContent = new Date().toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });

  const messageSpan = document.createElement("span");
  messageSpan.className = "message";
  messageSpan.textContent = `[SYSTEM] ${message}`;

  const impactSpan = document.createElement("span");
  impactSpan.className = "impact";
  impactSpan.textContent = "";

  logEntry.appendChild(timeSpan);
  logEntry.appendChild(messageSpan);
  logEntry.appendChild(impactSpan);

  logListEl.prepend(logEntry);
}

// Uptime / timer -------------------------------------------------------------

/**
 * Displays how long the current session has been running.
 */
function updateUptime() {
  if (!startTime) {
    uptimeEl.textContent = "00:00";
    return;
  }
  const elapsedMs = Date.now() - startTime;
  const totalSeconds = Math.floor(elapsedMs / 1000);
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  uptimeEl.textContent = `${minutes}:${seconds}`;
}

// Game over / restart --------------------------------------------------------

/**
 * Stops timers, disables actions, and shows game over overlay.
 */
function endGame() {
  gameRunning = false;
  allowBtn.disabled = true;
  blockBtn.disabled = true;

  clearTimeout(requestTimeoutId);
  clearInterval(levelIntervalId);
  clearInterval(uptimeTimerId);

  finalScoreEl.textContent = score;
  finalHighScoreEl.textContent = highScore;
  finalLevelEl.textContent = level;

  overlayEl.classList.remove("hidden");
}

/**
 * Fully restarts the game with fresh state.
 */
function restartGame() {
  overlayEl.classList.add("hidden");
  clearTimeout(requestTimeoutId);
  clearInterval(levelIntervalId);
  clearInterval(uptimeTimerId);

  initGame();
}

// Start the game once the DOM is ready --------------------------------------

window.addEventListener("load", initGame);