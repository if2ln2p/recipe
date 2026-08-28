(() => {
  'use strict';

  const MANIFEST_URL = 'recipes/index.json';
  const RECIPES_DIR = 'recipes/';
  const UNITS_URL = 'units.md';
  const SITE_TITLE = '우리집 레시피';

  const appEl = document.getElementById('app');

  /** @type {Map<string, object>} filename -> recipe record */
  const recipes = new Map();
  let manifestOrder = [];
  let loadError = null;

  let selectedTags = new Set();
  let query = '';
  let lastPicked = null;

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
    // related는 파일명이 아니라 레시피 이름(frontmatter의 name)으로 적는다.
    const related = Array.isArray(data.related)
      ? data.related.map((s) => String(s).trim()).filter(Boolean)
      : [];
    const thumbnail = typeof data.thumbnail === 'string'
      ? safeImageUrl(data.thumbnail.trim())
      : null;

    return { name: data.name.trim(), tags, source, servings, related, thumbnail, body };
  }

  // 썸네일 경로는 <img src>에 그대로 들어가므로 스킴을 제한한다.
  // http(s) 절대 URL이거나, 스킴 없는 상대 경로(assets/images/...)만 허용한다.
  function safeImageUrl(url) {
    if (!url) return null;
    if (/^https?:\/\//i.test(url)) return url;
    if (url.startsWith('//')) return null;              // 프로토콜 상대 URL
    if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return null;  // javascript:, data: 등
    return url;
  }

  function buildRecord(filename, raw) {
    const base = {
      filename, raw, error: null,
      name: null, tags: [], source: [], servings: null, related: [], thumbnail: null, body: '',
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
          name: null, tags: [], source: [], servings: null, related: [], thumbnail: null, body: '',
        });
      }
    }));

    buildNameIndex();
  }

  // --- 썸네일 ---
  // 레시피 md의 `thumbnail: assets/images/파일.jpg`에 적은 이미지를 목록 카드와
  // 상세 페이지에 보여준다. http(s) 주소도 쓸 수 있다.

  function thumbHtml(r, variant) {
    if (!r.thumbnail) return '';
    // 목록 카드는 스크롤을 내려야 보이므로 lazy, 상세 페이지 것은 바로 보이므로 eager.
    const loading = variant === 'card' ? 'lazy' : 'eager';
    return `
      <div class="thumb thumb-${variant}">
        <img src="${escapeHtml(r.thumbnail)}" alt="" loading="${loading}" data-thumb>
      </div>
    `;
  }

  // 경로가 틀렸거나 이미지를 못 불러오면 깨진 아이콘 대신 자리를 아예 없앤다.
  function wireThumbFallback(root) {
    root.querySelectorAll('img[data-thumb]').forEach((img) => {
      img.addEventListener('error', () => {
        const box = img.closest('.thumb');
        if (box) box.remove();
      });
      // 캐시된 실패 이미지는 리스너를 걸기 전에 이미 error가 끝났을 수 있다.
      if (img.complete && img.naturalWidth === 0) {
        const box = img.closest('.thumb');
        if (box) box.remove();
      }
    });
  }

  // --- 관련 레시피 ---
  // 레시피 md의 `related: [이름1, 이름2]`에 적힌 이름을 실제 레시피로 연결한다.
  // 파일명이 아닌 이름으로 적기 때문에 이름 -> 파일명 색인이 필요하다.

  /** @type {Map<string, string>} recipe name -> filename */
  const recipesByName = new Map();

  function buildNameIndex() {
    recipesByName.clear();
    manifestOrder.forEach((fn) => {
      const r = recipes.get(fn);
      if (!r || r.error || !r.name) return;
      // 이름이 겹치면 매니페스트에서 먼저 나온 파일을 쓴다.
      if (!recipesByName.has(r.name)) recipesByName.set(r.name, fn);
    });
  }

  // 자기 자신과 중복은 빼고, 찾지 못한 이름은 오타를 알아챌 수 있도록 그대로 돌려준다.
  function resolveRelated(r) {
    const seen = new Set();
    const found = [];
    const missing = [];

    (r.related || []).forEach((name) => {
      if (seen.has(name)) return;
      seen.add(name);

      const fn = recipesByName.get(name);
      if (fn === undefined) {
        missing.push(name);
        return;
      }
      if (fn === r.filename) return;
      found.push(recipes.get(fn));
    });

    return { found, missing };
  }

  function relatedSectionHtml(r) {
    const { found, missing } = resolveRelated(r);
    if (!found.length && !missing.length) return '';

    const foundHtml = found.map((rel) => `
      <a class="related-item" href="#/recipe/${encodeURIComponent(rel.filename)}">
        <span class="related-name">${escapeHtml(rel.name)}</span>
        ${rel.servings ? `<span class="related-meta">${escapeHtml(String(rel.servings))}인분</span>` : ''}
      </a>
    `).join('');

    const missingHtml = missing.map((name) => `
      <span class="related-item related-missing" title="이 이름의 레시피를 찾을 수 없습니다">
        <span class="related-name">${escapeHtml(name)}</span>
        <span class="related-meta">찾을 수 없음</span>
      </span>
    `).join('');

    return `
      <section class="related">
        <h3 class="related-title">관련 레시피</h3>
        <div class="related-list">${foundHtml}${missingHtml}</div>
      </section>
    `;
  }

  // --- 목록 필터 상태를 URL 해시에 반영한다 (#/?q=두부&tag=한식) ---
  // 새로고침하거나 링크를 공유해도 검색어·태그가 유지된다.

  function parseListParams(hash) {
    const i = hash.indexOf('?');
    if (i === -1) return { query: '', tags: new Set() };
    const params = new URLSearchParams(hash.slice(i + 1));
    return { query: params.get('q') || '', tags: new Set(params.getAll('tag')) };
  }

  // 그 태그 하나만 선택된 목록으로 가는 링크 (상세 페이지의 태그에 쓴다)
  function tagFilterHash(tag) {
    return `#/?${new URLSearchParams([['tag', tag]]).toString()}`;
  }

  function listHash() {
    const params = new URLSearchParams();
    if (query.trim()) params.set('q', query);
    Array.from(selectedTags)
      .sort((a, b) => a.localeCompare(b, 'ko'))
      .forEach((t) => params.append('tag', t));
    const s = params.toString();
    return s ? `#/?${s}` : '#/';
  }

  // replaceState를 쓰는 이유: location.hash에 대입하면 hashchange가 발생해
  // 목록 전체가 다시 그려지고, 그러면 검색창이 교체되어 한글 조합이 끊긴다.
  function syncListUrl() {
    const target = listHash();
    if ((location.hash || '#/') !== target) {
      history.replaceState(null, '', target);
    }
  }

  // 현재 검색어·태그 조건을 만족하는 (오류 없는) 레시피 목록
  function currentFiltered() {
    return manifestOrder
      .map((fn) => recipes.get(fn))
      .filter((r) => r && !r.error && matchesFilters(r));
  }

  function matchesFilters(r) {
    if (selectedTags.size > 0 && !Array.from(selectedTags).every((t) => r.tags.includes(t))) return false;
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      const hay = (r.name + ' ' + r.tags.join(' ') + ' ' + r.body).toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }

  function renderList() {
    document.title = SITE_TITLE;
    releaseWakeLock();

    if (loadError) {
      appEl.innerHTML = `<div class="notice notice-error">${escapeHtml(loadError)}</div>`;
      return;
    }

    appEl.innerHTML = `
      <section class="toolbar">
        <input type="search" id="search-input" class="search-input" placeholder="레시피 이름, 재료, 태그 검색..." value="${escapeHtml(query)}">
        <div class="tag-list" id="tag-list"></div>
        <div class="toolbar-footer">
          <span class="result-count" id="result-count"></span>
          <div class="toolbar-actions">
            <button type="button" id="random-btn" class="btn-reset">아무거나</button>
            <button type="button" id="reset-btn" class="btn-reset">초기화</button>
          </div>
        </div>
      </section>
      <section class="card-grid" id="card-grid"></section>
    `;

    renderResults();

    document.getElementById('search-input').addEventListener('input', (e) => {
      query = e.target.value;
      syncListUrl();
      renderResults();
    });
    document.getElementById('reset-btn').addEventListener('click', () => {
      query = '';
      selectedTags = new Set();
      syncListUrl();
      renderList();
    });
    // 현재 필터에 걸린 것들 중에서 고른다. 연달아 눌렀을 때
    // 같은 레시피가 다시 나오지 않도록 직전 것은 후보에서 뺀다.
    document.getElementById('random-btn').addEventListener('click', () => {
      let candidates = currentFiltered();
      if (!candidates.length) return;
      if (candidates.length > 1 && lastPicked) {
        const others = candidates.filter((r) => r.filename !== lastPicked);
        if (others.length) candidates = others;
      }
      const pick = candidates[Math.floor(Math.random() * candidates.length)];
      lastPicked = pick.filename;
      location.hash = `#/recipe/${encodeURIComponent(pick.filename)}`;
    });
    // 태그 목록은 검색어 입력마다 다시 그려지므로(선택 가능한 태그 좁히기),
    // 이벤트 위임으로 한 번만 등록한다.
    document.getElementById('tag-list').addEventListener('click', (e) => {
      const btn = e.target.closest('.chip[data-tag]');
      if (!btn) return;
      const t = btn.dataset.tag;
      if (selectedTags.has(t)) selectedTags.delete(t); else selectedTags.add(t);
      syncListUrl();
      renderList();
    });
  }

  // 검색창 입력마다 호출된다. 입력 요소 자체는 다시 그리지 않아야
  // 한글 입력 중 조합(IME) 상태가 끊기지 않는다.
  function renderResults() {
    const all = manifestOrder.map((fn) => recipes.get(fn)).filter(Boolean);
    const broken = all.filter((r) => r.error);
    const filtered = currentFiltered();

    renderTagList(filtered);

    const cardsHtml = filtered.map((r) => `
      <a class="card" href="#/recipe/${encodeURIComponent(r.filename)}">
        ${thumbHtml(r, 'card')}
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

    const grid = document.getElementById('card-grid');
    grid.innerHTML = cardsHtml + brokenHtml + emptyHtml;
    wireThumbFallback(grid);
    document.getElementById('result-count').textContent = `${filtered.length}개 레시피${broken.length ? ` · 오류 ${broken.length}개` : ''}`;
    document.getElementById('random-btn').disabled = filtered.length === 0;
  }

  // 현재 필터(선택된 태그 + 검색어)를 만족하는 레시피들이 가진 태그만 보여준다.
  // 태그를 선택할수록, 검색어를 입력할수록 더 이상 결과가 없는 태그는 목록에서 사라진다.
  function renderTagList(filtered) {
    const tagSet = new Set();
    filtered.forEach((r) => r.tags.forEach((t) => tagSet.add(t)));
    // 이미 선택된 태그는 결과가 0개가 되더라도 해제할 수 있도록 항상 남겨둔다.
    selectedTags.forEach((t) => tagSet.add(t));
    const tags = Array.from(tagSet).sort((a, b) => a.localeCompare(b, 'ko'));

    const chipHtml = tags.map((t) => `
      <button type="button" class="chip ${selectedTags.has(t) ? 'chip-active' : ''}" data-tag="${escapeHtml(t)}">${escapeHtml(t)}</button>
    `).join('');

    document.getElementById('tag-list').innerHTML = chipHtml || '<span class="muted">태그 없음</span>';
  }

  function renderDetail(filename, showRaw = false) {
    if (loadError) {
      appEl.innerHTML = `<div class="notice notice-error">${escapeHtml(loadError)}</div>`;
      return;
    }
    const r = recipes.get(filename);
    if (!r) {
      document.title = SITE_TITLE;
      appEl.innerHTML = `
        <a class="back-link" href="#/">← 목록으로</a>
        <div class="notice notice-error">레시피를 찾을 수 없습니다: ${escapeHtml(filename)}</div>
      `;
      return;
    }

    document.title = `${r.name || r.filename} · ${SITE_TITLE}`;
    // 주방에서 보는 화면이 조리 중 꺼지지 않도록 한다.
    requestWakeLock();

    const mode = r.raw === null ? 'raw' : (showRaw ? 'raw' : 'rendered');

    const sourceHtml = (r.source || []).map((s) => `
      <li>${s.url ? `<a href="${escapeHtml(s.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(s.title)}</a>` : escapeHtml(s.title)}</li>
    `).join('');

    appEl.innerHTML = `
      <a class="back-link" href="#/">← 목록으로</a>
      <header class="detail-header">
        ${thumbHtml(r, 'detail')}
        <h2>${escapeHtml(r.name || r.filename)}</h2>
        <div class="detail-meta">${r.servings ? `${escapeHtml(String(r.servings))}인분` : ''}</div>
        ${r.tags.length ? `<div class="card-tags">${r.tags.map((t) => `<a class="chip chip-static chip-link" href="${tagFilterHash(t)}">${escapeHtml(t)}</a>`).join('')}</div>` : ''}
        ${sourceHtml ? `<ul class="source-list">${sourceHtml}</ul>` : ''}
      </header>

      ${r.error ? `<div class="notice notice-error">이 레시피를 처리할 수 없습니다: ${escapeHtml(r.error)}</div>` : ''}

      <div id="detail-content" class="detail-content"></div>

      <div class="view-toggle" role="group">
        ${r.raw !== null ? `<button type="button" id="toggle-raw" class="toggle-btn ${mode === 'raw' ? 'toggle-active' : ''}" aria-pressed="${mode === 'raw'}">원문 보기</button>` : ''}
        ${r.raw !== null ? '<button type="button" id="copy-raw" class="btn-copy">원문 복사</button>' : ''}
      </div>

      ${relatedSectionHtml(r)}
    `;

    renderDetailContent(r, mode, document.getElementById('detail-content'));
    wireThumbFallback(appEl);

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

  // --- 계량 단위 페이지 ---
  // 내용은 units.md에 있어서 코드를 고치지 않고 단위를 추가할 수 있다.
  // 목록에 섞이지 않도록 recipes/ 밖에 둔다.

  let unitsDoc = null;

  async function loadUnits() {
    if (unitsDoc) return unitsDoc;
    try {
      const res = await fetch(UNITS_URL, { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      unitsDoc = { raw: await res.text(), error: null };
    } catch (e) {
      unitsDoc = { raw: null, error: 'units.md를 불러오지 못했습니다: ' + e.message };
    }
    return unitsDoc;
  }

  async function renderUnits() {
    document.title = `계량 단위 · ${SITE_TITLE}`;
    releaseWakeLock();

    appEl.innerHTML = `
      <a class="back-link" href="#/">← 목록으로</a>
      <div id="units-content" class="detail-content"><p class="muted">불러오는 중...</p></div>
    `;

    const doc = await loadUnits();
    const el = document.getElementById('units-content');
    if (!el) return; // 불러오는 사이 다른 화면으로 이동한 경우

    if (doc.error) {
      el.innerHTML = `<div class="notice notice-error">${escapeHtml(doc.error)}</div>`;
      return;
    }
    try {
      const html = marked.parse(doc.raw || '');
      el.innerHTML = window.DOMPurify ? DOMPurify.sanitize(html) : html;
    } catch (e) {
      el.innerHTML = `<div class="notice notice-error">렌더링 중 오류가 발생했습니다: ${escapeHtml(e.message)}</div>`;
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

  // --- 화면 꺼짐 방지 (상세 페이지에서만) ---
  // 미지원 브라우저나 절전 모드에서는 조용히 무시된다.

  let wakeLock = null;

  async function requestWakeLock() {
    if (!('wakeLock' in navigator)) return;
    if (wakeLock && !wakeLock.released) return;
    try {
      wakeLock = await navigator.wakeLock.request('screen');
    } catch (e) {
      wakeLock = null;
    }
  }

  function releaseWakeLock() {
    if (!wakeLock) return;
    const lock = wakeLock;
    wakeLock = null;
    lock.release().catch(() => {});
  }

  function isDetailRoute() {
    return /^#\/recipe\/.+/.test(location.hash || '');
  }

  function route() {
    const hash = location.hash || '#/';
    const m = /^#\/recipe\/(.+)$/.exec(hash);
    if (m) {
      renderDetail(decodeURIComponent(m[1]));
    } else if (/^#\/units(\?|$)/.test(hash)) {
      renderUnits();
    } else {
      // URL에 담긴 검색어·태그를 상태로 복원한 뒤 그린다.
      const parsed = parseListParams(hash);
      query = parsed.query;
      selectedTags = parsed.tags;
      renderList();
    }
    window.scrollTo(0, 0);
  }

  async function init() {
    marked.setOptions({ gfm: true, breaks: false });
    await loadRecipes();
    route();
    window.addEventListener('hashchange', route);
    // 화면을 껐다 켜거나 탭을 다시 열면 잠금이 해제되므로 다시 건다.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && isDetailRoute()) requestWakeLock();
    });
  }

  init();
})();
