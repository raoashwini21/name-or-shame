/* =========================================================================
   Name Worth It? — illustrated case file
   One request (POST /api/name-check) returns every lookup at once. The
   progress list then resolves each check in turn, and the evidence board
   pins up what came back. Nothing here invents data: every line, string
   and report item is derived from the response.
   ========================================================================= */
(function(){
  'use strict';

  // Same-origin call — this page and the serverless function it hits
  // (api/name-check.js) are deployed together. No key to bring here —
  // the function runs on a server-held Jev key.
  const RELAY_URL = '/api/name-check';

  const $ = (id) => document.getElementById(id);
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const sleep = (ms) => new Promise(r => setTimeout(r, reduceMotion ? 0 : ms));
  const pad2 = (n) => String(n).padStart(2, '0');

  function escapeHtml(str){
    return String(str == null ? '' : str).replace(/[&<>"']/g, function(ch){
      return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch];
    });
  }
  function pct(v){ return v === null || v === undefined ? '—' : Math.round(v * 100) + '%'; }
  function hostOf(url){ try{ return new URL(url).hostname.replace(/^www\./, '').toLowerCase(); }catch(e){ return ''; } }
  function buyUrl(domain){ return 'https://www.namecheap.com/domains/registration/results/?domain=' + encodeURIComponent(domain); }
  function clock(d){ return pad2(d.getHours()) + ':' + pad2(d.getMinutes()); }
  const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');

  const TLD_ORDER = ['com', 'io', 'net', 'ai', 'app', 'co'];

  // the six checks, in the order they're resolved on screen
  const ICON = {
    domains: '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18M5 7.5h14M5 16.5h14"/>',
    collisions: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 L21 21"/>',
    handles: '<circle cx="12" cy="12" r="4"/><path d="M16 12v1.5a2.5 2.5 0 0 0 5 0V12a9 9 0 1 0-3.5 7.1"/>',
    market: '<path d="M6 20V10M12 20V4M18 20v-7"/>',
    relatives: '<path d="M4 12l8-8h8v8l-8 8z"/><circle cx="15.5" cy="8.5" r="1.5"/>',
    memory: '<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/>'
  };
  const CHECKS = [
    { key: 'domains',    label: 'Checking domains',          title: 'Domains',         wait: 'Querying registries…' },
    { key: 'collisions', label: 'Scanning for collisions',   title: 'Competitors',     wait: 'Searching the web…' },
    { key: 'handles',    label: 'Checking social handles',   title: 'Social handles',  wait: 'Scanning…' },
    { key: 'market',     label: 'Reading the market signal', title: 'Market signal',   wait: 'Searching…' },
    { key: 'relatives',  label: 'Tracing similar names',     title: 'Similar names',   wait: 'Trying variants…' },
    { key: 'memory',     label: 'Analyzing memorability',    title: 'Memorability',    wait: 'Almost there…' }
  ];
  const CHECK = Object.fromEntries(CHECKS.map(c => [c.key, c]));
  const icon = (k) => '<svg viewBox="0 0 24 24" aria-hidden="true">' + ICON[k] + '</svg>';

  const state = { caseNum: '0001', today: '', name: '', context: '', data: null, receivedAt: null, links: [], status: {} };

  // purely cosmetic case counter, local to this browser
  try{
    const n = parseInt(localStorage.getItem('nwi_case_no') || '0', 10) + 1;
    localStorage.setItem('nwi_case_no', String(n));
    state.caseNum = String(n).padStart(4, '0');
  }catch(e){}
  try{ state.today = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase(); }catch(e){}
  document.querySelectorAll('[data-case-no]').forEach(el => { el.textContent = state.caseNum; });
  document.querySelectorAll('.js-date').forEach(el => { el.textContent = state.today || '—'; });

  // ---------------------------------------------------------------------
  //  The name follows you through the illustrations
  // ---------------------------------------------------------------------
  function clip(s, n){ return s.length > n ? s.slice(0, n - 1) + '…' : s; }
  function paintName(raw){
    const name = (raw || '').trim() || 'your name';
    const short = clip(name, 18);
    $('artName').textContent = clip(name, 16);
    const card = $('artCard');
    card.textContent = short;
    card.setAttribute('font-size', String(Math.max(16, Math.min(40, Math.floor(300 / Math.max(short.length, 1))))));
    document.querySelectorAll('.js-name').forEach(el => { el.textContent = clip(name, 24) + '.'; });
    document.querySelectorAll('.js-name-svg').forEach(el => {
      el.textContent = clip(name, 12);
      el.setAttribute('font-size', String(Math.max(11, Math.min(21, Math.floor(110 / Math.max(clip(name, 12).length, 1))))));
    });
  }
  $('nameInput').addEventListener('input', (e) => paintName(e.target.value));
  paintName($('nameInput').value);

  // ---------------------------------------------------------------------
  //  Evidence helpers
  // ---------------------------------------------------------------------
  // DNS-fallback "clear" only means nothing is delegated — a registered
  // domain with no DNS would look the same — so it's marked "likely".
  function domainVerdict(d){
    if (!d || d.available === null || d.available === undefined) return { cls: 'unk', label: 'Unknown' };
    if (d.available === true) return { cls: 'ok', label: d.source === 'dns' ? 'Likely free' : 'Available' };
    return { cls: 'bad', label: 'Taken' };
  }
  function handleVerdict(s){
    if (!s || s.taken === null || s.taken === undefined) return { cls: 'unk', label: s && s.note ? 'Too long' : 'Unknown' };
    return s.taken ? { cls: 'bad', label: 'Taken' } : { cls: 'ok', label: 'Open' };
  }
  // Match and risk are a rough read of a search snippet against the name and the one-liner.
  const STOP = new Set(['that','with','your','from','this','tool','tools','helps','help','their','them','into','about','which','where','when','what','have','will','more','than','they','team','teams','based','using','used','makes','make']);
  function roughRead(m){
    const n = state.name.toLowerCase().trim();
    const title = (m.title || '').toLowerCase();
    const text = title + ' ' + (m.snippet || '').toLowerCase();
    const reName = new RegExp('(^|[^a-z0-9])' + n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|[^a-z0-9])');
    const exact = reName.test(title);
    const words = Array.from(new Set((state.context.toLowerCase().match(/[a-z]{4,}/g) || []).filter(w => !STOP.has(w))));
    const overlap = words.filter(w => text.includes(w)).length;
    return { host: hostOf(m.link) || '—', match: exact ? 'name in title' : 'mentioned', risk: exact && overlap >= 2 ? 'HIGH' : (exact || overlap >= 2) ? 'MEDIUM' : 'LOW' };
  }
  function retrieved(){ return state.receivedAt ? clock(state.receivedAt) : '—'; }
  function domainConfidence(list){
    if (list.some(x => x.available === null || x.available === undefined)) return 'Incomplete';
    return list.some(x => x.source === 'dns') ? 'Partial — DNS fallback' : 'Verified';
  }

  // clear (✓) or did it turn up something worth a look (!)?
  function leadOutcome(key, d){
    if (key === 'domains'){ const c = d.domains && d.domains.com; return c && c.available === true ? 'clear' : 'found'; }
    if (key === 'handles') return ['x', 'instagram'].some(p => d.socials && d.socials[p] && d.socials[p].taken === true) ? 'found' : 'clear';
    if (key === 'collisions') return (d.niche_matches || []).length ? 'found' : 'clear';
    if (key === 'market') return (d.trademark_matches || []).length ? 'found' : 'clear';
    if (key === 'relatives') return (d.variants || []).some(v => v.domains && v.domains.com && v.domains.com.available === true) ? 'clear' : 'found';
    if (key === 'memory') return ((d.scores.memorable ?? 0) >= 0.65 && (d.scores.too_generic ?? 0) < 0.5) ? 'clear' : 'found';
    return 'clear';
  }
  // the one-line result for the progress list and the board card headline
  function resultLine(key, d){
    if (key === 'domains'){
      const own = TLD_ORDER.map(t => d.domains && d.domains[t]).filter(Boolean);
      const c = d.domains && d.domains.com;
      if (!own.length) return 'No records returned';
      const free = own.filter(x => x.available === true).length;
      return c ? c.domain + ' ' + domainVerdict(c).label.toLowerCase() : free + ' of ' + own.length + ' free';
    }
    if (key === 'handles'){
      const s = ['x', 'instagram'].map(p => d.socials && d.socials[p]).filter(Boolean);
      if (!s.length) return 'Not checked';
      const taken = s.filter(x => x.taken === true), open = s.filter(x => x.taken === false);
      if (taken.length === s.length) return '@' + s[0].handle + ' taken on both';
      if (taken.length) return '@' + s[0].handle + ' taken on ' + taken.map(x => x.label).join(', ');
      if (open.length === s.length) return '@' + s[0].handle + ' open on both';
      return open.length ? '@' + s[0].handle + ' open on ' + open.map(x => x.label).join(', ') : 'Could not confirm';
    }
    if (key === 'collisions'){
      const n = (d.niche_matches || []).length;
      return n ? plural(n, 'existing use') + ' in your niche' : (d.serp_error ? 'Search unavailable' : 'No major conflicts');
    }
    if (key === 'market'){
      const n = (d.trademark_matches || []).length;
      return n ? plural(n, 'trademark mention') : (d.trademark_error ? 'Search unavailable' : 'No trademark chatter');
    }
    if (key === 'relatives'){
      const v = (d.variants || []).filter(x => x.domains && x.domains.com && x.domains.com.available === true);
      if (!(d.variants || []).length) return 'No close variants';
      return v.length ? plural(v.length, 'variant') + ' with a free .com' : 'None with a free .com';
    }
    const m = d.scores.memorable ?? 0, g = d.scores.too_generic ?? 0;
    return pct(d.scores.memorable) + ' memorable · ' + (m >= 0.65 && g < 0.5 ? 'strong potential' : g < 0.5 ? 'distinctive' : 'not very distinctive');
  }

  // ---------------------------------------------------------------------
  //  04 — the progress checklist
  // ---------------------------------------------------------------------
  const Checklist = {
    render(){
      $('checklist').innerHTML = CHECKS.map(c =>
        '<li class="check" data-k="' + c.key + '" data-st="idle">' +
        '<svg class="ci" viewBox="0 0 24 24" aria-hidden="true">' + ICON[c.key] + '</svg>' +
        '<span class="cl">' + c.label + '</span>' +
        '<span class="stat idle" aria-hidden="true"></span>' +
        '<span class="cr">Queued</span></li>').join('');
    },
    set(key, st, text){
      state.status[key] = st;
      const li = document.querySelector('.check[data-k="' + key + '"]');
      if (!li) return;
      li.dataset.st = st;
      li.querySelector('.stat').className = 'stat ' + st;
      if (text != null) li.querySelector('.cr').textContent = text;
      const words = { idle: 'queued', active: 'in progress', found: 'needs a look', clear: 'clear', cold: 'did not return' };
      li.setAttribute('aria-label', CHECK[key].label + ' — ' + words[st] + (text ? ': ' + text : ''));
    },
    now(key){ document.querySelectorAll('.check').forEach(li => li.classList.toggle('now', li.dataset.k === key)); }
  };

  // ---------------------------------------------------------------------
  //  03 — evidence cards
  // ---------------------------------------------------------------------
  const ROT = { domains: '-1.4deg', handles: '1deg', collisions: '1.6deg', relatives: '-.8deg', market: '-1.2deg', memory: '1.2deg' };
  function card(key, d, body){
    const out = leadOutcome(key, d);
    const res = resultLine(key, d);
    return '<article class="ev" data-k="' + key + '" tabindex="0" role="button" style="--r:' + ROT[key] + '" aria-label="' + escapeHtml(CHECK[key].title + ': ' + res) + ' — open evidence">' +
      '<span class="pin"></span><span class="ev-open">open ↗</span>' +
      '<div class="ev-h">' + icon(key) + '<span class="t">' + CHECK[key].title + '</span></div>' +
      '<div class="ev-res"><span class="stat ' + out + '" aria-hidden="true"></span><span>' + escapeHtml(res) + '</span></div>' +
      body + '</article>';
  }
  const tag = (v, extra) => '<span class="' + v.cls + '">' + escapeHtml(v.label) + (extra || '') + '</span>';
  const RENDER = {
    domains(d){
      const own = TLD_ORDER.map(t => d.domains && d.domains[t]).filter(Boolean);
      return '<ul class="ev-list">' + (own.length ? own.map(x => { const v = domainVerdict(x);
        return '<li><span>' + escapeHtml(x.domain) + '</span>' + (x.available === true ? '<a class="ok" href="' + buyUrl(x.domain) + '" target="_blank" rel="noopener">' + v.label + ' ↗</a>' : tag(v)) + '</li>'; }).join('')
        : '<li><span class="w">Could not reach the registry this run.</span></li>') + '</ul>';
    },
    handles(d){
      const s = ['x', 'instagram'].filter(p => d.socials && d.socials[p]).map(p => d.socials[p]);
      return '<ul class="ev-list">' + (s.length ? s.map(x => '<li><span>' + escapeHtml(x.label) + ' · @' + escapeHtml(x.handle) + '</span>' + tag(handleVerdict(x)) + '</li>').join('')
        : '<li><span class="w">Could not check handles this run.</span></li>') + '</ul>';
    },
    collisions(d){
      const m = d.niche_matches || [];
      return '<ul class="ev-list">' + (m.length ? m.slice(0, 3).map(x => { const r = roughRead(x);
        return '<li><span><a href="' + escapeHtml(x.link) + '" target="_blank" rel="noopener">' + escapeHtml(r.host) + '</a></span><span class="' + (r.risk === 'HIGH' ? 'bad' : 'unk') + '">' + r.risk.toLowerCase() + '</span></li>'; }).join('') +
        (m.length > 3 ? '<li><span class="unk">+ ' + (m.length - 3) + ' more</span></li>' : '')
        : '<li><span class="w">' + escapeHtml(d.serp_error || 'Nobody obvious is using it in your niche.') + '</span></li>') + '</ul>';
    },
    market(d){
      const m = d.trademark_matches || [];
      return '<ul class="ev-list">' + (m.length ? m.slice(0, 2).map(x => '<li><span><a href="' + escapeHtml(x.link) + '" target="_blank" rel="noopener">' + escapeHtml(hostOf(x.link)) + '</a></span></li>').join('') : '') +
        '<li><span class="w unk">' + escapeHtml(d.trademark_error || 'A web signal — not a trademark register search.') + '</span></li></ul>';
    },
    relatives(d){
      const v = d.variants || [];
      return '<ul class="ev-list">' + (v.length ? v.map(x => { const com = x.domains && x.domains.com;
        return '<li><span>' + escapeHtml(x.name) + '</span>' + (com ? tag(domainVerdict(com), '') : '<span class="unk">—</span>') + '</li>'; }).join('')
        : '<li><span class="w">No close variants for this name.</span></li>') + '</ul>';
    },
    memory(d){
      const s = d.scores;
      const row = (label, val, neg) => '<li class="meter"><span style="width:96px;flex:none">' + label + '</span><span class="bar"><i class="' + (neg ? 'neg' : '') + '" data-w="' + (val == null ? 0 : Math.round(val * 100)) + '"></i></span><span style="width:36px;text-align:right">' + pct(val) + '</span></li>';
      return '<ul class="ev-list">' + row('Memorable', s.memorable) + row('Easy to say', s.easy_say_spell) +
        row('Distinctive', s.too_generic == null ? null : 1 - s.too_generic) + row('Brand clash', s.brand_collision, true) + '</ul>';
    }
  };

  // ---------------------------------------------------------------------
  //  Strings — subject to every card; red dashes only where the data
  //  genuinely relates two pieces of evidence
  // ---------------------------------------------------------------------
  function computeLinks(d){
    const links = [];
    const colHosts = new Set((d.niche_matches || []).map(m => hostOf(m.link)).filter(Boolean));
    const tmHosts = new Set((d.trademark_matches || []).map(m => hostOf(m.link)).filter(Boolean));
    const takenOwn = TLD_ORDER.map(t => d.domains && d.domains[t]).filter(x => x && x.available === false).map(x => x.domain.toLowerCase());
    const hit = takenOwn.find(dom => colHosts.has(dom));
    if (hit) links.push({ a: 'domains', b: 'collisions', why: hit + ' is in the results' });
    const shared = Array.from(tmHosts).filter(h => colHosts.has(h));
    if (shared.length) links.push({ a: 'market', b: 'collisions', why: 'same source · ' + shared[0] });
    const handle = d.socials && d.socials.x && d.socials.x.handle;
    const socialHosts = ['x.com', 'twitter.com', 'instagram.com'];
    if ((d.niche_matches || []).some(m => socialHosts.includes(hostOf(m.link)) || (handle && ((m.title || '') + ' ' + (m.snippet || '')).toLowerCase().includes('@' + handle)))) {
      links.push({ a: 'handles', b: 'collisions', why: 'handle shows up in results' });
    }
    if ((d.variants || []).length) links.push({ a: 'relatives', b: 'domains', why: 'variant .com records' });
    if ((d.variants || []).some(v => (v.niche_matches || []).length)) links.push({ a: 'relatives', b: 'collisions', why: 'variants also sighted' });
    if ((d.scores.brand_collision ?? 0) >= 0.35 && (d.niche_matches || []).length) links.push({ a: 'memory', b: 'collisions', why: 'clash read backed by results' });
    return links;
  }
  const linksFor = (key) => state.links.filter(l => l.a === key || l.b === key).map(l => ({ other: l.a === key ? l.b : l.a, why: l.why }));

  const evboard = $('evboard'), threads = $('threads'), threadsTop = $('threadsTop'), subjectEl = $('subjectCard');
  const evEl = (key) => evboard.querySelector('.ev[data-k="' + key + '"]');
  const boardHidden = () => getComputedStyle(threads).display === 'none' || !$('board').classList.contains('on');
  function pinPoint(el){
    const g = evboard.getBoundingClientRect(), p = (el.querySelector('.pin') || el).getBoundingClientRect();
    return [p.left + p.width / 2 - g.left, p.top + p.height / 2 - g.top];
  }
  // a string sags a little between its two pins
  function sag(a, b, amt){
    const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2 + (amt == null ? Math.min(40, Math.hypot(b[0] - a[0], b[1] - a[1]) * 0.12) : amt);
    return ['M' + a[0].toFixed(1) + ' ' + a[1].toFixed(1) + ' Q' + mx.toFixed(1) + ' ' + my.toFixed(1) + ' ' + b[0].toFixed(1) + ' ' + b[1].toFixed(1), mx, (a[1] + b[1]) / 2 + (my - (a[1] + b[1]) / 2) / 2];
  }
  const NS = 'http://www.w3.org/2000/svg';
  const Strings = {
    size(){ const g = evboard.getBoundingClientRect(), vb = '0 0 ' + g.width + ' ' + g.height; threads.setAttribute('viewBox', vb); threadsTop.setAttribute('viewBox', vb); },
    tie(key, animate){
      if (boardHidden()) return;
      const el = evEl(key); if (!el) return;
      this.size();
      const p = document.createElementNS(NS, 'path');
      p.setAttribute('d', sag(pinPoint(subjectEl), pinPoint(el))[0]);
      p.dataset.k = key;
      threads.appendChild(p);
      if (animate && !reduceMotion){ const len = p.getTotalLength(); p.style.strokeDasharray = len; p.style.strokeDashoffset = len; p.classList.add('draw'); }
    },
    retie(){
      threads.querySelectorAll('path[data-k]').forEach(p => p.remove());
      CHECKS.forEach(c => { if (evEl(c.key)) this.tie(c.key, false); });
    },
    show(key){
      this.clear();
      if (boardHidden()) return;
      const el = evEl(key); if (!el) return;
      this.size();
      evboard.classList.add('dim');
      el.classList.add('is-hot');
      const own = threads.querySelector('path[data-k="' + key + '"]'); if (own) own.classList.add('hot');
      const placed = [];
      linksFor(key).forEach(l => {
        const o = evEl(l.other); if (!o) return;
        o.classList.add('is-linked');
        const [d, lx, ly] = sag(pinPoint(el), pinPoint(o), 18);
        const p = document.createElementNS(NS, 'path');
        p.setAttribute('class', 'hot xref'); p.setAttribute('d', d);
        threadsTop.appendChild(p);
        const g = document.createElementNS(NS, 'g'); g.setAttribute('class', 'lbl xref-lbl');
        const t = document.createElementNS(NS, 'text');
        t.textContent = l.why; t.setAttribute('x', lx); t.setAttribute('y', ly + 4); t.setAttribute('text-anchor', 'middle');
        g.appendChild(t); threadsTop.appendChild(g);
        // keep labels from landing on each other
        let bb = t.getBBox(), guard = 0;
        const hits = (b) => placed.some(q => b.x < q.x + q.width + 8 && b.x + b.width + 8 > q.x && b.y < q.y + q.height + 6 && b.y + b.height + 6 > q.y);
        while (hits(bb) && guard++ < 8){ t.setAttribute('y', parseFloat(t.getAttribute('y')) + 20); bb = t.getBBox(); }
        placed.push(bb);
        const r = document.createElementNS(NS, 'rect');
        r.setAttribute('x', bb.x - 6); r.setAttribute('y', bb.y - 3); r.setAttribute('width', bb.width + 12); r.setAttribute('height', bb.height + 6);
        g.insertBefore(r, t);
      });
    },
    clear(){
      threadsTop.innerHTML = '';
      threads.querySelectorAll('path.hot').forEach(p => p.classList.remove('hot'));
      evboard.classList.remove('dim');
      evboard.querySelectorAll('.is-hot, .is-linked').forEach(n => n.classList.remove('is-hot', 'is-linked'));
    }
  };

  const Board = {
    reset(name, ctx){
      $('evGrid').innerHTML = '';
      threads.innerHTML = ''; threadsTop.innerHTML = '';
      $('subjectName').textContent = name;
      $('subjectCtx').innerHTML = escapeHtml(ctx) + '<div class="sc-state" id="subjectState">UNDER INVESTIGATION</div>';
      $('boardName').textContent = clip(name, 24) + '.';
      $('noteText').textContent = '—';
      $('summary').classList.remove('on');
    },
    pin(key, d){
      $('evGrid').insertAdjacentHTML('beforeend', card(key, d, RENDER[key](d)));
      const el = evEl(key);
      if (!reduceMotion){ el.classList.add('arrive'); el.addEventListener('animationend', () => el.classList.remove('arrive'), { once: true }); }
      requestAnimationFrame(() => requestAnimationFrame(() => el.querySelectorAll('.bar i').forEach(b => { b.style.width = b.dataset.w + '%'; })));
      el.addEventListener('mouseenter', () => Strings.show(key));
      el.addEventListener('mouseleave', () => Strings.clear());
      el.addEventListener('focus', () => Strings.show(key));
      el.addEventListener('blur', () => Strings.clear());
      el.addEventListener('click', (e) => { if (e.target.closest('a')) return; Drawer.open(key, el); });
      el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' '){ e.preventDefault(); Drawer.open(key, el); } });
    }
  };

  // ---------------------------------------------------------------------
  //  Drawer — the full evidence
  // ---------------------------------------------------------------------
  const Drawer = {
    returnTo: null,
    open(key, from){
      const d = state.data; if (!d) return;
      this.returnTo = from || null;
      const meta = [['Retrieved', retrieved() + ' · ' + state.today]];
      let title = CHECK[key].title, items = '';
      const tagv = (v, href) => href ? '<a class="tagv ' + v.cls + '" href="' + href + '" target="_blank" rel="noopener">' + v.label + ' — claim ↗</a>' : '<span class="tagv ' + v.cls + '">' + v.label + '</span>';
      if (key === 'domains'){
        const own = TLD_ORDER.map(t => d.domains && d.domains[t]).filter(Boolean);
        meta.push(['Source', Array.from(new Set(own.map(x => (x.source || 'rdap').toUpperCase()))).join(' / ') || 'RDAP'], ['Confidence', domainConfidence(own)]);
        const row = (x) => { const v = domainVerdict(x); return '<div class="dr-item"><div class="row"><span>' + escapeHtml(x.domain) + '</span>' + tagv(v, x.available === true ? buyUrl(x.domain) : null) + '</div>' +
          '<div class="mt">SOURCE ' + escapeHtml((x.source || 'rdap').toUpperCase()) + (x.source === 'dns' ? ' — RDAP WAS INCONCLUSIVE; ' + (x.available === true ? 'NO NS RECORDS FOUND' : x.available === false ? 'NS RECORDS FOUND' : 'DNS DID NOT ANSWER') : '') + '</div></div>'; };
        items = own.map(row).join('') + ((d.variants || []).length ? '<div class="kicker" style="margin-top:18px">SIMILAR NAMES</div>' + d.variants.map(v => TLD_ORDER.map(t => v.domains && v.domains[t]).filter(Boolean).map(row).join('')).join('') : '');
      } else if (key === 'handles'){
        meta.push(['Source', 'HTTP status check'], ['Method', '200 = taken · 404 = open · other = unknown']);
        items = ['x', 'instagram'].filter(p => d.socials && d.socials[p]).map(p => { const x = d.socials[p];
          return '<div class="dr-item"><div class="row"><span>@' + escapeHtml(x.handle) + ' · ' + escapeHtml(x.label) + '</span>' + tagv(handleVerdict(x)) + '</div>' +
            '<div class="mt">' + (x.note ? escapeHtml(x.note) : '<a href="' + escapeHtml(x.url) + '" target="_blank" rel="noopener">' + escapeHtml(x.url) + ' ↗</a>') + '</div></div>'; }).join('') || '<p>Handles were not checked this run.</p>';
      } else if (key === 'collisions'){
        meta.push(['Source', 'Web search · "' + state.name + '" + your one-liner'], ['Confidence', 'Rough read of snippets']);
        items = (d.niche_matches || []).map(x => { const r = roughRead(x); return '<div class="dr-item"><div class="mt">' + escapeHtml(r.host) + ' · ' + r.match + ' · risk ' + r.risk.toLowerCase() + '</div>' +
          '<a class="tt" href="' + escapeHtml(x.link) + '" target="_blank" rel="noopener">' + escapeHtml(x.title) + '</a><p>' + escapeHtml(x.snippet) + '</p></div>'; }).join('') ||
          '<p>' + escapeHtml(d.serp_error || 'No existing company or product turned up in your niche.') + '</p>';
      } else if (key === 'market'){
        meta.push(['Source', 'Web search · "' + state.name + '" trademark'], ['Confidence', 'Signal — not a register search']);
        items = (d.trademark_matches || []).map(x => '<div class="dr-item"><div class="mt">' + escapeHtml(hostOf(x.link)) + '</div><a class="tt" href="' + escapeHtml(x.link) + '" target="_blank" rel="noopener">' + escapeHtml(x.title) + '</a><p>' + escapeHtml(x.snippet) + '</p></div>').join('') ||
          '<p>' + escapeHtml(d.trademark_error || 'No trademark mentions turned up in web search. Still not a clearance.') + '</p>';
      } else if (key === 'relatives'){
        meta.push(['Source', 'RDAP · web search']);
        items = (d.variants || []).map(v => '<div class="dr-item"><div class="tt">' + escapeHtml(v.name) + '</div>' +
          '<div class="mt" style="margin-top:6px">' + TLD_ORDER.filter(t => v.domains && v.domains[t]).map(t => { const dv = domainVerdict(v.domains[t]); return '<span class="' + dv.cls + '">.' + t + ' ' + dv.label.toLowerCase() + '</span>'; }).join(' &nbsp; ') + '</div>' +
          ((v.niche_matches || []).length ? v.niche_matches.map(m => '<p><a href="' + escapeHtml(m.link) + '" target="_blank" rel="noopener">' + escapeHtml(m.title) + '</a></p>').join('') : '<p>' + escapeHtml(v.serp_error || 'No sightings in your niche.') + '</p>') + '</div>').join('') || '<p>No close variants for this name.</p>';
      } else {
        meta.push(['Source', 'Jev assessment'], ['Confidence', 'Model judgement']);
        const s2 = d.scores;
        items = [['Memorable — sticks after hearing it once', s2.memorable], ['Easy to say & spell', s2.easy_say_spell], ['Too generic (lower is better)', s2.too_generic], ['Sounds like an existing brand (lower is better)', s2.brand_collision]]
          .map(r => '<div class="dr-item"><div class="row"><span>' + escapeHtml(r[0]) + '</span><b>' + pct(r[1]) + '</b></div></div>').join('');
      }
      const xr = linksFor(key);
      $('drKicker').textContent = 'CASE ' + state.caseNum + ' · EVIDENCE';
      $('drBody').innerHTML = '<div class="kicker">' + escapeHtml(resultLine(key, d)) + '</div><h2 class="dr-title" id="drTitle">' + escapeHtml(title) + '</h2>' +
        '<dl class="dr-meta">' + meta.map(m => '<dt>' + m[0] + '</dt><dd>' + escapeHtml(m[1]) + '</dd>').join('') + '</dl>' + items +
        (xr.length ? '<div class="dr-xref"><div class="kicker">CONNECTED CLUES</div><ul>' + xr.map(x => '<li><b>' + escapeHtml(CHECK[x.other].title) + '</b> — ' + escapeHtml(x.why) + '</li>').join('') + '</ul></div>' : '');
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
  //  Case summary — verdict logic unchanged; only the presentation is new
  // ---------------------------------------------------------------------
  const CLASSIFICATION = { IMPERSONATION: 'HIGH COLLISION', 'NO WITNESSES': 'LOW RECALL', CLEARED: 'CLEARED', 'UNDER WATCH': 'UNDER WATCH' };
  const NOTE = { IMPERSONATION: 'Same name. Different story.', 'NO WITNESSES': 'Easy to forget. Keep digging.', CLEARED: 'A clearer view for a brighter brand.', 'UNDER WATCH': 'Promising — one thing needs a second look.' };
  const Summary = {
    render(d){
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

      // WHAT WE FOUND
      const own = TLD_ORDER.map(t => d.domains && d.domains[t]).filter(Boolean);
      const taken = own.filter(x => x.available === false).length;
      const com = d.domains && d.domains.com;
      const hs = ['x', 'instagram'].map(p => d.socials && d.socials[p]).filter(Boolean);
      const hTaken = hs.filter(x => x.taken === true), hOpen = hs.filter(x => x.taken === false);
      const niche = (d.niche_matches || []).length, tm = (d.trademark_matches || []).length;
      const viable = (d.variants || []).filter(v => v.domains && v.domains.com && v.domains.com.available === true);
      const handlesLine = !hs.length || hTaken.length + hOpen.length === 0 ? ['Could not be confirmed', 'unk']
        : hTaken.length === hs.length ? ['Primary handle occupied on ' + hTaken.map(x => x.label).join(' and '), 'found']
        : hTaken.length ? ['Occupied on ' + hTaken.map(x => x.label).join(', ') + ' · open on ' + hOpen.map(x => x.label).join(', '), 'found']
        : ['Primary handle open on ' + hOpen.map(x => x.label).join(' and '), 'clear'];
      const rows = [
        ['DOMAINS', own.length ? taken + ' of ' + own.length + ' registered · .com ' + (com ? domainVerdict(com).label.toLowerCase() : 'unknown') : 'No records returned', own.length ? (com && com.available === true ? 'clear' : 'found') : 'unk'],
        ['HANDLES', handlesLine[0], handlesLine[1]],
        ['COMPETITORS', (niche ? niche + ' direct/adjacent collision' + (niche === 1 ? '' : 's') : 'No collisions in your niche') + ' · ' + (tm ? tm + ' trademark mention' + (tm === 1 ? '' : 's') : 'no trademark chatter'), niche || tm ? 'found' : 'clear'],
        ['SIMILAR NAMES', viable.length ? viable.length + ' viable alternative' + (viable.length === 1 ? '' : 's') + ' (free .com)' : 'None with a free .com', viable.length ? 'clear' : 'unk'],
        ['MEMORABILITY', pct(scores.memorable) + (g < 0.5 ? ' · distinctive' : ' · not very distinctive'), m >= 0.65 ? 'clear' : 'found']
      ];
      $('reportRows').innerHTML = rows.map(r => '<li><span class="l">' + r[0] + '</span><span class="v"><span class="stat ' + (r[2] === 'unk' ? 'idle' : r[2]) + '" aria-hidden="true"></span><span>' + escapeHtml(r[1]) + '</span></span></li>').join('');

      $('stampName').textContent = state.name;
      const stamp = $('stampEl');
      stamp.textContent = label;
      stamp.classList.toggle('good', verdictClass === 'good');
      stamp.classList.toggle('mid', verdictClass === 'mid');
      const because = [];
      if (niche) because.push(niche + ' existing use' + (niche === 1 ? '' : 's') + ' turned up in your niche');
      if (com && com.available === false) because.push('the .com is already registered');
      if (hTaken.length) because.push('the handle is taken on ' + hTaken.map(x => x.label).join(' and '));
      $('stampSub').textContent = sub.charAt(0).toUpperCase() + sub.slice(1) + '.' + (because.length ? ' On the record: ' + because.join(', ') + '.' : '');

      // NEXT MOVE — only options the lookups actually returned
      const next = [];
      own.filter(x => x.available === true).slice(0, 3).forEach(x => next.push('Claim <a class="dom" href="' + buyUrl(x.domain) + '" target="_blank" rel="noopener">' + escapeHtml(x.domain) + '</a> while it\'s unregistered' + (x.source === 'dns' ? ' <span class="k">(DNS CHECK — CONFIRM)</span>' : '')));
      viable.forEach(v => next.push('Consider <b>' + escapeHtml(v.name) + '</b> — <a class="dom" href="' + buyUrl(v.domains.com.domain) + '" target="_blank" rel="noopener">' + escapeHtml(v.domains.com.domain) + '</a> is clear'));
      if (hTaken.length) next.push('Primary handles are occupied — plan a modifier for social and check it before launch');
      if (verdict === 'IMPERSONATION' || verdict === 'NO WITNESSES') next.push('Keep looking — this name carries real collision or recall risk');
      next.push('Run a formal trademark search before you file anything');
      $('nextMoves').innerHTML = next.map(t => '<li><span class="m">→</span><span>' + t + '</span></li>').join('');

      $('noteText').textContent = NOTE[verdict];
      $('rawPre').textContent = JSON.stringify(d.raw, null, 2);
      stamp.style.animation = 'none'; void stamp.offsetWidth; stamp.style.animation = '';
      $('summary').classList.add('on');

      $('result').dataset.shareText =
        'Name Worth It case file on "' + state.name + '": ' + label + ' (' + pct(m) + ' memorable, ' + pct(e) + ' easy to say/spell, ' +
        pct(g) + ' too generic, ' + pct(c) + ' brand collision risk).';
    }
  };

  // ---------------------------------------------------------------------
  //  Screens
  // ---------------------------------------------------------------------
  function showScreen(which){
    ['landing', 'progress', 'board'].forEach(id => $(id).classList.toggle('on', id === which));
    window.scrollTo(0, 0);
  }
  function showError(title, detail, extra){
    const onProgress = $('progress').classList.contains('on');
    const box = onProgress ? $('wsError') : $('errorBox');
    box.innerHTML = '<strong>' + escapeHtml(title) + '</strong><br>' + escapeHtml(detail) + (extra ? '<pre>' + escapeHtml(extra) + '</pre>' : '') +
      (onProgress ? '<br><button class="btn-line" type="button" data-back>← Try another name</button>' : '');
    box.style.display = 'block';
    const back = box.querySelector('[data-back]');
    if (back) back.addEventListener('click', newCase);
  }
  function hideError(){ ['errorBox', 'wsError'].forEach(id => { $(id).style.display = 'none'; $(id).innerHTML = ''; }); }

  // ---------------------------------------------------------------------
  //  The investigation
  // ---------------------------------------------------------------------
  let walkTimer = null;
  let queued = [];
  function stopQueued(){ clearInterval(walkTimer); queued.forEach(clearTimeout); queued = []; }

  function beginInvestigation(name, context){
    state.name = name; state.context = context; state.data = null; state.links = []; state.status = {};
    $('progName').textContent = clip(name, 22) + '…';
    $('progress').classList.remove('done', 'hold');
    Checklist.render();
    // every lookup is dispatched at once on the server — mark them as they go out
    CHECKS.forEach((c, i) => queued.push(setTimeout(() => Checklist.set(c.key, 'active', c.wait), reduceMotion ? 0 : 150 + i * 160)));
    let i = 0;
    walkTimer = setInterval(() => { Checklist.now(CHECKS[i % CHECKS.length].key); i++; }, 800);
  }

  async function fileEvidence(d){
    stopQueued();
    state.data = d;
    state.receivedAt = new Date();
    state.links = computeLinks(d);
    CHECKS.forEach(c => { if (state.status[c.key] === 'idle') Checklist.set(c.key, 'active', c.wait); });
    const step = d.cached ? 200 : 460;
    for (const c of CHECKS){
      Checklist.now(c.key);
      await sleep(step);
      Checklist.set(c.key, leadOutcome(c.key, d), resultLine(c.key, d));
    }
    Checklist.now(null);
    $('progress').classList.add('done');
    await sleep(d.cached ? 300 : 700);

    // 03 — pin everything up
    Board.reset(state.name, state.context);
    showScreen('board');
    await sleep(120);
    for (const c of CHECKS){
      Board.pin(c.key, d);
      await sleep(Math.round(step * 0.35));
      Strings.tie(c.key, true);
      await sleep(Math.round(step * 0.2));
    }
    Strings.retie();
    $('subjectState').textContent = 'CASE COMPLETE';
    Summary.render(d);
  }

  function holdCase(){
    stopQueued();
    CHECKS.forEach(c => { if (state.status[c.key] !== 'clear' && state.status[c.key] !== 'found') Checklist.set(c.key, 'cold', 'Did not return'); });
    Checklist.now(null);
    $('progress').classList.add('hold');
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
    $('runBtnLabel').textContent = 'Opening the file…';

    // the lookups start now
    const request = fetch(RELAY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name, context: context })
    });

    await sleep(260);
    beginInvestigation(name, context);
    showScreen('progress');

    try{
      const res = await request;
      const text = await res.text();
      let data;
      try{ data = JSON.parse(text); }catch(e){ data = { raw: text }; }

      if (res.status === 429){
        holdCase();
        showError('Too many checks right now', data.error || 'Give it a minute and try again.');
        return;
      }
      if (!res.ok){
        holdCase();
        showError('Got an error back (' + res.status + ')', data.error || 'Something went wrong on the checker side.', JSON.stringify(data, null, 2));
        return;
      }
      if (!data.scores){
        holdCase();
        showError('Got a response but couldn\'t read the scores out of it', 'Raw response below.', JSON.stringify(data, null, 2));
        return;
      }

      await sleep(200);
      await fileEvidence(data);
    }catch(err){
      holdCase();
      showError('Could not reach the checker', 'Try again in a moment.');
    }finally{
      runBtn.disabled = false;
      $('runBtnLabel').textContent = 'Investigate the name';
    }
  }

  function newCase(){
    stopQueued();
    Drawer.close();
    hideError();
    showScreen('landing');
    setTimeout(() => { $('nameInput').focus({ preventScroll: true }); $('nameInput').select(); }, 50);
  }

  // ---------------------------------------------------------------------
  //  Wiring
  // ---------------------------------------------------------------------
  $('intakeForm').addEventListener('submit', (e) => { e.preventDefault(); if (!$('runBtn').disabled) run(); });
  $('runAgainBtn').addEventListener('click', newCase);
  $('homeLink').addEventListener('click', (e) => { e.preventDefault(); if (!$('runBtn').disabled) newCase(); });

  const copyBtn = $('copyBtn');
  copyBtn.addEventListener('click', async function(){
    const txt = $('result').dataset.shareText || '';
    try{
      await navigator.clipboard.writeText(txt);
      copyBtn.textContent = 'Copied';
      setTimeout(function(){ copyBtn.textContent = 'Copy report'; }, 1500);
    }catch(e){ copyBtn.textContent = 'Copy failed — select the verdict manually'; setTimeout(function(){ copyBtn.textContent = 'Copy report'; }, 2500); }
  });
  const rawToggle = $('rawToggle'), rawOutput = $('rawOutput');
  rawToggle.addEventListener('click', function(){
    const showing = rawOutput.style.display === 'block';
    rawOutput.style.display = showing ? 'none' : 'block';
    rawToggle.textContent = showing ? 'show raw response' : 'hide raw response';
  });

  let rt = null;
  window.addEventListener('resize', () => {
    clearTimeout(rt);
    rt = setTimeout(() => { Strings.clear(); Strings.retie(); }, 100);
  });
  Checklist.render();
})();
