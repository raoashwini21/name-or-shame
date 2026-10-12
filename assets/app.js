/* =========================================================================
   Name Worth It?
   One request (POST /api/name-check) returns every lookup. The workspace
   opens a case straight away, then files each finding as it is read out of
   the response, connects findings the data genuinely links, and closes with
   the assessment. Nothing here invents data.
   Demo mode: add ?demo to the URL to replay a saved representative case
   (labelled "Demo data" on screen). Without it, every case is a live lookup.
   ========================================================================= */
(function(){
  'use strict';

  const RELAY_URL = '/api/name-check';
  const DEMO = /[?&]demo\b/.test(location.search);

  const $ = (id) => document.getElementById(id);
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const sleep = (ms) => new Promise(r => setTimeout(r, reduceMotion ? 0 : ms));
  const pad2 = (n) => String(n).padStart(2, '0');
  function escapeHtml(str){
    return String(str == null ? '' : str).replace(/[&<>"']/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch]));
  }
  function pct(v){ return v === null || v === undefined ? '—' : Math.round(v * 100) + '%'; }
  function hostOf(url){ try{ return new URL(url).hostname.replace(/^www\./, '').toLowerCase(); }catch(e){ return ''; } }
  function buyUrl(domain){ return 'https://www.namecheap.com/domains/registration/results/?domain=' + encodeURIComponent(domain); }
  const clock = (d) => pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  const clockS = (d) => clock(d) + ':' + pad2(d.getSeconds());
  const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');

  const TLD_ORDER = ['com', 'io', 'net', 'ai', 'app', 'co'];
  const ICON = {
    domains: '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/>',
    handles: '<circle cx="12" cy="12" r="4"/><path d="M16 12v1.5a2.5 2.5 0 0 0 5 0V12a9 9 0 1 0-3.5 7.1"/>',
    collisions: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 21 21"/>',
    market: '<path d="M5 20V11M12 20V5M19 20v-6"/>',
    relatives: '<path d="M7 7h10M7 12h10M7 17h6"/><circle cx="18" cy="17" r="2"/>',
    memory: '<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/>'
  };
  // the order findings are filed in, with what each one is called
  const CHECKS = [
    { key: 'domains',    ex: 'A', title: 'Domains',            src: 'RDAP · DNS',        meta: '6 TLDs',        verb: 'Questioning the domain registries' },
    { key: 'handles',    ex: 'B', title: 'Social handles',     src: 'HTTP status',       meta: 'X · Instagram', verb: 'Checking who holds the handle' },
    { key: 'collisions', ex: 'C', title: 'Existing brands',    src: 'Web search',        meta: 'your niche',    verb: 'Canvassing the web for existing brands' },
    { key: 'market',     ex: 'D', title: 'Trademark mentions', src: 'Web search',        meta: 'signal only',   verb: 'Looking for trademark mentions' },
    { key: 'relatives',  ex: 'E', title: 'Similar names',      src: 'RDAP · Web search', meta: 'variants',      verb: 'Tracing close variants' },
    { key: 'memory',     ex: 'F', title: 'Memorability',       src: 'Jev',               meta: 'model read',    verb: 'Taking a read on memorability' }
  ];
  const CHECK = Object.fromEntries(CHECKS.map(c => [c.key, c]));
  const icon = (k) => '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">' + ICON[k] + '</svg>';
  const GLYPH = {
    queued: '<svg viewBox="0 0 18 18"><circle cx="9" cy="9" r="7"/></svg>',
    running: '<svg viewBox="0 0 18 18"><circle cx="9" cy="9" r="7" fill="none" stroke="rgba(255,255,255,.12)" stroke-width="2"/><path d="M9 2a7 7 0 0 1 7 7" fill="none" stroke="#B89B68" stroke-width="2" stroke-linecap="round"/></svg>',
    clear: '<svg viewBox="0 0 18 18"><circle cx="9" cy="9" r="8" fill="#3D7567"/><path d="M5.5 9.2 7.9 11.5 12.6 6.6" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    found: '<svg viewBox="0 0 18 18"><circle cx="9" cy="9" r="8" fill="#B77C48"/><path d="M9 5v5" stroke="#fff" stroke-width="1.9" stroke-linecap="round"/><circle cx="9" cy="12.8" r="1.1" fill="#fff"/></svg>',
    evidence: '<svg viewBox="0 0 18 18"><circle cx="9" cy="9" r="8" fill="#B89B68"/><circle cx="9" cy="9" r="3" fill="#fff"/></svg>',
    cold: '<svg viewBox="0 0 18 18"><circle cx="9" cy="9" r="8" fill="#5B6B73"/><path d="M6.4 6.4l5.2 5.2M11.6 6.4l-5.2 5.2" stroke="#fff" stroke-width="1.7" stroke-linecap="round"/></svg>'
  };
  const glyph = (st) => '<span class="st st-' + st + '" aria-hidden="true">' + GLYPH[st] + '</span>';

  const state = { caseNum: '0001', today: '', name: '', context: '', data: null, receivedAt: null, links: [], status: {}, filed: 0 };

  // purely cosmetic case counter, local to this browser
  try{
    const n = parseInt(localStorage.getItem('nwi_case_no') || '0', 10) + 1;
    localStorage.setItem('nwi_case_no', String(n));
    state.caseNum = String(n).padStart(4, '0');
  }catch(e){}
  try{ state.today = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); }catch(e){}
  document.querySelectorAll('[data-case-no]').forEach(el => { el.textContent = state.caseNum; });

  // ---------------------------------------------------------------------
  //  Home: the example dossier — click a record or a tab to bring it forward
  // ---------------------------------------------------------------------
  const dossier = $('dossier');
  function bringForward(name){
    const sheets = Array.from(dossier.querySelectorAll('.sheet'));
    const order = sheets.map(el => el.dataset.sheet).sort((a, b) => (a === name ? -1 : b === name ? 1 : 0) ||
      +dossier.querySelector('[data-sheet="' + a + '"]').dataset.pos - +dossier.querySelector('[data-sheet="' + b + '"]').dataset.pos);
    order.forEach((n, i) => { dossier.querySelector('[data-sheet="' + n + '"]').dataset.pos = String(i); });
    document.querySelectorAll('.dossier-tabs [data-show]').forEach(t => t.setAttribute('aria-selected', String(t.dataset.show === name)));
  }
  dossier.querySelectorAll('.sheet').forEach(el => {
    el.addEventListener('click', () => bringForward(el.dataset.sheet));
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' '){ e.preventDefault(); bringForward(el.dataset.sheet); } });
  });
  document.querySelectorAll('.dossier-tabs [data-show]').forEach(t => t.addEventListener('click', () => bringForward(t.dataset.show)));
  $('toForm').addEventListener('click', (e) => { e.preventDefault(); window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' }); setTimeout(() => $('nameInput').focus({ preventScroll: true }), 300); });

  // ---------------------------------------------------------------------
  //  Reading the evidence
  // ---------------------------------------------------------------------
  // A DNS-fallback "clear" only means nothing is delegated — a registered
  // domain with no DNS would look the same — so it's labelled "likely".
  function domainVerdict(d){
    if (!d || d.available === null || d.available === undefined) return { cls: 'tag-neutral', label: 'Unknown', strip: 'unk' };
    if (d.available === true) return { cls: 'tag-ok', label: d.source === 'dns' ? 'Likely free' : 'Available', strip: 'free' };
    return { cls: 'tag-neutral', label: 'Registered', strip: 'taken' };
  }
  function handleVerdict(s){
    if (!s || s.taken === null || s.taken === undefined) return { cls: 'tag-neutral', label: s && s.note ? 'Too long' : 'Unknown' };
    return s.taken ? { cls: 'tag-warn', label: 'Taken' } : { cls: 'tag-ok', label: 'Open' };
  }
  const STOP = new Set(['that','with','your','from','this','tool','tools','helps','help','their','them','into','about','which','where','when','what','have','will','more','than','they','team','teams','based','using','used','makes','make']);
  function roughRead(m){
    const n = state.name.toLowerCase().trim();
    const title = (m.title || '').toLowerCase();
    const text = title + ' ' + (m.snippet || '').toLowerCase();
    const reName = new RegExp('(^|[^a-z0-9])' + n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|[^a-z0-9])');
    const exact = reName.test(title);
    const words = Array.from(new Set((state.context.toLowerCase().match(/[a-z]{4,}/g) || []).filter(w => !STOP.has(w))));
    const overlap = words.filter(w => text.includes(w)).length;
    const risk = exact && overlap >= 2 ? 'High' : (exact || overlap >= 2) ? 'Medium' : 'Low';
    return { host: hostOf(m.link) || '—', match: exact ? 'Name in title' : 'Mentioned', risk };
  }
  function domainConfidence(list){
    if (list.some(x => x.available === null || x.available === undefined)) return 'Incomplete';
    return list.some(x => x.source === 'dns') ? 'Partial — DNS fallback used' : 'Verified';
  }
  function resultLine(key, d){
    if (key === 'domains'){
      const own = TLD_ORDER.map(t => d.domains && d.domains[t]).filter(Boolean);
      const c = d.domains && d.domains.com;
      if (!own.length) return 'No registry records came back';
      const free = own.filter(x => x.available === true).length;
      return (c ? c.domain + ' is ' + domainVerdict(c).label.toLowerCase() : 'No .com record') + ' · ' + free + ' of ' + own.length + ' free';
    }
    if (key === 'handles'){
      const s = ['x', 'instagram'].map(p => d.socials && d.socials[p]).filter(Boolean);
      if (!s.length) return 'Handles were not checked';
      const taken = s.filter(x => x.taken === true), open = s.filter(x => x.taken === false);
      if (taken.length === s.length) return '@' + s[0].handle + ' is taken on both';
      if (taken.length) return '@' + s[0].handle + ' is taken on ' + taken.map(x => x.label).join(', ');
      if (open.length === s.length) return '@' + s[0].handle + ' is open on both';
      return open.length ? '@' + s[0].handle + ' is open on ' + open.map(x => x.label).join(', ') : 'Could not be confirmed';
    }
    if (key === 'collisions'){ const n = (d.niche_matches || []).length; return n ? plural(n, 'existing use') + ' in your space' : (d.serp_error ? 'Search unavailable' : 'Nobody obvious in your space'); }
    if (key === 'market'){ const n = (d.trademark_matches || []).length; return n ? plural(n, 'trademark mention') + ' on the web' : (d.trademark_error ? 'Search unavailable' : 'No trademark chatter'); }
    if (key === 'relatives'){
      const v = (d.variants || []).filter(x => x.domains && x.domains.com && x.domains.com.available === true);
      if (!(d.variants || []).length) return 'No close variants';
      return v.length ? plural(v.length, 'variant') + ' with a free .com' : 'No variant has a free .com';
    }
    const m = d.scores.memorable ?? 0, g = d.scores.too_generic ?? 0, c = d.scores.brand_collision ?? 0;
    if (c >= 0.55) return 'Sounds like an existing brand · ' + pct(d.scores.brand_collision);
    return pct(d.scores.memorable) + ' memorable · ' + (m >= 0.65 && g < 0.5 ? 'strong recall' : g < 0.5 ? 'distinctive' : 'not very distinctive');
  }
  // What a filed lookup turned up, in the words the progress view uses.
  // Every branch reads a real field of the response, errors included.
  function stateOf(key, d){
    const S = (t, label) => ({ t, label });
    if (key === 'domains'){
      const own = TLD_ORDER.map(t => d.domains && d.domains[t]).filter(Boolean);
      if (!own.length) return S('unavailable', 'Source unavailable');
      const c = d.domains.com;
      return c && c.available === false ? S('review', 'Review needed') : S('done', 'Check completed');
    }
    if (key === 'handles'){
      const s = ['x', 'instagram'].map(p => d.socials && d.socials[p]).filter(Boolean);
      if (!s.length || s.every(x => x.taken === null || x.taken === undefined)) return S('unavailable', 'Inconclusive');
      return s.some(x => x.taken === true) ? S('review', 'Review needed') : S('done', 'Check completed');
    }
    if (key === 'collisions'){
      if ((d.niche_matches || []).length) return S('evidence', 'Evidence found');
      return d.serp_error ? S('unavailable', 'Source unavailable') : S('clear', 'No significant matches');
    }
    if (key === 'market'){
      if ((d.trademark_matches || []).length) return S('evidence', 'Evidence found');
      return d.trademark_error ? S('unavailable', 'Source unavailable') : S('clear', 'No significant matches');
    }
    if (key === 'relatives') return (d.variants || []).length ? S('done', 'Check completed') : S('clear', 'No significant matches');
    const m = d.scores.memorable ?? 0, g = d.scores.too_generic ?? 0, c = d.scores.brand_collision ?? 0;
    return (m < 0.5 || g >= 0.6 || c >= 0.55) ? S('review', 'Review needed') : S('done', 'Check completed');
  }
  const GLYPH_FOR = { review: 'found', evidence: 'evidence', clear: 'clear', done: 'clear', unavailable: 'cold' };

  // ---------------------------------------------------------------------
  //  Connections — only where the data genuinely relates two findings
  // ---------------------------------------------------------------------
  function computeLinks(d){
    const links = [];
    const colHosts = new Set((d.niche_matches || []).map(m => hostOf(m.link)).filter(Boolean));
    const tmHosts = new Set((d.trademark_matches || []).map(m => hostOf(m.link)).filter(Boolean));
    const takenOwn = TLD_ORDER.map(t => d.domains && d.domains[t]).filter(x => x && x.available === false).map(x => x.domain.toLowerCase());
    const hit = takenOwn.find(dom => colHosts.has(dom));
    if (hit) links.push({ a: 'domains', b: 'collisions', why: hit + ' is one of the brands in your space' });
    const shared = Array.from(tmHosts).filter(h => colHosts.has(h));
    if (shared.length) links.push({ a: 'market', b: 'collisions', why: shared[0] + ' shows up in both searches' });
    const handle = d.socials && d.socials.x && d.socials.x.handle;
    const socialHosts = ['x.com', 'twitter.com', 'instagram.com'];
    if ((d.niche_matches || []).some(m => socialHosts.includes(hostOf(m.link)) || (handle && ((m.title || '') + ' ' + (m.snippet || '')).toLowerCase().includes('@' + handle)))) {
      links.push({ a: 'handles', b: 'collisions', why: 'the handle appears in the search results' });
    }
    if ((d.variants || []).some(v => (v.niche_matches || []).length)) links.push({ a: 'relatives', b: 'collisions', why: 'variants are also in use in your space' });
    if ((d.scores.brand_collision ?? 0) >= 0.35 && (d.niche_matches || []).length) links.push({ a: 'memory', b: 'collisions', why: 'the collision read is backed by real results' });
    if ((d.variants || []).length) links.push({ a: 'relatives', b: 'domains', why: 'variants were checked against the same registries' });
    return links;
  }
  const linksFor = (key) => state.links.filter(l => l.a === key || l.b === key).map(l => ({ other: l.a === key ? l.b : l.a, why: l.why }));

  // ---------------------------------------------------------------------
  //  Sidebar checklist + progress
  // ---------------------------------------------------------------------
  const Side = {
    render(){
      $('sideChecks').innerHTML = CHECKS.map(c => '<li><button type="button" data-k="' + c.key + '" data-st="queued">' + glyph('queued') +
        '<span><span class="lbl"><b class="ex mono">' + c.ex + '</b>' + c.title + '</span><span class="res">' + c.meta + '</span></span></button></li>').join('');
    },
    set(key, st, text){
      state.status[key] = st;
      const b = document.querySelector('.side-checks [data-k="' + key + '"]'); if (!b) return;
      b.dataset.st = st;
      b.querySelector('.st').outerHTML = glyph(st);
      if (text != null) b.querySelector('.res').textContent = text;
      const words = { queued: 'queued', running: 'searching sources', found: 'review needed', evidence: 'evidence found', clear: 'completed', cold: 'no answer' };
      b.setAttribute('aria-label', CHECK[key].title + ' — ' + words[st] + (text ? ': ' + text : ''));
    },
    progress(){
      const done = CHECKS.filter(c => ['clear', 'found', 'evidence', 'cold'].includes(state.status[c.key])).length;
      $('progBar').style.width = Math.round(done / CHECKS.length * 100) + '%';
      $('progText').textContent = done === CHECKS.length ? 'All six checks in' : done + ' of 6 checks in';
    }
  };
  $('sideChecks').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-k]'); if (!b) return;
    const card = document.querySelector('.card[data-k="' + b.dataset.k + '"]');
    if (card){ card.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' }); card.focus({ preventScroll: true }); }
  });

  // ---------------------------------------------------------------------
  //  Findings
  // ---------------------------------------------------------------------
  const Grid = {
    // while the lookups run, each investigation is a slim record that says what it is searching
    reset(){
      $('grid').classList.remove('focus');
      $('grid').innerHTML = CHECKS.map(c =>
        '<article class="card pending" data-k="' + c.key + '" aria-busy="true">' +
        '<div class="card-h"><span class="exhibit mono">Exhibit ' + c.ex + '</span><h3>' + c.title + '</h3></div>' +
        '<span class="searching"><span class="spin" aria-hidden="true"></span>' + c.verb + '…</span>' +
        '<div class="redacted" aria-hidden="true"><i></i><i></i><i></i></div></article>').join('');
      $('findCount').textContent = '';
    },
    file(key, d){
      const el = document.querySelector('.card[data-k="' + key + '"]');
      const st = stateOf(key, d);
      el.className = 'card';
      el.removeAttribute('aria-busy');
      el.tabIndex = -1;
      el.innerHTML = '<div class="card-h"><span class="exhibit mono">Exhibit ' + CHECK[key].ex + '</span><h3>' + CHECK[key].title + '</h3><span class="state" data-t="' + st.t + '">' + st.label + '</span></div>' +
        '<p class="card-sum">' + escapeHtml(resultLine(key, d)) + '</p>' +
        '<div class="card-meta"><span>Source: ' + CHECK[key].src + '</span><span>·</span><span>filed ' + clockS(new Date()) + '</span></div>' +
        '<div class="card-body">' + BODY[key](d) + '</div>' +
        '<div class="card-foot"><span class="linked-note"></span><button class="txt-btn" type="button" data-open="' + key + '">Full evidence →</button></div>';
      if (!reduceMotion){
        el.classList.add('filing', 'fresh', 'declassify');
        setTimeout(() => el.classList.remove('declassify'), 900);
        el.addEventListener('animationend', () => el.classList.remove('filing'), { once: true });
        setTimeout(() => el.classList.remove('fresh'), 900);
      }
      requestAnimationFrame(() => requestAnimationFrame(() => el.querySelectorAll('.mtrack i').forEach(b => { b.style.width = b.dataset.w + '%'; })));
      el.querySelector('[data-open]').addEventListener('click', () => Drawer.open(key, el.querySelector('[data-open]')));
      el.addEventListener('mouseenter', () => Grid.focus(key));
      el.addEventListener('mouseleave', () => Grid.blur());
      el.addEventListener('focusin', () => Grid.focus(key));
      el.addEventListener('focusout', () => Grid.blur());
      return st;
    },
    cold(key){
      const el = document.querySelector('.card.pending[data-k="' + key + '"]'); if (!el) return;
      el.removeAttribute('aria-busy');
      el.classList.add('cold');
      el.querySelector('.searching').innerHTML = '<span class="spin"></span>Lookup did not return';
      const r = el.querySelector('.redacted'); if (r) r.remove();
    },
    // hovering an investigation shows what else it is connected to
    focus(key){
      const xs = linksFor(key); if (!xs.length) return;
      $('grid').classList.add('focus');
      document.querySelector('.card[data-k="' + key + '"]').classList.add('hot');
      xs.forEach(x => { const o = document.querySelector('.card[data-k="' + x.other + '"]'); if (!o || !o.querySelector('.linked-note')) return; o.classList.add('linked'); o.querySelector('.linked-note').textContent = 'Linked: ' + x.why; });
    },
    blur(){
      $('grid').classList.remove('focus');
      document.querySelectorAll('.card.hot, .card.linked').forEach(c => c.classList.remove('hot', 'linked'));
    }
  };

  // ---- one evidence format per investigation
  const st = (t, label) => '<span class="state" data-t="' + t + '">' + label + '</span>';
  const BODY = {
    // registry-style records
    domains(d){
      const own = TLD_ORDER.map(t => d.domains && d.domains[t]).filter(Boolean);
      if (!own.length) return '<p class="empty">Could not reach the registry this run.</p>';
      return '<table class="registry"><thead><tr><th>Domain</th><th>Status</th><th>Source</th></tr></thead><tbody>' + own.map(x => {
        const v = domainVerdict(x), cls = x.available === true ? 'free' : x.available === false ? 'taken' : '';
        const status = x.available === true ? '<a href="' + buyUrl(x.domain) + '" target="_blank" rel="noopener" title="Register ' + escapeHtml(x.domain) + '">' + v.label + ' ↗</a>'
          : '<span class="' + (x.available === false ? 'taken-l' : 'unk-l') + '">' + v.label + '</span>';
        return '<tr class="' + cls + '"><td class="d">' + escapeHtml(x.domain) + '</td><td>' + status + '</td><td class="src">' + escapeHtml((x.source || 'rdap').toUpperCase()) + '</td></tr>'; }).join('') + '</tbody></table>';
    },
    // compact profile extracts
    handles(d){
      const s = ['x', 'instagram'].filter(p => d.socials && d.socials[p]).map(p => d.socials[p]);
      if (!s.length) return '<p class="empty">Could not check handles this run.</p>';
      return '<div class="profiles">' + s.map(x => { const v = handleVerdict(x);
        return '<div class="profile"><span class="av" aria-hidden="true">' + (x.platform === 'x' ? 'X' : 'IG') + '</span><div style="min-width:0"><div class="h">@' + escapeHtml(x.handle) + '</div>' +
          '<div class="p">' + escapeHtml(x.label) + (x.note ? ' · ' + escapeHtml(x.note) : ' · <a href="' + escapeHtml(x.url) + '" target="_blank" rel="noopener">open profile ↗</a>') + '</div></div>' +
          st(v.label === 'Taken' ? 'review' : v.label === 'Open' ? 'clear' : 'unavailable', v.label) + '</div>'; }).join('') + '</div>';
    },
    // company intelligence briefs
    collisions(d){
      const m = d.niche_matches || [];
      if (!m.length) return emptySig(d.serp_error || 'No existing company or product turned up for this name in your space.');
      const bars = (r) => { const n = r === 'High' ? 3 : r === 'Medium' ? 2 : 1; return '<span class="overlap">' + [1, 2, 3].map(i => '<i class="' + (i <= n ? 'on' : '') + '"></i>').join('') + r + ' overlap</span>'; };
      return '<div class="briefs">' + m.slice(0, 3).map(x => { const r = roughRead(x);
        return '<div class="brief" data-r="' + r.risk + '"><div class="brief-top"><span class="mono">' + escapeHtml(r.host) + '</span>' + bars(r.risk) + '</div>' +
          '<a class="bt" href="' + escapeHtml(x.link) + '" target="_blank" rel="noopener">' + escapeHtml(x.title) + '</a><p>' + escapeHtml(x.snippet) + '</p>' +
          '<div class="basis">Basis: ' + r.match.toLowerCase() + (r.risk !== 'Low' ? ', overlaps your description' : '') + '</div></div>'; }).join('') + '</div>' +
        (m.length > 3 ? '<p class="disclaimer">' + (m.length - 3) + ' more in the full evidence.</p>' : '');
    },
    // formal search findings
    market(d){
      const m = d.trademark_matches || [];
      return '<dl class="scope"><dt>Query</dt><dd class="mono">"' + escapeHtml(state.name) + '" trademark</dd><dt>Scope</dt><dd>Open web only — no trademark register was searched</dd><dt>Findings</dt><dd>' + m.length + '</dd></dl>' +
        (m.length ? '<ol class="formal">' + m.slice(0, 3).map(x => '<li><div><a href="' + escapeHtml(x.link) + '" target="_blank" rel="noopener">' + escapeHtml(x.title) + '</a><div class="src">' + escapeHtml(hostOf(x.link)) + '</div></div></li>').join('') + '</ol>'
          : '<p class="empty" style="margin-top:12px">' + escapeHtml(d.trademark_error || 'No trademark mentions turned up.') + '</p>');
    },
    // the subject against its variants
    relatives(d){
      const v = d.variants || [];
      if (!v.length) return '<p class="empty">No close variants for this name.</p>';
      const dots = (doms) => '<span class="tld-dots" aria-hidden="true">' + TLD_ORDER.map(t => { const x = doms && doms[t]; return '<i class="' + (!x ? '' : x.available === true ? 'f' : x.available === false ? 't' : '') + '"></i>'; }).join('') + '</span>';
      const freeOf = (doms) => TLD_ORDER.filter(t => doms && doms[t] && doms[t].available === true).length;
      const com = (doms) => { const c = doms && doms.com; return !c ? '—' : c.available === true ? '<span class="com-ok">Free</span>' : c.available === false ? '<span class="com-no">Registered</span>' : '<span class="muted">Unknown</span>'; };
      const row = (nm, sub, doms, inUse, cls) => '<tr class="' + cls + '"><td class="nm">' + escapeHtml(nm) + (sub ? '<small>' + sub + '</small>' : '') + '</td><td>' + com(doms) + '</td><td>' + dots(doms) + ' <span class="muted small">' + freeOf(doms) + '/6</span></td><td>' + inUse + '</td></tr>';
      return '<table class="compare"><thead><tr><th>Name</th><th>.com</th><th>TLDs free</th><th>In your space</th></tr></thead><tbody>' +
        row(state.name, 'Subject', d.domains, (d.niche_matches || []).length, 'subject') +
        v.map(x => row(x.name, '', x.domains, (x.niche_matches || []).length, '')).join('') + '</tbody></table>';
    },
    // the four scores against the lines the verdict is drawn on
    memory(d){
      const s = d.scores;
      const row = (label, val, tick, risk) => '<div class="mrow"><div class="mt"><span>' + label + '</span><span class="mono">' + pct(val) + '</span></div>' +
        '<div class="mtrack"><i class="' + (risk ? 'risk' : '') + '" data-w="' + (val == null ? 0 : Math.round(val * 100)) + '"></i><span class="tick" style="left:' + tick + '%" title="Verdict threshold: ' + tick + '%"></span></div></div>';
      return '<div class="mviz">' + row('Memorable', s.memorable, 65) + row('Easy to say & spell', s.easy_say_spell, 60) +
        row('Distinctive', s.too_generic == null ? null : 1 - s.too_generic, 50) + row('Sounds like an existing brand', s.brand_collision, 55, true) +
        '<p class="mcap">Marks show the thresholds the verdict uses</p></div>';
    }
  };
  const emptySig = (text) => '<p class="empty-sig"><svg aria-hidden="true"><use href="#sig"/></svg><span>' + escapeHtml(text) + '</span></p>';

  // ---------------------------------------------------------------------
  //  Drawer — the full evidence for one finding
  // ---------------------------------------------------------------------
  const Drawer = {
    returnTo: null,
    open(key, from){
      const d = state.data; if (!d) return;
      this.returnTo = from || null;
      const meta = [['Retrieved', clock(state.receivedAt) + ', ' + state.today]];
      let items = '';
      const tg = (v, href) => href ? '<a class="tag ' + v.cls + '" href="' + href + '" target="_blank" rel="noopener">' + v.label + ' — register ↗</a>' : '<span class="tag ' + v.cls + '">' + v.label + '</span>';
      if (key === 'domains'){
        const own = TLD_ORDER.map(t => d.domains && d.domains[t]).filter(Boolean);
        meta.push(['Source', Array.from(new Set(own.map(x => (x.source || 'rdap').toUpperCase()))).join(' / ') || 'RDAP'], ['Confidence', domainConfidence(own)]);
        const row = (x) => { const v = domainVerdict(x); return '<div class="dr-item"><div class="row"><span class="mono">' + escapeHtml(x.domain) + '</span>' + tg(v, x.available === true ? buyUrl(x.domain) : null) + '</div>' +
          '<div class="mt mono">' + escapeHtml((x.source || 'rdap').toUpperCase()) + (x.source === 'dns' ? ' — RDAP was inconclusive; ' + (x.available === true ? 'no NS records found' : x.available === false ? 'NS records found' : 'DNS did not answer') : '') + '</div></div>'; };
        items = own.map(row).join('') + ((d.variants || []).length ? '<h3 class="h-sm" style="margin-top:20px">Similar names</h3>' + d.variants.map(v => TLD_ORDER.map(t => v.domains && v.domains[t]).filter(Boolean).map(row).join('')).join('') : '');
      } else if (key === 'handles'){
        meta.push(['Source', 'HTTP status check'], ['Method', '200 = taken · 404 = open · anything else = unknown']);
        items = ['x', 'instagram'].filter(p => d.socials && d.socials[p]).map(p => { const x = d.socials[p];
          return '<div class="dr-item"><div class="row"><span>@' + escapeHtml(x.handle) + ' on ' + escapeHtml(x.label) + '</span>' + tg(handleVerdict(x)) + '</div>' +
            '<div class="mt">' + (x.note ? escapeHtml(x.note) : '<a href="' + escapeHtml(x.url) + '" target="_blank" rel="noopener">' + escapeHtml(x.url) + ' ↗</a>') + '</div></div>'; }).join('') || '<p>Handles were not checked this run.</p>';
      } else if (key === 'collisions'){
        meta.push(['Source', 'Web search: "' + state.name + '" + your one-liner'], ['Confidence', 'Rough read of the search snippets']);
        items = (d.niche_matches || []).map(x => { const r = roughRead(x); return '<div class="dr-item"><div class="mt"><span class="mono">' + escapeHtml(r.host) + '</span> · ' + r.match + ' · ' + r.risk.toLowerCase() + ' overlap</div>' +
          '<a class="tt" href="' + escapeHtml(x.link) + '" target="_blank" rel="noopener">' + escapeHtml(x.title) + '</a><p>' + escapeHtml(x.snippet) + '</p></div>'; }).join('') ||
          '<p>' + escapeHtml(d.serp_error || 'No existing company or product turned up in your space.') + '</p>';
      } else if (key === 'market'){
        meta.push(['Source', 'Web search: "' + state.name + '" trademark'], ['Confidence', 'Signal — not a register search']);
        items = (d.trademark_matches || []).map(x => '<div class="dr-item"><div class="mt mono">' + escapeHtml(hostOf(x.link)) + '</div><a class="tt" href="' + escapeHtml(x.link) + '" target="_blank" rel="noopener">' + escapeHtml(x.title) + '</a><p>' + escapeHtml(x.snippet) + '</p></div>').join('') ||
          '<p>' + escapeHtml(d.trademark_error || 'No trademark mentions turned up in web search. Still not a clearance.') + '</p>';
      } else if (key === 'relatives'){
        meta.push(['Source', 'RDAP · web search']);
        items = (d.variants || []).map(v => '<div class="dr-item"><div class="tt">' + escapeHtml(v.name) + '</div>' +
          '<div class="mt mono" style="margin-top:6px">' + TLD_ORDER.filter(t => v.domains && v.domains[t]).map(t => '.' + t + ' ' + domainVerdict(v.domains[t]).label.toLowerCase()).join(' · ') + '</div>' +
          ((v.niche_matches || []).length ? v.niche_matches.map(m => '<p><a href="' + escapeHtml(m.link) + '" target="_blank" rel="noopener">' + escapeHtml(m.title) + '</a></p>').join('') : '<p>' + escapeHtml(v.serp_error || 'Not seen in your space.') + '</p>') + '</div>').join('') || '<p>No close variants for this name.</p>';
      } else {
        meta.push(['Source', 'Jev assessment'], ['Confidence', 'Model judgement']);
        const s2 = d.scores;
        items = [['Memorable — sticks after hearing it once', s2.memorable], ['Easy to say & spell', s2.easy_say_spell], ['Too generic (lower is better)', s2.too_generic], ['Sounds like an existing brand (lower is better)', s2.brand_collision]]
          .map(r => '<div class="dr-item"><div class="row"><span>' + escapeHtml(r[0]) + '</span><span class="mono">' + pct(r[1]) + '</span></div></div>').join('');
      }
      const xr = linksFor(key);
      $('drKicker').textContent = 'NW-' + state.caseNum + ' · Exhibit ' + CHECK[key].ex;
      $('drBody').innerHTML = '<span class="muted small">' + escapeHtml(resultLine(key, d)) + '</span><h2 class="dr-title" id="drTitle">' + CHECK[key].title + '</h2>' +
        '<dl class="dr-meta">' + meta.map(m => '<dt>' + m[0] + '</dt><dd>' + escapeHtml(m[1]) + '</dd>').join('') + '</dl>' + items +
        (xr.length ? '<h3 class="h-sm" style="margin-top:22px">Connected findings</h3>' + xr.map(x => '<div class="dr-item"><b>' + CHECK[x.other].title + '</b> — ' + escapeHtml(x.why) + '</div>').join('') : '');
      $('drawer').classList.add('on'); $('drawer').setAttribute('aria-hidden', 'false');
      $('scrim').classList.add('on');
      $('drClose').focus({ preventScroll: true });
    },
    close(){
      if (!$('drawer').classList.contains('on')) return;
      $('drawer').classList.remove('on'); $('drawer').setAttribute('aria-hidden', 'true');
      $('scrim').classList.remove('on');
      if (this.returnTo) this.returnTo.focus({ preventScroll: true });
    }
  };
  $('drClose').addEventListener('click', () => Drawer.close());
  $('scrim').addEventListener('click', () => Drawer.close());
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') Drawer.close(); });

  // ---------------------------------------------------------------------
  //  Connections list
  // ---------------------------------------------------------------------
  function renderLinks(){
    $('linksSec').hidden = false;
    $('linkList').innerHTML = state.links.length ? state.links.map(l =>
      '<li data-a="' + l.a + '" data-b="' + l.b + '"><span class="chip"><b class="mono">' + CHECK[l.a].ex + '</b> ' + CHECK[l.a].title + '</span><span class="join" aria-hidden="true"></span><span class="chip"><b class="mono">' + CHECK[l.b].ex + '</b> ' + CHECK[l.b].title + '</span><p class="why">' + escapeHtml(l.why.charAt(0).toUpperCase() + l.why.slice(1)) + '</p></li>').join('')
      : '<li>' + emptySig('No investigation here backs up another — each stands on its own.') + '</li>';
    $('linkList').querySelectorAll('li[data-a]').forEach(li => {
      li.addEventListener('mouseenter', () => { $('grid').classList.add('focus'); [li.dataset.a, li.dataset.b].forEach(k => document.querySelector('.card[data-k="' + k + '"]').classList.add('linked')); });
      li.addEventListener('mouseleave', () => Grid.blur());
    });
  }

  // ---------------------------------------------------------------------
  //  Assessment — verdict logic unchanged from the live app
  // ---------------------------------------------------------------------
  const CLASSIFICATION = { IMPERSONATION: 'HIGH COLLISION', 'NO WITNESSES': 'LOW RECALL', CLEARED: 'CLEARED', 'UNDER WATCH': 'UNDER WATCH' };
  const DISPLAY = { IMPERSONATION: 'High collision risk', 'NO WITNESSES': 'Low recall', CLEARED: 'Cleared', 'UNDER WATCH': 'Under watch' };
  // the direct answer to "is this name worth pursuing?"
  const ANSWER = { IMPERSONATION: 'Not as it stands.', 'NO WITNESSES': 'Probably not.', CLEARED: 'Yes — worth pursuing.', 'UNDER WATCH': 'Possibly, with caution.' };

  // the three findings that matter most: risks first, by weight, then strengths
  function keyFindings(d){
    const out = [];
    const s = d.scores, m = s.memorable ?? 0, g = s.too_generic ?? 0, c = s.brand_collision ?? 0;
    const own = TLD_ORDER.map(t => d.domains && d.domains[t]).filter(Boolean);
    const com = d.domains && d.domains.com;
    const free = own.filter(x => x.available === true);
    const niche = d.niche_matches || [], tm = d.trademark_matches || [];
    const hTaken = ['x', 'instagram'].map(p => d.socials && d.socials[p]).filter(x => x && x.taken === true);
    const viable = (d.variants || []).filter(v => v.domains && v.domains.com && v.domains.com.available === true);
    const add = (t, w, key, title, detail) => out.push({ t, w, key, title, detail });
    if (niche.length){
      const hi = niche.filter(x => roughRead(x).risk === 'High').length;
      add('risk', 90 + niche.length, 'collisions', plural(niche.length, 'existing brand') + ' already use the name in your space', hi ? hi + ' with high overlap, including ' + roughRead(niche[0]).host : 'Top result: ' + roughRead(niche[0]).host);
    }
    if (c >= 0.55) add('risk', 85, 'memory', 'It sounds like a brand that already exists', 'Brand collision read ' + pct(c) + ' — the verdict line is 55%');
    if (s.memorable != null && m < 0.5) add('risk', 80, 'memory', 'It may not stick', pct(m) + ' memorable — below the 50% line');
    if (com && com.available === false) add('risk', 70, 'domains', com.domain + ' is registered', free.length ? free.length + ' of ' + own.length + ' TLDs free: ' + free.slice(0, 2).map(x => x.domain).join(', ') : 'None of the six TLDs is free');
    if (tm.length) add('risk', 65, 'market', plural(tm.length, 'trademark mention') + ' on the open web', 'A signal only — check the register before filing');
    if (hTaken.length) add('risk', 60, 'handles', '@' + hTaken[0].handle + ' is taken on ' + hTaken.map(x => x.label).join(' and '), "You'd need a modifier on social");
    if (com && com.available === true) add('strength', 55, 'domains', com.domain + ' is available', 'Confirmed via ' + (com.source === 'dns' ? 'DNS — verify before buying' : 'the registry'));
    if (!niche.length && !d.serp_error) add('strength', 50, 'collisions', 'No existing brand in your space', 'Web search for the name with your description');
    if (viable.length) add('strength', 45, 'relatives', viable[0].name + ' has a free .com', viable.length > 1 ? 'And ' + (viable.length - 1) + ' more variant' + (viable.length > 2 ? 's' : '') : 'A close variant to fall back on');
    if (m >= 0.65) add('strength', 40, 'memory', 'It sticks — ' + pct(m) + ' memorable', pct(s.easy_say_spell) + ' easy to say and spell');
    return out.sort((a, b) => (a.t === b.t ? b.w - a.w : a.t === 'risk' ? -1 : 1)).slice(0, 3);
  }

  function renderReport(d){
    const scores = d.scores;
    const m = scores.memorable ?? 0;
    const e = scores.easy_say_spell ?? 0;
    const g = scores.too_generic ?? 0;
    const c = scores.brand_collision ?? 0;

    // verdict logic unchanged from the live app
    let verdict, verdictClass, sub;
    if (c >= 0.55){
      verdict = 'IMPERSONATION'; verdictClass = 'bad';
      sub = "lands too close to an existing name — expect confusion, maybe a letter from their lawyer";
    } else if (g >= 0.6 && m < 0.5){
      verdict = 'NO WITNESSES'; verdictClass = 'bad';
      sub = "nothing distinctive enough for anyone to remember it afterward";
    } else if (m >= 0.65 && e >= 0.6 && g < 0.5 && c < 0.35){
      verdict = 'CLEARED'; verdictClass = 'good';
      sub = 'distinctive, sayable, and clear of the obvious collisions — case closed';
    } else {
      verdict = 'UNDER WATCH'; verdictClass = 'mid';
      sub = 'not ruled out, not ruled in — at least one thing here needs a second look';
    }
    const label = CLASSIFICATION[verdict];

    const own = TLD_ORDER.map(t => d.domains && d.domains[t]).filter(Boolean);
    const com = d.domains && d.domains.com;
    const hTaken = ['x', 'instagram'].map(p => d.socials && d.socials[p]).filter(x => x && x.taken === true);
    const niche = (d.niche_matches || []).length;
    const viable = (d.variants || []).filter(v => v.domains && v.domains.com && v.domains.com.available === true);

    $('rpFiled').textContent = 'Case closed ' + clock(state.receivedAt) + ', ' + state.today;
    $('rpVerdict').dataset.v = verdictClass;
    $('rpQuestion').textContent = 'Is ' + state.name + ' worth pursuing?';
    $('verdictLabel').textContent = ANSWER[verdict];
    $('stampSub').textContent = sub.charAt(0).toUpperCase() + sub.slice(1) + '.';
    $('rpClass').textContent = DISPLAY[verdict];
    $('rpClass').dataset.v = verdictClass;
    $('rpScores').textContent = pct(m) + ' memorable · ' + pct(e) + ' easy to say · ' + pct(g) + ' generic · ' + pct(c) + ' collision';

    $('keyFindings').innerHTML = keyFindings(d).map((k, i) => '<li data-t="' + k.t + '"><span class="rk" aria-hidden="true">' + (k.t === 'risk' ? '!' : '✓') + '</span><div>' +
      '<div class="kt">' + escapeHtml(k.title) + '</div><div class="kd">' + escapeHtml(k.detail) + '</div>' +
      '<button class="kl" type="button" data-goto="' + k.key + '">See exhibit ' + CHECK[k.key].ex + ' — ' + CHECK[k.key].title.toLowerCase() + ' ↓</button></div></li>').join('');
    $('keyFindings').querySelectorAll('[data-goto]').forEach(b => b.addEventListener('click', () => {
      const card = document.querySelector('.card[data-k="' + b.dataset.goto + '"]'); if (!card) return;
      card.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
      card.classList.add('spot'); setTimeout(() => card.classList.remove('spot'), 1600);
    }));

    // only options the lookups actually returned
    const next = [];
    own.filter(x => x.available === true).slice(0, 3).forEach(x => next.push('Register <a href="' + buyUrl(x.domain) + '" target="_blank" rel="noopener">' + escapeHtml(x.domain) + '</a> while it\'s free' + (x.source === 'dns' ? ' <span class="note">(DNS check — confirm first)</span>' : '')));
    viable.forEach(v => next.push('Consider <b>' + escapeHtml(v.name) + '</b> — <a href="' + buyUrl(v.domains.com.domain) + '" target="_blank" rel="noopener">' + escapeHtml(v.domains.com.domain) + '</a> is free'));
    if (hTaken.length) next.push('Plan a handle modifier for social and check it before launch');
    if (verdict === 'IMPERSONATION' || verdict === 'NO WITNESSES') next.unshift('Keep looking — this name carries real collision or recall risk');
    next.push('Run a formal trademark search before you file anything');
    $('nextMoves').classList.remove('all');
    $('nextMoves').innerHTML = next.map((t, i) => '<li class="' + (i >= 3 ? 'extra' : '') + '"><span>' + t + '</span></li>').join('');
    const more = $('moreMoves');
    more.hidden = next.length <= 3;
    more.textContent = 'Show ' + (next.length - 3) + ' more';

    $('rawPre').textContent = JSON.stringify(d.raw, null, 2);
    $('summary').hidden = false;

    $('result').dataset.shareText =
      'Name Worth It case file on "' + state.name + '": ' + label + ' (' + pct(m) + ' memorable, ' + pct(e) + ' easy to say/spell, ' +
      pct(g) + ' too generic, ' + pct(c) + ' brand collision risk).';
    return { verdict, verdictClass };
  }
  $('moreMoves').addEventListener('click', () => { $('nextMoves').classList.add('all'); $('moreMoves').hidden = true; });

  // ---------------------------------------------------------------------
  //  Views, status, errors
  // ---------------------------------------------------------------------
  function showView(which){
    $('home').classList.toggle('on', which === 'home');
    $('workspace').classList.toggle('on', which === 'workspace');
    window.scrollTo(0, 0);
  }
  function setStatus(s, text){
    $('statusPill').dataset.s = s; $('statusText').textContent = text;
    $('workspace').dataset.phase = s;
  }
  function showError(title, detail, extra){
    const inWs = $('workspace').classList.contains('on');
    const box = inWs ? $('wsError') : $('errorBox');
    box.innerHTML = '<strong>' + escapeHtml(title) + '</strong><br>' + escapeHtml(detail) + (extra ? '<pre>' + escapeHtml(extra) + '</pre>' : '') +
      (inWs ? '<br><button class="btn btn-ghost btn-sm" type="button" data-back>Try another name</button>' : '');
    box.style.display = 'block';
    const back = box.querySelector('[data-back]');
    if (back) back.addEventListener('click', newCase);
  }
  function hideError(){ ['errorBox', 'wsError'].forEach(id => { $(id).style.display = 'none'; $(id).innerHTML = ''; }); }

  // ---------------------------------------------------------------------
  //  The investigation
  // ---------------------------------------------------------------------
  let tick = null, queued = [];
  function stopQueued(){ clearInterval(tick); queued.forEach(clearTimeout); queued = []; }

  function openCase(name, context){
    state.name = name; state.context = context; state.data = null; state.links = []; state.status = {}; state.filed = 0;
    const opened = new Date();
    $('openedAt').textContent = 'Opened ' + clock(opened);
    $('sideName').textContent = name; $('sideCtx').textContent = context;
    $('wsName').textContent = name; $('wsCtx').textContent = context;
    $('demoTag').hidden = !DEMO;
    $('summary').hidden = true; $('linksSec').hidden = true;
    $('findingsH').textContent = 'Exhibits';
    $('copyBtn').disabled = true;
    $('rawOutput').style.display = 'none'; $('rawToggle').textContent = 'Show raw response';
    setStatus('running', 'Investigating');
    Side.render(); Side.progress(); Grid.reset();
    $('liveLine').innerHTML = '<b>Case NW-' + state.caseNum + ' opened.</b> Six lines of inquiry running in parallel.';
    // every lookup is dispatched at once on the server
    CHECKS.forEach((c, i) => queued.push(setTimeout(() => Side.set(c.key, 'running', c.src), reduceMotion ? 0 : 120 + i * 90)));
    const t0 = performance.now();
    let n = 0;
    tick = setInterval(() => {
      $('elapsed').textContent = ((performance.now() - t0) / 1000).toFixed(1) + 's';
      // all six run at once on the server; the line names each line of inquiry in turn
      if (++n % 14 === 0){ const c = CHECKS[(n / 14) % CHECKS.length]; $('liveLine').innerHTML = '<b>' + c.verb + '…</b> <span class="muted">Six lines of inquiry open.</span>'; }
    }, 100);
  }

  async function fileEvidence(d){
    stopQueued();
    state.data = d;
    state.receivedAt = new Date();
    state.links = computeLinks(d);
    CHECKS.forEach(c => { if (state.status[c.key] !== 'running') Side.set(c.key, 'running', c.src); });
    $('liveLine').innerHTML = '<b>Sources answered' + (d.cached ? ' (a check from the last 10 minutes)' : '') + '.</b> Filing evidence…';
    const step = d.cached ? 160 : 420;
    for (const c of CHECKS){
      await sleep(step);
      const s = Grid.file(c.key, d);
      Side.set(c.key, GLYPH_FOR[s.t], s.label + ' · ' + resultLine(c.key, d));
      state.filed++;
      Side.progress();
      $('liveLine').innerHTML = '<b>Exhibit ' + CHECK[c.key].ex + ' filed.</b> ' + CHECK[c.key].title + ': ' + escapeHtml(s.label.toLowerCase()) + '.';
      $('findCount').textContent = state.filed + ' of 6 filed';
    }
    await sleep(step);
    renderLinks();
    await sleep(step);
    renderReport(d);
    const review = CHECKS.filter(c => state.status[c.key] === 'found' || state.status[c.key] === 'evidence').length;
    $('liveLine').innerHTML = '<b>Case closed.</b> ' + (review ? plural(review, 'exhibit') + ' turned up something to review' : 'Nothing to review') + ' · ' + plural(state.links.length, 'piece') + ' of linked evidence.';
    $('findingsH').textContent = 'Exhibits A–F';
    $('findCount').textContent = 'Hover one to see what it connects to';
    setStatus('complete', 'Case closed');
    $('copyBtn').disabled = false;
  }

  function holdCase(reason){
    stopQueued();
    CHECKS.forEach(c => { if (!['clear', 'found'].includes(state.status[c.key])){ Side.set(c.key, 'cold', 'No answer'); Grid.cold(c.key); } });
    Side.progress();
    $('liveLine').innerHTML = '<b>Case on hold.</b> ' + escapeHtml(reason);
    setStatus('hold', 'On hold');
  }

  async function request(name, context){
    if (DEMO){
      await new Promise(r => setTimeout(r, 2400));
      const res = await fetch('/assets/demo-case.json');
      return { status: res.status, ok: res.ok, text: await res.text() };
    }
    const res = await fetch(RELAY_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name, context: context }) });
    return { status: res.status, ok: res.ok, text: await res.text() };
  }

  async function run(){
    hideError();
    const nameEl = $('nameInput'), contextEl = $('context');
    const name = nameEl.value.trim();
    const context = contextEl.value.trim();

    if (!name){ showError('Missing name', 'Type the name you want checked.'); nameEl.focus(); return; }
    if (!context){ showError('Missing context', "Add a one-line description of what it does — it's also what gets searched for the niche check."); contextEl.focus(); return; }

    const runBtn = $('runBtn');
    runBtn.disabled = true;
    $('runBtnLabel').textContent = 'Opening case…';

    const pending = request(name, context);
    pending.catch(() => {}); // handled below, once the case is open
    await sleep(220);
    openCase(name, context);
    showView('workspace');

    try{
      const res = await pending;
      let data;
      try{ data = JSON.parse(res.text); }catch(e){ data = { raw: res.text }; }

      if (res.status === 429){
        holdCase('Too many checks right now.');
        showError('Too many checks right now', data.error || 'Give it a minute and try again.');
        return;
      }
      if (!res.ok){
        holdCase('The checker returned an error (' + res.status + ').');
        showError('Got an error back (' + res.status + ')', data.error || 'Something went wrong on the checker side.', JSON.stringify(data, null, 2));
        return;
      }
      if (!data.scores){
        holdCase('The response could not be read.');
        showError('Got a response but couldn\'t read the scores out of it', 'Raw response below.', JSON.stringify(data, null, 2));
        return;
      }
      await fileEvidence(data);
    }catch(err){
      holdCase('The checker could not be reached.');
      showError('Could not reach the checker', 'Try again in a moment.');
    }finally{
      runBtn.disabled = false;
      $('runBtnLabel').textContent = 'Investigate a name';
    }
  }

  function newCase(){
    stopQueued();
    Drawer.close();
    hideError();
    showView('home');
    setTimeout(() => { $('nameInput').focus({ preventScroll: true }); $('nameInput').select(); }, 50);
  }

  // ---------------------------------------------------------------------
  //  Wiring
  // ---------------------------------------------------------------------
  $('intakeForm').addEventListener('submit', (e) => { e.preventDefault(); if (!$('runBtn').disabled) run(); });
  $('newBtn').addEventListener('click', newCase);
  document.querySelectorAll('[data-home]').forEach(a => a.addEventListener('click', (e) => { e.preventDefault(); newCase(); }));

  const copyBtn = $('copyBtn');
  copyBtn.addEventListener('click', async function(){
    const txt = $('result').dataset.shareText || '';
    try{
      await navigator.clipboard.writeText(txt);
      copyBtn.textContent = 'Copied';
      setTimeout(() => { copyBtn.textContent = 'Copy case report'; }, 1500);
    }catch(e){ copyBtn.textContent = 'Copy failed'; setTimeout(() => { copyBtn.textContent = 'Copy case report'; }, 2000); }
  });
  const rawToggle = $('rawToggle'), rawOutput = $('rawOutput');
  rawToggle.addEventListener('click', function(){
    const showing = rawOutput.style.display === 'block';
    rawOutput.style.display = showing ? 'none' : 'block';
    rawToggle.textContent = showing ? 'Show raw response' : 'Hide raw response';
  });
})();
