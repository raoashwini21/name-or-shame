/* =========================================================================
   Name Worth It? — Midnight Archive (stage 1 preview)
   One request (POST /api/name-check) returns every lookup. The workspace
   opens a case straight away, then files each finding as it is read out of
   the response, connects findings the data genuinely links, and closes with
   the assessment. Nothing here invents data.
   Add ?demo to the URL to replay a saved representative case instead.
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
  const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
  const slugOf = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

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
    { key: 'domains',    title: 'Domains',            src: 'RDAP · DNS',       meta: '6 TLDs' },
    { key: 'handles',    title: 'Social handles',     src: 'HTTP status',      meta: 'X · Instagram' },
    { key: 'collisions', title: 'Existing brands',    src: 'Web search',       meta: 'your niche' },
    { key: 'market',     title: 'Trademark mentions', src: 'Web search',       meta: 'signal only' },
    { key: 'relatives',  title: 'Similar names',      src: 'RDAP · Web search', meta: 'variants' },
    { key: 'memory',     title: 'Memorability',       src: 'Jev',              meta: 'model read' }
  ];
  const CHECK = Object.fromEntries(CHECKS.map(c => [c.key, c]));
  const icon = (k) => '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">' + ICON[k] + '</svg>';
  const GLYPH = {
    queued: '<svg viewBox="0 0 18 18"><circle cx="9" cy="9" r="7"/></svg>',
    running: '<svg viewBox="0 0 18 18"><circle cx="9" cy="9" r="7" fill="none" stroke="rgba(255,255,255,.12)" stroke-width="2"/><path d="M9 2a7 7 0 0 1 7 7" fill="none" stroke="#B89B68" stroke-width="2" stroke-linecap="round"/></svg>',
    clear: '<svg viewBox="0 0 18 18"><circle cx="9" cy="9" r="8" fill="#3D7567"/><path d="M5.5 9.2 7.9 11.5 12.6 6.6" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    found: '<svg viewBox="0 0 18 18"><circle cx="9" cy="9" r="8" fill="#B77C48"/><path d="M9 5v5" stroke="#fff" stroke-width="1.9" stroke-linecap="round"/><circle cx="9" cy="12.8" r="1.1" fill="#fff"/></svg>',
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
  //  Home: the case document fills in as you type
  // ---------------------------------------------------------------------
  function paintDoc(){
    const name = $('nameInput').value.trim(), ctx = $('context').value.trim(), slug = slugOf(name);
    $('docName').textContent = name || 'Your name';
    $('docCtx').textContent = ctx || 'What it does, in one line';
    $('docSlug').textContent = slug ? slug + '.com + 5 TLDs' : '6 TLDs';
    $('docHandle').textContent = slug ? '@' + slug + ' on X, Instagram' : 'X, Instagram';
  }
  $('nameInput').addEventListener('input', paintDoc);
  $('context').addEventListener('input', paintDoc);
  paintDoc();

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
  function leadOutcome(key, d){
    if (key === 'domains'){ const c = d.domains && d.domains.com; return c && c.available === true ? 'clear' : 'found'; }
    if (key === 'handles') return ['x', 'instagram'].some(p => d.socials && d.socials[p] && d.socials[p].taken === true) ? 'found' : 'clear';
    if (key === 'collisions') return (d.niche_matches || []).length ? 'found' : 'clear';
    if (key === 'market') return (d.trademark_matches || []).length ? 'found' : 'clear';
    if (key === 'relatives') return (d.variants || []).some(v => v.domains && v.domains.com && v.domains.com.available === true) ? 'clear' : 'found';
    if (key === 'memory') return ((d.scores.memorable ?? 0) >= 0.65 && (d.scores.too_generic ?? 0) < 0.5) ? 'clear' : 'found';
    return 'clear';
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
    const m = d.scores.memorable ?? 0, g = d.scores.too_generic ?? 0;
    return pct(d.scores.memorable) + ' memorable · ' + (m >= 0.65 && g < 0.5 ? 'strong recall' : g < 0.5 ? 'distinctive' : 'not very distinctive');
  }
  const TAG = {
    domains:    { clear: ['.com free', 'tag-ok'],       found: ['.com taken', 'tag-warn'] },
    handles:    { clear: ['Open', 'tag-ok'],            found: ['Taken', 'tag-warn'] },
    collisions: { clear: ['No conflicts', 'tag-ok'],    found: ['Conflicts', 'tag-warn'] },
    market:     { clear: ['Quiet', 'tag-ok'],           found: ['Mentions', 'tag-warn'] },
    relatives:  { clear: ['Options found', 'tag-ok'],   found: ['None free', 'tag-neutral'] },
    memory:     { clear: ['Strong', 'tag-ok'],          found: ['Mixed', 'tag-warn'] }
  };

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
        '<span><span class="lbl">' + c.title + '</span><span class="res">' + c.meta + '</span></span></button></li>').join('');
    },
    set(key, st, text){
      state.status[key] = st;
      const b = document.querySelector('.side-checks [data-k="' + key + '"]'); if (!b) return;
      b.dataset.st = st;
      b.querySelector('.st').outerHTML = glyph(st);
      if (text != null) b.querySelector('.res').textContent = text;
      const words = { queued: 'queued', running: 'running', found: 'needs a look', clear: 'clear', cold: 'no answer' };
      b.setAttribute('aria-label', CHECK[key].title + ' — ' + words[st] + (text ? ': ' + text : ''));
    },
    progress(){
      const done = CHECKS.filter(c => ['clear', 'found', 'cold'].includes(state.status[c.key])).length;
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
    reset(){
      $('grid').classList.remove('focus');
      $('grid').innerHTML = CHECKS.map(c =>
        '<article class="card pending" data-k="' + c.key + '" aria-busy="true">' +
        '<div class="card-h">' + icon(c.key) + '<h3>' + c.title + '</h3><span class="tag tag-neutral">Checking</span></div>' +
        '<p class="card-sum">Waiting on ' + c.src.toLowerCase() + '…</p><div class="sk w1"></div><div class="sk w2"></div><div class="sk w3"></div></article>').join('');
      $('findCount').textContent = '';
    },
    file(key, d){
      const el = document.querySelector('.card[data-k="' + key + '"]');
      const out = leadOutcome(key, d), tag = TAG[key][out];
      el.className = 'card filed';
      el.removeAttribute('aria-busy');
      el.tabIndex = -1;
      el.innerHTML = '<div class="card-h">' + icon(key) + '<h3>' + CHECK[key].title + '</h3><span class="tag ' + tag[1] + '">' + tag[0] + '</span></div>' +
        '<p class="card-sum">' + escapeHtml(resultLine(key, d)) + '</p>' +
        '<div class="card-src mono">' + CHECK[key].src + ' · retrieved ' + clock(state.receivedAt) + '</div>' +
        '<div class="card-body">' + BODY[key](d) + '</div>' +
        '<div class="card-foot"><span class="linked-note"></span><button class="txt-btn" type="button" data-open="' + key + '">Full evidence →</button></div>';
      requestAnimationFrame(() => requestAnimationFrame(() => el.querySelectorAll('.mb i').forEach(b => { b.style.width = b.dataset.w + '%'; })));
      el.querySelector('[data-open]').addEventListener('click', () => Drawer.open(key, el.querySelector('[data-open]')));
      el.addEventListener('mouseenter', () => Grid.focus(key));
      el.addEventListener('mouseleave', () => Grid.blur());
      el.addEventListener('focusin', () => Grid.focus(key));
      el.addEventListener('focusout', () => Grid.blur());
    },
    cold(key){
      const el = document.querySelector('.card.pending[data-k="' + key + '"]'); if (!el) return;
      el.removeAttribute('aria-busy');
      el.querySelector('.tag').textContent = 'No answer';
      el.querySelector('.card-sum').textContent = 'This lookup did not return.';
      el.querySelectorAll('.sk').forEach(s => s.remove());
    },
    // hovering a finding shows what else it is connected to
    focus(key){
      const xs = linksFor(key); if (!xs.length) return;
      $('grid').classList.add('focus');
      document.querySelector('.card[data-k="' + key + '"]').classList.add('hot');
      xs.forEach(x => { const o = document.querySelector('.card[data-k="' + x.other + '"]'); if (!o) return; o.classList.add('linked'); o.querySelector('.linked-note').textContent = 'Linked: ' + x.why; });
    },
    blur(){
      $('grid').classList.remove('focus');
      document.querySelectorAll('.card.hot, .card.linked').forEach(c => c.classList.remove('hot', 'linked'));
    }
  };
  const tag = (v, href) => href ? '<a class="tag ' + v.cls + '" href="' + href + '" target="_blank" rel="noopener" title="Register it">' + v.label + ' ↗</a>' : '<span class="tag ' + v.cls + '">' + v.label + '</span>';
  const BODY = {
    domains(d){
      const own = TLD_ORDER.map(t => d.domains && d.domains[t]).filter(Boolean);
      if (!own.length) return '<p class="empty">Could not reach the registry this run.</p>';
      return '<div class="domain-strip" aria-hidden="true">' + own.map(x => '<span class="' + domainVerdict(x).strip + '"></span>').join('') + '</div>' +
        '<table class="records" style="margin-top:12px"><tbody>' + own.map(x => { const v = domainVerdict(x);
          return '<tr><td class="d">' + escapeHtml(x.domain) + '</td><td class="s">' + tag(v, x.available === true ? buyUrl(x.domain) : null) + '</td><td class="src">' + escapeHtml((x.source || 'rdap').toUpperCase()) + '</td></tr>'; }).join('') + '</tbody></table>';
    },
    handles(d){
      const s = ['x', 'instagram'].filter(p => d.socials && d.socials[p]).map(p => d.socials[p]);
      if (!s.length) return '<p class="empty">Could not check handles this run.</p>';
      return '<table class="records"><tbody>' + s.map(x => '<tr><td>' + escapeHtml(x.label) + '</td><td class="d">' +
        (x.note ? '@' + escapeHtml(x.handle) : '<a href="' + escapeHtml(x.url) + '" target="_blank" rel="noopener">@' + escapeHtml(x.handle) + '</a>') + '</td><td class="s">' + tag(handleVerdict(x)) + '</td></tr>').join('') + '</tbody></table>';
    },
    collisions(d){
      const m = d.niche_matches || [];
      if (!m.length) return '<p class="empty">' + escapeHtml(d.serp_error || 'No existing company or product turned up for this name in your space.') + '</p>';
      return '<ul class="hits">' + m.slice(0, 3).map(x => { const r = roughRead(x);
        return '<li><div class="hm"><span class="mono">' + escapeHtml(r.host) + '</span><span class="tag ' + (r.risk === 'High' ? 'tag-warn' : 'tag-neutral') + '">' + r.risk + ' overlap</span></div>' +
          '<a class="ht" href="' + escapeHtml(x.link) + '" target="_blank" rel="noopener">' + escapeHtml(x.title) + '</a><p>' + escapeHtml(x.snippet) + '</p></li>'; }).join('') + '</ul>' +
        (m.length > 3 ? '<p class="disclaimer">' + (m.length - 3) + ' more in the full evidence.</p>' : '');
    },
    market(d){
      const m = d.trademark_matches || [];
      return (m.length ? '<ul class="hits">' + m.slice(0, 3).map(x => '<li><div class="hm"><span class="mono">' + escapeHtml(hostOf(x.link)) + '</span></div><a class="ht" href="' + escapeHtml(x.link) + '" target="_blank" rel="noopener">' + escapeHtml(x.title) + '</a></li>').join('') + '</ul>'
        : '<p class="empty">' + escapeHtml(d.trademark_error || 'Nothing turned up in a web search for trademark mentions.') + '</p>') +
        '<p class="disclaimer">A web signal, not a search of any trademark register.</p>';
    },
    relatives(d){
      const v = d.variants || [];
      if (!v.length) return '<p class="empty">No close variants for this name.</p>';
      return '<table class="records"><tbody>' + v.map(x => { const com = x.domains && x.domains.com;
        const free = TLD_ORDER.filter(t => x.domains && x.domains[t] && x.domains[t].available === true).length;
        const total = TLD_ORDER.filter(t => x.domains && x.domains[t]).length;
        return '<tr><td style="font-family:var(--f-head);font-weight:700">' + escapeHtml(x.name) + '</td><td class="d muted">' + free + '/' + total + ' free · ' + (x.niche_matches || []).length + ' in use</td><td class="s">' +
          (com ? tag(domainVerdict(com), com.available === true ? buyUrl(com.domain) : null).replace(/(Available|Registered|Likely free|Unknown)/, '.com $1') : '') + '</td></tr>'; }).join('') + '</tbody></table>';
    },
    memory(d){
      const s = d.scores;
      return '<div class="meters" style="grid-template-columns:1fr;margin-top:0">' +
        meter('Memorable', s.memorable) + meter('Easy to say & spell', s.easy_say_spell) +
        meter('Distinctive', s.too_generic == null ? null : 1 - s.too_generic) + meter('Sounds like an existing brand', s.brand_collision, true) + '</div>';
    }
  };
  function meter(label, val, risk){
    return '<div class="meter"><div class="mt"><span>' + label + '</span><span class="mono">' + pct(val) + '</span></div><div class="mb"><i class="' + (risk ? 'risk' : '') + '" data-w="' + (val == null ? 0 : Math.round(val * 100)) + '"></i></div></div>';
  }

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
      $('drKicker').textContent = 'NW-' + state.caseNum + ' · ' + CHECK[key].title;
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
      '<li data-a="' + l.a + '" data-b="' + l.b + '"><span class="chip">' + CHECK[l.a].title + '</span><span class="join" aria-hidden="true"></span><span class="chip">' + CHECK[l.b].title + '</span><p class="why">' + escapeHtml(l.why.charAt(0).toUpperCase() + l.why.slice(1)) + '</p></li>').join('')
      : '<li><p class="why">No finding here backs up another — each stands on its own.</p></li>';
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
  function renderAssessment(d){
    const scores = d.scores;
    const m = scores.memorable ?? 0;
    const e = scores.easy_say_spell ?? 0;
    const g = scores.too_generic ?? 0;
    const c = scores.brand_collision ?? 0;

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

    $('verdictLabel').textContent = DISPLAY[verdict];
    $('verdictLabel').parentElement.dataset.v = verdictClass;
    const because = [];
    if (niche) because.push(niche + ' existing use' + (niche === 1 ? '' : 's') + ' turned up in your space');
    if (com && com.available === false) because.push('the .com is already registered');
    if (hTaken.length) because.push('the handle is taken on ' + hTaken.map(x => x.label).join(' and '));
    $('stampSub').textContent = sub.charAt(0).toUpperCase() + sub.slice(1) + '.' + (because.length ? ' On the record: ' + because.join(', ') + '.' : '');
    $('meters').innerHTML = meter('Memorable', scores.memorable) + meter('Easy to say & spell', scores.easy_say_spell) +
      meter('Distinctive', scores.too_generic == null ? null : 1 - scores.too_generic) + meter('Brand collision risk', scores.brand_collision, true);

    // only options the lookups actually returned
    const next = [];
    own.filter(x => x.available === true).slice(0, 3).forEach(x => next.push('Register <a href="' + buyUrl(x.domain) + '" target="_blank" rel="noopener">' + escapeHtml(x.domain) + '</a> while it\'s free' + (x.source === 'dns' ? ' <span class="note">(DNS check — confirm first)</span>' : '')));
    viable.forEach(v => next.push('Consider <b>' + escapeHtml(v.name) + '</b> — <a href="' + buyUrl(v.domains.com.domain) + '" target="_blank" rel="noopener">' + escapeHtml(v.domains.com.domain) + '</a> is free'));
    if (hTaken.length) next.push('Plan a handle modifier for social and check it before launch');
    if (verdict === 'IMPERSONATION' || verdict === 'NO WITNESSES') next.push('Keep looking — this name carries real collision or recall risk');
    next.push('Run a formal trademark search before you file anything');
    $('nextMoves').innerHTML = next.map(t => '<li><span>' + t + '</span></li>').join('');

    $('rawPre').textContent = JSON.stringify(d.raw, null, 2);
    $('summary').hidden = false;
    requestAnimationFrame(() => requestAnimationFrame(() => $('meters').querySelectorAll('.mb i').forEach(b => { b.style.width = b.dataset.w + '%'; })));

    $('result').dataset.shareText =
      'Name Worth It case file on "' + state.name + '": ' + label + ' (' + pct(m) + ' memorable, ' + pct(e) + ' easy to say/spell, ' +
      pct(g) + ' too generic, ' + pct(c) + ' brand collision risk).';
  }

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
    $('copyBtn').disabled = true;
    $('rawOutput').style.display = 'none'; $('rawToggle').textContent = 'Show raw response';
    setStatus('running', 'Investigating');
    Side.render(); Side.progress(); Grid.reset();
    $('liveLine').innerHTML = '<b>Case opened.</b> Six lookups running in parallel.';
    // every lookup is dispatched at once on the server
    CHECKS.forEach((c, i) => queued.push(setTimeout(() => Side.set(c.key, 'running', c.src), reduceMotion ? 0 : 120 + i * 90)));
    const t0 = performance.now();
    tick = setInterval(() => { $('elapsed').textContent = ((performance.now() - t0) / 1000).toFixed(1) + 's'; }, 100);
  }

  async function fileEvidence(d){
    stopQueued();
    state.data = d;
    state.receivedAt = new Date();
    state.links = computeLinks(d);
    CHECKS.forEach(c => { if (state.status[c.key] !== 'running') Side.set(c.key, 'running', c.src); });
    $('liveLine').innerHTML = '<b>Results in' + (d.cached ? ' (from a check in the last 10 minutes)' : '') + '.</b> Filing findings…';
    const step = d.cached ? 140 : 340;
    for (const c of CHECKS){
      await sleep(step);
      const out = leadOutcome(c.key, d);
      Grid.file(c.key, d);
      Side.set(c.key, out, resultLine(c.key, d));
      state.filed++;
      Side.progress();
      $('findCount').textContent = state.filed + ' of 6 filed';
    }
    await sleep(step);
    renderLinks();
    await sleep(step);
    renderAssessment(d);
    const flagged = CHECKS.filter(c => state.status[c.key] === 'found').length;
    $('liveLine').innerHTML = '<b>Case complete.</b> ' + (flagged ? plural(flagged, 'finding') + ' need' + (flagged === 1 ? 's' : '') + ' a closer look' : 'Nothing flagged') + ' · ' + plural(state.links.length, 'connection') + '.';
    $('findCount').textContent = '6 findings';
    setStatus('complete', 'Complete');
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
      setTimeout(() => { copyBtn.textContent = 'Copy report'; }, 1500);
    }catch(e){ copyBtn.textContent = 'Copy failed'; setTimeout(() => { copyBtn.textContent = 'Copy report'; }, 2000); }
  });
  const rawToggle = $('rawToggle'), rawOutput = $('rawOutput');
  rawToggle.addEventListener('click', function(){
    const showing = rawOutput.style.display === 'block';
    rawOutput.style.display = showing ? 'none' : 'block';
    rawToggle.textContent = showing ? 'Show raw response' : 'Hide raw response';
  });
})();
