(() => {
'use strict';

const $ = (id) => document.getElementById(id);
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

/* ---------------- settings ---------------- */
const DEFAULTS = {
  fontSize: 56, lineHeight: 1.45, width: 82, readLine: 20, wpm: 150, countdownSec: 3, camBright: 45,
  theme: 'night', font: 'sans', align: 'left',
  mirror: false, flipV: false, fade: true, showBand: true, recRolls: true, playKey: null,
};
const S = Object.assign({}, DEFAULTS, store.get('tp.settings', {}));
const saveSettings = () => store.set('tp.settings', S);

/* ---------------- scripts ---------------- */
const SAMPLE = `[look into the lens] Here is the one thing nobody tells you about posting every day.

It is not the ideas. You have plenty of ideas. It is the friction between having the idea and hitting record.

So I built myself a teleprompter. [smile] Paste the script, pick a speed, and just talk.

**Tap the screen** to pause. Drag to scroll back. And if you lose your place, the green band shows you exactly where to look.

[beat] Follow for part two.`;

let scripts = store.get('tp.scripts', null);
if (!Array.isArray(scripts) || !scripts.length) {
  scripts = [{ id: uid(), title: 'Sample Reel', body: SAMPLE, updated: Date.now() }];
}
let currentId = store.get('tp.current', scripts[0].id);
if (!scripts.find((s) => s.id === currentId)) currentId = scripts[0].id;
const saveScripts = () => { store.set('tp.scripts', scripts); store.set('tp.current', currentId); };
const current = () => scripts.find((s) => s.id === currentId);

function uid() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36); }
function countWords(text) {
  return text.replace(/\[[^\]]*\]/g, ' ').replace(/\*\*/g, '').split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}
function fmtTime(sec) {
  sec = Math.max(0, Math.round(sec));
  return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
}
function titleOf(s) {
  if (s.title.trim()) return s.title.trim();
  const first = s.body.replace(/\[[^\]]*\]/g, '').trim().split('\n')[0] || '';
  return first.slice(0, 40) || 'Untitled script';
}

/* ---------------- home screen ---------------- */
const el = {
  home: $('home'), list: $('scriptList'), title: $('title'), body: $('body'),
  words: $('wordCount'), read: $('readTime'), prompter: $('prompter'),
};

function renderList() {
  const sorted = [...scripts].sort((a, b) => b.updated - a.updated);
  el.list.innerHTML = '';
  for (const s of sorted) {
    const li = document.createElement('li');
    if (s.id === currentId) li.className = 'active';
    const n = countWords(s.body);
    li.innerHTML = '<b></b><span></span>';
    li.querySelector('b').textContent = titleOf(s);
    li.querySelector('span').textContent = `${n} words · ${fmtTime(n / S.wpm * 60)}`;
    li.onclick = () => { currentId = s.id; saveScripts(); loadEditor(); renderList(); };
    el.list.appendChild(li);
  }
}
function loadEditor() {
  const s = current();
  el.title.value = s.title;
  el.body.value = s.body;
  updateStats();
}
function updateStats() {
  const n = countWords(el.body.value);
  el.words.textContent = `${n} ${n === 1 ? 'word' : 'words'}`;
  el.read.textContent = `${fmtTime(n / S.wpm * 60)} at ${S.wpm} wpm`;
}
let saveTimer;
function onEdit() {
  const s = current();
  s.title = el.title.value;
  s.body = el.body.value;
  s.updated = Date.now();
  updateStats();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { saveScripts(); renderList(); }, 300);
}
el.title.addEventListener('input', onEdit);
el.body.addEventListener('input', onEdit);

$('newScript').onclick = () => {
  const s = { id: uid(), title: '', body: '', updated: Date.now() };
  scripts.push(s); currentId = s.id; saveScripts(); renderList(); loadEditor();
  el.body.focus();
};
$('deleteBtn').onclick = () => {
  if (!confirm(`Delete "${titleOf(current())}"?`)) return;
  scripts = scripts.filter((s) => s.id !== currentId);
  if (!scripts.length) scripts.push({ id: uid(), title: '', body: '', updated: Date.now() });
  currentId = [...scripts].sort((a, b) => b.updated - a.updated)[0].id;
  saveScripts(); renderList(); loadEditor();
};
$('pasteBtn').onclick = async () => {
  try {
    const text = await navigator.clipboard.readText();
    if (!text) return;
    const ta = el.body;
    const a = ta.selectionStart ?? ta.value.length, b = ta.selectionEnd ?? ta.value.length;
    ta.value = ta.value.slice(0, a) + text + ta.value.slice(b);
    onEdit();
  } catch {
    el.body.focus();
    alert('Tap and hold in the script box, then choose Paste.');
  }
};
$('startBtn').onclick = () => {
  if (!countWords(el.body.value)) { el.body.focus(); return; }
  clearTimeout(saveTimer); saveScripts(); renderList();
  openPrompter();
};

/* ---------------- prompter ---------------- */
const P = {
  stage: $('stage'), flip: $('flip'), scroller: $('scroller'), band: $('band'),
  top: $('topBar'), bottom: $('bottomBar'), play: $('playBtn'), wpm: $('wpmVal'),
  title: $('pTitle'), remain: $('pRemain'), fill: $('progressFill'), sheet: $('sheet'),
  countdown: $('countdown'), toast: $('toast'), cam: $('cam'), shade: $('camShade'),
  camBtn: $('camBtn'), recBtn: $('recBtn'), voiceBtn: $('voiceBtn'), recDot: $('recDot'), recTime: $('recTime'),
};

let pos = 0, maxPos = 0, readY = 0, pxPerWord = 40, wordCount = 1;
let playing = false, dragging = false, lastT = 0, rafId = 0, lastApplied = -1;
let words = [];          // [{el, norm}]
let open = false;

function escapeHtml(s) { return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function norm(w) {
  return w.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}]/gu, '');
}

function renderScript(text) {
  words = [];
  let html = '';
  let bold = false;
  const paras = text.replace(/\r/g, '').trim().split(/\n\s*\n/);
  for (const para of paras) {
    const lines = para.split('\n').map((line) => {
      let out = '';
      for (const part of line.split(/(\[[^\]]*\])/)) {
        if (/^\[[^\]]*\]$/.test(part)) { out += `<span class="cue">${escapeHtml(part.slice(1, -1).trim())}</span> `; continue; }
        const chunks = part.split('**');
        chunks.forEach((chunk, ci) => {
          if (ci > 0) bold = !bold;
          for (const tok of chunk.split(/(\s+)/)) {
            if (!tok) continue;
            if (/^\s+$/.test(tok)) { out += ' '; continue; }
            const n = norm(tok);
            const span = `<span class="w" data-i="${n ? words.length : -1}">${escapeHtml(tok)}</span>`;
            if (n) words.push({ el: null, norm: n });
            out += bold ? `<strong>${span}</strong>` : span;
          }
        });
      }
      return out.trim();
    });
    html += `<p>${lines.join('<br>')}</p>`;
    bold = false;
  }
  html += '<div class="end">End</div>';
  P.scroller.innerHTML = html;
  P.scroller.querySelectorAll('.w').forEach((node) => {
    const i = +node.dataset.i;
    if (i >= 0) words[i].el = node;
  });
  wordCount = Math.max(1, words.length);
}

function applyLook() {
  const r = document.documentElement.style;
  r.setProperty('--fs', S.fontSize + 'px');
  r.setProperty('--lh', S.lineHeight);
  r.setProperty('--tw', S.width + '%');
  r.setProperty('--rl', S.readLine + '%');
  const pr = el.prompter;
  pr.classList.remove('theme-night', 'theme-amber', 'theme-day', 'font-sans', 'font-serif', 'font-rounded', 'align-left', 'align-center');
  pr.classList.add('theme-' + S.theme, 'font-' + S.font, 'align-' + S.align);
  P.flip.style.transform = `scale(${S.mirror ? -1 : 1}, ${S.flipV ? -1 : 1})`;
  P.flip.classList.toggle('fade', S.fade);
  P.band.classList.toggle('hidden', !S.showBand);
  P.shade.style.opacity = String(1 - S.camBright / 100);
  P.wpm.textContent = S.wpm;
  document.querySelectorAll('#presets button').forEach((b) => b.classList.toggle('on', +b.dataset.wpm === S.wpm));
}

function layout(keepFraction = true) {
  const frac = maxPos > 0 ? pos / maxPos : 0;
  const vh = P.stage.clientHeight;
  readY = vh * S.readLine / 100;
  P.scroller.style.paddingTop = readY + 'px';
  P.scroller.style.paddingBottom = Math.max(0, vh - readY) + 'px';
  maxPos = Math.max(0, P.scroller.scrollHeight - vh);
  pxPerWord = Math.max(1, maxPos / wordCount);
  if (keepFraction) pos = frac * maxPos;
  if (voice.active) voice.retarget();
  lastApplied = -1;
  draw();
}

const speedPx = () => (S.wpm / 60) * pxPerWord;

function draw() {
  pos = Math.min(Math.max(pos, 0), maxPos);
  if (Math.abs(pos - lastApplied) > 0.05) {
    P.scroller.style.transform = `translate3d(0, ${-pos}px, 0)`;
    lastApplied = pos;
    P.fill.style.width = (maxPos ? (pos / maxPos) * 100 : 0) + '%';
  }
}

let lastRemain = '';
function tick(t) {
  rafId = requestAnimationFrame(tick);
  const dt = Math.min(0.1, (t - (lastT || t)) / 1000);
  lastT = t;
  if (playing && !dragging) {
    if (voice.active) {
      pos += (voice.target - pos) * Math.min(1, dt * 5);
    } else {
      pos += speedPx() * dt;
      if (pos >= maxPos) { pos = maxPos; setPlaying(false); }
    }
  }
  draw();
  const rem = voice.active ? '' : fmtTime((maxPos - pos) / speedPx()) + ' left';
  if (rem !== lastRemain) { P.remain.textContent = rem || 'Voice follow'; lastRemain = rem; }
}

function setPlaying(on) {
  if (on && pos >= maxPos - 1) pos = 0;
  playing = on;
  P.play.textContent = on ? '❚❚' : '▶';
  P.play.setAttribute('aria-label', on ? 'Pause' : 'Play');
  if (voice.active) on ? voice.start() : voice.stop();
  showChrome();
}

/* countdown */
let cdTimer = null;
function cancelCountdown() {
  if (!cdTimer) return false;
  clearTimeout(cdTimer); cdTimer = null; P.countdown.classList.add('hidden');
  return true;
}
function runCountdown(n, done) {
  cancelCountdown();
  if (n <= 0) { done(); return; }
  hideChrome();
  P.countdown.classList.remove('hidden');
  const step = (k) => {
    if (k === 0) { P.countdown.classList.add('hidden'); cdTimer = null; done(); return; }
    P.countdown.textContent = k;
    P.countdown.classList.remove('pop'); void P.countdown.offsetWidth; P.countdown.classList.add('pop');
    cdTimer = setTimeout(() => step(k - 1), 1000);
  };
  step(n);
}

function togglePlay() {
  if (cancelCountdown()) { showChrome(); return; }
  if (playing) { setPlaying(false); return; }
  if (pos < 4 || pos >= maxPos - 1) runCountdown(S.countdownSec, () => setPlaying(true));
  else setPlaying(true);
}

/* chrome autohide */
let hideTimer;
function showChrome() {
  el.prompter.classList.remove('chrome-hidden');
  clearTimeout(hideTimer);
  if (playing && P.sheet.classList.contains('hidden')) hideTimer = setTimeout(hideChrome, 2500);
}
function hideChrome() {
  if (!P.sheet.classList.contains('hidden')) return;
  el.prompter.classList.add('chrome-hidden');
}

let toastTimer;
function toast(msg, ms = 2600) {
  P.toast.textContent = msg;
  P.toast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => P.toast.classList.add('hidden'), ms);
}

function setWpm(v) {
  S.wpm = Math.round(Math.min(320, Math.max(60, v)) / 5) * 5;
  saveSettings(); applyLook(); syncSheet(); updateStats();
}
function nudgeLines(n) {
  const lh = S.fontSize * S.lineHeight;
  if (voice.active) { voice.jumpTo(pos + n * lh); return; }
  pos += n * lh;
  draw();
}

function openPrompter() {
  open = true;
  const s = current();
  P.title.textContent = titleOf(s);
  renderScript(s.body);
  el.home.classList.add('hidden');
  el.prompter.classList.remove('hidden');
  applyLook();
  pos = 0; maxPos = 0;
  layout(false);
  playing = false; setPlaying(false);
  voice.reset();
  lastT = 0; cancelAnimationFrame(rafId); rafId = requestAnimationFrame(tick);
  wake.on();
  if (document.fonts) document.fonts.ready.then(() => open && layout());
}
function closePrompter() {
  if (rec.recorder) { toast('Stop recording first'); return; }
  cancelCountdown();
  setPlaying(false);
  voice.stop(); voice.setActive(false);
  camera.stop();
  P.sheet.classList.add('hidden');
  open = false;
  cancelAnimationFrame(rafId);
  wake.off();
  el.prompter.classList.add('hidden');
  el.home.classList.remove('hidden');
  renderList(); updateStats();
}

/* buttons */
$('exitBtn').onclick = closePrompter;
P.play.onclick = togglePlay;
$('restartBtn').onclick = () => { cancelCountdown(); setPlaying(false); pos = 0; voice.reset(); draw(); };
$('backBtn').onclick = () => nudgeLines(-3);
$('slowerBtn').onclick = () => setWpm(S.wpm - 10);
$('fasterBtn').onclick = () => setWpm(S.wpm + 10);
document.querySelectorAll('#presets button').forEach((b) => { b.onclick = () => setWpm(+b.dataset.wpm); });
$('setBtn').onclick = () => { P.sheet.classList.toggle('hidden'); syncSheet(); showChrome(); };
$('sheetClose').onclick = () => { P.sheet.classList.add('hidden'); showChrome(); };
[P.top, P.bottom, P.sheet].forEach((n) => n.addEventListener('pointerdown', () => showChrome()));

/* touch: tap to play/pause, drag to scrub */
let ptr = null;
P.stage.addEventListener('pointerdown', (e) => {
  ptr = { id: e.pointerId, y: e.clientY, startY: e.clientY, t: performance.now(), moved: false };
  try { P.stage.setPointerCapture(e.pointerId); } catch {}
});
P.stage.addEventListener('pointermove', (e) => {
  if (!ptr || e.pointerId !== ptr.id) return;
  const dy = e.clientY - ptr.y;
  if (!ptr.moved && Math.abs(e.clientY - ptr.startY) > 8) { ptr.moved = true; dragging = true; showChrome(); }
  if (ptr.moved) {
    const d = S.flipV ? dy : -dy;
    pos += d;
    if (voice.active) voice.jumpTo(pos, true);
    draw();
  }
  ptr.y = e.clientY;
});
const endPtr = (e) => {
  if (!ptr || e.pointerId !== ptr.id) return;
  const wasTap = !ptr.moved && performance.now() - ptr.t < 400;
  ptr = null; dragging = false;
  if (e.type === 'pointercancel') return;
  if (!wasTap) return;
  if (!P.sheet.classList.contains('hidden')) { P.sheet.classList.add('hidden'); showChrome(); return; }
  togglePlay();
};
P.stage.addEventListener('pointerup', endPtr);
P.stage.addEventListener('pointercancel', endPtr);
P.stage.addEventListener('wheel', (e) => {
  e.preventDefault();
  pos += (S.flipV ? -1 : 1) * e.deltaY;
  if (voice.active) voice.jumpTo(pos, true);
  draw(); showChrome();
}, { passive: false });

/* keyboard and Bluetooth remotes */
let learning = false;
window.addEventListener('keydown', (e) => {
  if (!open) return;
  if (e.target.closest && e.target.closest('input, textarea')) return;
  if (learning) {
    if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return;
    e.preventDefault();
    learning = false;
    S.playKey = e.code || e.key; saveSettings(); syncSheet();
    toast(`Remote key set: ${S.playKey}`);
    return;
  }
  const k = e.key;
  if (S.playKey && (e.code === S.playKey || k === S.playKey)) { e.preventDefault(); togglePlay(); return; }
  const handled = {
    ' ': togglePlay, Enter: togglePlay, PageDown: togglePlay, k: togglePlay,
    PageUp: () => nudgeLines(-3),
    ArrowUp: () => nudgeLines(-1), ArrowDown: () => nudgeLines(1),
    ArrowLeft: () => setWpm(S.wpm - 10), ArrowRight: () => setWpm(S.wpm + 10),
    Home: () => $('restartBtn').onclick(), r: () => $('restartBtn').onclick(),
    Escape: () => (P.sheet.classList.contains('hidden') ? closePrompter() : $('sheetClose').onclick()),
    m: () => { S.mirror = !S.mirror; saveSettings(); applyLook(); syncSheet(); },
    '[': () => setLook('fontSize', S.fontSize - 4), ']': () => setLook('fontSize', S.fontSize + 4),
  }[k];
  if (handled) { e.preventDefault(); handled(); showChrome(); }
});

/* ---------------- settings sheet ---------------- */
const RANGES = {
  fontSize: (v) => v + 'px', lineHeight: (v) => (+v).toFixed(2), width: (v) => v + '%',
  readLine: (v) => v + '% from top', wpm: (v) => v + ' wpm', countdownSec: (v) => (+v ? v + 's' : 'off'),
  camBright: (v) => v + '%',
};
const LABEL_IDS = { fontSize: 'fsVal', lineHeight: 'lhVal', width: 'wVal', readLine: 'rlVal', wpm: 'spVal', countdownSec: 'cdVal', camBright: 'cbVal' };
const TOGGLES = { mirror: 'mirror', flipV: 'flipV', fade: 'fade', showBand: 'showBand', recRolls: 'recRolls' };

function setLook(key, v) {
  if (key === 'fontSize') v = Math.min(160, Math.max(24, v));
  S[key] = v; saveSettings(); applyLook(); syncSheet();
  if (['fontSize', 'lineHeight', 'width', 'readLine', 'font'].includes(key)) layout();
}
function syncSheet() {
  for (const key in RANGES) {
    $(key).value = S[key];
    $(LABEL_IDS[key]).textContent = RANGES[key](S[key]);
  }
  for (const key in TOGGLES) $(TOGGLES[key]).checked = !!S[key];
  document.querySelectorAll('.seg').forEach((seg) => {
    seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', S[seg.dataset.key] === b.dataset.v));
  });
  $('learnKey').textContent = learning ? 'Press a remote button…' : (S.playKey ? `Play key: ${S.playKey}` : 'Set remote play key');
}
for (const key in RANGES) {
  $(key).addEventListener('input', (e) => {
    const v = key === 'lineHeight' ? parseFloat(e.target.value) : parseInt(e.target.value, 10);
    if (key === 'wpm') setWpm(v); else setLook(key, v);
  });
}
for (const key in TOGGLES) $(TOGGLES[key]).addEventListener('change', (e) => setLook(key, e.target.checked));
document.querySelectorAll('.seg').forEach((seg) => {
  seg.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) setLook(seg.dataset.key, b.dataset.v);
  });
});
$('learnKey').onclick = () => { learning = true; syncSheet(); toast('Press the button on your remote'); };
$('clearKey').onclick = () => { learning = false; S.playKey = null; saveSettings(); syncSheet(); };

/* ---------------- voice follow ---------------- */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const voice = {
  active: false, listening: false, rec: null, cur: 0, target: 0, saidUpTo: 0,
  setActive(on) {
    this.active = on;
    P.voiceBtn.classList.toggle('on', on);
    if (!on) { this.stop(); this.clearSaid(); }
  },
  reset() { this.cur = 0; this.target = 0; this.clearSaid(); },
  clearSaid() {
    for (let i = 0; i < this.saidUpTo; i++) words[i] && words[i].el && words[i].el.classList.remove('said');
    this.saidUpTo = 0;
  },
  markSaid() {
    const upTo = Math.min(this.cur, words.length);
    if (upTo > this.saidUpTo) for (let i = this.saidUpTo; i < upTo; i++) words[i].el.classList.add('said');
    else for (let i = upTo; i < this.saidUpTo; i++) words[i].el.classList.remove('said');
    this.saidUpTo = upTo;
  },
  retarget() {
    const w = words[Math.min(this.cur, words.length - 1)];
    if (!w) return;
    this.target = Math.min(maxPos, Math.max(0, w.el.offsetTop - readY));
  },
  // manual scroll in voice mode: move the cursor to the first word at the reading line
  jumpTo(p, fromDrag) {
    p = Math.min(maxPos, Math.max(0, p));
    let i = 0;
    while (i < words.length - 1 && words[i].el.offsetTop - readY < p - 2) i++;
    this.cur = i; this.markSaid();
    this.target = p;
    if (!fromDrag) pos = p;
  },
  start() {
    if (!SR) return;
    if (rec.recorder) return;
    if (this.listening) return;
    try {
      const r = new SR();
      r.continuous = true; r.interimResults = true; r.lang = navigator.language || 'en-US';
      r.onresult = (e) => this.onResult(e);
      r.onerror = (e) => {
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
          toast('Voice follow was blocked. Allow speech recognition, or open in Safari.', 4000);
          this.listening = false; setPlaying(false);
        }
      };
      r.onend = () => { if (this.listening) { try { r.start(); } catch {} } };
      this.rec = r; this.listening = true;
      r.start();
    } catch {
      this.listening = false;
      toast('Voice follow could not start here.');
    }
  },
  stop() {
    this.listening = false;
    if (this.rec) { try { this.rec.onend = null; this.rec.abort(); } catch {} this.rec = null; }
  },
  onResult(e) {
    let text = '';
    for (let i = Math.max(0, e.results.length - 2); i < e.results.length; i++) text += ' ' + e.results[i][0].transcript;
    const heard = text.split(/\s+/).map(norm).filter(Boolean).slice(-6);
    if (!heard.length) return;
    const H = heard.length;
    let best = -1, bestScore = 0;
    const lo = Math.max(0, this.cur - 6), hi = Math.min(words.length - 1, this.cur + 30);
    for (let j = lo; j <= hi; j++) {
      let score = 0;
      for (let k = 0; k < H && j - k >= 0; k++) if (similar(heard[H - 1 - k], words[j - k].norm)) score += 1;
      score -= Math.abs(j - this.cur) * 0.015;
      if (score > bestScore) { bestScore = score; best = j; }
    }
    const need = H >= 3 ? 1.9 : 0.9;
    if (best < 0 || bestScore < need) return;
    if (best + 1 < this.cur && bestScore < 2.9) return; // only go back on a strong match
    this.cur = best + 1;
    this.markSaid();
    this.retarget();
  },
};
function similar(a, b) {
  if (a === b) return true;
  if (a.length < 4 || b.length < 4) return false;
  return lev(a, b) <= (Math.max(a.length, b.length) >= 7 ? 2 : 1);
}
function lev(a, b) {
  const m = a.length, n = b.length;
  if (Math.abs(m - n) > 2) return 3;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}
P.voiceBtn.onclick = () => {
  if (!SR) { toast('Voice follow is not supported here. It works best in Safari.', 3600); return; }
  if (rec.recorder) { toast('Voice follow is off while recording, so your mic stays clean.', 3200); return; }
  const on = !voice.active;
  setPlaying(false);
  voice.setActive(on);
  if (on) { voice.jumpTo(pos); toast('Voice follow on. Press play and start talking.'); }
};

/* ---------------- camera + recording ---------------- */
const camera = {
  stream: null, on: false,
  async start() {
    const portrait = innerHeight >= innerWidth;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: portrait ? 1080 : 1920 }, height: { ideal: portrait ? 1920 : 1080 }, frameRate: { ideal: 30 } },
        audio: { echoCancellation: true, noiseSuppression: true },
      });
    } catch (err) {
      toast(err && err.name === 'NotAllowedError' ? 'Camera access was denied. Allow it in Settings.' : 'Camera is not available here.', 3600);
      return false;
    }
    P.cam.srcObject = this.stream;
    P.cam.play().catch(() => {});
    this.on = true;
    P.cam.classList.remove('hidden'); P.shade.classList.remove('hidden');
    el.prompter.classList.add('cam-on');
    P.camBtn.classList.add('on'); P.recBtn.classList.remove('hidden');
    return true;
  },
  stop() {
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    this.stream = null; this.on = false;
    P.cam.srcObject = null;
    P.cam.classList.add('hidden'); P.shade.classList.add('hidden');
    el.prompter.classList.remove('cam-on');
    P.camBtn.classList.remove('on'); P.recBtn.classList.add('hidden');
  },
  alive() { return this.stream && this.stream.getTracks().every((t) => t.readyState === 'live'); },
};
P.camBtn.onclick = () => {
  if (rec.recorder) { toast('Stop recording first'); return; }
  if (camera.on) camera.stop(); else camera.start();
};

const rec = {
  recorder: null, chunks: [], startedAt: 0, timer: null, blob: null, url: null, type: '',
  pickType() {
    const types = ['video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm'];
    return (window.MediaRecorder && types.find((t) => MediaRecorder.isTypeSupported(t))) || '';
  },
  begin() {
    if (!camera.alive()) { toast('Camera stopped. Tap Camera to turn it back on.'); return false; }
    if (!window.MediaRecorder) { toast('Recording is not supported on this browser.'); return false; }
    this.type = this.pickType();
    try {
      this.recorder = new MediaRecorder(camera.stream, this.type ? { mimeType: this.type, videoBitsPerSecond: 8_000_000 } : undefined);
    } catch {
      try { this.recorder = new MediaRecorder(camera.stream); } catch { toast('Could not start recording.'); return false; }
    }
    this.type = this.recorder.mimeType || this.type || 'video/mp4';
    this.chunks = [];
    this.recorder.ondataavailable = (e) => { if (e.data && e.data.size) this.chunks.push(e.data); };
    this.recorder.onstop = () => this.finish();
    this.recorder.start(1000);
    this.startedAt = Date.now();
    P.recDot.classList.remove('hidden'); P.recTime.textContent = '0:00';
    this.timer = setInterval(() => { P.recTime.textContent = fmtTime((Date.now() - this.startedAt) / 1000); }, 500);
    P.recBtn.classList.add('on'); P.recBtn.textContent = 'Stop';
    return true;
  },
  end() {
    if (!this.recorder) return;
    try { this.recorder.stop(); } catch { this.finish(); }
  },
  finish() {
    clearInterval(this.timer);
    this.recorder = null;
    P.recDot.classList.add('hidden');
    P.recBtn.classList.remove('on'); P.recBtn.textContent = 'Record';
    setPlaying(false);
    if (!this.chunks.length) { toast('Nothing was recorded.'); return; }
    this.blob = new Blob(this.chunks, { type: this.type });
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = URL.createObjectURL(this.blob);
    const ext = this.type.includes('webm') ? 'webm' : 'mp4';
    const stamp = new Date().toISOString().slice(0, 16).replace(/[T:]/g, '');
    this.name = `${titleOf(current()).replace(/[^\w ]+/g, '').trim().replace(/\s+/g, '_').slice(0, 30) || 'take'}_${stamp}.${ext}`;
    $('takeVideo').src = this.url;
    const dl = $('downloadTake'); dl.href = this.url; dl.download = this.name;
    $('saveModal').classList.remove('hidden');
  },
};
P.recBtn.onclick = () => {
  if (rec.recorder) { rec.end(); return; }
  if (cdTimer) { cancelCountdown(); showChrome(); return; }
  if (voice.active) { voice.setActive(false); toast('Voice follow paused while recording so your mic stays clean.', 3000); }
  if (S.recRolls) {
    setPlaying(false);
    runCountdown(S.countdownSec, () => { if (rec.begin()) setPlaying(true); });
  } else {
    rec.begin();
  }
};
$('shareTake').onclick = async () => {
  const file = new File([rec.blob], rec.name, { type: rec.type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file] }); } catch {}
  } else {
    $('downloadTake').click();
  }
};
$('discardTake').onclick = () => {
  if (!confirm('Discard this take?')) return;
  $('saveModal').classList.add('hidden');
  $('takeVideo').removeAttribute('src');
  if (rec.url) URL.revokeObjectURL(rec.url);
  rec.blob = null; rec.url = null;
};
$('closeTake').onclick = () => { $('saveModal').classList.add('hidden'); $('takeVideo').pause(); };

/* ---------------- wake lock ---------------- */
const wake = {
  lock: null, want: false,
  async on() {
    this.want = true;
    try { if ('wakeLock' in navigator && !this.lock) { this.lock = await navigator.wakeLock.request('screen'); this.lock.addEventListener('release', () => { this.lock = null; }); } } catch {}
  },
  off() { this.want = false; if (this.lock) { this.lock.release().catch(() => {}); this.lock = null; } },
};
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (open) { cancelCountdown(); setPlaying(false); }
    if (rec.recorder) rec.end();
  } else if (open) {
    if (wake.want) wake.on();
    if (camera.on && !camera.alive()) { camera.stop(); camera.start(); }
  }
});

/* ---------------- resize ---------------- */
let resizeTimer;
window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => open && layout(), 120); });

/* ---------------- boot ---------------- */
renderList();
loadEditor();
syncSheet();
applyLook();
saveScripts();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
})();
