
(function () {
  const d = window.__MATCH__;
  if (!d) return;
  const board = document.getElementById('board');
  const toggle = document.getElementById('toggle');
  const restart = document.getElementById('restart');
  const duelEl = document.getElementById('duel');
  const hpEl = document.getElementById('hp');
  const ctxEl = document.getElementById('context');
  const state = { frame: 0, timer: null, playing: false };

  function draw() {
    const m = d.map, f = d.frames[state.frame];
    if (!f) return;
    const cell = Math.floor(Math.min(320 / m.width, 320 / m.height));
    board.width = m.width * cell;
    board.height = m.height * cell;
    const ctx = board.getContext('2d');
    ctx.fillStyle = '#06060f';
    ctx.fillRect(0, 0, board.width, board.height);
    ctx.strokeStyle = 'rgba(0,255,136,0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 1; i < m.width; i++) { ctx.moveTo(i * cell + .5, 0); ctx.lineTo(i * cell + .5, board.height); }
    for (let j = 1; j < m.height; j++) { ctx.moveTo(0, j * cell + .5); ctx.lineTo(board.width, j * cell + .5); }
    ctx.stroke();
    ctx.fillStyle = '#17242e';
    for (const [x, y] of m.obstacles) ctx.fillRect(x * cell, y * cell, cell - 1, cell - 1);
    for (const [p, on, off] of [[f.a, '#00ff88', '#2a5a44'], [f.b, '#ff4466', '#5a2a36']]) {
      ctx.fillStyle = p.alive ? on : off;
      ctx.fillRect(p.x * cell + 1, p.y * cell + 1, cell - 2, cell - 2);
    }
    hpEl.textContent = 'HP ' + f.a.hp + ' / ' + f.b.hp + ' · tick ' + f.t + ' · ' + (state.frame + 1) + '/' + d.frames.length;
  }

  function stop() { clearInterval(state.timer); state.timer = null; state.playing = false; toggle.textContent = 'Play'; }

  function play() {
    stop();
    if (state.frame >= d.frames.length - 1) state.frame = 0;
    state.playing = true;
    toggle.textContent = 'Pause';
    state.timer = setInterval(() => {
      if (state.frame >= d.frames.length - 1) { stop(); return; }
      state.frame++;
      draw();
    }, 100);
  }

  const a = document.createElement('span');
  a.className = d.winner === 'A' ? 'win' : '';
  a.textContent = '◆ ' + d.a;
  const vs = document.createElement('span');
  vs.textContent = d.winner === 'draw' ? '  draw  ' : '  vs  ';
  const b = document.createElement('span');
  b.className = d.winner === 'B' ? 'win' : '';
  b.textContent = d.b + ' ◇';
  duelEl.append(a, vs, b);
  ctxEl.textContent = d.ticks + ' ticks · ' + d.map.name + ' · ' + (d.winner === 'draw' ? 'draw' : d.winner + ' wins');

  toggle.addEventListener('click', () => (state.playing ? stop() : play()));
  if (restart) restart.addEventListener('click', () => { state.frame = 0; draw(); play(); });
  draw();
  play();
})();
