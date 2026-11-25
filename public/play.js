(function () {
  const STORAGE_KEY = 'raffle_player_profile_v1';

  // DOM References
  const myProfileBadge = document.getElementById('myProfileBadge');
  const editProfileBtn = document.getElementById('editProfileBtn');
  const playerSoundBtn = document.getElementById('playerSoundBtn');

  const joinView = document.getElementById('joinView');
  const joinModeDesc = document.getElementById('joinModeDesc');
  const groupSelectSection = document.getElementById('groupSelectSection');
  const groupButtonsGrid = document.getElementById('groupButtonsGrid');
  const schoolInput = document.getElementById('schoolInput');
  const nameInput = document.getElementById('nameInput');
  const joinErrorMsg = document.getElementById('joinErrorMsg');
  const submitJoinBtn = document.getElementById('submitJoinBtn');

  const arenaView = document.getElementById('arenaView');
  const statusCard = document.getElementById('statusCard');
  const phasePill = document.getElementById('phasePill');
  const playerTimer = document.getElementById('playerTimer');
  const scoreCaption = document.getElementById('scoreCaption');
  const myScoreNum = document.getElementById('myScoreNum');
  const myRankLine = document.getElementById('myRankLine');
  const guideHintLine = document.getElementById('guideHintLine');

  const leftPadBtn = document.getElementById('leftPadBtn');
  const rightPadBtn = document.getElementById('rightPadBtn');

  const resultView = document.getElementById('resultView');
  const winnerCertCard = document.getElementById('winnerCertCard');
  const certPrizeTitle = document.getElementById('certPrizeTitle');
  const certUserGroup = document.getElementById('certUserGroup');
  const certUserName = document.getElementById('certUserName');
  const winnerMyRecord = document.getElementById('winnerMyRecord');

  const nonWinnerCard = document.getElementById('nonWinnerCard');
  const normalPrizeTitle = document.getElementById('normalPrizeTitle');
  const normalWinnerAnnounce = document.getElementById('normalWinnerAnnounce');
  const normalMyStats = document.getElementById('normalMyStats');

  const playerCountdown = document.getElementById('playerCountdown');
  const playerCountdownNum = document.getElementById('playerCountdownNum');
  const toastMsg = document.getElementById('toastMsg');

  // Local State
  let profile = loadSavedProfile();
  let selectedGroup = profile.group || 1;
  let joinedServer = false;
  let editingProfile = false;

  let latestSnap = null;
  let serverClockOffset = 0;
  let lastPhase = null;
  let renderedGroupCount = 0;

  let practiceScore = 0;
  let liveScore = 0;
  let lastSyncedScore = 0;
  let syncInFlight = false;
  let flushedAtEnd = false;
  let lastAcceptedSide = null; // 'left' | 'right' | null
  let eventSource = null;
  let toastTimer = null;
  let celebratedWinKey = '';

  function loadSavedProfile() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (_) {}
    return { playerId: '', name: '', school: '', group: 1 };
  }

  function saveProfile() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
    } catch (_) {}
  }

  function showToast(msg) {
    toastMsg.textContent = msg;
    toastMsg.classList.remove('hidden');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastMsg.classList.add('hidden'), 1500);
  }

  // ------------------------------------------------------------
  // Group Choice Grid Rendering
  // ------------------------------------------------------------
  function renderGroupButtons(count) {
    if (selectedGroup > count) selectedGroup = 1;
    renderedGroupCount = count;
    groupButtonsGrid.innerHTML = '';
    for (let g = 1; g <= count; g++) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `grp-choice-btn ${g === selectedGroup ? 'selected' : ''}`;
      btn.textContent = `${g}조`;
      btn.addEventListener('click', () => {
        selectedGroup = g;
        groupButtonsGrid.querySelectorAll('.grp-choice-btn').forEach((el, idx) => {
          el.classList.toggle('selected', idx + 1 === selectedGroup);
        });
      });
      groupButtonsGrid.appendChild(btn);
    }
  }
  renderGroupButtons(24);

  // Prefill inputs
  if (profile.school) schoolInput.value = profile.school;
  if (profile.name) nameInput.value = profile.name;

  // ------------------------------------------------------------
  // Join Logic
  // ------------------------------------------------------------
  async function submitJoin(auto = false) {
    const name = nameInput.value.trim();
    const school = schoolInput.value.trim();
    if (!name) {
      if (!auto) {
        joinErrorMsg.textContent = '선생님 성함을 입력해 주세요!';
        joinErrorMsg.classList.remove('hidden');
        nameInput.focus();
      }
      return;
    }
    joinErrorMsg.classList.add('hidden');
    if (!auto) SoundFX.unlock();

    try {
      const res = await fetch('/api/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          playerId: profile.playerId,
          name,
          school,
          group: selectedGroup
        })
      });
      const data = await res.json();
      if (!data.ok) {
        if (!auto) {
          joinErrorMsg.textContent = data.error || '입장에 실패했습니다.';
          joinErrorMsg.classList.remove('hidden');
        }
        return;
      }

      profile = {
        playerId: data.playerId,
        name: data.player.name,
        school: data.player.school,
        group: data.player.group
      };
      saveProfile();
      joinedServer = true;
      editingProfile = false;
      connectSse();
      updateViews();
    } catch (e) {
      if (!auto) {
        joinErrorMsg.textContent = '서버와 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.';
        joinErrorMsg.classList.remove('hidden');
      }
    }
  }

  submitJoinBtn.addEventListener('click', () => submitJoin(false));
  nameInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') submitJoin(false);
  });

  editProfileBtn.addEventListener('click', () => {
    editingProfile = true;
    updateViews();
  });

  playerSoundBtn.addEventListener('click', () => {
    const next = !SoundFX.isMuted();
    SoundFX.setMuted(next);
    playerSoundBtn.textContent = next ? '🔇' : '🔊';
  });

  // ------------------------------------------------------------
  // Input Handling: Laptop Arrow Keys (← / →) + Mobile Dual Pads
  // ------------------------------------------------------------
  function updateNextCueUI() {
    if (!latestSnap || !latestSnap.config.strictAlternating || lastAcceptedSide === null) {
      leftPadBtn.classList.add('next-cue');
      rightPadBtn.classList.add('next-cue');
      return;
    }
    leftPadBtn.classList.toggle('next-cue', lastAcceptedSide === 'right');
    rightPadBtn.classList.toggle('next-cue', lastAcceptedSide === 'left');
  }

  function animatePadPress(side) {
    const btn = side === 'left' ? leftPadBtn : rightPadBtn;
    btn.classList.add('pressed');
    setTimeout(() => btn.classList.remove('pressed'), 75);
  }

  function handleActionInput(side) {
    if (!joinedServer || editingProfile) return;
    if (!latestSnap) return;
    if (latestSnap.phase !== 'lobby' && latestSnap.phase !== 'playing') return;

    const now = Date.now() + serverClockOffset;
    if (latestSnap.phase === 'playing' && now >= latestSnap.gameEndAt) {
      flushScoreToServer();
      return;
    }

    SoundFX.unlock();
    animatePadPress(side);

    const strict = latestSnap.config.strictAlternating;
    if (strict && lastAcceptedSide === side) {
      // Gently remind to alternate without freezing
      showToast(side === 'left' ? '이제 오른쪽(▶)을 눌러주세요!' : '이제 왼쪽(◀)을 눌러주세요!');
      return;
    }

    lastAcceptedSide = side;
    updateNextCueUI();
    SoundFX.tap(side);
    if (navigator.vibrate) {
      try { navigator.vibrate(10); } catch (_) {}
    }

    if (latestSnap.phase === 'lobby') {
      practiceScore++;
      myScoreNum.textContent = practiceScore;
    } else if (latestSnap.phase === 'playing') {
      liveScore++;
      myScoreNum.textContent = liveScore;
    }
  }

  // Keyboard listener for Laptops (← / → or A / D, blocking key-hold auto-repeat!)
  window.addEventListener('keydown', e => {
    if (!joinedServer || editingProfile) return;
    if (document.activeElement && ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;

    if (e.key === 'ArrowLeft' || e.code === 'KeyA') {
      e.preventDefault();
      if (e.repeat) {
        showToast('키를 꾹 누르지 말고 떼었다가 번갈아 눌러주세요!');
        return;
      }
      handleActionInput('left');
    } else if (e.key === 'ArrowRight' || e.code === 'KeyD') {
      e.preventDefault();
      if (e.repeat) {
        showToast('키를 꾹 누르지 말고 떼었다가 번갈아 눌러주세요!');
        return;
      }
      handleActionInput('right');
    }
  });

  // Pointerdown for instantaneous multi-touch on smartphones & mouse clicks on laptops
  leftPadBtn.addEventListener('pointerdown', e => {
    e.preventDefault();
    handleActionInput('left');
  });
  rightPadBtn.addEventListener('pointerdown', e => {
    e.preventDefault();
    handleActionInput('right');
  });

  // Prevent double-tap zoom on iOS/Android
  document.addEventListener('dblclick', e => {
    if (joinedServer && !editingProfile) e.preventDefault();
  }, { passive: false });

  // ------------------------------------------------------------
  // Throttled Score Sync to Server (Every 150ms when dirty)
  // ------------------------------------------------------------
  async function flushScoreToServer() {
    if (!profile.playerId || liveScore <= lastSyncedScore || syncInFlight) return;
    if (latestSnap && latestSnap.phase !== 'playing' && latestSnap.phase !== 'settling') return;

    const targetScore = liveScore;
    syncInFlight = true;
    try {
      const res = await fetch('/api/hit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          playerId: profile.playerId,
          score: targetScore
        })
      });
      const data = await res.json();
      if (data && data.ok && !data.ignored) {
        lastSyncedScore = Math.max(lastSyncedScore, data.score || targetScore);
      }
    } catch (_) {
      // Will retry on next interval
    } finally {
      syncInFlight = false;
      // If more taps accumulated while fetch was in flight, flush immediately
      if (liveScore > lastSyncedScore && latestSnap && (latestSnap.phase === 'playing' || latestSnap.phase === 'settling')) {
        flushScoreToServer();
      }
    }
  }

  setInterval(flushScoreToServer, 120);

  // Live timer animation loop on player screen
  function tickPlayerTimer() {
    if (latestSnap) {
      const now = Date.now() + serverClockOffset;
      if (latestSnap.phase === 'countdown') {
        playerCountdown.classList.remove('hidden');
        const rem = latestSnap.gameStartAt - now;
        if (rem > 2100) playerCountdownNum.textContent = '3';
        else if (rem > 1100) playerCountdownNum.textContent = '2';
        else if (rem > 200) playerCountdownNum.textContent = '1';
        else playerCountdownNum.textContent = '출발!';
      } else {
        playerCountdown.classList.add('hidden');
      }

      if (latestSnap.phase === 'playing') {
        const remMs = Math.max(0, latestSnap.gameEndAt - now);
        playerTimer.textContent = `남은 시간 ${(remMs / 1000).toFixed(1)}초`;
        if (remMs === 0 && !flushedAtEnd) {
          flushedAtEnd = true;
          flushScoreToServer();
        }
      } else if (latestSnap.phase === 'settling') {
        playerTimer.textContent = '최종 기록 집계 중...';
        flushScoreToServer();
      } else if (latestSnap.phase === 'lobby') {
        playerTimer.textContent = '시작 대기 중';
      }
    }
    requestAnimationFrame(tickPlayerTimer);
  }
  requestAnimationFrame(tickPlayerTimer);

  // ------------------------------------------------------------
  // View Updates from Server State
  // ------------------------------------------------------------
  function updateViews() {
    if (!latestSnap) return;
    const c = latestSnap.config;
    const isGroup = c.mode === 'group';

    // Update join form dynamic elements
    groupSelectSection.classList.toggle('hidden', !isGroup);
    joinModeDesc.textContent = isGroup
      ? '앉아 계신 조를 선택하고 성함을 입력해 주세요.'
      : '개인전 모드입니다. 성함을 입력하고 바로 입장해 주세요!';

    if (isGroup && renderedGroupCount !== c.groupCount) {
      renderGroupButtons(c.groupCount);
    }

    // Check ifserver cleared players (e.g. kick_all)
    if (joinedServer && !latestSnap.me) {
      joinedServer = false;
    }

    const showJoin = !joinedServer || editingProfile;
    joinView.classList.toggle('hidden', !showJoin);
    editProfileBtn.classList.toggle('hidden', showJoin || latestSnap.phase === 'playing' || latestSnap.phase === 'settling');
    myProfileBadge.classList.toggle('hidden', showJoin);

    if (showJoin) {
      arenaView.classList.add('hidden');
      resultView.classList.add('hidden');
      return;
    }

    const me = latestSnap.me;
    const fullName = me.school ? `${me.school} ${me.name}` : me.name;
    myProfileBadge.textContent = isGroup ? `${me.group}조 · ${fullName}` : fullName;

    if (latestSnap.phase === 'ended') {
      arenaView.classList.add('hidden');
      resultView.classList.remove('hidden');
      renderResultScreen(latestSnap, me);
    } else {
      resultView.classList.add('hidden');
      arenaView.classList.remove('hidden');
      renderArenaScreen(latestSnap, me);
    }
  }

  function renderArenaScreen(snap, me) {
    const isPlaying = snap.phase === 'playing' || snap.phase === 'countdown' || snap.phase === 'settling';
    statusCard.classList.toggle('live-playing', isPlaying);

    if (snap.phase === 'lobby') {
      phasePill.textContent = '🖐 손 풀기 연습 모드';
      scoreCaption.textContent = '연습 타수';
      myScoreNum.textContent = practiceScore;
      myRankLine.textContent =
        snap.config.mode === 'group'
          ? `${me.group}조 입장 완료! 사회자 시작 신호를 기다려 주세요.`
          : `개인전 입장 완료! 사회자 시작 신호를 기다려 주세요.`;
      guideHintLine.innerHTML =
        '노트북은 <strong>◀ · ▶ 방향키</strong>, 휴대폰은 <strong>아래 청·백 버튼</strong>을 번갈아 눌러 연습해 보세요!';
    } else {
      phasePill.textContent = snap.phase === 'settling' ? '⏳ 최종 기록 집계 중...' : '🔥 본 경기 진행 중! 박을 터뜨려라!';
      scoreCaption.textContent = '내 타격';
      liveScore = Math.max(liveScore, me.score || 0);
      myScoreNum.textContent = liveScore;

      if (snap.config.mode === 'group') {
        const rankTxt = me.myRank ? `현재 우리 ${me.group}조 ${me.myRank}위` : `${me.group}조 응원 참여 중`;
        myRankLine.textContent = `${rankTxt} (조 합산 ${me.myGroupScore}타)`;
        guideHintLine.innerHTML = `각 조 상위 ${snap.config.topN}명 기록 합산! 끝까지 힘차게 눌러주세요!`;
      } else {
        const rankTxt = me.myRank ? `현재 개인 ${me.myRank}위` : '열정 참여 중';
        const goalTxt =
          liveScore >= snap.config.targetTouches
            ? `✅ 완주 목표(${snap.config.targetTouches}타) 달성!`
            : `완주 목표까지 ${snap.config.targetTouches - liveScore}타 남음`;
        myRankLine.textContent = rankTxt;
        guideHintLine.textContent = goalTxt;
      }
    }
  }

  function renderResultScreen(snap, me) {
    const res = snap.resultSummary;
    const fullName = me.school ? `${me.school} ${me.name}` : me.name;
    // Use authoritative server score so player screen & projector screen always match 100%
    const finalScore = me.score !== undefined ? me.score : liveScore;
    liveScore = finalScore;

    if (me.isWinner) {
      winnerCertCard.classList.remove('hidden');
      nonWinnerCard.classList.add('hidden');

      certPrizeTitle.textContent = res ? res.prizeTitle : snap.config.prizeTitle;
      certUserGroup.textContent =
        snap.config.mode === 'group' ? `🎊 ${me.group}조 전원 경품 당첨! 🎊` : `🎊 개인전 영광의 주인공! 🎊`;
      certUserName.textContent = `${fullName} 선생님`;
      winnerMyRecord.textContent = `내 타격 기록: ${finalScore}타`;

      const winKey = `${snap.roundNumber}_${res ? res.prizeTitle : ''}_${res ? (res.winningPlayerNames || []).join(',') : ''}`;
      if (celebratedWinKey !== winKey) {
        celebratedWinKey = winKey;
        SoundFX.winChime();
      }
    } else {
      winnerCertCard.classList.add('hidden');
      nonWinnerCard.classList.remove('hidden');

      normalPrizeTitle.textContent = res ? res.prizeTitle : `${snap.roundNumber}라운드 결과`;
      if (res && res.mode === 'group') {
        const gText = res.winningGroupNums.length > 0 ? res.winningGroupNums.map(g => `${g}조`).join(', ') : '없음';
        normalWinnerAnnounce.textContent = `🏆 이번 라운드 우승: ${gText}`;
        normalMyStats.textContent = `우리 ${me.group}조 최종 순위: ${me.myRank ? `${me.myRank}위` : '-'} (내 기록: ${finalScore}타)`;
      } else if (res) {
        const pText = res.winningPlayerNames.length > 0 ? res.winningPlayerNames.join(', ') : '없음';
        normalWinnerAnnounce.textContent = `🏆 당첨자: ${pText}`;
        normalMyStats.textContent = `내 기록: ${finalScore}타 ${me.myRank ? `(개인 ${me.myRank}위)` : ''}`;
      }
    }
  }

  // ------------------------------------------------------------
  // SSE Connection
  // ------------------------------------------------------------
  function connectSse() {
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
    const q = profile.playerId ? `&playerId=${encodeURIComponent(profile.playerId)}` : '';
    eventSource = new EventSource(`/api/events?role=player${q}`);

    eventSource.addEventListener('state', ev => {
      const snap = JSON.parse(ev.data);
      serverClockOffset = snap.serverNow - Date.now();

      // Phase transition resets
      if (lastPhase !== snap.phase) {
        if (snap.phase === 'countdown') {
          liveScore = 0;
          lastSyncedScore = 0;
          flushedAtEnd = false;
          lastAcceptedSide = null;
          updateNextCueUI();
        } else if (snap.phase === 'lobby') {
          practiceScore = 0;
          liveScore = 0;
          lastSyncedScore = 0;
          flushedAtEnd = false;
          lastAcceptedSide = null;
          updateNextCueUI();
        } else if (snap.phase === 'settling') {
          flushScoreToServer();
        }
        lastPhase = snap.phase;
      }

      latestSnap = snap;
      updateViews();
    });
  }

  // Initial connect (and auto-rejoin if profile saved!)
  connectSse();
  if (profile.name && profile.playerId) {
    submitJoin(true);
  }
})();

