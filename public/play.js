(function () {
  const STORAGE_KEY = 'raffle_player_profile_v1';

  // DOM References
  const fxCanvas = document.getElementById('playerFxCanvas');
  const fxCtx = fxCanvas.getContext('2d');

  const myProfileBadge = document.getElementById('myProfileBadge');
  const feverBadge = document.getElementById('feverBadge');
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
  const playerTimerMobile = document.getElementById('playerTimerMobile');
  const scoreCaption = document.getElementById('scoreCaption');
  const myScoreNum = document.getElementById('myScoreNum');
  const myRankLine = document.getElementById('myRankLine');
  const guideHintLine = document.getElementById('guideHintLine');

  const miniGourdBall = document.getElementById('miniGourdBall');
  const feverLevelText = document.getElementById('feverLevelText');
  const blueCheerWing = document.getElementById('blueCheerWing');
  const whiteCheerWing = document.getElementById('whiteCheerWing');
  const blueBubble = document.getElementById('blueBubble');
  const whiteBubble = document.getElementById('whiteBubble');

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

  // Cheer Chants by Fever Tier
  const BLUE_CHANTS_BASE = ['영차! 💙', '청군 파이팅!', '잘한다!!', '힘차게 휙!', '가즈아! ◀'];
  const WHITE_CHANTS_BASE = ['으랏차! 🤍', '백군 파이팅!', '나이스!!', '좋아요 휙!', '최고다! ▶'];
  const CHANTS_FEVER_1 = ['열정 폭발! 🔥', '손놀림 번개! ⚡', '기세 최고!!', '선생님 멋져요!'];
  const CHANTS_FEVER_2 = ['초고속 질주!! 🔥🔥', '우승 예감!! 🏆', '못 말린다!! ⚡', '박 갈라진다!!'];
  const CHANTS_FEVER_3 = ['전설의 타격!! 👑', '신기록 탄생!! 🎉', '완전 대박!! 💥', '교장·교감쌤 최고!! 🏆'];

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
  let bluePopTimer = null;
  let whitePopTimer = null;
  let gourdPopTimer = null;
  let celebratedWinKey = '';
  let blueChantIdx = 0;
  let whiteChantIdx = 0;

  // ------------------------------------------------------------
  // Canvas FX: Flying Beanbags from Cheer Squads -> Mini Gourd + Fever Sparks
  // ------------------------------------------------------------
  const flyingBags = [];
  const sparks = [];

  function resizeFxCanvas() {
    fxCanvas.width = window.innerWidth;
    fxCanvas.height = window.innerHeight;
  }
  window.addEventListener('resize', resizeFxCanvas);
  resizeFxCanvas();

  function launchCheerBeanbag(side, feverTier) {
    const wingEl = side === 'left' ? blueCheerWing : whiteCheerWing;
    const gourdEl = miniGourdBall;
    if (!wingEl || !gourdEl) return;

    const wRect = wingEl.getBoundingClientRect();
    const gRect = gourdEl.getBoundingClientRect();
    if (wRect.width === 0 || gRect.width === 0) return;

    const sx = wRect.left + wRect.width * 0.5 + (Math.random() - 0.5) * 30;
    const sy = wRect.top + wRect.height * 0.48;
    const tx = gRect.left + gRect.width * 0.5 + (Math.random() - 0.5) * 16;
    const ty = gRect.top + gRect.height * 0.5 + (Math.random() - 0.5) * 12;

    flyingBags.push({
      sx,
      sy,
      tx,
      ty,
      t: 0,
      speed: 0.085 + Math.random() * 0.025,
      side,
      feverTier
    });

    // Spawn extra cheer sparks around the cheering squad during Fever!
    if (feverTier >= 1) {
      const sparkCount = feverTier * 4;
      const colors = feverTier >= 3
        ? ['#fde047', '#f59e0b', '#f43f5e', '#38bdf8', '#a855f7']
        : feverTier === 2
        ? ['#fbbf24', '#f97316', '#ef4444']
        : ['#60a5fa', '#fde047', '#ffffff'];

      for (let i = 0; i < sparkCount; i++) {
        sparks.push({
          x: sx + (Math.random() - 0.5) * 90,
          y: sy + (Math.random() - 0.5) * 60,
          vx: (Math.random() - 0.5) * 6,
          vy: -2.5 - Math.random() * 4.5,
          r: 3 + Math.random() * 4,
          color: colors[i % colors.length],
          life: 1
        });
      }
    }
  }

  function spawnMiniGourdImpact(x, y, side, feverTier) {
    miniGourdBall.classList.add('hit-pop');
    if (gourdPopTimer) clearTimeout(gourdPopTimer);
    gourdPopTimer = setTimeout(() => miniGourdBall.classList.remove('hit-pop'), 90);

    const count = 4 + feverTier * 2;
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + Math.random() * 0.4;
      const spd = 2 + Math.random() * 3.5;
      sparks.push({
        x,
        y,
        vx: Math.cos(angle) * spd,
        vy: Math.sin(angle) * spd,
        r: 2.5 + Math.random() * 3,
        color: feverTier >= 2 ? '#fbbf24' : side === 'left' ? '#60a5fa' : '#ffffff',
        life: 0.9
      });
    }
  }

  function getFeverTier(score) {
    if (score >= 90) return 3;
    if (score >= 60) return 2;
    if (score >= 30) return 1;
    return 0;
  }

  function applyFeverVisuals(score) {
    const tier = getFeverTier(score);
    [blueCheerWing, whiteCheerWing].forEach(w => {
      if (!w) return;
      w.classList.toggle('fever-1', tier === 1);
      w.classList.toggle('fever-2', tier === 2);
      w.classList.toggle('fever-3', tier >= 3);
    });

    document.body.classList.toggle('fever-lv2', tier === 2);
    document.body.classList.toggle('fever-lv3', tier >= 3);

    if (tier === 0) {
      feverBadge.classList.add('hidden');
      feverLevelText.textContent = '박을 맞춰라!';
    } else if (tier === 1) {
      feverBadge.classList.remove('hidden');
      feverBadge.textContent = '🔥 FEVER Lv.1';
      feverLevelText.textContent = '🔥 열정 점화!';
    } else if (tier === 2) {
      feverBadge.classList.remove('hidden');
      feverBadge.textContent = '🔥🔥 FEVER Lv.2';
      feverLevelText.textContent = '⚡ 초고속 질주!';
    } else {
      feverBadge.classList.remove('hidden');
      feverBadge.textContent = '👑 MAX FEVER!!';
      feverLevelText.textContent = '👑 전설의 손놀림!';
    }
  }

  function triggerCheerReaction(side, currentCount) {
    const tier = getFeverTier(currentCount);
    let chant = '';

    if (tier === 3) {
      chant = CHANTS_FEVER_3[currentCount % CHANTS_FEVER_3.length];
    } else if (tier === 2) {
      chant = CHANTS_FEVER_2[currentCount % CHANTS_FEVER_2.length];
    } else if (tier === 1 && currentCount % 2 === 0) {
      chant = CHANTS_FEVER_1[(currentCount >> 1) % CHANTS_FEVER_1.length];
    } else if (side === 'left') {
      chant = BLUE_CHANTS_BASE[blueChantIdx++ % BLUE_CHANTS_BASE.length];
    } else {
      chant = WHITE_CHANTS_BASE[whiteChantIdx++ % WHITE_CHANTS_BASE.length];
    }

    if (side === 'left') {
      blueBubble.textContent = chant;
      blueCheerWing.classList.add('cheer-pop');
      if (bluePopTimer) clearTimeout(bluePopTimer);
      bluePopTimer = setTimeout(() => blueCheerWing.classList.remove('cheer-pop'), 145);
    } else {
      whiteBubble.textContent = chant;
      whiteCheerWing.classList.add('cheer-pop');
      if (whitePopTimer) clearTimeout(whitePopTimer);
      whitePopTimer = setTimeout(() => whiteCheerWing.classList.remove('cheer-pop'), 145);
    }

    applyFeverVisuals(currentCount);
    launchCheerBeanbag(side, tier);
  }

  function resetCheerState() {
    applyFeverVisuals(0);
    blueBubble.textContent = '청군 준비 완료!';
    whiteBubble.textContent = '백군 준비 완료!';
    blueCheerWing.classList.remove('cheer-pop');
    whiteCheerWing.classList.remove('cheer-pop');
  }

  // Unified Animation Loop (FX Canvas + Live Countdown/Timer)
  function animationFrameLoop() {
    fxCtx.clearRect(0, 0, fxCanvas.width, fxCanvas.height);

    // Draw flying beanbags
    for (let i = flyingBags.length - 1; i >= 0; i--) {
      const b = flyingBags[i];
      b.t += b.speed;
      if (b.t >= 1) {
        spawnMiniGourdImpact(b.tx, b.ty, b.side, b.feverTier);
        flyingBags.splice(i, 1);
        continue;
      }

      const x = b.sx + (b.tx - b.sx) * b.t;
      const arc = Math.sin(b.t * Math.PI) * 75;
      const y = b.sy + (b.ty - b.sy) * b.t - arc;

      fxCtx.save();
      // Golden trail in Fever mode
      if (b.feverTier >= 1) {
        fxCtx.beginPath();
        fxCtx.arc(x, y, 13, 0, Math.PI * 2);
        fxCtx.fillStyle = b.feverTier >= 2 ? 'rgba(251, 191, 36, 0.45)' : 'rgba(96, 165, 250, 0.35)';
        fxCtx.fill();
      }
      fxCtx.beginPath();
      fxCtx.arc(x, y, 9, 0, Math.PI * 2);
      fxCtx.fillStyle = b.side === 'left' ? '#3b82f6' : '#ffffff';
      fxCtx.fill();
      fxCtx.lineWidth = 2.5;
      fxCtx.strokeStyle = b.feverTier >= 2 ? '#f59e0b' : b.side === 'left' ? '#1e3a8a' : '#e11d48';
      fxCtx.stroke();
      fxCtx.restore();
    }

    // Draw sparks
    for (let i = sparks.length - 1; i >= 0; i--) {
      const s = sparks[i];
      s.x += s.vx;
      s.y += s.vy;
      s.vy += 0.14;
      s.life -= 0.045;
      if (s.life <= 0) {
        sparks.splice(i, 1);
        continue;
      }
      fxCtx.save();
      fxCtx.globalAlpha = Math.max(0, s.life);
      fxCtx.beginPath();
      fxCtx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      fxCtx.fillStyle = s.color;
      fxCtx.fill();
      fxCtx.restore();
    }

    tickPlayerTimer();
    requestAnimationFrame(animationFrameLoop);
  }

  // ------------------------------------------------------------
  // Profile Storage & Group Selector
  // ------------------------------------------------------------
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
    toastTimer = setTimeout(() => toastMsg.classList.add('hidden'), 1400);
  }

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
      triggerCheerReaction(side, practiceScore);
    } else if (latestSnap.phase === 'playing') {
      liveScore++;
      myScoreNum.textContent = liveScore;
      triggerCheerReaction(side, liveScore);
    }
  }

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

  leftPadBtn.addEventListener('pointerdown', e => {
    e.preventDefault();
    handleActionInput('left');
  });
  rightPadBtn.addEventListener('pointerdown', e => {
    e.preventDefault();
    handleActionInput('right');
  });

  document.addEventListener('dblclick', e => {
    if (joinedServer && !editingProfile) e.preventDefault();
  }, { passive: false });

  // ------------------------------------------------------------
  // Guaranteed Score Sync to Server
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
      // Retry automatically
    } finally {
      syncInFlight = false;
      if (liveScore > lastSyncedScore && latestSnap && (latestSnap.phase === 'playing' || latestSnap.phase === 'settling')) {
        flushScoreToServer();
      }
    }
  }

  setInterval(flushScoreToServer, 120);

  function setTimerTexts(txt) {
    playerTimer.textContent = txt;
    if (playerTimerMobile) playerTimerMobile.textContent = txt;
  }

  function tickPlayerTimer() {
    if (!latestSnap) return;
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
      setTimerTexts(`남은 시간 ${(remMs / 1000).toFixed(1)}초`);
      if (remMs === 0 && !flushedAtEnd) {
        flushedAtEnd = true;
        flushScoreToServer();
      }
    } else if (latestSnap.phase === 'settling') {
      setTimerTexts('최종 기록 집계 중...');
      flushScoreToServer();
    } else if (latestSnap.phase === 'lobby') {
      setTimerTexts('시작 대기 중');
    }
  }

  // Start unified loop
  requestAnimationFrame(animationFrameLoop);

  // ------------------------------------------------------------
  // View Updates from Server State
  // ------------------------------------------------------------
  function updateViews() {
    if (!latestSnap) return;
    const c = latestSnap.config;
    const isGroup = c.mode === 'group';

    groupSelectSection.classList.toggle('hidden', !isGroup);
    joinModeDesc.textContent = isGroup
      ? '앉아 계신 조를 선택하고 성함을 입력해 주세요.'
      : '개인전 모드입니다. 성함을 입력하고 바로 입장해 주세요!';

    if (isGroup && renderedGroupCount !== c.groupCount) {
      renderGroupButtons(c.groupCount);
    }

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
      feverBadge.classList.add('hidden');
      document.body.classList.remove('fever-lv2', 'fever-lv3');
      return;
    }

    const me = latestSnap.me;
    const fullName = me.school ? `${me.school} ${me.name}` : me.name;
    myProfileBadge.textContent = isGroup ? `${me.group}조 · ${fullName}` : fullName;

    if (latestSnap.phase === 'ended') {
      arenaView.classList.add('hidden');
      resultView.classList.remove('hidden');
      feverBadge.classList.add('hidden');
      document.body.classList.remove('fever-lv2', 'fever-lv3');
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
        '노트북 <strong>◀ · ▶ 방향키</strong>나 화면 버튼을 눌러 좌·우 응원단과 함께 연습해 보세요!';
    } else {
      phasePill.textContent = snap.phase === 'settling' ? '⏳ 최종 기록 집계 중...' : '🔥 본 경기 진행 중! 박을 터뜨려라!';
      scoreCaption.textContent = '내 타격';
      liveScore = Math.max(liveScore, me.score || 0);
      myScoreNum.textContent = liveScore;

      if (snap.config.mode === 'group') {
        const rankTxt = me.myRank ? `현재 우리 ${me.group}조 ${me.myRank}위` : `${me.group}조 응원 참여 중`;
        myRankLine.textContent = `${rankTxt} (조 합산 ${me.myGroupScore}타)`;
        guideHintLine.innerHTML = `각 조 상위 ${snap.config.topN}명 기록 합산! 응원단과 함께 힘차게 눌러주세요!`;
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

      if (lastPhase !== snap.phase) {
        if (snap.phase === 'countdown') {
          liveScore = 0;
          lastSyncedScore = 0;
          flushedAtEnd = false;
          lastAcceptedSide = null;
          resetCheerState();
          updateNextCueUI();
        } else if (snap.phase === 'lobby') {
          practiceScore = 0;
          liveScore = 0;
          lastSyncedScore = 0;
          flushedAtEnd = false;
          lastAcceptedSide = null;
          resetCheerState();
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

  connectSse();
  if (profile.name && profile.playerId) {
    submitJoin(true);
  }
})();
