const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

// ------------------------------------------------------------
// Game State
// ------------------------------------------------------------
const state = {
  roundNumber: 1,
  phase: 'lobby', // 'lobby' | 'countdown' | 'playing' | 'settling' | 'ended'
  config: {
    mode: 'group',            // 'group' | 'individual'
    groupCount: 24,           // 2 ~ 40 groups
    topN: 5,                  // Top N players per group summed
    durationSec: 10,          // Game duration in seconds (5 ~ 30)
    winnerCount: 1,           // Number of winning groups (group mode) or top K players (individual mode)
    indivSelection: 'rank',   // 'rank' (기록 순위) | 'raffle' (완주자 랜덤 추첨)
    targetTouches: 25,        // Completion threshold for individual raffle
    excludePastWinners: true, // Exclude previous round winners from winning again
    strictAlternating: true,  // Require Left/Right alternating for full speed
    prizeTitle: '제1라운드 특별 경품'
  },
  countdownStartAt: 0,
  gameStartAt: 0,
  gameEndAt: 0,
  totalHits: 0,
  players: new Map(), // playerId -> { id, name, school, group, score, lastHitOffsetMs, connected, isBot, botRate, lastSide }
  pastWinnerGroups: new Set(),   // group numbers
  pastWinnerPlayers: new Set(),  // playerIds
  currentResult: null,           // Computed result when phase === 'ended'
  history: []                    // Array of past round summaries
};

// SSE Clients
const hostClients = new Set();
const playerClients = new Map(); // res -> playerId

let countdownTimer = null;
let gameEndTimer = null;
let settleTimer = null;
let broadcastInterval = null;
let botInterval = null;
let dirty = false;

function getLocalLanIp() {
  const interfaces = os.networkInterfaces();
  const candidates = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        candidates.push(iface.address);
      }
    }
  }
  const preferred = candidates.find(ip => ip.startsWith('192.168.') || ip.startsWith('10.')) || candidates[0];
  return preferred || 'localhost';
}

// ------------------------------------------------------------
// Standings & Winner Calculation
// ------------------------------------------------------------
function computeGroupStandings() {
  const { groupCount, topN, excludePastWinners } = state.config;
  const currentWinGroups = new Set(
    state.phase === 'ended' && state.currentResult && state.currentResult.winningGroupNums
      ? state.currentResult.winningGroupNums
      : []
  );
  const groups = [];
  for (let g = 1; g <= groupCount; g++) {
    const wonBeforeThisRound = state.pastWinnerGroups.has(g) && !currentWinGroups.has(g);
    groups.push({
      group: g,
      excluded: excludePastWinners && wonBeforeThisRound,
      alreadyWon: state.pastWinnerGroups.has(g),
      memberCount: 0,
      countedMembers: 0,
      score: 0,
      lastHitOffsetMs: 0,
      topContributors: [],
      allMembers: []
    });
  }

  for (const p of state.players.values()) {
    const gIdx = (p.group || 1) - 1;
    if (gIdx >= 0 && gIdx < groupCount) {
      groups[gIdx].memberCount++;
      groups[gIdx].allMembers.push({
        id: p.id,
        name: p.name,
        school: p.school,
        score: p.score,
        lastHitOffsetMs: p.lastHitOffsetMs,
        isBot: !!p.isBot
      });
    }
  }

  for (const g of groups) {
    // Sort members by score DESC, then earlier reach time ASC
    g.allMembers.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return (a.lastHitOffsetMs || 0) - (b.lastHitOffsetMs || 0);
    });
    const topSlice = g.allMembers.slice(0, topN);
    g.countedMembers = topSlice.length;
    g.score = topSlice.reduce((sum, m) => sum + m.score, 0);
    g.lastHitOffsetMs = topSlice.reduce((maxT, m) => (m.score > 0 ? Math.max(maxT, m.lastHitOffsetMs || 0) : maxT), 0);
    g.topContributors = topSlice.map(m => ({
      id: m.id,
      name: m.name,
      school: m.school,
      score: m.score
    }));
    delete g.allMembers; // Keep broadcast payload lean
  }

  // Ranked copy for active competition
  const ranked = [...groups].sort((a, b) => {
    if (a.excluded !== b.excluded) return a.excluded ? 1 : -1;
    if (b.score !== a.score) return b.score - a.score;
    if (a.score > 0 && a.lastHitOffsetMs !== b.lastHitOffsetMs) {
      return a.lastHitOffsetMs - b.lastHitOffsetMs;
    }
    return a.group - b.group;
  });

  const rankMap = new Map();
  let currentRank = 1;
  for (const g of ranked) {
    if (!g.excluded && g.score > 0) {
      rankMap.set(g.group, currentRank++);
    } else {
      rankMap.set(g.group, null);
    }
  }

  for (const g of groups) {
    g.rank = rankMap.get(g.group);
  }

  // Min non-zero group size advisor for Host
  const populatedCounts = groups.filter(g => !g.excluded && g.memberCount > 0).map(g => g.memberCount);
  const minGroupSize = populatedCounts.length > 0 ? Math.min(...populatedCounts) : 0;
  const maxGroupSize = populatedCounts.length > 0 ? Math.max(...populatedCounts) : 0;

  return {
    groups,
    ranked,
    populatedGroupCount: populatedCounts.length,
    minGroupSize,
    maxGroupSize
  };
}

function computeIndividualStandings(ignoreCurrentWinExemption = false) {
  const { excludePastWinners, targetTouches } = state.config;
  const currentWinPlayers = new Set(
    !ignoreCurrentWinExemption && state.phase === 'ended' && state.currentResult && state.currentResult.winningPlayerIds
      ? state.currentResult.winningPlayerIds
      : []
  );
  const list = [];
  for (const p of state.players.values()) {
    const alreadyWon = state.pastWinnerPlayers.has(p.id);
    const wonBeforeThisRound = alreadyWon && !currentWinPlayers.has(p.id);
    const excluded = excludePastWinners && wonBeforeThisRound;
    list.push({
      id: p.id,
      name: p.name,
      school: p.school,
      group: p.group,
      score: p.score,
      lastHitOffsetMs: p.lastHitOffsetMs || 0,
      completed: p.score >= targetTouches,
      alreadyWon,
      excluded,
      isBot: !!p.isBot
    });
  }

  list.sort((a, b) => {
    if (a.excluded !== b.excluded) return a.excluded ? 1 : -1;
    if (b.score !== a.score) return b.score - a.score;
    if (a.score > 0 && a.lastHitOffsetMs !== b.lastHitOffsetMs) {
      return a.lastHitOffsetMs - b.lastHitOffsetMs;
    }
    return a.name.localeCompare(b.name, 'ko');
  });

  let rank = 1;
  for (const item of list) {
    item.rank = !item.excluded && item.score > 0 ? rank++ : null;
  }

  const eligibleCompleted = list.filter(p => !p.excluded && p.completed);
  return {
    players: list,
    eligibleCompletedCount: eligibleCompleted.length
  };
}

function finalizeRoundResult(forceMode) {
  const mode = state.config.mode;
  const winnerCount = Math.max(1, Number(state.config.winnerCount) || 1);

  if (mode === 'group') {
    const { ranked } = computeGroupStandings();
    const eligible = ranked.filter(g => !g.excluded && g.memberCount > 0 && g.score > 0);
    const winners = eligible.slice(0, winnerCount);
    const winningGroupNums = winners.map(w => w.group);

    const winningPlayerIds = [];
    for (const p of state.players.values()) {
      if (winningGroupNums.includes(p.group)) {
        winningPlayerIds.push(p.id);
      }
    }

    for (const gNum of winningGroupNums) {
      state.pastWinnerGroups.add(gNum);
    }

    state.currentResult = {
      mode: 'group',
      selectionType: 'group_top_n',
      prizeTitle: state.config.prizeTitle,
      topNUsed: state.config.topN,
      winningGroups: winners,
      winningGroupNums,
      winningPlayerIds,
      timestamp: Date.now()
    };
  } else {
    const selectionType = forceMode || state.config.indivSelection;
    // When drawing an extra raffle right after rank winners, exclude those rank winners too
    const { players } = computeIndividualStandings(Boolean(forceMode));
    let winners = [];

    if (selectionType === 'raffle') {
      // Random draw among eligible players who reached targetTouches (fallback to all >0 if none reached)
      let pool = players.filter(p => !p.excluded && p.completed);
      let usedFallback = false;
      if (pool.length === 0) {
        pool = players.filter(p => !p.excluded && p.score > 0);
        usedFallback = true;
      }
      // Fisher-Yates shuffle
      const shuffled = [...pool];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      winners = shuffled.slice(0, winnerCount);
      for (const w of winners) {
        state.pastWinnerPlayers.add(w.id);
      }
      state.currentResult = {
        mode: 'individual',
        selectionType: 'raffle',
        usedFallback,
        targetTouches: state.config.targetTouches,
        poolSize: pool.length,
        prizeTitle: state.config.prizeTitle,
        winningPlayers: winners,
        winningPlayerIds: winners.map(w => w.id),
        timestamp: Date.now()
      };
    } else {
      // Rank-based winners
      const eligible = players.filter(p => !p.excluded && p.score > 0);
      winners = eligible.slice(0, winnerCount);
      for (const w of winners) {
        state.pastWinnerPlayers.add(w.id);
      }
      state.currentResult = {
        mode: 'individual',
        selectionType: 'rank',
        prizeTitle: state.config.prizeTitle,
        winningPlayers: winners,
        winningPlayerIds: winners.map(w => w.id),
        timestamp: Date.now()
      };
    }
  }

  if (state.currentResult) {
    state.history.unshift({
      roundNumber: state.roundNumber,
      prizeTitle: state.config.prizeTitle,
      mode: state.currentResult.mode,
      selectionType: state.currentResult.selectionType,
      summary:
        state.currentResult.mode === 'group'
          ? state.currentResult.winningGroupNums.map(g => `${g}조`).join(', ') || '당첨 없음'
          : state.currentResult.winningPlayers.map(p => (p.school ? `${p.school} ${p.name}` : p.name)).join(', ') || '당첨 없음',
      time: new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
    });
    if (state.history.length > 20) state.history.pop();
  }
}

// ------------------------------------------------------------
// Payload Builders & SSE Broadcast
// ------------------------------------------------------------
function buildHostSnapshot() {
  const now = Date.now();
  const totalPlayers = state.players.size;
  let botCount = 0;
  for (const p of state.players.values()) {
    if (p.isBot) botCount++;
  }

  const base = {
    serverNow: now,
    lanIp: getLocalLanIp(),
    port: PORT,
    roundNumber: state.roundNumber,
    phase: state.phase,
    config: state.config,
    countdownStartAt: state.countdownStartAt,
    gameStartAt: state.gameStartAt,
    gameEndAt: state.gameEndAt,
    totalHits: state.totalHits,
    totalPlayers,
    botCount,
    pastWinnerGroups: Array.from(state.pastWinnerGroups),
    pastWinnerPlayersCount: state.pastWinnerPlayers.size,
    currentResult: state.currentResult,
    history: state.history
  };

  if (state.config.mode === 'group') {
    base.groupStandings = computeGroupStandings();
  } else {
    base.indivStandings = computeIndividualStandings();
  }

  return base;
}

function buildPlayerSnapshot(playerId, groupRankLookup, indivRankLookup) {
  const now = Date.now();
  const p = playerId ? state.players.get(playerId) : null;
  let myRank = null;
  let myGroupScore = 0;
  let isWinner = false;

  if (p) {
    if (state.config.mode === 'group' && groupRankLookup) {
      const gInfo = groupRankLookup.get(p.group);
      if (gInfo) {
        myRank = gInfo.rank;
        myGroupScore = gInfo.score;
      }
    } else if (state.config.mode === 'individual' && indivRankLookup) {
      const iInfo = indivRankLookup.get(p.id);
      if (iInfo) {
        myRank = iInfo.rank;
      }
    }
    if (state.phase === 'ended' && state.currentResult) {
      isWinner = state.currentResult.winningPlayerIds.includes(p.id);
    }
  }

  return {
    serverNow: now,
    roundNumber: state.roundNumber,
    phase: state.phase,
    config: {
      mode: state.config.mode,
      groupCount: state.config.groupCount,
      topN: state.config.topN,
      durationSec: state.config.durationSec,
      targetTouches: state.config.targetTouches,
      strictAlternating: state.config.strictAlternating,
      prizeTitle: state.config.prizeTitle
    },
    countdownStartAt: state.countdownStartAt,
    gameStartAt: state.gameStartAt,
    gameEndAt: state.gameEndAt,
    me: p
      ? {
          id: p.id,
          name: p.name,
          school: p.school,
          group: p.group,
          score: p.score,
          myRank,
          myGroupScore,
          isWinner
        }
      : null,
    resultSummary: state.currentResult
      ? {
          prizeTitle: state.currentResult.prizeTitle,
          mode: state.currentResult.mode,
          winningGroupNums: state.currentResult.winningGroupNums || [],
          winningPlayerNames: (state.currentResult.winningPlayers || []).map(w =>
            w.school ? `${w.school} ${w.name}` : w.name
          )
        }
      : null
  };
}

function sendSse(res, eventName, data) {
  try {
    res.write(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`);
  } catch (_) {
    // Client disconnected
  }
}

function broadcastAll(force = false) {
  if (!force && !dirty) return;
  dirty = false;

  const hostSnap = buildHostSnapshot();
  for (const res of hostClients) {
    sendSse(res, 'state', hostSnap);
  }

  if (playerClients.size > 0) {
    const groupRankLookup = new Map();
    const indivRankLookup = new Map();
    if (hostSnap.groupStandings) {
      for (const g of hostSnap.groupStandings.groups) {
        groupRankLookup.set(g.group, g);
      }
    }
    if (hostSnap.indivStandings) {
      for (const p of hostSnap.indivStandings.players) {
        indivRankLookup.set(p.id, p);
      }
    }

    for (const [res, pid] of playerClients.entries()) {
      const pSnap = buildPlayerSnapshot(pid, groupRankLookup, indivRankLookup);
      sendSse(res, 'state', pSnap);
    }
  }
}

// Keep a steady 160ms broadcast ticker so bursts of 230 concurrent players never flood sockets
broadcastInterval = setInterval(() => {
  broadcastAll(false);
}, 160);

// Heartbeat every 20s to keep proxies/Wi-Fi connections alive
setInterval(() => {
  for (const res of hostClients) {
    try { res.write(': ping\n\n'); } catch (_) {}
  }
  for (const res of playerClients.keys()) {
    try { res.write(': ping\n\n'); } catch (_) {}
  }
}, 20000);

// ------------------------------------------------------------
// Game Flow & Bot Simulator
// ------------------------------------------------------------
function clearGameTimers() {
  if (countdownTimer) {
    clearTimeout(countdownTimer);
    countdownTimer = null;
  }
  if (gameEndTimer) {
    clearTimeout(gameEndTimer);
    gameEndTimer = null;
  }
  if (settleTimer) {
    clearTimeout(settleTimer);
    settleTimer = null;
  }
  if (botInterval) {
    clearInterval(botInterval);
    botInterval = null;
  }
}

function resetScores() {
  state.totalHits = 0;
  for (const p of state.players.values()) {
    p.score = 0;
    p.lastHitOffsetMs = 0;
    p.lastSide = null;
  }
}

function startCountdown() {
  clearGameTimers();
  resetScores();
  state.currentResult = null;
  state.phase = 'countdown';
  const now = Date.now();
  state.countdownStartAt = now;
  state.gameStartAt = now + 3200; // 3.2s for 3-2-1-출발!
  state.gameEndAt = state.gameStartAt + state.config.durationSec * 1000;
  dirty = true;
  broadcastAll(true);

  countdownTimer = setTimeout(() => {
    state.phase = 'playing';
    dirty = true;
    broadcastAll(true);
    startBotSimulation();

    const remainingMs = Math.max(500, state.gameEndAt - Date.now());
    gameEndTimer = setTimeout(() => {
      finishGame();
    }, remainingMs);
  }, 3200);
}

function finishGame() {
  clearGameTimers();
  if (state.phase === 'ended' || state.phase === 'settling') return;
  // Enter a 550ms score-settling window so all in-flight client packets arrive BEFORE locking winners
  state.phase = 'settling';
  dirty = true;
  broadcastAll(true);

  settleTimer = setTimeout(() => {
    settleTimer = null;
    state.phase = 'ended';
    finalizeRoundResult();
    dirty = true;
    broadcastAll(true);
  }, 550);
}

function resetToLobby(advanceRound = true) {
  clearGameTimers();
  resetScores();
  if (advanceRound && state.phase === 'ended') {
    state.roundNumber++;
    state.config.prizeTitle = `제${state.roundNumber}라운드 경품`;
  }
  state.phase = 'lobby';
  state.currentResult = null;
  dirty = true;
  broadcastAll(true);
}

function startBotSimulation() {
  if (botInterval) clearInterval(botInterval);
  botInterval = setInterval(() => {
    if (state.phase !== 'playing') return;
    const now = Date.now();
    if (now >= state.gameEndAt) return;
    const offset = Math.max(1, now - state.gameStartAt);

    let anyHit = false;
    for (const p of state.players.values()) {
      if (!p.isBot) continue;
      // botRate = average taps per second (e.g., 2.2 ~ 8.8 taps/sec). Tick is every 120ms.
      const expected = (p.botRate || 5) * 0.12;
      const whole = Math.floor(expected);
      const frac = expected - whole;
      const hits = whole + (Math.random() < frac ? 1 : 0);
      if (hits > 0) {
        p.score += hits;
        p.lastHitOffsetMs = offset;
        state.totalHits += hits;
        anyHit = true;
      }
    }
    if (anyHit) dirty = true;
  }, 120);
}

const SAMPLE_SURNAMES = ['김', '이', '박', '최', '정', '강', '조', '윤', '장', '임', '한', '오', '서', '신', '권', '황', '안', '송', '전', '홍'];
const SAMPLE_GIVEN = ['영수', '미숙', '정호', '순자', '성훈', '영희', '동현', '지연', '상철', '현숙', '재호', '은주', '태호', '선영', '경수', '명숙', '진우', '수진', '종수', '혜경'];
const SAMPLE_SCHOOLS = ['한빛초', '푸른중', '청솔고', '가온초', '해오름중', '새봄초', '늘푸른고', '다솜초', '백마중', '은하수초', '소나무중', '무지개초'];

function spawnBots(preset) {
  // Remove existing bots first
  for (const [id, p] of state.players.entries()) {
    if (p.isBot) state.players.delete(id);
  }

  if (preset === 'clear') {
    dirty = true;
    broadcastAll(true);
    return;
  }

  if (preset === 'morning_230') {
    // 225 bots across 25 groups (varying 7~11 per group to realistically test Top N!)
    state.config.mode = 'group';
    state.config.groupCount = 25;
    state.config.topN = 5;
    for (let i = 0; i < 225; i++) {
      const id = `bot_${crypto.randomBytes(4).toString('hex')}`;
      const name = SAMPLE_SURNAMES[i % SAMPLE_SURNAMES.length] + SAMPLE_GIVEN[(i * 7 + 3) % SAMPLE_GIVEN.length];
      const school = SAMPLE_SCHOOLS[i % SAMPLE_SCHOOLS.length];
      // Slightly uneven group distribution (6~11 members per group)
      const group = ((i + Math.floor(i / 25)) % 25) + 1;
      // Realistic tap speed distribution: 2.2 ~ 8.5 taps/sec
      const botRate = +(2.2 + Math.random() * 6.3).toFixed(2);
      state.players.set(id, {
        id,
        name,
        school,
        group,
        score: 0,
        lastHitOffsetMs: 0,
        connected: true,
        isBot: true,
        botRate,
        lastSide: null
      });
    }
  } else if (preset === 'afternoon_44') {
    state.config.mode = 'individual';
    state.config.winnerCount = 3;
    state.config.targetTouches = 30;
    for (let i = 0; i < 43; i++) {
      const id = `bot_${crypto.randomBytes(4).toString('hex')}`;
      const name = SAMPLE_SURNAMES[(i * 3) % SAMPLE_SURNAMES.length] + SAMPLE_GIVEN[(i * 5 + 1) % SAMPLE_GIVEN.length];
      const school = SAMPLE_SCHOOLS[(i * 2) % SAMPLE_SCHOOLS.length];
      const botRate = +(2.0 + Math.random() * 6.8).toFixed(2);
      state.players.set(id, {
        id,
        name,
        school,
        group: (i % 8) + 1,
        score: 0,
        lastHitOffsetMs: 0,
        connected: true,
        isBot: true,
        botRate,
        lastSide: null
      });
    }
  }

  dirty = true;
  broadcastAll(true);
}

// ------------------------------------------------------------
// HTTP Helpers & Server
// ------------------------------------------------------------
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => {
      raw += chunk;
      if (raw.length > 65536) {
        req.destroy();
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, obj) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(obj));
}

function serveStatic(res, filePath) {
  const safePath = path.normalize(filePath);
  if (!safePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  fs.readFile(safePath, (err, content) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Not found');
    }
    const ext = path.extname(safePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    res.end(content);
  });
}

const server = http.createServer(async (req, res) => {
  const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = urlObj.pathname;

  // SSE Endpoint
  if (req.method === 'GET' && pathname === '/api/events') {
    const role = urlObj.searchParams.get('role') || 'player';
    const playerId = urlObj.searchParams.get('playerId') || '';

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });

    if (role === 'host') {
      hostClients.add(res);
      sendSse(res, 'state', buildHostSnapshot());
      req.on('close', () => {
        hostClients.delete(res);
      });
    } else {
      playerClients.set(res, playerId);
      if (playerId && state.players.has(playerId)) {
        state.players.get(playerId).connected = true;
      }
      sendSse(res, 'state', buildPlayerSnapshot(playerId, null, null));
      req.on('close', () => {
        playerClients.delete(res);
      });
    }
    return;
  }

  // Join / Update Player Profile
  if (req.method === 'POST' && pathname === '/api/join') {
    try {
      const body = await readJsonBody(req);
      const name = String(body.name || '').trim().slice(0, 20);
      const school = String(body.school || '').trim().slice(0, 20);
      let group = parseInt(body.group, 10);
      if (!Number.isFinite(group) || group < 1) group = 1;
      if (group > state.config.groupCount) group = state.config.groupCount;

      if (!name) {
        return sendJson(res, 400, { ok: false, error: '성함을 입력해 주세요.' });
      }

      let id = String(body.playerId || '').trim();
      if (!id || !state.players.has(id)) {
        id = id && id.startsWith('p_') ? id : `p_${crypto.randomBytes(6).toString('hex')}`;
        state.players.set(id, {
          id,
          name,
          school,
          group,
          score: 0,
          lastHitOffsetMs: 0,
          connected: true,
          isBot: false,
          lastSide: null
        });
      } else {
        const existing = state.players.get(id);
        existing.name = name;
        existing.school = school;
        existing.group = group;
        existing.connected = true;
      }

      dirty = true;
      broadcastAll(true);
      return sendJson(res, 200, { ok: true, playerId: id, player: state.players.get(id) });
    } catch (e) {
      return sendJson(res, 400, { ok: false, error: '잘못된 요청입니다.' });
    }
  }

  // Player Score Update (Throttled client delta or authoritative score)
  if (req.method === 'POST' && pathname === '/api/hit') {
    try {
      const body = await readJsonBody(req);
      const id = String(body.playerId || '');
      const player = state.players.get(id);
      if (!player) {
        return sendJson(res, 404, { ok: false, error: '입장 정보가 없습니다.' });
      }

      // Accept hits only during 'playing' and the 550ms 'settling' flush window; strictly lock once 'ended'
      if (state.phase !== 'playing' && state.phase !== 'settling') {
        return sendJson(res, 200, { ok: true, ignored: true, score: player.score });
      }

      const now = Date.now();
      const clientScore = Math.max(0, Math.min(400, parseInt(body.score, 10) || 0));
      if (clientScore > player.score) {
        const delta = clientScore - player.score;
        // Sanity cap: max ~22 taps/sec over round duration to prevent script tampering
        const maxReasonable = (state.config.durationSec + 2) * 22;
        if (clientScore <= maxReasonable) {
          player.score = clientScore;
          player.lastHitOffsetMs = Math.max(1, Math.min(state.config.durationSec * 1000, now - state.gameStartAt));
          state.totalHits += delta;
          dirty = true;
        }
      }

      return sendJson(res, 200, { ok: true, score: player.score });
    } catch (e) {
      return sendJson(res, 400, { ok: false });
    }
  }

  // Host Configuration Update
  if (req.method === 'POST' && pathname === '/api/host/config') {
    try {
      const body = await readJsonBody(req);
      const c = state.config;

      if (body.mode === 'group' || body.mode === 'individual') c.mode = body.mode;
      if (body.groupCount !== undefined) {
        c.groupCount = Math.max(2, Math.min(40, parseInt(body.groupCount, 10) || 24));
      }
      if (body.topN !== undefined) {
        c.topN = Math.max(1, Math.min(30, parseInt(body.topN, 10) || 5));
      }
      if (body.durationSec !== undefined && state.phase !== 'playing') {
        c.durationSec = Math.max(5, Math.min(30, parseInt(body.durationSec, 10) || 10));
      }
      if (body.winnerCount !== undefined) {
        c.winnerCount = Math.max(1, Math.min(20, parseInt(body.winnerCount, 10) || 1));
      }
      if (body.indivSelection === 'rank' || body.indivSelection === 'raffle') {
        c.indivSelection = body.indivSelection;
      }
      if (body.targetTouches !== undefined) {
        c.targetTouches = Math.max(5, Math.min(200, parseInt(body.targetTouches, 10) || 25));
      }
      if (typeof body.excludePastWinners === 'boolean') {
        c.excludePastWinners = body.excludePastWinners;
      }
      if (typeof body.strictAlternating === 'boolean') {
        c.strictAlternating = body.strictAlternating;
      }
      if (typeof body.prizeTitle === 'string') {
        c.prizeTitle = body.prizeTitle.trim().slice(0, 40) || `제${state.roundNumber}라운드 경품`;
      }

      dirty = true;
      broadcastAll(true);
      return sendJson(res, 200, { ok: true, config: state.config });
    } catch (e) {
      return sendJson(res, 400, { ok: false });
    }
  }

  // Host Actions
  if (req.method === 'POST' && pathname === '/api/host/action') {
    try {
      const body = await readJsonBody(req);
      const action = body.action;

      if (action === 'start') {
        if (state.phase === 'lobby' || state.phase === 'ended') {
          startCountdown();
        }
      } else if (action === 'stop') {
        if (state.phase === 'playing' || state.phase === 'countdown') {
          finishGame();
        }
      } else if (action === 'reset_lobby') {
        resetToLobby(true);
      } else if (action === 'draw_extra_raffle') {
        // Allows host in individual mode (even after rank winners were awarded!) to draw additional random winners among completers
        if (state.config.mode === 'individual') {
          finalizeRoundResult('raffle');
          state.phase = 'ended';
          dirty = true;
          broadcastAll(true);
        }
      } else if (action === 'recalculate_result') {
        // Re-evaluate winners if host adjusted topN or winnerCount on ended screen (undoes current round winners first)
        if (state.phase === 'ended' && state.currentResult) {
          if (state.currentResult.winningGroupNums) {
            for (const g of state.currentResult.winningGroupNums) state.pastWinnerGroups.delete(g);
          }
          if (state.currentResult.winningPlayerIds && state.currentResult.mode === 'individual') {
            for (const pid of state.currentResult.winningPlayerIds) state.pastWinnerPlayers.delete(pid);
          }
          if (state.history.length > 0 && state.history[0].roundNumber === state.roundNumber) {
            state.history.shift();
          }
          finalizeRoundResult();
          dirty = true;
          broadcastAll(true);
        }
      } else if (action === 'clear_winner_history') {
        state.pastWinnerGroups.clear();
        state.pastWinnerPlayers.clear();
        state.history = [];
        dirty = true;
        broadcastAll(true);
      } else if (action === 'kick_all') {
        clearGameTimers();
        state.players.clear();
        state.phase = 'lobby';
        state.currentResult = null;
        state.totalHits = 0;
        dirty = true;
        broadcastAll(true);
      } else if (action === 'spawn_bots') {
        spawnBots(body.preset || 'morning_230');
      }

      return sendJson(res, 200, { ok: true, phase: state.phase });
    } catch (e) {
      return sendJson(res, 400, { ok: false, error: e.message });
    }
  }

  // Routes
  if (req.method === 'GET' && (pathname === '/' || pathname === '/play')) {
    return serveStatic(res, path.join(PUBLIC_DIR, 'play.html'));
  }
  if (req.method === 'GET' && (pathname === '/host' || pathname === '/admin')) {
    return serveStatic(res, path.join(PUBLIC_DIR, 'host.html'));
  }

  // Static files in /public
  if (req.method === 'GET') {
    const rel = pathname.replace(/^\/+/, '');
    return serveStatic(res, path.join(PUBLIC_DIR, rel));
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, '0.0.0.0', () => {
  const lanIp = getLocalLanIp();
  console.log('====================================================');
  console.log('🎊 청백 운동회 박 터뜨리기 추첨 서버가 시작되었습니다!');
  console.log(`🖥️ 사회자(대형 전광판): http://localhost:${PORT}/host`);
  console.log(`💻 참가자(내 PC 테스트): http://localhost:${PORT}/`);
  console.log(`📱 참가자(동일 와이파이): http://${lanIp}:${PORT}/`);
  console.log('====================================================');
});

