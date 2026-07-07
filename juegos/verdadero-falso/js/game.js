const QUESTIONS_PER_GAME = 10;
const GAME_ID = 'mito';

const CATEGORY_LABELS = {
  biologia: 'Biología', conservacion: 'Conservación',
  mexico: 'México', cozumel: 'Cozumel', nidos: 'Nidos'
};

let pool = [], current = 0, score = 0, answered = false;

async function loadKB() {
  const res  = await fetch('../knowledge_base.json');
  const kb   = await res.json();
  return kb.knowledge_items.filter(i => i.myth_prompt);
}

async function startGame() {
  const items = await loadKB();
  pool     = items.sort(() => Math.random() - .5).slice(0, QUESTIONS_PER_GAME);
  current  = 0;
  score    = 0;
  answered = false;
  showScreen('game');
  renderQuestion();
}

function renderQuestion() {
  answered = false;
  const item = pool[current];
  const mp   = item.myth_prompt;

  document.getElementById('progress-q').textContent     = `Pregunta ${current + 1} de ${QUESTIONS_PER_GAME}`;
  document.getElementById('progress-score').textContent = `${score} correctas`;
  document.getElementById('progress-bar').style.width   = (current / QUESTIONS_PER_GAME * 100) + '%';
  document.getElementById('q-category').textContent     = CATEGORY_LABELS[item.category] || item.category;
  document.getElementById('q-statement').textContent    = mp.statement;

  document.querySelectorAll('.ans-btn').forEach(b => {
    b.classList.remove('correct', 'wrong');
    b.disabled = false;
  });

  document.getElementById('feedback-card').style.display = 'none';
  document.getElementById('question-card').style.display = '';

  const qc = document.getElementById('question-card');
  qc.style.animation = 'none';
  qc.offsetHeight;
  qc.style.animation = 'slideIn .35s ease';
}

function answer(choice) {
  if (answered) return;
  answered = true;

  const item    = pool[current];
  const mp      = item.myth_prompt;
  const correct = choice === mp.answer;

  if (correct) score++;

  document.querySelectorAll('.ans-btn').forEach(b => {
    b.disabled = true;
    const isChosen = (b.classList.contains('ans-mito') && choice === 'mito') ||
                     (b.classList.contains('ans-real') && choice === 'realidad');
    if (isChosen) b.classList.add(correct ? 'correct' : 'wrong');
  });

  const fh = document.getElementById('feedback-header');
  fh.className = 'feedback-header ' + (correct ? 'correct' : 'wrong');

  document.getElementById('feedback-result').textContent  = correct ? '✅' : '❌';
  const verd = document.getElementById('feedback-verdict');
  verd.textContent = correct ? '¡Correcto!' : 'Era un ' + mp.answer;
  verd.className   = 'feedback-verdict ' + (correct ? 'correct' : 'wrong');

  document.getElementById('feedback-explanation').textContent = mp.feedback + ' ' + item.explanation;
  document.getElementById('feedback-curious').textContent     = item.curious || '';

  document.getElementById('feedback-card').style.display = '';
  document.getElementById('question-card').style.display = 'none';
}

function nextQuestion() {
  current++;
  if (current >= pool.length) { showResult(); return; }
  renderQuestion();
}

function showResult() {
  const xp = score >= 10 ? 15 : score >= 9 ? 14 : score >= 8 ? 13 :
             score >= 7  ? 12 : score >= 6  ? 11 : score >= 5 ? 10 : 5;

  const pct   = score / QUESTIONS_PER_GAME;
  const emoji = pct === 1 ? '🏆' : pct >= .7 ? '🐢' : pct >= .5 ? '🌊' : '🥚';
  const title = pct === 1 ? '¡Perfecto!' : pct >= .7 ? '¡Bien hecho!' : pct >= .5 ? '¡Vas bien!' : 'Sigue aprendiendo';
  const msg   = pct === 1
    ? 'Conoces muy bien a las tortugas marinas. Eres un verdadero Guardián.'
    : pct >= .7
    ? 'Tienes buenos conocimientos. Con práctica llegarás al nivel experto.'
    : pct >= .5
    ? '¡Vas por buen camino! Repite el juego para reforzar lo aprendido.'
    : 'Cada mito descubierto es un paso hacia convertirte en Guardián. ¡Inténtalo de nuevo!';

  document.getElementById('result-emoji').textContent = emoji;
  document.getElementById('result-title').textContent = title;
  document.getElementById('result-msg').textContent   = msg;
  document.getElementById('result-score').textContent = score;
  document.getElementById('result-xp').textContent    = '+' + xp + ' XP ganados ⭐';

  showScreen('result');

  // Guardar en localStorage
  const state   = JSON.parse(localStorage.getItem('torturretos_v2') || '{"xp":0,"best":{}}');
  state.xp     += xp;
  state.best[GAME_ID] = Math.max(state.best[GAME_ID] || 0, score);
  localStorage.setItem('torturretos_v2', JSON.stringify(state));

  // Toast
  setTimeout(() => {
    const t = document.getElementById('xp-toast');
    t.textContent = '+' + xp + ' XP ⭐';
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 2500);
  }, 500);
}

function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-' + name).classList.add('active');
}