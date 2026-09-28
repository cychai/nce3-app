'use strict';

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const audio = $('#audio');

const STORAGE = {
  done: 'nce3.done',
  last: 'nce3.last',
  mode: 'nce3.mode',
  rate: 'nce3.rate',
  follow: 'nce3.follow',
  subtitle: 'nce3.subtitle',
};

const state = {
  book: null,
  unit: null,
  unitIndex: -1,
  lines: [],
  activeLine: -1,
  loopLine: -1,
  mode: localStorage.getItem(STORAGE.mode) || 'sequence',
  rate: Number(localStorage.getItem(STORAGE.rate)) || 1,
  follow: localStorage.getItem(STORAGE.follow) !== '0',
  subtitle: localStorage.getItem(STORAGE.subtitle) || 'dual',
  done: new Set(readStored(STORAGE.done, [])),
  seeking: false,
  playRequested: false,
  loadToken: 0,
  lyricCache: new Map(),
};

const RATES = [0.75, 1, 1.25, 1.5, 2];
const MODES = [
  { key: 'sequence', label: '顺序' },
  { key: 'lesson', label: '单课' },
  { key: 'sentence', label: '单句' },
];
const LEGACY_MODES = { seq: 'sequence', one: 'lesson', sent: 'sentence' };
state.mode = LEGACY_MODES[state.mode] || state.mode;

function readStored(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback));
  } catch (_) {
    return fallback;
  }
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds)) return '0:00';
  const value = Math.max(0, Math.floor(seconds));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
}

function resourceUrl(base, filename) {
  return `${base.replace(/\/$/, '')}/${encodeURIComponent(filename)}`;
}

function parseLrc(text) {
  const timePattern = /^\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\](.*)$/;
  return text.split(/\r?\n/).flatMap((raw) => {
    const match = raw.trim().match(timePattern);
    if (!match) return [];
    const fraction = match[3] ? Number(`0.${match[3]}`) : 0;
    const time = Number(match[1]) * 60 + Number(match[2]) + fraction;
    const [en = '', ...zhParts] = match[4].split('|');
    const english = en.trim();
    if (!english) return [];
    return [{ t: Math.round(time * 1000) / 1000, en: english, zh: zhParts.join('|').trim() }];
  }).sort((a, b) => a.t - b.t);
}

let toastTimer;
function toast(message) {
  const element = $('#toast');
  element.textContent = message;
  element.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { element.hidden = true; }, 1700);
}

function saveDone() {
  localStorage.setItem(STORAGE.done, JSON.stringify([...state.done]));
  $('#statDone').textContent = state.done.size;
}

function renderHome() {
  const keyword = $('#searchInput').value.trim().toLowerCase();
  const list = $('#lessonList');
  list.replaceChildren();
  let count = 0;

  const fragment = document.createDocumentFragment();
  state.book.units.forEach((unit, index) => {
    const searchable = `${unit.num} lesson ${unit.num} ${unit.title}`.toLowerCase();
    if (keyword && !searchable.includes(keyword)) return;
    count += 1;

    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `lesson${state.done.has(unit.num) ? ' is-done' : ''}`;
    button.innerHTML = `
      <span class="lesson-no">${String(unit.num).padStart(2, '0')}</span>
      <span class="lesson-body">
        <span class="lesson-title">${escapeHtml(unit.title)}</span>
        <span class="lesson-meta">${unit.lineCount || '—'} LINES · AMERICAN AUDIO</span>
      </span>
      <span class="lesson-done" aria-label="${state.done.has(unit.num) ? '已完成' : '未完成'}"></span>`;
    button.addEventListener('click', () => openUnit(index));
    item.appendChild(button);
    fragment.appendChild(item);
  });

  if (!count) {
    const empty = document.createElement('li');
    empty.className = 'empty';
    empty.textContent = '没有匹配的课程';
    fragment.appendChild(empty);
  }
  list.appendChild(fragment);
}

function renderResume() {
  const slot = $('#resumeSlot');
  slot.replaceChildren();
  const last = readStored(STORAGE.last, null);
  if (!last) return;
  const index = state.book.units.findIndex((unit) => unit.num === last.num);
  if (index < 0) return;

  const unit = state.book.units[index];
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'resume';
  button.innerHTML = `
    <span class="resume-icon"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="m8 5 11 7-11 7z"></path></svg></span>
    <span><strong>继续 Lesson ${unit.num} · ${escapeHtml(unit.title)}</strong><small>从上次的学习位置继续</small></span>
    <span class="resume-time">${formatTime(last.t)}</span>`;
  button.addEventListener('click', () => openUnit(index, last.t));
  slot.appendChild(button);
}

function escapeHtml(value) {
  const node = document.createElement('span');
  node.textContent = value || '';
  return node.innerHTML;
}

function switchView(name) {
  $('#view-home').classList.toggle('is-active', name === 'home');
  $('#view-player').classList.toggle('is-active', name === 'player');
}

async function loadLyrics(unit) {
  if (state.lyricCache.has(unit.file)) return state.lyricCache.get(unit.file);
  const url = resourceUrl(state.book.resources.lyrics, `${unit.file}.lrc`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`字幕 HTTP ${response.status}`);
  const lines = parseLrc(await response.text());
  if (!lines.length) throw new Error('字幕内容为空');
  state.lyricCache.set(unit.file, lines);
  return lines;
}

async function openUnit(index, seekTo = 0, shouldPlay = false) {
  const token = ++state.loadToken;
  state.playRequested = shouldPlay;
  audio.pause();
  state.unitIndex = index;
  state.unit = state.book.units[index];
  state.lines = [];
  state.activeLine = -1;

  $('#playerNum').textContent = `LESSON ${String(state.unit.num).padStart(2, '0')}`;
  $('#playerTitle').textContent = state.unit.title;
  $('#btnDone').classList.toggle('is-marked', state.done.has(state.unit.num));
  $('#btnPrevLesson').disabled = index === 0;
  $('#btnNextLesson').disabled = index === state.book.units.length - 1;
  $('#lyricList').replaceChildren();
  $('#lyricStatus').hidden = false;
  $('#lyricStatus').textContent = '正在载入双语字幕...';
  $('#activeIdx').textContent = '0 / 0';
  $('#progressFill').style.width = '0%';
  $('#progressThumb').style.left = '0%';
  $('#timeCur').textContent = '0:00';
  $('#timeDur').textContent = '0:00';
  switchView('player');
  if (location.hash !== '#play') history.pushState({ view: 'player' }, '', '#play');
  setAudioSource(state.unit, seekTo);
  if (shouldPlay) requestPlayback();

  try {
    const lines = await loadLyrics(state.unit);
    if (token !== state.loadToken) return;
    state.lines = lines;
    state.loopLine = state.mode === 'sentence'
      ? Math.max(0, sentenceAt(audio.currentTime || seekTo))
      : -1;
    renderLyrics();
  } catch (error) {
    if (token !== state.loadToken) return;
    $('#lyricStatus').textContent = `字幕加载失败：${error.message}`;
    $('#resourceState').textContent = 'RESOURCE ERROR';
  }
}

function renderLyrics() {
  const list = $('#lyricList');
  const fragment = document.createDocumentFragment();
  state.lines.forEach((line, index) => {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'lyric-line';
    button.dataset.index = index;
    button.innerHTML = `
      <span class="line-index">${String(index + 1).padStart(2, '0')}</span>
      <span class="line-copy">
        <span class="line-en">${escapeHtml(line.en)}</span>
        <span class="line-zh">${escapeHtml(line.zh || '暂无译文')}</span>
      </span>`;
    button.addEventListener('click', () => {
      audio.currentTime = line.t + 0.01;
      if (state.mode === 'sentence') state.loopLine = index;
      requestPlayback();
    });
    item.appendChild(button);
    fragment.appendChild(item);
  });
  const end = document.createElement('li');
  end.className = 'lyric-end';
  end.textContent = 'END OF LESSON';
  fragment.appendChild(end);
  list.replaceChildren(fragment);
  $('#lyricStatus').hidden = true;
  $('#activeIdx').textContent = `0 / ${state.lines.length}`;
  $('#lyricScroll').scrollTop = 0;
}

function setAudioSource(unit, seekTo) {
  audio.dataset.source = 'primary';
  audio.src = resourceUrl(state.book.resources.audio, `${unit.file}.mp3`);
  audio.playbackRate = state.rate;
  audio.load();
  $('#resourceState').textContent = 'JSDELIVR · LOADING';
  localStorage.setItem(STORAGE.last, JSON.stringify({ num: unit.num, t: seekTo }));

  audio.addEventListener('loadedmetadata', function onMetadata() {
    audio.removeEventListener('loadedmetadata', onMetadata);
    if (seekTo > 0 && seekTo < audio.duration) audio.currentTime = seekTo;
    $('#timeDur').textContent = formatTime(audio.duration);
    updateProgress();
  });
}

function activateAudioFallback() {
  const fallback = state.book.resources.audioFallback;
  if (!fallback || !state.unit || audio.dataset.source === 'fallback') return false;

  audio.dataset.source = 'fallback';
  const filename = `${state.unit.audioFallbackFile || state.unit.file.replace('－', '.')}.mp3`;
  audio.src = resourceUrl(fallback, filename);
  audio.load();
  $('#resourceState').textContent = 'BACKUP · LOADING';
  if (state.playRequested) {
    audio.addEventListener('canplay', () => {
      if (state.playRequested) {
        audio.play().catch(() => toast('音频加载失败，请稍后重试'));
      }
    }, { once: true });
  }
  return true;
}

function requestPlayback() {
  if (!audio.src) return;
  state.playRequested = true;
  audio.play().catch(() => {
    if (!activateAudioFallback()) toast('音频加载失败，请稍后重试');
  });
}

function sentenceAt(time) {
  let low = 0;
  let high = state.lines.length - 1;
  let answer = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (state.lines[middle].t <= time) {
      answer = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return answer;
}

function sentenceEnd(index) {
  return index + 1 < state.lines.length
    ? state.lines[index + 1].t
    : (audio.duration || Infinity);
}

function updateActive(index) {
  if (index === state.activeLine) return;
  const previous = $('#lyricList').children[state.activeLine];
  previous?.firstElementChild?.classList.remove('is-active');
  state.activeLine = index;

  const current = $('#lyricList').children[index];
  current?.firstElementChild?.classList.add('is-active');
  if (current && state.follow) {
    const scroller = $('#lyricScroll');
    scroller.scrollTo({ top: current.offsetTop - scroller.clientHeight * 0.38, behavior: 'smooth' });
  }
  $('#activeIdx').textContent = `${Math.max(0, index + 1)} / ${state.lines.length}`;
}

function updateProgress() {
  const percent = audio.duration ? Math.min(100, (audio.currentTime / audio.duration) * 100) : 0;
  $('#progressFill').style.width = `${percent}%`;
  $('#progressThumb').style.left = `${percent}%`;
  $('#progressBar').setAttribute('aria-valuenow', String(Math.round(percent)));
  $('#timeCur').textContent = formatTime(audio.currentTime);
}

function jumpSentence(direction) {
  if (!state.lines.length) return;
  const current = sentenceAt(audio.currentTime);
  let target;
  if (direction < 0) {
    const elapsed = audio.currentTime - (state.lines[current]?.t || 0);
    target = elapsed > 1.5 ? Math.max(0, current) : Math.max(0, current - 1);
  } else {
    target = Math.min(state.lines.length - 1, Math.max(0, current + 1));
  }
  if (state.mode === 'sentence') state.loopLine = target;
  audio.currentTime = state.lines[target].t + 0.01;
  requestPlayback();
}

function applyPreferences() {
  document.body.dataset.subtitleMode = state.subtitle;
  $$('#subtitleTabs button').forEach((button) => {
    const active = button.dataset.subtitle === state.subtitle;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  $('#chkFollow').checked = state.follow;
  $('#btnRate').textContent = `${state.rate.toFixed(2).replace(/0$/, '')}×`;
  $('#btnMode').textContent = MODES.find((mode) => mode.key === state.mode)?.label || MODES[0].label;
}

function bindEvents() {
  $('#searchInput').addEventListener('input', renderHome);
  $('#searchInput').addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.currentTarget.value = '';
      renderHome();
      event.currentTarget.blur();
    }
  });
  document.addEventListener('keydown', (event) => {
    const onPlayer = $('#view-player').classList.contains('is-active');
    if (!onPlayer && event.key === '/' && event.target.tagName !== 'INPUT') {
      event.preventDefault();
      $('#searchInput').focus();
      return;
    }
    if (!onPlayer || event.target.tagName === 'INPUT') return;
    if (event.code === 'Space') {
      event.preventDefault();
      $('#btnPlay').click();
    } else if (event.key === 'ArrowLeft') {
      jumpSentence(-1);
    } else if (event.key === 'ArrowRight') {
      jumpSentence(1);
    } else if (event.key === 'Escape') {
      $('#btnBack').click();
    }
  });

  $('#btnBack').addEventListener('click', () => {
    state.playRequested = false;
    audio.pause();
    renderHome();
    renderResume();
    switchView('home');
    history.replaceState(null, '', location.pathname + location.search);
  });
  $('#btnPlay').addEventListener('click', () => {
    if (!audio.src) return;
    if (audio.paused) {
      requestPlayback();
    } else {
      state.playRequested = false;
      audio.pause();
    }
  });
  $('#btnPrevSentence').addEventListener('click', () => jumpSentence(-1));
  $('#btnNextSentence').addEventListener('click', () => jumpSentence(1));
  $('#btnPrevLesson').addEventListener('click', () => {
    openUnit(state.unitIndex - 1, 0, state.playRequested || !audio.paused);
  });
  $('#btnNextLesson').addEventListener('click', () => {
    openUnit(state.unitIndex + 1, 0, state.playRequested || !audio.paused);
  });

  $('#btnDone').addEventListener('click', () => {
    const number = state.unit.num;
    state.done.has(number) ? state.done.delete(number) : state.done.add(number);
    $('#btnDone').classList.toggle('is-marked', state.done.has(number));
    saveDone();
    toast(state.done.has(number) ? '已完成本课' : '已取消完成');
  });
  $('#btnRate').addEventListener('click', () => {
    const index = RATES.indexOf(state.rate);
    state.rate = RATES[(index + 1) % RATES.length];
    audio.playbackRate = state.rate;
    localStorage.setItem(STORAGE.rate, String(state.rate));
    applyPreferences();
  });
  $('#btnMode').addEventListener('click', () => {
    const index = MODES.findIndex((mode) => mode.key === state.mode);
    state.mode = MODES[(index + 1) % MODES.length].key;
    state.loopLine = state.mode === 'sentence'
      ? Math.max(0, sentenceAt(audio.currentTime))
      : -1;
    localStorage.setItem(STORAGE.mode, state.mode);
    applyPreferences();
    toast(MODES.find((mode) => mode.key === state.mode).label);
  });
  $$('#subtitleTabs button').forEach((button) => {
    button.addEventListener('click', () => {
      state.subtitle = button.dataset.subtitle;
      localStorage.setItem(STORAGE.subtitle, state.subtitle);
      applyPreferences();
    });
  });
  $('#chkFollow').addEventListener('change', (event) => {
    state.follow = event.target.checked;
    localStorage.setItem(STORAGE.follow, state.follow ? '1' : '0');
  });

  const progress = $('#progressBar');
  const seek = (event) => {
    if (!audio.duration) return;
    const rect = progress.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    audio.currentTime = ratio * audio.duration;
    if (state.mode === 'sentence') {
      state.loopLine = Math.max(0, sentenceAt(audio.currentTime));
    }
    updateProgress();
  };
  progress.addEventListener('pointerdown', (event) => {
    state.seeking = true;
    progress.setPointerCapture(event.pointerId);
    seek(event);
  });
  progress.addEventListener('pointermove', (event) => { if (state.seeking) seek(event); });
  progress.addEventListener('pointerup', () => { state.seeking = false; });
  progress.addEventListener('keydown', (event) => {
    if (!audio.duration || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    audio.currentTime = Math.min(audio.duration, Math.max(0, audio.currentTime + (event.key === 'ArrowRight' ? 5 : -5)));
  });

  audio.addEventListener('play', () => {
    $('#btnPlay').classList.add('is-playing');
    $('#btnPlay').setAttribute('aria-label', '暂停');
  });
  audio.addEventListener('pause', () => {
    $('#btnPlay').classList.remove('is-playing');
    $('#btnPlay').setAttribute('aria-label', '播放');
  });
  audio.addEventListener('timeupdate', () => {
    if (!state.unit || state.seeking) return;
    const active = sentenceAt(audio.currentTime);
    if (
      state.mode === 'sentence'
      && state.loopLine >= 0
      && audio.currentTime >= sentenceEnd(state.loopLine) - 0.04
    ) {
      audio.currentTime = state.lines[state.loopLine].t + 0.01;
      updateActive(state.loopLine);
      updateProgress();
      return;
    }
    updateActive(active);
    updateProgress();

    const last = readStored(STORAGE.last, null);
    if (!last || last.num !== state.unit.num || Math.abs(last.t - audio.currentTime) > 3) {
      localStorage.setItem(STORAGE.last, JSON.stringify({ num: state.unit.num, t: audio.currentTime }));
    }
  });
  audio.addEventListener('ended', () => {
    if (state.mode === 'lesson') {
      audio.currentTime = 0;
      requestPlayback();
    } else if (state.mode === 'sentence' && state.loopLine >= 0) {
      audio.currentTime = state.lines[state.loopLine].t + 0.01;
      requestPlayback();
    } else if (state.unitIndex < state.book.units.length - 1) {
      openUnit(state.unitIndex + 1, 0, true);
    } else {
      toast('第三册已全部播放完成');
    }
  });
  audio.addEventListener('error', () => {
    if (!state.unit) return;
    if (activateAudioFallback()) return;
    $('#resourceState').textContent = 'AUDIO ERROR';
    if (state.playRequested) toast('音频加载失败，请稍后重试');
  });
  audio.addEventListener('canplay', () => {
    $('#resourceState').textContent = audio.dataset.source === 'fallback'
      ? 'BACKUP · READY'
      : 'JSDELIVR · READY';
  });
}

async function boot() {
  try {
    const response = await fetch('./data/catalog.json');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    state.book = await response.json();
    $('#statLessons').textContent = state.book.units.length;
    $('#statLines').textContent = state.book.lineCount;
    $('#statDone').textContent = state.done.size;
  } catch (error) {
    document.body.innerHTML = `<main class="fatal"><h1>课程数据加载失败</h1><p>${escapeHtml(error.message)}</p></main>`;
    return;
  }

  bindEvents();
  applyPreferences();
  renderHome();
  renderResume();

  const requestedLesson = Number(new URLSearchParams(location.search).get('lesson'));
  const requestedIndex = state.book.units.findIndex((unit) => unit.num === requestedLesson);
  if (requestedIndex >= 0) openUnit(requestedIndex);
}

window.addEventListener('popstate', () => {
  if (location.hash !== '#play' && $('#view-player').classList.contains('is-active')) {
    state.playRequested = false;
    audio.pause();
    renderHome();
    renderResume();
    switchView('home');
  }
});

boot();
