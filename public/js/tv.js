(() => {
  const socket = io({ reconnectionDelay: 500 });
  const stages = { lobby: 'st-lobby', countdown: 'st-count', question: 'st-q', reveal: 'st-q', podium: 'st-podium' };
  const CIRC = 427;
  let lastQ = -1, lastPhase = '', total = 12;

  fetch('/api/info').then(r => r.json()).then(i => {
    $('url').textContent = i.url.replace('http://', '');
    if (i.qr) $('qr').src = i.qr; else $('qr').classList.add('hidden');
  }).catch(() => {});

  function renderTop(list) {
    $('top-list').innerHTML = list.length
      ? list.map(e => `<li><span class="n">${esc(e.nick)}</span><span class="s">${e.score}</span></li>`).join('')
      : '<p class="empty">Aún no hay puntajes.<br>¡Sé el primero!</p>';
  }

  function renderSlots(s) {
    let h = '';
    for (let i = 0; i < s.max; i++) {
      const p = s.players[i];
      h += p ? `<div class="slot full ${p.connected ? '' : 'off'}">${esc(p.nick)}</div>` : `<div class="slot">Esperando…</div>`;
    }
    $('slots').innerHTML = h;
  }

  function setClock(t) {
    $('clock-num').textContent = t;
    const fg = $('clock-fg');
    fg.style.strokeDashoffset = CIRC * (1 - t / total);
    fg.classList.toggle('low', t <= 3);
  }

  function renderQuestion(s) {
    total = s.questionTime;
    $('q-count').textContent = `Pregunta ${s.qIndex + 1}/${s.total}`;
    $('q-text').textContent = s.question.text;
    $('opts').innerHTML = s.question.options.map((o, i) =>
      `<div class="opt o${i}">${ICONS[i]}<span>${esc(o)}</span></div>`).join('');
    const fg = $('clock-fg');
    fg.style.transition = 'none'; fg.style.strokeDashoffset = 0; void fg.getBoundingClientRect(); fg.style.transition = '';
  }

  function renderAnswered(s) {
    $('answered').innerHTML = s.players.map(p =>
      `<span class="chip ${p.answered ? 'done' : ''} ${p.connected ? '' : 'off'}">${esc(p.nick)} ${p.answered ? '🔒' : '🤔'}</span>`).join('');
  }

  function renderPodium(s) {
    const order = [1, 0, 2]; // visual: 2º, 1º, 3º
    $('podium').innerHTML = order.map(i => s.ranking[i] ? `
      <div class="pod p${i + 1}">
        ${i === 0 ? '<img class="mascot-win" src="/assets/robot-win.png" alt="Ganador">' : ''}
        <div class="name">${esc(s.ranking[i].nick)}</div>
        <div class="pts">${s.ranking[i].score} pts</div>
        <div class="block">${i + 1}</div>
      </div>` : '').join('');
    confetti();
  }

  function confetti() {
    const colors = ['#e21b3c', '#1368ce', '#ffa602', '#3ab514', '#8b3dff', '#fff'];
    for (let i = 0; i < 90; i++) {
      const c = document.createElement('div');
      c.className = 'confetti';
      c.style.left = Math.random() * 100 + 'vw';
      c.style.background = colors[i % colors.length];
      c.style.animationDuration = 2.5 + Math.random() * 3 + 's';
      c.style.animationDelay = Math.random() * 1.5 + 's';
      document.body.appendChild(c);
      setTimeout(() => c.remove(), 8000);
    }
  }

  socket.on('state', s => {
    renderTop(s.top10);
    Object.values(stages).forEach(id => $(id).classList.toggle('hidden', id !== stages[s.phase]));

    if (s.phase === 'lobby') renderSlots(s);
    if (s.phase === 'countdown') {
      const n = $('count-num'); n.textContent = s.countdown;
      n.style.animation = 'none'; void n.offsetWidth; n.style.animation = '';
    }
    if (s.phase === 'question' || s.phase === 'reveal') {
      if (s.qIndex !== lastQ) { lastQ = s.qIndex; renderQuestion(s); }
      setClock(s.remaining);
      renderAnswered(s);
      document.querySelectorAll('.opt').forEach((el, i) => {
        el.classList.toggle('right', s.correctIndex === i);
        el.classList.toggle('dim', s.correctIndex !== null && s.correctIndex !== i);
      });
    } else lastQ = -1;
    if (s.phase === 'podium' && lastPhase !== 'podium') renderPodium(s);
    lastPhase = s.phase;
  });
  socket.on('tick', setClock);
})();
