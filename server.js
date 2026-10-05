'use strict';
/**
 * Trivia IIN — servidor LAN (Express + Socket.io)
 * Uso: npm install && npm start
 */
const express = require('express');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { Server } = require('socket.io');
let QRCode = null;
try { QRCode = require('qrcode'); } catch (_) { /* QR opcional */ }

// ───────────── Configuración ─────────────
const PORT = 3000;
const HOST = '0.0.0.0';
const ADMIN_PIN = 'admin2026';
const MAX_PLAYERS = 3;
const QUESTION_TIME = 12;       // segundos
const COUNTDOWN_SECONDS = 3;
const REVEAL_MS = 4000;
const PODIUM_MS = 20000;
const BASE_POINTS = 1000;
const BONUS_PER_SEC = 50;
const SCORES_FILE = path.join(__dirname, 'scores.json');
const QUESTIONS_FILE = path.join(__dirname, 'questions.json');

// ───────────── Persistencia ─────────────
function readScores() {
  try {
    const data = JSON.parse(fs.readFileSync(SCORES_FILE, 'utf8'));
    return Array.isArray(data) ? data : [];
  } catch (_) { return []; }
}
function writeScores(list) {
  try {
    const tmp = SCORES_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(list, null, 2));
    fs.renameSync(tmp, SCORES_FILE);
  } catch (e) { console.error('No se pudo guardar scores.json:', e.message); }
}
if (!fs.existsSync(SCORES_FILE)) writeScores([]);

function loadQuestions() {
  try {
    const q = JSON.parse(fs.readFileSync(QUESTIONS_FILE, 'utf8'));
    return q.filter(x => x && x.text && Array.isArray(x.options) && x.options.length === 4).slice(0, 5);
  } catch (e) { console.error('Error leyendo questions.json:', e.message); return []; }
}
const topScores = () => readScores().sort((a, b) => b.score - a.score).slice(0, 10);

// ───────────── Estado del juego ─────────────
let game = newGame();
function newGame() {
  return {
    phase: 'lobby',            // lobby | countdown | question | reveal | podium
    players: [],               // {id, token, socketId, nick, score, connected, answer, lastPoints}
    questions: [],
    qIndex: -1,
    countdown: 0,
    remaining: QUESTION_TIME,
    deadline: 0,
    timers: [],
    final: null
  };
}
function clearTimers() {
  game.timers.forEach(t => { clearTimeout(t); clearInterval(t); });
  game.timers = [];
}
const later = (fn, ms) => { const t = setTimeout(fn, ms); game.timers.push(t); return t; };

// ───────────── Servidor ─────────────
const app = express();
const server = http.createServer(app);
const io = new Server(server, { pingInterval: 5000, pingTimeout: 8000 });

app.use('/assets', express.static(path.join(__dirname, 'assets')));
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (_, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/tv', (_, res) => res.sendFile(path.join(__dirname, 'public', 'tv.html')));
app.get('/admin', (_, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

function getLanIP() {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list || []) {
      if (i.family === 'IPv4' && !i.internal && !i.address.startsWith('169.254')) return i.address;
    }
  }
  return 'localhost';
}
const JOIN_URL = `http://${getLanIP()}:${PORT}`;
let qrDataUrl = null;

app.get('/api/info', (_, res) => res.json({ url: JOIN_URL, qr: qrDataUrl }));

// ───────────── Snapshot público ─────────────
function ranking() {
  return [...game.players].sort((a, b) => b.score - a.score);
}
function snapshot() {
  const q = game.questions[game.qIndex];
  const showAnswer = game.phase === 'reveal';
  return {
    phase: game.phase,
    max: MAX_PLAYERS,
    players: game.players.map(p => ({
      id: p.id, nick: p.nick, score: p.score, connected: p.connected, answered: p.answer !== null
    })),
    qIndex: game.qIndex,
    total: game.questions.length || 5,
    countdown: game.countdown,
    remaining: game.remaining,
    questionTime: QUESTION_TIME,
    question: q && (game.phase === 'question' || game.phase === 'reveal')
      ? { text: q.text, options: q.options } : null,
    correctIndex: showAnswer && q ? q.correct : null,
    ranking: game.phase === 'podium' ? ranking().map(p => ({ id: p.id, nick: p.nick, score: p.score })) : [],
    top10: topScores(),
    final: game.final
  };
}
function broadcast() {
  io.emit('state', snapshot());
}

// ───────────── Flujo del juego ─────────────
function archetype(score) {
  if (score > 4000) return 'Arquitecto de Software';
  if (score > 3000) return 'Ingeniero Full-Stack';
  if (score > 2000) return 'Dev Backend Imparable';
  if (score > 1000) return 'Junior Curioso';
  return 'Bug en Producción';
}

function startCountdown() {
  if (game.phase !== 'lobby' || game.players.length < 1) return;
  game.questions = loadQuestions();
  if (!game.questions.length) { console.error('Sin preguntas válidas'); return; }
  clearTimers();
  game.phase = 'countdown';
  game.countdown = COUNTDOWN_SECONDS;
  broadcast();
  const iv = setInterval(() => {
    game.countdown--;
    if (game.countdown <= 0) {
      clearInterval(iv);
      nextQuestion();
    } else broadcast();
  }, 1000);
  game.timers.push(iv);
}

function nextQuestion() {
  clearTimers();
  game.qIndex++;
  if (game.qIndex >= game.questions.length) return finishGame();
  game.players.forEach(p => { p.answer = null; p.lastPoints = 0; });
  game.phase = 'question';
  game.deadline = Date.now() + QUESTION_TIME * 1000;
  game.remaining = QUESTION_TIME;
  broadcast();
  const iv = setInterval(() => {
    const left = Math.max(0, Math.ceil((game.deadline - Date.now()) / 1000));
    if (left !== game.remaining) {
      game.remaining = left;
      io.emit('tick', left);
    }
    if (Date.now() >= game.deadline) { clearInterval(iv); endQuestion(); }
  }, 100);
  game.timers.push(iv);
}

function endQuestion() {
  if (game.phase !== 'question') return;
  clearTimers();
  game.phase = 'reveal';
  game.remaining = 0;
  const q = game.questions[game.qIndex];
  game.players.forEach(p => {
    const correct = p.answer !== null && p.answer === q.correct;
    if (p.socketId) io.to(p.socketId).emit('result', {
      correct, points: p.lastPoints, score: p.score, correctIndex: q.correct, answered: p.answer !== null
    });
  });
  broadcast();
  later(nextQuestion, REVEAL_MS);
}

function finishGame() {
  clearTimers();
  game.phase = 'podium';
  const rk = ranking();
  const stamp = new Date().toISOString();
  const all = readScores();
  rk.forEach(p => all.push({ nick: p.nick, score: p.score, date: stamp }));
  writeScores(all);
  game.final = rk.map((p, i) => ({ id: p.id, nick: p.nick, score: p.score, rank: i + 1, title: archetype(p.score) }));
  game.players.forEach(p => {
    if (p.socketId) io.to(p.socketId).emit('final', game.final.find(f => f.id === p.id));
  });
  broadcast();
  later(resetGame, PODIUM_MS);
}

function resetGame() {
  clearTimers();
  game.players.forEach(p => p.socketId && io.to(p.socketId).emit('kicked', 'La partida terminó'));
  game = newGame();
  broadcast();
}

function abortGame(reason) {
  clearTimers();
  game.players.forEach(p => p.socketId && io.to(p.socketId).emit('kicked', reason || 'Partida abortada'));
  game = newGame();
  broadcast();
}

function checkAllAnswered() {
  if (game.phase !== 'question') return;
  const active = game.players.filter(p => p.connected);
  if (active.length && active.every(p => p.answer !== null)) endQuestion();
}

// ───────────── Sockets ─────────────
const sanitizeNick = n => String(n || '').replace(/[<>&"'`]/g, '').trim().slice(0, 14);
const findBySocket = id => game.players.find(p => p.socketId === id);

io.on('connection', socket => {
  socket.emit('state', snapshot());

  socket.on('rejoin', token => {
    const p = game.players.find(x => x.token === token);
    if (!p) return socket.emit('rejoinFail');
    p.socketId = socket.id;
    p.connected = true;
    socket.emit('joined', { id: p.id, token: p.token, nick: p.nick });
    broadcast();
  });

  socket.on('join', rawNick => {
    if (game.phase !== 'lobby') return socket.emit('joinError', 'Hay una partida en curso. ¡Espera tu turno!');
    if (findBySocket(socket.id)) return;
    const nick = sanitizeNick(rawNick);
    if (!nick) return socket.emit('joinError', 'Escribe un nickname');
    if (game.players.length >= MAX_PLAYERS) return socket.emit('joinError', 'Sala llena');
    if (game.players.some(p => p.nick.toLowerCase() === nick.toLowerCase())) return socket.emit('joinError', 'Ese nick ya existe');
    const p = {
      id: crypto.randomBytes(4).toString('hex'),
      token: crypto.randomBytes(12).toString('hex'),
      socketId: socket.id, nick, score: 0, connected: true, answer: null, lastPoints: 0
    };
    game.players.push(p);
    socket.emit('joined', { id: p.id, token: p.token, nick });
    broadcast();
    if (game.players.length >= MAX_PLAYERS) startCountdown();
  });

  socket.on('answer', idx => {
    if (game.phase !== 'question') return;
    const p = findBySocket(socket.id);
    if (!p || p.answer !== null) return;
    idx = Number(idx);
    if (!Number.isInteger(idx) || idx < 0 || idx > 3) return;
    if (Date.now() > game.deadline) return;
    p.answer = idx;
    const q = game.questions[game.qIndex];
    if (idx === q.correct) {
      const secs = Math.min(QUESTION_TIME, Math.max(0, Math.ceil((game.deadline - Date.now()) / 1000)));
      p.lastPoints = BASE_POINTS + secs * BONUS_PER_SEC;
      p.score += p.lastPoints;
    }
    socket.emit('locked', idx);
    broadcast();
    checkAllAnswered();
  });

  socket.on('disconnect', () => {
    const p = findBySocket(socket.id);
    if (!p) return;
    if (game.phase === 'lobby') {
      game.players = game.players.filter(x => x !== p);
    } else {
      p.connected = false;
      p.socketId = null;
      if (!game.players.some(x => x.connected) && game.phase !== 'podium') {
        console.log('Todos los jugadores se desconectaron, reiniciando sala.');
        return abortGame();
      }
      checkAllAnswered();
    }
    broadcast();
  });

  // ── Admin ──
  socket.on('admin:auth', pin => {
    if (pin === ADMIN_PIN) { socket.data.admin = true; socket.emit('admin:ok'); }
    else socket.emit('admin:fail');
  });
  const guard = fn => (...a) => { if (socket.data.admin) { try { fn(...a); } catch (e) { console.error(e); } } };

  socket.on('admin:forceStart', guard(() => {
    if (game.phase === 'lobby' && game.players.length >= 1) startCountdown();
    else socket.emit('admin:msg', 'Necesitas al menos 1 jugador en el lobby');
  }));
  socket.on('admin:abort', guard(() => { abortGame('Partida abortada por el admin'); socket.emit('admin:msg', 'Partida abortada'); }));
  socket.on('admin:clearScores', guard(() => { writeScores([]); broadcast(); socket.emit('admin:msg', 'Ranking limpiado'); }));
  socket.on('admin:points', guard(({ playerId, delta }) => {
    const p = game.players.find(x => x.id === playerId);
    delta = Number(delta);
    if (!p || !Number.isFinite(delta)) return socket.emit('admin:msg', 'Jugador o valor inválido');
    p.score = Math.max(0, p.score + Math.round(delta));
    broadcast();
    socket.emit('admin:msg', `${p.nick}: ${p.score} pts`);
  }));
});

process.on('uncaughtException', e => console.error('uncaughtException:', e));
process.on('unhandledRejection', e => console.error('unhandledRejection:', e));

server.listen(PORT, HOST, async () => {
  if (QRCode) {
    try { qrDataUrl = await QRCode.toDataURL(JOIN_URL, { margin: 1, width: 600, color: { dark: '#051737', light: '#ffffff' } }); } catch (_) {}
  }
  console.log('\n🎮  TRIVIA IIN lista');
  console.log(`   Jugadores : ${JOIN_URL}`);
  console.log(`   Pantalla  : ${JOIN_URL}/tv`);
  console.log(`   Admin     : ${JOIN_URL}/admin  (PIN: ${ADMIN_PIN})\n`);
  if (QRCode) {
    try { QRCode.toString(JOIN_URL, { type: 'terminal', small: true }, (e, s) => { if (!e) console.log(s); }); } catch (_) {}
  }
});
