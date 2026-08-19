(() => {
  'use strict';

  const MANIFEST_URL = 'recipes/index.json';
  const RECIPES_DIR = 'recipes/';

  const appEl = document.getElementById('app');

  /** @type {Map<string, object>} filename -> recipe record */
  const recipes = new Map();
  let manifestOrder = [];
  let loadError = null;

  let selectedTags = new Set();
  let query = '';

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function parseFrontmatter(raw) {
    const match = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?/.exec(raw);
    if (!match) {
      throw new Error('frontmatter(--- ... ---)를 찾을 수 없습니다.');
    }
    const yamlText = match[1];
    const body = raw.slice(match[0].length);

    let data;
    try {
      data = jsyaml.load(yamlText);
    } catch (e) {
      throw new Error('YAML frontmatter 파싱 실패: ' + e.message);
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new Error('frontmatter 형식이 올바르지 않습니다.');
    }
    if (typeof data.name !== 'string' || !data.name.trim()) {
      throw new Error('frontmatter에 name이 없습니다.');
    }

    const tags = Array.isArray(data.tags) ? data.tags.map((t) => String(t)) : [];
    const source = Array.isArray(data.source)
      ? data.source
          .filter((s) => s && typeof s === 'object' && typeof s.title === 'string')
          .map((s) => ({ title: s.title, url: typeof s.url === 'string' ? s.url : null }))
      : [];
    const servings = (typeof data.servings === 'number' || typeof data.servings === 'string')
      ? data.servings
      : null;

    return { name: data.name.trim(), tags, source, servings, body };
  }

  function buildRecord(filename, raw) {
    const base = {
      filename, raw, error: null,
      name: null, tags: [], source: [], servings: null, body: '',
    };
    try {
      const parsed = parseFrontmatter(raw);
      return Object.assign(base, parsed);
    } catch (e) {
      return Object.assign(base, { error: e.message });
    }
  }

  async function loadRecipes() {
    let manifest;
    try {
      const res = await fetch(MANIFEST_URL, { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      manifest = await res.json();
      if (!Array.isArray(manifest)) throw new Error('index.json이 배열 형식이 아닙니다.');
    } catch (e) {
      loadError = 'recipes/index.json을 불러오지 못했습니다: ' + e.message
        + ' (정적 서버로 실행 중인지, gen-manifest 스크립트로 생성되었는지 확인하세요)';
      return;
    }

    manifestOrder = manifest;

    await Promise.all(manifest.map(async (filename) => {
      try {
        const url = RECIPES_DIR + encodeURIComponent(filename);
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const raw = await res.text();
        recipes.set(filename, buildRecord(filename, raw));
      } catch (e) {
        recipes.set(filename, {
          filename, raw: null, error: '파일을 불러오지 못했습니다: ' + e.message,
          name: null, tags: [], source: [], servings: null, body: '',
        });
      }
    }));
  }

  function allTags() {
    const set = new Set();
    manifestOrder.forEach((fn) => {
      const r = recipes.get(fn);
      if (r && !r.error) r.tags.forEach((t) => set.add(t));
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'ko'));
  }

  function matchesFilters(r) {
    if (selectedTags.size > 0 && !r.tags.some((t) => selectedTags.has(t))) return false;
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      const hay = (r.name + ' ' + r.tags.join(' ') + ' ' + r.body).toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }

  function renderList() {
    if (loadError) {
      appEl.innerHTML = `<div class="notice notice-error">${escapeHtml(loadError)}</div>`;
      return;
    }

    const all = manifestOrder.map((fn) => recipes.get(fn)).filter(Boolean);
    const normal = all.filter((r) => !r.error);
    const broken = all.filter((r) => r.error);
    const filtered = normal.filter(matchesFilters);
    const tags = allTags();

    const chipHtml = tags.map((t) => `
      <button type="button" class="chip ${selectedTags.has(t) ? 'chip-active' : ''}" data-tag="${escapeHtml(t)}">${escapeHtml(t)}</button>
    `).join('');

    const cardsHtml = filtered.map((r) => `
      <a class="card" href="#/recipe/${encodeURIComponent(r.filename)}">
        <h3 class="card-title">${escapeHtml(r.name)}</h3>
        <div class="card-meta">${r.servings ? `${escapeHtml(String(r.servings))}인분` : ''}</div>
        <div class="card-tags">${r.tags.map((t) => `<span class="chip chip-static">${escapeHtml(t)}</span>`).join('')}</div>
      </a>
    `).join('');

    const brokenHtml = broken.map((r) => `
      <a class="card card-broken" href="#/recipe/${encodeURIComponent(r.filename)}">
        <h3 class="card-title">⚠ ${escapeHtml(r.filename)}</h3>
        <p class="card-error">${escapeHtml(r.error)}</p>
        <p class="card-hint">원문 보기로 열 수 있습니다</p>
      </a>
    `).join('');

    const emptyHtml = (!filtered.length && !broken.length)
      ? '<p class="muted">조건에 맞는 레시피가 없습니다.</p>'
      : '';

    appEl.innerHTML = `
      <section class="toolbar">
        <input type="search" id="search-input" class="search-input" placeholder="레시피 이름, 재료, 태그 검색..." value="${escapeHtml(query)}">
        <div class="tag-list">${chipHtml || '<span class="muted">태그 없음</span>'}</div>
        <div class="toolbar-footer">
          <span class="result-count">${filtered.length}개 레시피${broken.length ? ` · 오류 ${broken.length}개` : ''}</span>
          <button type="button" id="reset-btn" class="btn-reset">초기화</button>
        </div>
      </section>
      <section class="card-grid">
        ${cardsHtml}${brokenHtml}${emptyHtml}
      </section>
    `;

    const searchInput = document.getElementById('search-input');
    searchInput.addEventListener('input', (e) => {
      query = e.target.value;
      const caret = e.target.selectionStart;
      renderList();
      const newInput = document.getElementById('search-input');
      newInput.focus();
      newInput.setSelectionRange(caret, caret);
    });
    document.getElementById('reset-btn').addEventListener('click', () => {
      query = '';
      selectedTags = new Set();
      renderList();
    });
    appEl.querySelectorAll('.chip[data-tag]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const t = btn.dataset.tag;
        if (selectedTags.has(t)) selectedTags.delete(t); else selectedTags.add(t);
        renderList();
      });
    });
  }

  function renderDetail(filename, showRaw = false) {
    if (loadError) {
      appEl.innerHTML = `<div class="notice notice-error">${escapeHtml(loadError)}</div>`;
      return;
    }
    const r = recipes.get(filename);
    if (!r) {
      appEl.innerHTML = `
        <a class="back-link" href="#/">← 목록으로</a>
        <div class="notice notice-error">레시피를 찾을 수 없습니다: ${escapeHtml(filename)}</div>
      `;
      return;
    }

    const mode = r.raw === null ? 'raw' : (showRaw ? 'raw' : 'rendered');

    const sourceHtml = (r.source || []).map((s) => `
      <li>${s.url ? `<a href="${escapeHtml(s.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(s.title)}</a>` : escapeHtml(s.title)}</li>
    `).join('');

    appEl.innerHTML = `
      <a class="back-link" href="#/">← 목록으로</a>
      <header class="detail-header">
        <h2>${escapeHtml(r.name || r.filename)}</h2>
        <div class="detail-meta">${r.servings ? `${escapeHtml(String(r.servings))}인분` : ''}</div>
        ${r.tags.length ? `<div class="card-tags">${r.tags.map((t) => `<span class="chip chip-static">${escapeHtml(t)}</span>`).join('')}</div>` : ''}
        ${sourceHtml ? `<ul class="source-list">${sourceHtml}</ul>` : ''}
      </header>

      ${r.error ? `<div class="notice notice-error">이 레시피를 처리할 수 없습니다: ${escapeHtml(r.error)}</div>` : ''}

      <div id="detail-content" class="detail-content"></div>

      <div class="view-toggle" role="group">
        ${r.raw !== null ? `<button type="button" id="toggle-raw" class="toggle-btn ${mode === 'raw' ? 'toggle-active' : ''}" aria-pressed="${mode === 'raw'}">원문 보기</button>` : ''}
        ${r.raw !== null ? '<button type="button" id="copy-raw" class="btn-copy">원문 복사</button>' : ''}
      </div>
    `;

    renderDetailContent(r, mode, document.getElementById('detail-content'));

    const toggleBtn = document.getElementById('toggle-raw');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', () => {
        renderDetail(filename, mode !== 'raw');
      });
    }
    const copyBtn = document.getElementById('copy-raw');
    if (copyBtn) {
      copyBtn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(r.raw);
          copyBtn.textContent = '복사됨!';
        } catch (e) {
          copyBtn.textContent = '복사 실패';
        }
        setTimeout(() => { copyBtn.textContent = '원문 복사'; }, 1500);
      });
    }
  }

  function renderDetailContent(r, mode, el) {
    if (mode === 'raw') {
      if (r.raw === null) {
        el.innerHTML = '<div class="notice notice-error">원문을 불러올 수 없습니다.</div>';
      } else {
        el.innerHTML = '<pre class="raw-view"></pre>';
        el.querySelector('pre').textContent = r.raw;
      }
      return;
    }
    if (r.error) {
      el.innerHTML = '<p class="muted">렌더링할 수 없습니다. 원문 보기를 이용하세요.</p>';
      return;
    }
    try {
      const html = marked.parse(r.body || '');
      const clean = window.DOMPurify ? DOMPurify.sanitize(html) : html;
      el.innerHTML = clean;
    } catch (e) {
      el.innerHTML = `<div class="notice notice-error">마크다운 렌더링 중 오류가 발생했습니다: ${escapeHtml(e.message)}</div>`;
    }
  }

  function route() {
    const hash = location.hash || '#/';
    const m = /^#\/recipe\/(.+)$/.exec(hash);
    if (m) {
      renderDetail(decodeURIComponent(m[1]));
    } else {
      renderList();
    }
    window.scrollTo(0, 0);
  }

  async function init() {
    marked.setOptions({ gfm: true, breaks: false });
    await loadRecipes();
    route();
    window.addEventListener('hashchange', route);
  }

  init();
})();
