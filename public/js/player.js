(() => {
  // El socket NO se conecta hasta que el usuario pulsa "Unirse a la trivia"
  // (o hasta que haya una sesión previa guardada para reconectar).
  const socket = io({ reconnectionDelay: 500, autoConnect: false });
  const screens = ['hub', 'join', 'lobby', 'count', 'game', 'end'];
  const show = name => {
    screens.forEach(s => $('screen-' + s).classList.toggle('hidden', s !== name));
    $('game-bar').classList.toggle('hidden', !me || name === 'hub' || name === 'join');
  };

  let me = null;          // {id, token, nick}
  let myScore = 0;
  let pickedIdx = null;
  let lastKey = '';
  let flashTimer = null;

  // ───── Portal: acordeón y malla curricular ─────
  const MALLA = [
    ['Semestre 1', ['Lógica y Matemática Discreta', 'Geometría Analítica y Vectores', 'Organización y Arquitectura de Computadoras', 'Lenguajes de Programación 1', 'Algoritmos y Estructura de Datos 1', 'Comunicación Oral y Escrita']],
    ['Semestre 2', ['Álgebra Lineal', 'Cálculo de una Variable', 'Lenguajes de Programación 2', 'Algoritmos y Estructura de Datos 2', 'Inglés Profesional', 'Optativa 1']],
    ['Semestre 3', ['Cálculo de Varias Variables', 'Fundamentos de Mecánica', 'Sistemas Operativos', 'Lenguajes de Programación 3', 'Algoritmos y Estructura de Datos 3', 'Optativa 2']],
    ['Semestre 4', ['Ecuaciones Diferenciales', 'Física para Informática', 'Redes de Computadoras', 'Ingeniería de Software 1', 'Programación de Aplicaciones 1', 'Bases de Datos 1']],
    ['Semestre 5', ['Estadística y Probabilidad', 'Dirección y Organización Empresarial', 'Seguridad Informática', 'Programación de Aplicaciones 2', 'Bases de Datos 2', 'Algoritmos Numéricos']],
    ['Semestre 6', ['Modelos estadísticos', 'Programación de Aplicaciones 3', 'Estructura de Lenguajes de Programación', 'Bases de Datos Avanzadas', 'Emprendimientos en TI', 'Economía y Finanzas']],
    ['Semestre 7', ['Infraestructuras Avanzadas', 'Fundamentos de IA', 'Ingeniería de Software 2', 'Diseño de Compiladores', 'Optimización e Investigación de Operaciones 1']],
    ['Semestre 8', ['Aprendizaje de Máquina', 'Minería de Datos', 'Optimización e Investigación de Operaciones 2', 'Proyecto Integrador de Desarrollo', 'Electiva 1']],
    ['Semestre 9', ['Programación Paralela', 'Ciencia de Datos', 'Estrategias de Planificación y Búsqueda', 'Electiva 2', 'Electiva 3']],
    ['Semestre 10 y 11', ['Electiva 4', 'Anteproyecto de Trabajo de Grado', 'Trabajo de Grado']]
  ];
  // Clasificación por palabras clave: matemática / programación / hardware-redes
  const kind = n => {
    const s = n.toLowerCase();
    if (/matem|geometr|lgebra|lculo|ecuaciones|estad|probab|modelos|num[eé]ric|optimizaci|f[ií]sica|mec[aá]nica/.test(s)) return 't-math';
    if (/organizaci[oó]n y arq|redes|operativos|seguridad|infraestructura/.test(s)) return 't-hw';
    if (/program|algoritmos|datos|software|compilad|lenguajes|ia$|aprendizaje|miner|ciencia de datos|planificaci|proyecto|trabajo de grado/.test(s)) return 't-prog';
    return 't-gen';
  };
  $('malla').innerHTML = MALLA.map(([sem, mats]) =>
    `<div class="sem"><button class="sem-head" type="button" aria-expanded="false"><span>${esc(sem)}</span><b class="chev">▾</b></button>` +
    `<div class="sem-body"><div class="sem-inner"><ul>${mats.map(m => `<li class="${kind(m)}">${esc(m)}</li>`).join('')}</ul></div></div></div>`
  ).join('');

  function toggle(el, headSel) {
    const open = el.classList.toggle('open');
    el.querySelector(headSel).setAttribute('aria-expanded', open);
    return open;
  }
  document.querySelectorAll('.acc > .acc-head').forEach(h => h.addEventListener('click', () => {
    const acc = h.parentElement;
    const willOpen = !acc.classList.contains('open');
    document.querySelectorAll('.acc.open').forEach(o => { if (o !== acc) toggle(o, '.acc-head'); }); // uno abierto a la vez
    toggle(acc, '.acc-head');
    if (willOpen) setTimeout(() => acc.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 380);
  }));
  $('malla').addEventListener('click', e => {
    const h = e.target.closest('.sem-head');
    if (h) toggle(h.parentElement, '.sem-head');
  });

  // ───── Entrar al juego ─────
  $('btn-play').addEventListener('click', () => {
    if (!socket.connected && !socket.active) socket.connect();
    show('join');
    setTimeout(() => $('nick').focus(), 300);
  });
  $('btn-back').addEventListener('click', () => { $('join-err').textContent = ''; show('hub'); });
  $('nick').addEventListener('keydown', e => e.stopPropagation());

  // Construir gamepad una sola vez
  $('pad').innerHTML = ICONS.map((ic, i) => `<button class="ans ans-${i}" data-i="${i}" aria-label="Opción ${i + 1}">${ic}</button>`).join('');
  $('pad').addEventListener('click', e => {
    const b = e.target.closest('.ans');
    if (!b || pickedIdx !== null || b.disabled) return;
    pickedIdx = Number(b.dataset.i);
    if (navigator.vibrate) navigator.vibrate(40);
    lockPad(pickedIdx);
    socket.emit('answer', pickedIdx);
  });

  function lockPad(idx) {
    document.querySelectorAll('.ans').forEach(b => {
      b.classList.add('locked');
      b.classList.toggle('picked', Number(b.dataset.i) === idx);
    });
    $('wait-tag').classList.remove('hidden');
  }
  function unlockPad() {
    pickedIdx = null;
    document.querySelectorAll('.ans').forEach(b => b.classList.remove('locked', 'picked'));
    $('wait-tag').classList.add('hidden');
  }
  function hideFlash() { $('flash').classList.add('hidden'); clearTimeout(flashTimer); }

  function backToJoin(msg) {
    me = null; myScore = 0; pickedIdx = null; lastKey = '';
    sessionStorage.removeItem('token');
    hideFlash(); unlockPad();
    $('join-err').textContent = msg || '';
    $('join-btn').disabled = false;
    show('join');
  }

  // ── Conexión / reconexión ──
  socket.on('connect', () => {
    const t = sessionStorage.getItem('token');
    if (t) socket.emit('rejoin', t);
  });
  socket.on('rejoinFail', () => backToJoin());

  $('join-form').addEventListener('submit', e => {
    e.preventDefault();
    const nick = $('nick').value.trim();
    if (!nick) return;
    $('join-btn').disabled = true;
    socket.emit('join', nick);
  });
  socket.on('joinError', msg => { $('join-err').textContent = msg; $('join-btn').disabled = false; });
  socket.on('joined', p => {
    me = p; sessionStorage.setItem('token', p.token);
    $('bar-nick').textContent = p.nick;
    $('lobby-title').textContent = `¡Listo, ${p.nick}!`;
    show('lobby');
  });
  socket.on('kicked', msg => backToJoin(msg));

  // ── Estado del servidor ──
  socket.on('state', s => {
    if (!me) return;
    const mine = s.players.find(p => p.id === me.id);
    if (!mine) { if (s.phase === 'lobby' || s.phase === 'podium') return backToJoin(); return; }
    myScore = mine.score;
    $('hud-score').textContent = myScore;

    if (s.phase === 'lobby') {
      show('lobby');
      $('lobby-sub').textContent = `Jugadores: ${s.players.length}/${s.max} · esperando…`;
    } else if (s.phase === 'countdown') {
      show('count'); $('count-num').textContent = s.countdown;
      const n = $('count-num'); n.style.animation = 'none'; void n.offsetWidth; n.style.animation = '';
    } else if (s.phase === 'question') {
      const key = 'q' + s.qIndex;
      if (key !== lastKey) { lastKey = key; unlockPad(); hideFlash(); }
      if (mine.answered && pickedIdx === null) { /* reconexión: bloquear sin saber cuál */
        pickedIdx = -1; lockPad(-1);
      }
      $('hud-q').textContent = `${s.qIndex + 1}/${s.total}`;
      setTime(s.remaining);
      show('game');
    } else if (s.phase === 'reveal') {
      show('game');
    }
  });

  function setTime(t) {
    const el = $('hud-time');
    el.textContent = t;
    el.classList.toggle('low', t <= 3);
  }
  socket.on('tick', setTime);
  socket.on('locked', idx => { pickedIdx = idx; lockPad(idx); });

  socket.on('result', r => {
    myScore = r.score; $('hud-score').textContent = myScore;
    const f = $('flash');
    f.className = 'flash ' + (r.correct ? 'ok' : 'bad');
    f.innerHTML = r.correct
      ? `<div class="emoji">✅</div><h2>¡CORRECTO!</h2><div class="pts">+${r.points}</div>`
      : `<div class="emoji">${r.answered ? '❌' : '⏰'}</div><h2>${r.answered ? '¡FALLASTE!' : '¡SE ACABÓ!'}</h2><div class="pts">+0</div>`;
    if (navigator.vibrate) navigator.vibrate(r.correct ? [60, 40, 60] : 300);
    clearTimeout(flashTimer);
    flashTimer = setTimeout(hideFlash, 3600);
  });

  socket.on('final', f => {
    if (!f) return;
    hideFlash();
    $('end-score').textContent = f.score;
    $('end-title').textContent = f.title;
    $('end-rank').textContent = `Puesto #${f.rank} de esta ronda`;
    show('end');
  });

  show('hub');
  // Sesión previa (recarga de página): reconectar automáticamente
  if (sessionStorage.getItem('token')) socket.connect();
})();
