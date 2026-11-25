(function () {
  // DOM References
  const hostBlueCheer = document.getElementById('hostBlueCheer');
  const hostWhiteCheer = document.getElementById('hostWhiteCheer');
  let cheerBounceToggle = false;
  let cheerBounceTimer = null;
  const roundBadge = document.getElementById('roundBadge');
  const prizeTitleInput = document.getElementById('prizeTitleInput');
  const modeGroupBtn = document.getElementById('modeGroupBtn');
  const modeIndivBtn = document.getElementById('modeIndivBtn');
  const groupCountWrap = document.getElementById('groupCountWrap');
  const groupCountInput = document.getElementById('groupCountInput');
  const topNWrap = document.getElementById('topNWrap');
  const topNInput = document.getElementById('topNInput');
  const indivModeWrap = document.getElementById('indivModeWrap');
  const indivSelectionSelect = document.getElementById('indivSelectionSelect');
  const targetTouchesWrap = document.getElementById('targetTouchesWrap');
  const targetTouchesInput = document.getElementById('targetTouchesInput');
  const winnerCountInput = document.getElementById('winnerCountInput');
  const winnerUnitLabel = document.getElementById('winnerUnitLabel');
  const durationInput = document.getElementById('durationInput');

  const primaryActionBtn = document.getElementById('primaryActionBtn');
  const botMenuBtn = document.getElementById('botMenuBtn');
  const botPopover = document.getElementById('botPopover');
  const settingsBtn = document.getElementById('settingsBtn');
  const settingsPopover = document.getElementById('settingsPopover');
  const soundToggleBtn = document.getElementById('soundToggleBtn');
  const fullscreenBtn = document.getElementById('fullscreenBtn');

  const excludeWinnersCheck = document.getElementById('excludeWinnersCheck');
  const strictAltCheck = document.getElementById('strictAltCheck');
  const customJoinUrlInput = document.getElementById('customJoinUrlInput');
  const clearHistoryBtn = document.getElementById('clearHistoryBtn');
  const historyList = document.getElementById('historyList');
  const kickAllBtn = document.getElementById('kickAllBtn');

  const lobbySection = document.getElementById('lobbySection');
  const arenaSection = document.getElementById('arenaSection');
  const lobbyRuleSummary = document.getElementById('lobbyRuleSummary');
  const joinUrlText = document.getElementById('joinUrlText');
  const copyUrlBtn = document.getElementById('copyUrlBtn');
  const qrContainer = document.getElementById('qrContainer');
  const attendanceTitle = document.getElementById('attendanceTitle');
  const advisorBanner = document.getElementById('advisorBanner');
  const totalPlayersCount = document.getElementById('totalPlayersCount');
  const lobbyAttendanceGrid = document.getElementById('lobbyAttendanceGrid');

  const timerPill = document.getElementById('timerPill');
  const timerValue = document.getElementById('timerValue');
  const gourdWhole = document.getElementById('gourdWhole');
  const gourdBurst = document.getElementById('gourdBurst');
  const burstBannerMain = document.getElementById('burstBannerMain');
  const arenaTotalHits = document.getElementById('arenaTotalHits');

  const liveSpotlight = document.getElementById('liveSpotlight');
  const winnerSpotlight = document.getElementById('winnerSpotlight');
  const activeRulePill = document.getElementById('activeRulePill');
  const top5List = document.getElementById('top5List');

  const winnerPrizeBadge = document.getElementById('winnerPrizeBadge');
  const winnerHeadline = document.getElementById('winnerHeadline');
  const extraRaffleBtn = document.getElementById('extraRaffleBtn');
  const recalcBtn = document.getElementById('recalcBtn');
  const nextRoundBtn = document.getElementById('nextRoundBtn');
  const winnerCardsArea = document.getElementById('winnerCardsArea');

  const fullBoardTitle = document.getElementById('fullBoardTitle');
  const fullBoardSub = document.getElementById('fullBoardSub');
  const fullStandingsGrid = document.getElementById('fullStandingsGrid');

  const countdownOverlay = document.getElementById('countdownOverlay');
  const countdownNum = document.getElementById('countdownNum');

  // State tracking
  let latestSnap = null;
  let serverClockOffset = 0; // serverNow - Date.now()
  let lastPhase = null;
  let lastTotalHits = 0;
  let lastRenderedQrUrl = '';
  let lastBeepStep = null;

  // ------------------------------------------------------------
  // Canvas FX (Flying Beanbags + Celebration Confetti)
  // ------------------------------------------------------------
  const canvas = document.getElementById('fxCanvas');
  const ctx = canvas.getContext('2d');
  const beanbags = [];
  const confetti = [];

  function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  window.addEventListener('resize', resizeCanvas);
  resizeCanvas();

  function spawnBeanbags(count) {
    const gourdEl = document.getElementById('gourdWrapper');
    if (!gourdEl) return;
    const rect = gourdEl.getBoundingClientRect();
    if (rect.width === 0) return;
    const targetX = rect.left + rect.width / 2 + (Math.random() - 0.5) * 70;
    const targetY = rect.top + rect.height / 2 + (Math.random() - 0.5) * 50;

    const n = Math.min(8, Math.max(1, count));
    for (let i = 0; i < n; i++) {
      const fromLeft = Math.random() < 0.5;
      const startX = fromLeft ? Math.random() * 260 : canvas.width - Math.random() * 260;
      const startY = canvas.height + 20;
      beanbags.push({
        x: startX,
        y: startY,
        tx: targetX,
        ty: targetY,
        t: 0,
        speed: 0.045 + Math.random() * 0.03,
        color: fromLeft ? '#2563eb' : '#ffffff',
        stroke: fromLeft ? '#1e40af' : '#64748b'
      });
    }
  }

  function spawnConfettiBurst() {
    const colors = ['#fbbf24', '#3b82f6', '#f43f5e', '#10b981', '#a855f7', '#ffffff'];
    for (let i = 0; i < 160; i++) {
      confetti.push({
        x: canvas.width * 0.35 + (Math.random() - 0.5) * 300,
        y: canvas.height * 0.28,
        vx: (Math.random() - 0.5) * 18,
        vy: -6 - Math.random() * 12,
        size: 7 + Math.random() * 8,
        color: colors[i % colors.length],
        rot: Math.random() * Math.PI * 2,
        vrot: (Math.random() - 0.5) * 0.25,
        life: 1
      });
    }
  }

  function renderFxFrame() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Beanbags
    for (let i = beanbags.length - 1; i >= 0; i--) {
      const b = beanbags[i];
      b.t += b.speed;
      if (b.t >= 1) {
        beanbags.splice(i, 1);
        continue;
      }
      const curX = b.x + (b.tx - b.x) * b.t;
      const arc = Math.sin(b.t * Math.PI) * 110;
      const curY = b.y + (b.ty - b.y) * b.t - arc;

      ctx.save();
      ctx.beginPath();
      ctx.arc(curX, curY, 10, 0, Math.PI * 2);
      ctx.fillStyle = b.color;
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = b.stroke;
      ctx.stroke();
      ctx.restore();
    }

    // Confetti
    for (let i = confetti.length - 1; i >= 0; i--) {
      const p = confetti[i];
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.32;
      p.vx *= 0.99;
      p.rot += p.vrot;
      p.life -= 0.006;
      if (p.y > canvas.height + 30 || p.life <= 0) {
        confetti.splice(i, 1);
        continue;
      }
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillRect(-p.size / 2, -p.size / 3, p.size, p.size * 0.66);
      ctx.restore();
    }

    // Smooth timer & countdown animation frame
    updateLiveTimers();
    requestAnimationFrame(renderFxFrame);
  }
  requestAnimationFrame(renderFxFrame);

  // ------------------------------------------------------------
  // Live Timer & Countdown Loop
  // ------------------------------------------------------------
  function updateLiveTimers() {
    if (!latestSnap) return;
    const now = Date.now() + serverClockOffset;

    if (latestSnap.phase === 'countdown') {
      countdownOverlay.classList.remove('hidden');
      const rem = latestSnap.gameStartAt - now;
      let stepText = '출발!';
      if (rem > 2100) stepText = '3';
      else if (rem > 1100) stepText = '2';
      else if (rem > 200) stepText = '1';

      if (stepText !== lastBeepStep) {
        lastBeepStep = stepText;
        if (stepText === '출발!') SoundFX.whistleStart();
        else SoundFX.beep();
      }
      countdownNum.textContent = stepText;
    } else {
      countdownOverlay.classList.add('hidden');
      lastBeepStep = null;
    }

    if (latestSnap.phase === 'playing') {
      const remMs = Math.max(0, latestSnap.gameEndAt - now);
      const sec = (remMs / 1000).toFixed(1);
      timerValue.textContent = sec;
      timerPill.classList.toggle('urgent', remMs <= 3000);
    } else if (latestSnap.phase === 'settling' || latestSnap.phase === 'ended') {
      timerValue.textContent = '0.0';
      timerPill.classList.toggle('urgent', latestSnap.phase === 'settling');
    }
  }

  // ------------------------------------------------------------
  // API Helpers
  // ------------------------------------------------------------
  async function postJson(url, data) {
    SoundFX.unlock();
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    return res.json();
  }

  function pushConfigUpdate(patch) {
    postJson('/api/host/config', patch);
  }

  // ------------------------------------------------------------
  // UI Event Bindings
  // ------------------------------------------------------------
  modeGroupBtn.addEventListener('click', () => pushConfigUpdate({ mode: 'group' }));
  modeIndivBtn.addEventListener('click', () => pushConfigUpdate({ mode: 'individual' }));

  groupCountInput.addEventListener('change', () => pushConfigUpdate({ groupCount: Number(groupCountInput.value) }));
  topNInput.addEventListener('change', () => pushConfigUpdate({ topN: Number(topNInput.value) }));
  indivSelectionSelect.addEventListener('change', () => pushConfigUpdate({ indivSelection: indivSelectionSelect.value }));
  targetTouchesInput.addEventListener('change', () => pushConfigUpdate({ targetTouches: Number(targetTouchesInput.value) }));
  winnerCountInput.addEventListener('change', () => pushConfigUpdate({ winnerCount: Number(winnerCountInput.value) }));
  durationInput.addEventListener('change', () => pushConfigUpdate({ durationSec: Number(durationInput.value) }));
  prizeTitleInput.addEventListener('change', () => pushConfigUpdate({ prizeTitle: prizeTitleInput.value }));

  excludeWinnersCheck.addEventListener('change', () => pushConfigUpdate({ excludePastWinners: excludeWinnersCheck.checked }));
  strictAltCheck.addEventListener('change', () => pushConfigUpdate({ strictAlternating: strictAltCheck.checked }));

  primaryActionBtn.addEventListener('click', () => {
    if (!latestSnap) return;
    if (latestSnap.phase === 'lobby') {
      postJson('/api/host/action', { action: 'start' });
    } else if (latestSnap.phase === 'playing' || latestSnap.phase === 'countdown') {
      postJson('/api/host/action', { action: 'stop' });
    } else if (latestSnap.phase === 'ended') {
      postJson('/api/host/action', { action: 'reset_lobby' });
    }
  });

  nextRoundBtn.addEventListener('click', () => {
    postJson('/api/host/action', { action: 'reset_lobby' });
  });

  recalcBtn.addEventListener('click', () => {
    postJson('/api/host/action', { action: 'recalculate_result' });
  });

  extraRaffleBtn.addEventListener('click', () => {
    postJson('/api/host/action', { action: 'draw_extra_raffle' });
    spawnConfettiBurst();
    SoundFX.gourdBurstFanfare();
  });

  botMenuBtn.addEventListener('click', e => {
    e.stopPropagation();
    settingsPopover.classList.add('hidden');
    botPopover.classList.toggle('hidden');
  });

  settingsBtn.addEventListener('click', e => {
    e.stopPropagation();
    botPopover.classList.add('hidden');
    settingsPopover.classList.toggle('hidden');
  });

  document.addEventListener('click', e => {
    if (!botPopover.contains(e.target) && e.target !== botMenuBtn) botPopover.classList.add('hidden');
    if (!settingsPopover.contains(e.target) && e.target !== settingsBtn) settingsPopover.classList.add('hidden');
  });

  botPopover.querySelectorAll('[data-bot]').forEach(btn => {
    btn.addEventListener('click', () => {
      postJson('/api/host/action', { action: 'spawn_bots', preset: btn.dataset.bot });
      botPopover.classList.add('hidden');
    });
  });

  clearHistoryBtn.addEventListener('click', () => {
    postJson('/api/host/action', { action: 'clear_winner_history' });
  });

  kickAllBtn.addEventListener('click', () => {
    if (confirm('현재 접속한 모든 참가자(봇 포함)를 초기화하시겠습니까?')) {
      postJson('/api/host/action', { action: 'kick_all' });
      settingsPopover.classList.add('hidden');
    }
  });

  soundToggleBtn.addEventListener('click', () => {
    const nextMuted = !SoundFX.isMuted();
    SoundFX.setMuted(nextMuted);
    soundToggleBtn.textContent = nextMuted ? '🔇' : '🔊';
  });

  fullscreenBtn.addEventListener('click', () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  });

  copyUrlBtn.addEventListener('click', () => {
    const url = joinUrlText.textContent;
    navigator.clipboard.writeText(url).then(() => {
      const orig = copyUrlBtn.textContent;
      copyUrlBtn.textContent = '✅ 복사 완료!';
      setTimeout(() => (copyUrlBtn.textContent = orig), 1600);
    });
  });

  customJoinUrlInput.addEventListener('input', () => {
    if (latestSnap) updateJoinUrlAndQr(latestSnap);
  });

  // ------------------------------------------------------------
  // Rendering Functions
  // ------------------------------------------------------------
  function getEffectiveJoinUrl(snap) {
    const custom = customJoinUrlInput.value.trim();
    if (custom) return custom;
    // If opened on a public domain (e.g. Render/Railway/ngrok), use window.location.origin
    if (location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
      return location.origin;
    }
    return `http://${snap.lanIp}:${snap.port}`;
  }

  function updateJoinUrlAndQr(snap) {
    const url = getEffectiveJoinUrl(snap);
    joinUrlText.textContent = url;
    if (url !== lastRenderedQrUrl) {
      lastRenderedQrUrl = url;
      qrContainer.innerHTML = QRGen.createQrSvg(url);
    }
  }

  function syncTopControls(snap) {
    const c = snap.config;
    roundBadge.textContent = `${snap.roundNumber}라운드`;
    if (document.activeElement !== prizeTitleInput) prizeTitleInput.value = c.prizeTitle;

    const isGroup = c.mode === 'group';
    modeGroupBtn.classList.toggle('active', isGroup);
    modeIndivBtn.classList.toggle('active', !isGroup);

    groupCountWrap.classList.toggle('hidden', !isGroup);
    topNWrap.classList.toggle('hidden', !isGroup);
    indivModeWrap.classList.toggle('hidden', isGroup);
    targetTouchesWrap.classList.toggle('hidden', isGroup);
    winnerUnitLabel.textContent = isGroup ? '개조' : '명';

    if (document.activeElement !== groupCountInput) groupCountInput.value = c.groupCount;
    if (document.activeElement !== topNInput) topNInput.value = c.topN;
    if (document.activeElement !== indivSelectionSelect) indivSelectionSelect.value = c.indivSelection;
    if (document.activeElement !== targetTouchesInput) targetTouchesInput.value = c.targetTouches;
    if (document.activeElement !== winnerCountInput) winnerCountInput.value = c.winnerCount;
    if (document.activeElement !== durationInput) durationInput.value = c.durationSec;

    excludeWinnersCheck.checked = !!c.excludePastWinners;
    strictAltCheck.checked = !!c.strictAlternating;

    // Primary button state
    primaryActionBtn.classList.remove('stop-mode', 'reset-mode');
    if (snap.phase === 'lobby') {
      primaryActionBtn.textContent = '🏁 경기 시작';
    } else if (snap.phase === 'countdown' || snap.phase === 'playing' || snap.phase === 'settling') {
      primaryActionBtn.textContent = snap.phase === 'settling' ? '⏳ 최종 집계 중...' : '⏹ 즉시 종료';
      primaryActionBtn.classList.add('stop-mode');
    } else {
      primaryActionBtn.textContent = '🔄 다음 라운드 대기실';
      primaryActionBtn.classList.add('reset-mode');
    }

    // History list
    if (!snap.history || snap.history.length === 0) {
      historyList.innerHTML = '<li class="empty-item">아직 진행된 라운드가 없습니다.</li>';
    } else {
      historyList.innerHTML = snap.history
        .map(h => `<li><strong>[${h.roundNumber}R · ${escapeHtml(h.prizeTitle)}]</strong> ${escapeHtml(h.summary)} <span style="color:#94a3b8">(${h.time})</span></li>`)
        .join('');
    }
  }

  function renderLobby(snap) {
    const c = snap.config;
    totalPlayersCount.textContent = snap.totalPlayers;

    if (c.mode === 'group') {
      lobbyRuleSummary.innerHTML = `노트북 <strong>◀ · ▶ 방향키</strong> 또는 스마트폰 터치로 참여! <strong>각 조 상위 ${c.topN}명의 기록 합산</strong>으로 우승 조 전원에게 경품을 드립니다!`;
      attendanceTitle.textContent = `조별 실시간 입장 현황 (총 ${c.groupCount}개 조)`;

      const gs = snap.groupStandings;
      if (gs.populatedGroupCount === 0) {
        advisorBanner.textContent = '참가자 입장을 기다리고 있습니다. (우측 상단 🧪 테스트 봇으로 즉시 시뮬레이션 가능)';
        advisorBanner.className = 'sub-hint';
      } else if (gs.minGroupSize < c.topN) {
        advisorBanner.textContent = `💡 현재 입장한 조 중 최소 인원이 ${gs.minGroupSize}명입니다. 공정한 합산을 위해 상단 [합산 상위 N]을 ${gs.minGroupSize}명 이하로 맞추시는 것을 권장합니다!`;
        advisorBanner.className = 'sub-hint warn';
      } else {
        advisorBanner.textContent = `✅ 모든 참여 조(${gs.populatedGroupCount}개 조)가 최소 ${gs.minGroupSize}명 이상 입장했습니다! (현재 상위 ${c.topN}명 합산 설정 적정)`;
        advisorBanner.className = 'sub-hint';
      }

      lobbyAttendanceGrid.innerHTML = gs.groups
        .map(g => {
          const classes = ['lobby-cell'];
          if (g.memberCount > 0) classes.push('active');
          if (g.memberCount > 0 && g.memberCount < c.topN && !g.excluded) classes.push('under-n');
          if (g.excluded) classes.push('won-excluded');
          const badge = g.excluded ? ' (수상완료)' : '';
          return `<div class="${classes.join(' ')}">
            <span class="g-name">${g.group}조${badge}</span>
            <span class="g-cnt">${g.memberCount}명</span>
          </div>`;
        })
        .join('');
    } else {
      const modeDesc =
        c.indivSelection === 'raffle'
          ? `제한 시간 동안 <strong>${c.targetTouches}타 이상 완주한 선생님 중 ${c.winnerCount}명을 랜덤 추첨</strong>합니다!`
          : `제한 시간 동안 가장 많이 두드린 <strong>상위 ${c.winnerCount}분</strong>께 경품을 드립니다!`;
      lobbyRuleSummary.innerHTML = `노트북 <strong>◀ · ▶ 방향키</strong> 또는 스마트폰 좌·우 터치! ${modeDesc}`;
      attendanceTitle.textContent = `개인전 실시간 입장 명단`;
      advisorBanner.textContent =
        snap.totalPlayers > 0
          ? `현재 ${snap.totalPlayers}명의 선생님이 입장 완료하셨습니다. 준비되면 [🏁 경기 시작]을 눌러주세요!`
          : '선생님들의 입장을 기다리고 있습니다...';
      advisorBanner.className = 'sub-hint';

      const players = snap.indivStandings ? snap.indivStandings.players : [];
      lobbyAttendanceGrid.innerHTML = players
        .slice(0, 80)
        .map(p => {
          const label = p.school ? `${p.school} ${p.name}` : p.name;
          return `<div class="lobby-cell active ${p.excluded ? 'won-excluded' : ''}">
            <span class="g-name">${escapeHtml(label)}</span>
            <span class="g-cnt">${p.excluded ? '수상' : '준비'}</span>
          </div>`;
        })
        .join('');
    }
  }

  function renderArena(snap) {
    const c = snap.config;
    arenaTotalHits.textContent = snap.totalHits.toLocaleString();

    // Gourd state: whole vs burst
    const isEnded = snap.phase === 'ended';
    gourdWhole.classList.toggle('hidden', isEnded);
    gourdBurst.classList.toggle('hidden', !isEnded);

    if (!isEnded) {
      gourdWhole.classList.toggle('shake', (snap.phase === 'playing' || snap.phase === 'settling') && snap.totalHits > 0);
      // Crack progression based on time elapsed
      const now = Date.now() + serverClockOffset;
      const progress = snap.phase === 'settling' ? 1 : Math.max(0, Math.min(1, (now - snap.gameStartAt) / (c.durationSec * 1000)));
      gourdWhole.classList.toggle('crack-1', progress >= 0.28);
      gourdWhole.classList.toggle('crack-2', progress >= 0.58);
      gourdWhole.classList.toggle('crack-3', progress >= 0.82);
    }

    liveSpotlight.classList.toggle('hidden', isEnded);
    winnerSpotlight.classList.toggle('hidden', !isEnded);

    if (c.mode === 'group') {
      const gs = snap.groupStandings;
      activeRulePill.textContent = `조별 상위 ${c.topN}명 합산 · 상위 ${c.winnerCount}개조 우승`;
      fullBoardTitle.textContent = `전체 조 실시간 현황 (${c.groupCount}개 조)`;
      fullBoardSub.textContent = `각 조 상위 ${c.topN}명의 점수만 합산됩니다`;

      const activeRanked = gs.ranked.filter(g => !g.excluded);
      const maxScore = Math.max(10, activeRanked[0] ? activeRanked[0].score : 10);

      // Top 5
      top5List.innerHTML = activeRanked
        .slice(0, 5)
        .map((g, idx) => {
          const pct = Math.min(100, Math.round((g.score / maxScore) * 100));
          const medal = idx === 0 ? '🥇 1위' : idx === 1 ? '🥈 2위' : idx === 2 ? '🥉 3위' : `${idx + 1}위`;
          return `<div class="top5-row ${idx === 0 && g.score > 0 ? 'rank-1' : ''}">
            <span class="rank-medal">${medal}</span>
            <span class="row-name">${g.group}조 <small style="color:#64748b;font-size:0.82rem">(${g.countedMembers}/${g.memberCount}명)</small></span>
            <div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div>
            <span class="row-score">${g.score}타</span>
          </div>`;
        })
        .join('');

      // Full Group Grid (ordered 1조..N조 so eyes can track fixed positions easily!)
      const winSet = new Set((snap.currentResult && snap.currentResult.winningGroupNums) || []);
      fullStandingsGrid.innerHTML = gs.groups
        .map(g => {
          const isTop1 = g.rank === 1 && g.score > 0 && !isEnded;
          const isWinner = isEnded && winSet.has(g.group);
          const rankLabel = isWinner ? '🏆우승' : g.excluded ? '수상완료' : g.rank ? `${g.rank}위` : '-';
          return `<div class="mini-tile ${isTop1 ? 'is-top1' : ''} ${isWinner ? 'is-winner' : ''} ${g.excluded && !isWinner ? 'is-excluded' : ''}">
            <div class="mini-top">
              <span class="mini-name">${g.group}조</span>
              <span class="mini-rank">${rankLabel}</span>
            </div>
            <div class="mini-bottom">
              <span class="mini-meta">상위${g.countedMembers}/${g.memberCount}명</span>
              <span class="mini-score">${g.score}타</span>
            </div>
          </div>`;
        })
        .join('');

      if (isEnded && snap.currentResult) {
        renderGroupWinners(snap.currentResult);
      }
    } else {
      // INDIVIDUAL MODE
      const is = snap.indivStandings;
      activeRulePill.textContent =
        c.indivSelection === 'raffle'
          ? `완주 기준 ${c.targetTouches}타 달성: ${is.eligibleCompletedCount}명`
          : `개인 기록 순위 상위 ${c.winnerCount}명 시상`;
      fullBoardTitle.textContent = `개인전 실시간 현황 (${is.players.length}명)`;
      fullBoardSub.textContent = `완주 기준(${c.targetTouches}타) 달성자: 현재 ${is.eligibleCompletedCount}명`;

      const activePlayers = is.players.filter(p => !p.excluded);
      const maxScore = Math.max(10, activePlayers[0] ? activePlayers[0].score : 10);

      top5List.innerHTML = activePlayers
        .slice(0, 5)
        .map((p, idx) => {
          const pct = Math.min(100, Math.round((p.score / maxScore) * 100));
          const medal = idx === 0 ? '🥇 1위' : idx === 1 ? '🥈 2위' : idx === 2 ? '🥉 3위' : `${idx + 1}위`;
          const label = p.school ? `${p.school} ${p.name}` : p.name;
          return `<div class="top5-row ${idx === 0 && p.score > 0 ? 'rank-1' : ''}">
            <span class="rank-medal">${medal}</span>
            <span class="row-name">${escapeHtml(label)}</span>
            <div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div>
            <span class="row-score">${p.score}타</span>
          </div>`;
        })
        .join('');

      const winIds = new Set((snap.currentResult && snap.currentResult.winningPlayerIds) || []);
      fullStandingsGrid.innerHTML = is.players
        .slice(0, 60)
        .map(p => {
          const isTop1 = p.rank === 1 && p.score > 0 && !isEnded;
          const isWinner = isEnded && winIds.has(p.id);
          const label = p.school ? `${p.school} ${p.name}` : p.name;
          const rankLabel = isWinner ? '🎉당첨' : p.excluded ? '수상완료' : p.completed ? '완주' : p.rank ? `${p.rank}위` : '-';
          return `<div class="mini-tile ${isTop1 ? 'is-top1' : ''} ${isWinner ? 'is-winner' : ''} ${p.excluded && !isWinner ? 'is-excluded' : ''}">
            <div class="mini-top">
              <span class="mini-name">${escapeHtml(label)}</span>
              <span class="mini-rank">${rankLabel}</span>
            </div>
            <div class="mini-bottom">
              <span class="mini-meta">${p.completed ? '✅목표달성' : '도전중'}</span>
              <span class="mini-score">${p.score}타</span>
            </div>
          </div>`;
        })
        .join('');

      if (isEnded && snap.currentResult) {
        renderIndivWinners(snap.currentResult);
      }
    }
  }

  function renderGroupWinners(res) {
    winnerPrizeBadge.textContent = res.prizeTitle;
    extraRaffleBtn.classList.add('hidden');
    const groups = res.winningGroups || [];

    if (groups.length === 0) {
      burstBannerMain.textContent = '참여 기록 없음';
      winnerHeadline.textContent = '집계된 점수가 없습니다.';
      winnerCardsArea.innerHTML = '';
      return;
    }

    burstBannerMain.textContent = groups.map(g => `${g.group}조 우승!`).join(' · ');
    winnerHeadline.textContent = `🏆 축하합니다! 우승 조 전원에게 경품을 드립니다!`;

    winnerCardsArea.innerHTML = groups
      .map((g, idx) => {
        const mvps = (g.topContributors || [])
          .map(m => `<span class="mvp-tag">${escapeHtml(m.school ? `${m.school} ${m.name}` : m.name)} (${m.score}타)</span>`)
          .join('');
        return `<div class="win-card">
          <div class="win-card-top">
            <span class="win-title">${idx === 0 ? '🥇' : '🏅'} ${g.group}조 전원 당첨!</span>
            <span class="win-score">합산 ${g.score}타</span>
          </div>
          <div class="win-mvp-label">👏 우리 조를 캐리한 상위 ${res.topNUsed}명 에이스</div>
          <div class="win-mvp-tags">${mvps || '<span class="mvp-tag">기록 없음</span>'}</div>
        </div>`;
      })
      .join('');
  }

  function renderIndivWinners(res) {
    winnerPrizeBadge.textContent = res.prizeTitle;
    extraRaffleBtn.classList.remove('hidden');
    const winners = res.winningPlayers || [];

    if (winners.length === 0) {
      burstBannerMain.textContent = '당첨자 없음';
      winnerHeadline.textContent = '조건을 만족하는 참가자가 없습니다.';
      winnerCardsArea.innerHTML = '';
      return;
    }

    burstBannerMain.textContent =
      res.selectionType === 'raffle' ? `행운 추첨 ${winners.length}명!` : `최고 기록 ${winners.length}명!`;
    winnerHeadline.textContent =
      res.selectionType === 'raffle'
        ? `🎲 완주자(${res.targetTouches}타 이상, 대상 ${res.poolSize}명) 랜덤 추첨 당첨자!`
        : `🏆 개인전 최고 연타 기록 수상자 발표!`;

    winnerCardsArea.innerHTML = winners
      .map((w, idx) => {
        const fullName = w.school ? `${w.school} ${w.name}` : w.name;
        const badge = res.selectionType === 'raffle' ? '🎁 행운당첨' : `${idx + 1}위`;
        return `<div class="win-card">
          <div class="win-card-top">
            <span class="win-title">${escapeHtml(fullName)} 선생님</span>
            <span class="win-score">${badge} (${w.score}타)</span>
          </div>
          <div class="win-mvp-label">스마트폰 또는 노트북 화면의 당첨 확인증을 보여주세요!</div>
        </div>`;
      })
      .join('');
  }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ------------------------------------------------------------
  // SSE Subscription
  // ------------------------------------------------------------
  function connectSse() {
    const es = new EventSource('/api/events?role=host');
    es.addEventListener('state', ev => {
      const snap = JSON.parse(ev.data);
      serverClockOffset = snap.serverNow - Date.now();

      // Detect hit increments during playing to shoot beanbags & bounce stage mascots!
      if (snap.phase === 'playing' && snap.totalHits > lastTotalHits) {
        const diff = snap.totalHits - lastTotalHits;
        spawnBeanbags(Math.ceil(diff / 4));
        if (Math.random() < 0.65) SoundFX.gourdHit();

        cheerBounceToggle = !cheerBounceToggle;
        const activeMascot = cheerBounceToggle ? hostBlueCheer : hostWhiteCheer;
        if (activeMascot) {
          activeMascot.classList.add('bounce');
          if (cheerBounceTimer) clearTimeout(cheerBounceTimer);
          cheerBounceTimer = setTimeout(() => {
            if (hostBlueCheer) hostBlueCheer.classList.remove('bounce');
            if (hostWhiteCheer) hostWhiteCheer.classList.remove('bounce');
          }, 130);
        }
      }
      lastTotalHits = snap.totalHits;

      // Detect transition into 'ended' -> Burst Gourd + Fanfare + Confetti!
      if (lastPhase && lastPhase !== 'ended' && snap.phase === 'ended') {
        SoundFX.gourdBurstFanfare();
        spawnConfettiBurst();
      }
      lastPhase = snap.phase;
      latestSnap = snap;

      updateJoinUrlAndQr(snap);
      syncTopControls(snap);

      const inLobby = snap.phase === 'lobby';
      lobbySection.classList.toggle('hidden', !inLobby);
      arenaSection.classList.toggle('hidden', inLobby);

      if (inLobby) {
        renderLobby(snap);
      } else {
        renderArena(snap);
      }
    });

    es.onerror = () => {
      // Browser EventSource automatically reconnects
    };
  }

  connectSse();
})();

