<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<title>Fast Access Challenge</title>
<link rel="stylesheet" href="style.css">
</head>
<body>

<!-- LOADING -->
<div id="screen-loading" class="screen active">
  <div class="loader-wrap">
    <div class="spinner"></div>
    <div class="loader-title">Fast Access Challenge</div>
    <div class="loader-sub" id="loading-msg">Connecting...</div>
  </div>
</div>

<!-- MENU -->
<div id="screen-menu" class="screen">
  <div class="menu-inner">
    <div class="game-title">⚡ Fast Access<br>Challenge</div>
    <div class="menu-subtitle">Multiplayer Brain Race</div>
    <button class="btn-main" id="btn-create">🏠 Create Room</button>
    <button class="btn-secondary" id="btn-join-open">🔗 Join Room</button>
    <div class="menu-foot">Up to 40 players • 5 levels • Real-time</div>
    <div class="qr-wrap">
      <div class="qr-label">Scan to join</div>
      <div id="qr-code"></div>
    </div>
  </div>
</div>

<!-- JOIN MODAL -->
<div id="modal-join" class="modal-overlay hidden">
  <div class="modal-box">
    <div class="modal-title">Join a Room</div>
    <input id="input-name" class="text-input" type="text" placeholder="Your name" maxlength="16" autocomplete="off">
    <input id="input-code" class="text-input" type="text" placeholder="Room code (e.g. AB12)" maxlength="6" autocomplete="off" style="text-transform:uppercase">
    <button class="btn-main" id="btn-join-confirm">Join</button>
    <button class="btn-ghost" id="btn-join-cancel">Cancel</button>
    <div class="modal-error hidden" id="join-error"></div>
  </div>
</div>

<!-- CREATE MODAL -->
<div id="modal-create" class="modal-overlay hidden">
  <div class="modal-box">
    <div class="modal-title">Create Room</div>
    <input id="input-host-name" class="text-input" type="text" placeholder="Your name" maxlength="16" autocomplete="off">
    <button class="btn-main" id="btn-create-confirm">Create</button>
    <button class="btn-ghost" id="btn-create-cancel">Cancel</button>
    <div class="modal-error hidden" id="create-error"></div>
  </div>
</div>

<!-- LOBBY -->
<div id="screen-lobby" class="screen">
  <div class="lobby-inner">
    <div class="lobby-header">
      <div class="lobby-title">Waiting Room</div>
      <div class="room-code-wrap">
        <span class="room-code-label">Room Code</span>
        <span class="room-code-val" id="lobby-room-code">----</span>
        <button class="btn-copy" id="btn-copy-code" title="Copy code">📋</button>
      </div>
    </div>
    <div class="player-list" id="lobby-player-list"></div>
    <div class="lobby-status" id="lobby-status">Waiting for players...</div>
    <div class="lobby-actions">
      <button class="btn-main hidden" id="btn-start-game">▶ Start Game</button>
      <button class="btn-ghost" id="btn-leave-lobby">Leave</button>
    </div>
  </div>
</div>

<!-- COUNTDOWN OVERLAY -->
<div id="countdown-overlay" class="fullscreen-overlay hidden">
  <div class="countdown-num" id="countdown-num">3</div>
</div>

<!-- LEVEL 1 — COLOUR SORTING -->
<div id="screen-level1" class="screen">
  <div class="game-screen-inner">
    <div class="game-hud">
      <div class="hud-info">
        <span class="hud-level">🎨 Level 1</span>
        <span class="hud-round" id="l1-round">1/5</span>
      </div>
      <div class="hud-timer-wrap">
        <div class="hud-timer" id="l1-timer">14</div>
        <div class="timer-bar-wrap"><div class="timer-bar" id="l1-timer-bar"></div></div>
      </div>
      <button class="btn-mute" id="mute-btn-l1">🎵</button>
    </div>
    <div class="level-desc">Find the <strong>odd colour</strong>!</div>
    <div id="color-grid" class="color-grid"></div>
    <div class="live-scores" id="l1-scores"></div>
  </div>
</div>

<!-- LEVEL 2 — DYSLEXIA CHALLENGE -->
<div id="screen-level2" class="screen">
  <div class="game-screen-inner">
    <div class="game-hud">
      <div class="hud-info">
        <span class="hud-level">📝 Level 2</span>
        <span class="hud-round" id="l2-round">1/7</span>
      </div>
      <div class="hud-timer-wrap">
        <div class="hud-timer" id="l2-timer">12</div>
        <div class="timer-bar-wrap"><div class="timer-bar" id="l2-timer-bar"></div></div>
      </div>
      <button class="btn-mute" id="mute-btn-l2">🎵</button>
    </div>
    <div class="level-desc" id="word-prompt">Which is spelled correctly?</div>
    <div class="word-options" id="word-options"></div>
    <div class="live-scores" id="l2-scores"></div>
  </div>
</div>

<!-- LEVEL 3 — MOVING FRUITS -->
<div id="screen-level3" class="screen">
  <div class="game-screen-inner">
    <div class="game-hud">
      <div class="hud-info">
        <span class="hud-level">🍎 Level 3</span>
        <span class="hud-round" id="l3-round">1/5</span>
      </div>
      <div class="hud-timer-wrap">
        <div class="hud-timer" id="l3-timer">16</div>
        <div class="timer-bar-wrap"><div class="timer-bar" id="l3-timer-bar"></div></div>
      </div>
      <button class="btn-mute" id="mute-btn-l3">🎵</button>
    </div>
    <div class="target-display">
      <span class="target-label">Tap all:</span>
      <span class="target-fruit" id="l3-target">🍎</span>
      <span class="hit-count" id="l3-hits">0/5</span>
    </div>
    <div id="l3-arena" class="fruit-arena"></div>
    <div class="live-scores" id="l3-scores"></div>
  </div>
</div>

<!-- LEVEL 4 — MEMORY FLASH -->
<div id="screen-level4" class="screen">
  <div class="game-screen-inner">
    <div class="game-hud">
      <div class="hud-info">
        <span class="hud-level">🧠 Level 4</span>
        <span class="hud-round" id="l4-round">1/5</span>
      </div>
      <div class="hud-timer-wrap">
        <div class="hud-timer" id="l4-timer">10</div>
        <div class="timer-bar-wrap"><div class="timer-bar" id="l4-timer-bar"></div></div>
      </div>
      <button class="btn-mute" id="mute-btn-l4">🎵</button>
    </div>
    <div class="level-desc" id="l4-prompt">Memorise this sequence!</div>
    <div class="flash-bar-wrap"><div class="flash-bar" id="l4-flash-bar"></div></div>
    <div id="l4-sequence-display" class="mem-sequence"></div>
    <div id="l4-slots" class="mem-slots"></div>
    <div id="l4-input-area" class="mem-input"></div>
    <div id="l4-feedback" class="l4-feedback"></div>
    <div class="live-scores" id="l4-scores"></div>
  </div>
</div>

<!-- LEVEL 5 — MIX OF ALL -->
<div id="screen-level5" class="screen">
  <div class="game-screen-inner">
    <div class="game-hud">
      <div class="hud-info">
        <span class="hud-level">🌀 Level 5</span>
        <span class="hud-round" id="l5-round">1/8</span>
      </div>
      <div class="hud-timer-wrap">
        <div class="hud-timer" id="l5-timer">12</div>
        <div class="timer-bar-wrap"><div class="timer-bar" id="l5-timer-bar"></div></div>
      </div>
      <button class="btn-mute" id="mute-btn-l5">🎵</button>
    </div>
    <div class="l5-type-label" id="l5-type-label"></div>
    <div id="l5-fruit-target-wrap" class="target-display hidden">
      <span class="target-label">Tap all:</span>
      <span class="target-fruit" id="l5-fruit-target">🍎</span>
      <span class="hit-count" id="l5-fruit-hits">0/3</span>
    </div>
    <div id="l5-arena" class="l5-arena"></div>
    <div id="l5-feedback" class="l5-fb"></div>
    <div class="live-scores" id="l5-scores"></div>
  </div>
</div>

<!-- BETWEEN LEVELS -->
<div id="screen-between" class="screen">
  <div class="between-inner">
    <div class="between-title" id="between-title">Level Complete! 🎉</div>
    <div class="between-sub" id="between-sub">Leaderboard</div>
    <div class="leaderboard" id="leaderboard-between"></div>
    <div class="between-countdown" id="between-countdown"></div>
    <button class="btn-main hidden" id="btn-next-level">Next Level →</button>
  </div>
</div>

<!-- FINAL RESULTS -->
<div id="screen-results" class="screen">
  <div class="results-inner">
    <div class="results-title">🏆 Final Results</div>
    <div class="results-reveal-label">Revealing rankings...</div>
    <div class="podium" id="podium"></div>
    <div class="full-leaderboard" id="full-leaderboard"></div>
    <div class="results-actions" id="results-actions"></div>
  </div>
</div>

<!-- GAME OVER -->
<div id="screen-gameover" class="screen">
  <div class="gameover-inner">
    <div class="gameover-icon">💀</div>
    <div class="gameover-title">Time's Up!</div>
    <div class="gameover-sub" id="gameover-msg">All players timed out.</div>
    <div class="leaderboard" id="leaderboard-gameover"></div>
    <button class="btn-main hidden" id="btn-gameover-again">🔁 Play Again</button>
    <button class="btn-ghost" id="btn-gameover-menu">Main Menu</button>
  </div>
</div>

<!-- TOAST -->
<div id="toast" class="toast hidden"></div>

<!-- CONNECTION -->
<div id="conn-indicator" class="conn-indicator">
  <span class="conn-dot"></span>
  <span class="conn-label" id="conn-label">Connected</span>
</div>

<!-- LEVEL INTRO OVERLAY -->
<div id="level-intro-overlay" class="fullscreen-overlay hidden intro-overlay">
  <div class="intro-content">
    <div class="intro-emoji-big" id="intro-level-emoji">🎨</div>
    <div class="intro-level-num" id="intro-level-num">Level 1</div>
    <div class="intro-level-title" id="intro-level-title">Colour Vision</div>
    <div class="intro-level-sub" id="intro-level-sub">Find the odd colour!</div>
    <div class="intro-level-tip" id="intro-level-tip">💡 Look for the different shade.</div>
    <div class="intro-count" id="intro-countdown"></div>
  </div>
</div>

<!-- CHAMPION OVERLAY -->
<div id="champion-overlay" class="fullscreen-overlay hidden champion-overlay">
  <div class="champion-content">
    <div class="champion-suspense">🥁 And the winner is...</div>
    <div class="champion-trophy">🏆</div>
    <div class="champion-crown">👑</div>
    <div class="champion-title">CHAMPION</div>
    <div class="champion-name" id="champion-name"></div>
    <div class="champion-score" id="champion-score"></div>
    <button class="btn-main champion-close-btn" onclick="document.getElementById('champion-overlay').classList.add('hidden');document.getElementById('full-leaderboard').scrollIntoView({behavior:'smooth'})">🏆 See Full Results</button>
  </div>
</div>

<script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
<script>
  new QRCode(document.getElementById('qr-code'), {
    text: 'https://fast-access-challenge-m3n6.vercel.app/',
    width: 140, height: 140,
    colorDark: '#ffffff', colorLight: '#12122a',
    correctLevel: QRCode.CorrectLevel.M
  });
</script>
<script type="module" src="app.js"></script>
</body>
</html>
