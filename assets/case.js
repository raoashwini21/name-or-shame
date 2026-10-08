/* =========================================================================
   Name Worth It? — case desk
   One request (POST /api/name-check) returns every lookup at once; the desk
   then files each piece of evidence in turn. Nothing here invents data:
   every artifact, connection and report line is derived from the response.
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
  function clock(d){ return pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds()); }

  // ---------------------------------------------------------------------
  //  CaseStatus — the single source of truth for the desk
  // ---------------------------------------------------------------------
  const TLD_ORDER = ['com', 'io', 'net', 'ai', 'app', 'co'];
  const SECTIONS = [
    { key: 'collisions', n: '01', label: 'COLLISIONS', code: 'C', filed: 'COLLISIONS' },
    { key: 'domains',    n: '02', label: 'DOMAINS',    code: 'D', filed: 'DOMAINS' },
    { key: 'handles',    n: '03', label: 'HANDLES',    code: 'H', filed: 'HANDLES' },
    { key: 'market',     n: '04', label: 'MARKET',     code: 'M', filed: 'MARKET' },
    { key: 'relatives',  n: '05', label: 'RELATIVES',  code: 'R', filed: 'RELATIVES' },
    { key: 'memory',     n: '06', label: 'MEMORY',     code: 'Y', filed: 'MEMORABILITY' }
  ];
  const SECTION = Object.fromEntries(SECTIONS.map(s => [s.key, s]));
  // the order evidence is filed onto the desk, with the activity-log wording
  const FILING = [
    { key: 'domains',    query: 'QUERYING REGISTRY' },
    { key: 'handles',    query: 'CHECKING HANDLES' },
    { key: 'collisions', query: 'CROSS-REFERENCING NAMES' },
    { key: 'market',     query: 'SEARCHING MARKET RECORDS' },
    { key: 'relatives',  query: 'TRACING CLOSE RELATIVES' },
    { key: 'memory',     query: 'ASSESSING MEMORABILITY' }
  ];
  const MARK = { idle: '○', active: '◌', found: '●', clear: '✓', cold: '×' };

  const state = {
    caseNum: '0001', today: '', name: '', context: '',
    data: null, receivedAt: null, links: [],
    sections: {}, evidence: 0, filed: 0
  };

  // purely cosmetic case counter, local to this browser
  try{
    const n = parseInt(localStorage.getItem('nwi_case_no') || '0', 10) + 1;
    localStorage.setItem('nwi_case_no', String(n));
    state.caseNum = String(n).padStart(4, '0');
  }catch(e){}
  try{ state.today = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase(); }catch(e){}
  document.querySelectorAll('[data-case-no]').forEach(el => { el.textContent = state.caseNum; });
  document.querySelectorAll('.js-date').forEach(el => { el.textContent = state.today || '—'; });
  const ref = (key, i) => 'NW-' + state.caseNum + '-' + SECTION[key].code + (i ? pad2(i) : '');

  // ---------------------------------------------------------------------
  //  CaseHeader
  // ---------------------------------------------------------------------
  const CaseHeader = {
    set(status, live, liveText){
      if (status) $('chStatus').textContent = status;
      const l = $('chLive');
      l.classList.remove('active', 'complete', 'hold');
      if (live) l.classList.add(live);
      if (liveText) $('chLiveText').textContent = liveText;
    },
    counts(){
      $('chChecks').textContent = pad2(state.filed) + '/06';
      $('chEvidence').textContent = pad2(state.evidence);
      $('chProgress').style.width = Math.round(state.filed / 6 * 100) + '%';
    }
  };

  // ---------------------------------------------------------------------
  //  CaseFileSidebar
  // ---------------------------------------------------------------------
  const CaseFileSidebar = {
    render(){
      $('cfSections').innerHTML = SECTIONS.map(s =>
        '<li><button class="sec" type="button" data-k="' + s.key + '" data-state="idle" aria-label="' + s.label + ' — not checked">' +
        '<span class="n">' + s.n + '</span><span>' + s.label + '</span><span class="m">' + MARK.idle + '</span></button></li>').join('');
    },
    mark(key, st){
      state.sections[key] = st;
      const b = document.querySelector('.sec[data-k="' + key + '"]');
      if (!b) return;
      b.dataset.state = st;
      b.querySelector('.m').textContent = MARK[st];
      const words = { idle: 'not checked', active: 'investigating', found: 'evidence found', clear: 'clear', cold: 'lookup failed' };
      b.setAttribute('aria-label', SECTION[key].label + ' — ' + words[st]);
    },
    counts(){
      const leads = Object.values(state.sections).filter(v => v === 'found').length;
      $('cfEvidence').textContent = pad2(state.evidence);
      $('cfLeads').textContent = pad2(leads);
      $('cfChecks').textContent = pad2(state.filed) + '/06';
    },
    current(key){
      document.querySelectorAll('.sec').forEach(b => b.classList.toggle('is-current', b.dataset.k === key));
    }
  };

  // ---------------------------------------------------------------------
  //  InvestigationLog (+ live "now" line and emerging findings)
  // ---------------------------------------------------------------------
  const InvestigationLog = {
    reset(){ $('log').innerHTML = ''; $('findings').innerHTML = ''; $('logCount').textContent = '0'; this.now('—', true); },
    now(text, idle){ const a = $('nowAct'); a.textContent = text; $('now').classList.toggle('idle', !!idle); },
    add(text, mark){
      const li = document.createElement('li');
      li.className = mark === 'pending' ? '' : 'res';
      li.innerHTML = '<span class="tm">' + clock(new Date()) + '</span><span class="m ' + (mark === 'pending' ? 'm-pending' : (mark || '')) + '">' + (mark === 'found' ? MARK.found : mark === 'clear' ? MARK.clear : mark === 'cold' ? MARK.cold : MARK.active) + '</span><span>' + escapeHtml(text) + '</span>';
      $('log').appendChild(li);
      $('logCount').textContent = $('log').children.length;
      li.scrollIntoView({ block: 'nearest' });
    },
    finding(text, mark){
      const li = document.createElement('li');
      li.innerHTML = '<span class="m ' + (mark === 'found' ? 's-bad' : mark === 'clear' ? 's-ok' : 's-unk') + '">' + (mark === 'found' ? MARK.found : mark === 'clear' ? MARK.clear : '·') + '</span><span>' + escapeHtml(text) + '</span>';
      $('findings').appendChild(li);
    }
  };

  // ---------------------------------------------------------------------
  //  Evidence helpers
  // ---------------------------------------------------------------------
  // DNS-fallback "clear" only means nothing is delegated — a registered
  // domain with no DNS would look the same — so it's marked with a *.
  function domainVerdict(d){
    if (!d || d.available === null || d.available === undefined) return { cls: 's-unk', label: 'UNKNOWN', state: 'unk' };
    if (d.available === true) return { cls: 's-ok', label: d.source === 'dns' ? 'CLEAR*' : 'CLEAR', state: 'clear' };
    return { cls: 's-bad', label: 'TAKEN', state: 'taken' };
  }
  function handleVerdict(s){
    if (!s || s.taken === null || s.taken === undefined) return { cls: 's-unk', label: s && s.note ? 'TOO LONG' : 'UNKNOWN' };
    return s.taken ? { cls: 's-bad', label: 'TAKEN' } : { cls: 's-ok', label: 'OPEN' };
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
    return { host: hostOf(m.link) || '—', match: exact ? 'NAME IN TITLE' : 'MENTIONED', risk: exact && overlap >= 2 ? 'HIGH' : (exact || overlap >= 2) ? 'MEDIUM' : 'LOW' };
  }
  function retrieved(){ return state.receivedAt ? clock(state.receivedAt) : '—'; }

  // Is a lead clear (✓) or did it turn up evidence (●)?
  function leadOutcome(key, d){
    if (key === 'domains'){ const c = d.domains && d.domains.com; return c && c.available === true ? 'clear' : 'found'; }
    if (key === 'handles') return ['x', 'instagram'].some(p => d.socials && d.socials[p] && d.socials[p].taken === true) ? 'found' : 'clear';
    if (key === 'collisions') return (d.niche_matches || []).length ? 'found' : 'clear';
    if (key === 'market') return (d.trademark_matches || []).length ? 'found' : 'clear';
    if (key === 'relatives') return (d.variants || []).some(v => v.domains && v.domains.com && v.domains.com.available === true) ? 'found' : 'clear';
    if (key === 'memory') return ((d.scores.memorable ?? 0) >= 0.65 && (d.scores.too_generic ?? 0) < 0.5) ? 'clear' : 'found';
    return 'clear';
  }
  function evidenceCount(key, d){
    if (key === 'domains') return TLD_ORDER.filter(t => d.domains && d.domains[t]).length;
    if (key === 'handles') return ['x', 'instagram'].filter(p => d.socials && d.socials[p]).length;
    if (key === 'collisions') return (d.niche_matches || []).length;
    if (key === 'market') return (d.trademark_matches || []).length;
    if (key === 'relatives') return (d.variants || []).length;
    return 1;
  }
  // the log line written when a lookup's evidence is filed
  function receivedLine(key, d){
    if (key === 'domains'){
      const own = TLD_ORDER.map(t => d.domains && d.domains[t]).filter(Boolean);
      return 'DOMAIN RECORD RECEIVED · ' + own.filter(x => x.available === false).length + '/' + own.length + ' REGISTERED';
    }
    if (key === 'handles') return leadOutcome('handles', d) === 'found' ? 'SOCIAL MATCH FOUND' : 'HANDLES CLEAR';
    if (key === 'collisions'){ const n = (d.niche_matches || []).length; return n ? n + ' MARKET COLLISION' + (n === 1 ? '' : 'S') : (d.serp_error ? 'SEARCH UNAVAILABLE' : 'NO COLLISIONS ON RECORD'); }
    if (key === 'market'){ const n = (d.trademark_matches || []).length; return n ? n + ' TRADEMARK MENTION' + (n === 1 ? '' : 'S') : (d.trademark_error ? 'TRADEMARK SEARCH UNAVAILABLE' : 'NO TRADEMARK CHATTER'); }
    if (key === 'relatives'){ const v = (d.variants || []).filter(x => x.domains && x.domains.com && x.domains.com.available === true).length; return v ? 'RELATIVE NAME FOUND · ' + v + ' WITH A FREE .COM' : 'RELATIVES TRACED · NONE WITH A FREE .COM'; }
    return 'MEMORABILITY ASSESSED · ' + pct(d.scores.memorable);
  }
  function findingLine(key, d){
    if (key === 'domains'){ const c = d.domains && d.domains.com; return c ? (c.available === true ? c.domain + ' is unregistered' : c.available === false ? c.domain + ' is registered' : c.domain + ' could not be confirmed') : 'No domain records'; }
    if (key === 'handles'){
      const s = ['x', 'instagram'].map(p => d.socials && d.socials[p]).filter(Boolean);
      const taken = s.filter(x => x.taken === true).map(x => x.label);
      return taken.length ? '@' + s[0].handle + ' is taken on ' + taken.join(' and ') : (s.length ? '@' + s[0].handle + ' looks open' : 'Handles not checked');
    }
    if (key === 'collisions'){ const n = (d.niche_matches || []).length; return n ? n + ' existing use' + (n === 1 ? '' : 's') + ' in your niche' : 'Nobody obvious in your niche'; }
    if (key === 'market'){ const n = (d.trademark_matches || []).length; return n ? n + ' trademark mention' + (n === 1 ? '' : 's') + ' on the web' : 'No trademark chatter found'; }
    if (key === 'relatives'){ const v = (d.variants || []).filter(x => x.domains && x.domains.com && x.domains.com.available === true); return v.length ? v.map(x => x.name).join(', ') + ' — .com clear' : 'No close variant has a free .com'; }
    return pct(d.scores.memorable) + ' memorable · ' + ((d.scores.too_generic ?? 0) < 0.5 ? 'distinctive' : 'not very distinctive');
  }

  // ---------------------------------------------------------------------
  //  EvidenceArtifact — shared shell, then one renderer per evidence type
  // ---------------------------------------------------------------------
  function EvidenceArtifact(key, opts){
    const s = SECTION[key];
    return '<article class="art ' + key + ' ' + (opts.cls || '') + '" data-art="' + key + '" tabindex="0" role="button" aria-label="' + escapeHtml(opts.aria) + ' — open evidence" style="--r:' + (opts.r || '0deg') + '">' +
      (opts.pin ? '<span class="pin" style="' + opts.pin + '"></span>' : '') +
      opts.html +
      '<span class="open-hint">OPEN ↗</span></article>';
  }
  const shellHead = (title, key) => '<div class="art-h"><span class="t">' + title + '</span><span class="ref">REF ' + ref(key) + '</span></div>';
  const shellFoot = (items) => '<div class="art-f">' + items.map(i => '<span>' + i[0] + ' <b>' + escapeHtml(i[1]) + '</b></span>').join('') + '</div>';

  function domainConfidence(list){
    if (list.some(x => x.available === null || x.available === undefined)) return 'INCOMPLETE';
    return list.some(x => x.source === 'dns') ? 'PARTIAL · DNS FALLBACK' : 'VERIFIED';
  }

  // DOMAINS — a typed registry extract
  function RegistryEvidence(d){
    const own = TLD_ORDER.map(t => d.domains && d.domains[t]).filter(Boolean);
    const aliases = (d.variants || []).map(v => v.domains && v.domains.com).filter(Boolean);
    const row = (x) => { const v = domainVerdict(x);
      return '<div class="reg-row"><span class="d">' + escapeHtml(x.domain) + '</span>' +
        (x.available === true ? '<a class="verdict-tag ' + v.cls + '" href="' + buyUrl(x.domain) + '" target="_blank" rel="noopener" title="Claim ' + escapeHtml(x.domain) + '">' + v.label + ' ↗</a>' : '<span class="verdict-tag ' + v.cls + '">' + v.label + '</span>') + '</div>'; };
    const sources = Array.from(new Set(own.map(x => (x.source || 'rdap').toUpperCase()))).join(' / ') || 'RDAP';
    const html = '<span class="tab">FILED UNDER: DOMAINS</span>' + shellHead('DOMAIN REGISTRY', 'domains') +
      '<div class="art-b">' + (own.length ? own.map(row).join('') : '<p class="s-unk">Could not reach the registry this run.</p>') +
      (aliases.length ? '<div class="reg-sep">ALIASES · .COM · CROSS-REF ' + ref('relatives') + '</div>' + aliases.map(row).join('') : '') + '</div>' +
      shellFoot([['SOURCE', sources], ['RETRIEVED', retrieved()], ['CONFIDENCE', domainConfidence(own)]]);
    return EvidenceArtifact('domains', { html, r: '-0.8deg', aria: 'Domain registry', pin: 'left:58%;top:1px' });
  }

  // HANDLES — small profile ID cards
  function SocialEvidence(d){
    const cards = ['x', 'instagram'].filter(p => d.socials && d.socials[p]).map(function(p, i){
      const s = d.socials[p], v = handleVerdict(s);
      return '<div class="idcard"><div class="side">' + escapeHtml(s.label.toUpperCase()) + '</div><div class="in">' +
        '<div class="k">PROFILE · ' + ref('handles', i + 1) + '</div>' +
        '<div class="h">@' + escapeHtml(s.handle) + '</div>' +
        '<div class="row"><span class="verdict-tag ' + v.cls + '"' + (s.note ? ' title="' + escapeHtml(s.note) + '"' : '') + '>' + v.label + '</span>' +
        (s.note ? '' : '<a href="' + escapeHtml(s.url) + '" target="_blank" rel="noopener">view profile ↗</a>') + '</div>' +
        '<div class="src">SOURCE HTTP · ' + escapeHtml(hostOf(s.url)) + '</div></div></div>';
    }).join('');
    const html = '<div class="social-head"><span class="k" style="color:var(--ink)">SOCIAL / PROFILE</span><span class="k">REF ' + ref('handles') + '</span></div>' +
      '<div class="idcards">' + (cards || '<div class="idcard"><div class="side">—</div><div class="in">Could not check handles this run.</div></div>') + '</div>';
    return EvidenceArtifact('handles', { html, r: '0.8deg', aria: 'Social profiles', pin: 'left:22px;top:22px' });
  }

  // COLLISIONS — clipped search records
  function CollisionRecords(d){
    const m = d.niche_matches || [];
    let body;
    if (m.length){
      body = m.slice(0, 3).map(function(x, i){
        const r = roughRead(x);
        return '<div class="clipping"><div class="meta"><span>' + ref('collisions', i + 1) + '</span><span>' + escapeHtml(r.host) + '</span><span class="' + (r.risk === 'HIGH' ? 's-bad' : '') + '">RISK ' + r.risk + '</span></div>' +
          '<a class="tt" href="' + escapeHtml(x.link) + '" target="_blank" rel="noopener">' + escapeHtml(x.title) + '</a><p>' + escapeHtml(x.snippet) + '</p></div>';
      }).join('') + (m.length > 3 ? '<div class="more-note">+ ' + (m.length - 3) + ' MORE IN THE FILE — OPEN TO READ</div>' : '');
    } else {
      body = '<div class="clipping"><p>' + escapeHtml(d.serp_error || 'No existing company or product turned up in your niche.') + '</p></div>';
    }
    const html = '<div class="clip-label">SEARCH RECORDS <b>' + pad2(m.length) + '</b><span class="ref">REF ' + ref('collisions') + '</span></div>' + body;
    return EvidenceArtifact('collisions', { html, r: '0.3deg', aria: 'Collision search records', pin: 'left:14px;top:2px' });
  }

  // MARKET — a typed note on cream stock
  function MarketNote(d){
    const m = d.trademark_matches || [];
    let body;
    if (m.length){
      body = '<div class="lead">' + m.length + ' trademark mention' + (m.length === 1 ? '' : 's') + '</div><ol>' +
        m.slice(0, 3).map(x => '<li><a href="' + escapeHtml(x.link) + '" target="_blank" rel="noopener">' + escapeHtml(x.title) + '</a><br><span>' + escapeHtml(hostOf(x.link)) + '</span></li>').join('') + '</ol>' +
        (m.length > 3 ? '<div class="disc">+ ' + (m.length - 3) + ' more in the file</div>' : '');
    } else {
      body = '<div class="lead">' + (d.trademark_error ? 'Search unavailable' : 'Nothing on file') + '</div><div>' + escapeHtml(d.trademark_error || 'No trademark mentions turned up in web search.') + '</div>';
    }
    const html = shellHead('MARKET NOTE', 'market') + '<div class="art-b typed">' + body + '<div class="disc">A web signal — not a search of any trademark register.</div></div>' +
      shellFoot([['SOURCE', 'WEB SEARCH'], ['RETRIEVED', retrieved()]]);
    return EvidenceArtifact('market', { html, r: '-0.6deg', aria: 'Market note', pin: 'left:46%;top:1px' });
  }

  // RELATIVES — a name-family diagram
  function NameFamily(d){
    const v = d.variants || [];
    const kids = v.map(function(x, i){
      const com = x.domains && x.domains.com, cv = domainVerdict(com);
      const free = TLD_ORDER.filter(t => x.domains && x.domains[t] && x.domains[t].available === true).length;
      const total = TLD_ORDER.filter(t => x.domains && x.domains[t]).length;
      return '<div class="fam-kid' + (com && com.available === true ? ' viable' : '') + '" data-i="' + i + '"><div class="nm">' + escapeHtml(x.name) + '</div>' +
        '<div class="ln"><span class="' + cv.cls + '">.COM ' + cv.label + '</span><span>' + free + '/' + total + ' FREE</span><span>' + (x.niche_matches || []).length + ' SIGHTED</span></div></div>';
    }).join('');
    const html = shellHead('NAME FAMILY', 'relatives') +
      '<div class="art-b"><div class="family"><svg class="fam-lines" aria-hidden="true"></svg><span class="fam-root">' + escapeHtml(state.name) + '</span>' +
      '<div class="fam-kids">' + (kids || '<div class="fam-kid">No close variants for this name.</div>') + '</div></div></div>' +
      shellFoot([['SOURCE', 'RDAP · WEB SEARCH'], ['RETRIEVED', retrieved()]]);
    return EvidenceArtifact('relatives', { html, r: '0.6deg', aria: 'Name family', pin: 'left:62%;top:1px' });
  }

  // MEMORY — typed assessment with a pencilled observation
  function MemoryObservation(d){
    const s = d.scores, m = s.memorable, e = s.easy_say_spell, g = s.too_generic, c = s.brand_collision;
    const mk = (ok, warn) => ok ? '<span class="m s-ok">✓</span>' : warn ? '<span class="m s-bad">!</span>' : '<span class="m s-unk">?</span>';
    const row = (label, val, mark, neg) => '<div class="memo-row"><span>' + label + '</span><span class="v">' + pct(val) + '</span>' + mark +
      '<span class="bar"><i class="' + (neg ? 'neg' : '') + '" data-w="' + (val == null ? 0 : Math.round(val * 100)) + '"></i></span></div>';
    const note = ((m ?? 0) >= 0.65 ? 'memorable' : (m ?? 0) >= 0.5 ? 'fairly memorable' : 'hard to recall') + ((g ?? 0) < 0.5 ? ', distinctive' : ', but generic') + ((c ?? 0) >= 0.55 ? ' — sounds taken' : '');
    const html = shellHead('MEMORY', 'memory') + '<div class="art-b">' +
      row('Memorable', m, mk((m ?? 0) >= 0.65, (m ?? 0) < 0.5)) +
      row('Easy to say &amp; spell', e, mk((e ?? 0) >= 0.6, (e ?? 0) < 0.45)) +
      row('Distinctive', g == null ? null : 1 - g, mk((g ?? 0) < 0.5, (g ?? 0) >= 0.6)) +
      row('Sounds like a brand', c, mk((c ?? 0) < 0.35, (c ?? 0) >= 0.55), true) +
      '<div class="pencil">' + escapeHtml(note) + '</div></div>' +
      shellFoot([['SOURCE', 'JEV ASSESSMENT'], ['RETRIEVED', retrieved()]]);
    return EvidenceArtifact('memory', { html, r: '-0.5deg', aria: 'Memorability', pin: 'left:58%;top:1px' });
  }

  const RENDER = { domains: RegistryEvidence, handles: SocialEvidence, collisions: CollisionRecords, market: MarketNote, relatives: NameFamily, memory: MemoryObservation };

  // ---------------------------------------------------------------------
  //  EvidenceConnection — only where the data genuinely relates two pieces
  // ---------------------------------------------------------------------
  function computeLinks(d){
    const links = [];
    const colHosts = new Set((d.niche_matches || []).map(m => hostOf(m.link)).filter(Boolean));
    const tmHosts = new Set((d.trademark_matches || []).map(m => hostOf(m.link)).filter(Boolean));
    const takenOwn = TLD_ORDER.map(t => d.domains && d.domains[t]).filter(x => x && x.available === false).map(x => x.domain.toLowerCase());
    const hit = takenOwn.find(dom => colHosts.has(dom));
    if (hit) links.push({ a: 'domains', b: 'collisions', why: hit + ' appears in search records' });
    const shared = Array.from(tmHosts).filter(h => colHosts.has(h));
    if (shared.length) links.push({ a: 'market', b: 'collisions', why: 'same source · ' + shared[0] });
    const handle = d.socials && d.socials.x && d.socials.x.handle;
    const socialHosts = ['x.com', 'twitter.com', 'instagram.com'];
    if ((d.niche_matches || []).some(m => socialHosts.includes(hostOf(m.link)) || (handle && ((m.title || '') + ' ' + (m.snippet || '')).toLowerCase().includes('@' + handle)))) {
      links.push({ a: 'handles', b: 'collisions', why: 'handle appears in search records' });
    }
    if ((d.variants || []).length) links.push({ a: 'relatives', b: 'domains', why: 'alias .com records' });
    if ((d.variants || []).some(v => (v.niche_matches || []).length)) links.push({ a: 'relatives', b: 'collisions', why: 'aliases also sighted in your niche' });
    if ((d.scores.brand_collision ?? 0) >= 0.35 && (d.niche_matches || []).length) links.push({ a: 'memory', b: 'collisions', why: 'collision read backed by records' });
    return links;
  }
  const linksFor = (key) => state.links.filter(l => l.a === key || l.b === key).map(l => ({ other: l.a === key ? l.b : l.a, why: l.why }));

  const board = $('board'), linksSvg = $('links'), subjectEl = $('subject');
  function anchor(el, toward){
    const g = board.getBoundingClientRect(), r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2 - g.left, cy = r.top + r.height / 2 - g.top;
    if (!toward) return [cx, cy, r];
    const dx = toward[0] - cx, dy = toward[1] - cy;
    const s = Math.min((r.width / 2) / Math.abs(dx || 1e-6), (r.height / 2) / Math.abs(dy || 1e-6), 1);
    return [cx + dx * s, cy + dy * s, r];
  }
  // crisp right-angle connector: out horizontally, across, then in — label sits on the middle run
  function curve(a, b){
    const f = (n) => n.toFixed(1);
    if (Math.abs(b[0] - a[0]) >= Math.abs(b[1] - a[1])){
      const mx = (a[0] + b[0]) / 2;
      return ['M' + f(a[0]) + ' ' + f(a[1]) + ' H' + f(mx) + ' V' + f(b[1]) + ' H' + f(b[0]), mx, (a[1] + b[1]) / 2];
    }
    const my = (a[1] + b[1]) / 2;
    return ['M' + f(a[0]) + ' ' + f(a[1]) + ' V' + f(my) + ' H' + f(b[0]) + ' V' + f(b[1]), (a[0] + b[0]) / 2, my];
  }
  const artEl = (key) => board.querySelector('.art[data-art="' + key + '"]');
  const isStacked = () => getComputedStyle(board).gridTemplateColumns.trim().split(/\s+/).length === 1;

  const EvidenceConnection = {
    size(){ const g = board.getBoundingClientRect(); linksSvg.setAttribute('viewBox', '0 0 ' + g.width + ' ' + g.height); },
    // faint dashed tether from the subject to each filed artifact
    tether(key, animate){
      if (isStacked()) return;
      const el = artEl(key); if (!el) return;
      this.size();
      const c = anchor(el), s = anchor(subjectEl, c), e = anchor(el, s);
      const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      p.setAttribute('class', 'tether'); p.dataset.k = key;
      p.setAttribute('d', curve(s, e)[0]);
      linksSvg.appendChild(p);
      if (animate && !reduceMotion){ const len = p.getTotalLength(); p.style.strokeDasharray = '2 4'; p.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 700, easing: 'ease-out' }); void len; }
    },
    retether(){
      linksSvg.querySelectorAll('.tether').forEach(p => p.remove());
      Object.keys(state.sections).filter(k => artEl(k)).forEach(k => this.tether(k, false));
    },
    // red investigative lines on hover/focus — to the subject and to related evidence
    show(key){
      this.clearHot();
      if (isStacked()) return;
      const el = artEl(key); if (!el) return;
      this.size();
      board.classList.add('dim');
      el.classList.add('is-hot');
      const placed = [];
      const draw = (fromEl, toEl, label) => {
        const tc = anchor(toEl), a = anchor(fromEl, tc), b = anchor(toEl, a);
        const [d, lx, ly] = curve(a, b);
        const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        p.setAttribute('class', 'hot'); p.setAttribute('d', d);
        linksSvg.appendChild(p);
        if (!reduceMotion){ const len = p.getTotalLength(); p.style.strokeDasharray = len; p.style.strokeDashoffset = len; p.classList.add('draw'); }
        if (label){
          const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
          g.setAttribute('class', 'lbl hotlbl');
          const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
          t.textContent = label.toUpperCase(); t.setAttribute('x', lx); t.setAttribute('y', ly + 3); t.setAttribute('text-anchor', 'middle');
          g.appendChild(t); linksSvg.appendChild(g);
          // nudge labels apart so cross-references never sit on top of each other
          let bb = t.getBBox(), guard = 0;
          const hits = (b) => placed.some(p => b.x < p.x + p.width + 8 && b.x + b.width + 8 > p.x && b.y < p.y + p.height + 6 && b.y + b.height + 6 > p.y);
          while (hits(bb) && guard++ < 8){ t.setAttribute('y', parseFloat(t.getAttribute('y')) + 18); bb = t.getBBox(); }
          placed.push(bb);
          const r = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
          r.setAttribute('x', bb.x - 6); r.setAttribute('y', bb.y - 3); r.setAttribute('width', bb.width + 12); r.setAttribute('height', bb.height + 6);
          g.insertBefore(r, t);
        }
      };
      draw(el, subjectEl, null);
      linksFor(key).forEach(l => { const o = artEl(l.other); if (o){ o.classList.add('is-linked'); draw(el, o, l.why); } });
    },
    clearHot(){
      linksSvg.querySelectorAll('.hot, .hotlbl').forEach(n => n.remove());
      board.classList.remove('dim');
      board.querySelectorAll('.is-hot, .is-linked').forEach(n => n.classList.remove('is-hot', 'is-linked'));
    }
  };

  // ---------------------------------------------------------------------
  //  SubjectCard
  // ---------------------------------------------------------------------
  const SubjectCard = {
    set(name, ctx){ $('subjectName').textContent = name; $('subjectCtx').textContent = ctx; this.state('UNDER INVESTIGATION'); subjectEl.classList.remove('complete'); },
    state(t){ $('subjectState').textContent = t; },
    complete(){ this.state('CASE COMPLETE'); subjectEl.classList.add('complete'); }
  };

  // ---------------------------------------------------------------------
  //  InvestigationCanvas
  // ---------------------------------------------------------------------
  const PENDING = { domains: 'DOMAIN REGISTRY', handles: 'SOCIAL / PROFILE', collisions: 'SEARCH RECORDS', market: 'MARKET NOTE', relatives: 'NAME FAMILY', memory: 'MEMORY' };
  const InvestigationCanvas = {
    reset(){
      linksSvg.innerHTML = '';
      board.querySelectorAll('.slot').forEach(s => {
        s.classList.remove('cold');
        s.innerHTML = '<div class="pending"><span class="k">' + PENDING[s.dataset.k] + '</span><span class="aw">◌ AWAITING RECORD · ' + ref(s.dataset.k) + '</span></div>';
      });
    },
    file(key, html){
      const slot = board.querySelector('.slot[data-k="' + key + '"]');
      slot.innerHTML = html;
      const el = slot.querySelector('.art');
      if (!reduceMotion){ el.classList.add('arrive'); el.addEventListener('animationend', () => el.classList.remove('arrive'), { once: true }); }
      requestAnimationFrame(() => requestAnimationFrame(() => el.querySelectorAll('.bar i').forEach(b => { b.style.width = b.dataset.w + '%'; })));
      if (key === 'relatives') requestAnimationFrame(() => drawFamily(el));
      bindArtifact(el, key);
    },
    cold(key){
      const slot = board.querySelector('.slot[data-k="' + key + '"]');
      if (!slot.querySelector('.pending')) return;
      slot.classList.add('cold');
      slot.querySelector('.aw').textContent = '× LOOKUP DID NOT RETURN';
    },
    // a soft camera move to one piece of evidence
    focus(key){
      CaseFileSidebar.current(key);
      const el = artEl(key) || board.querySelector('.slot[data-k="' + key + '"]');
      if (!el) return;
      el.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
      if (el.classList.contains('art')){
        el.classList.add('is-focus');
        setTimeout(() => el.classList.remove('is-focus'), 1800);
        EvidenceConnection.show(key);
        setTimeout(() => { if (!el.matches(':hover')) EvidenceConnection.clearHot(); }, 1800);
      }
    }
  };
  // lines in the name-family diagram, from the root to each alias
  function drawFamily(el){
    const fam = el.querySelector('.family'), svg = fam.querySelector('.fam-lines'), root = fam.querySelector('.fam-root');
    const f = fam.getBoundingClientRect(), r = root.getBoundingClientRect();
    svg.setAttribute('viewBox', '0 0 ' + f.width + ' ' + f.height);
    const x = r.left - f.left + 14, y = r.bottom - f.top;
    svg.innerHTML = Array.from(fam.querySelectorAll('.fam-kid')).map(k => { const kr = k.getBoundingClientRect(); const ky = kr.top - f.top + kr.height / 2;
      return '<path d="M' + x + ' ' + y + ' V' + ky.toFixed(1) + ' H' + (kr.left - f.left).toFixed(1) + '"/>'; }).join('');
  }

  function bindArtifact(el, key){
    el.addEventListener('mouseenter', () => EvidenceConnection.show(key));
    el.addEventListener('mouseleave', () => EvidenceConnection.clearHot());
    el.addEventListener('focus', () => { EvidenceConnection.show(key); CaseFileSidebar.current(key); });
    el.addEventListener('blur', () => EvidenceConnection.clearHot());
    el.addEventListener('click', (e) => { if (e.target.closest('a')) return; EvidenceDrawer.open(key, el); });
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' '){ e.preventDefault(); EvidenceDrawer.open(key, el); } });
  }

  // ---------------------------------------------------------------------
  //  EvidenceDrawer — the full document
  // ---------------------------------------------------------------------
  const EvidenceDrawer = {
    returnTo: null,
    open(key, from){
      const d = state.data; if (!d) return;
      this.returnTo = from || null;
      const s = SECTION[key];
      const meta = [['REF', ref(key)], ['FILED UNDER', s.filed], ['RETRIEVED', retrieved() + ' · ' + state.today]];
      let title = '', items = '';
      if (key === 'domains'){
        title = 'Domain registry';
        const own = TLD_ORDER.map(t => d.domains && d.domains[t]).filter(Boolean);
        meta.push(['SOURCE', Array.from(new Set(own.map(x => (x.source || 'rdap').toUpperCase()))).join(' / ')], ['CONFIDENCE', domainConfidence(own)]);
        const row = (x) => { const v = domainVerdict(x); return '<div class="dr-item"><div style="display:flex;justify-content:space-between;gap:10px"><span class="mono">' + escapeHtml(x.domain) + '</span>' +
          (x.available === true ? '<a class="verdict-tag ' + v.cls + '" href="' + buyUrl(x.domain) + '" target="_blank" rel="noopener">' + v.label + ' — CLAIM ↗</a>' : '<span class="verdict-tag ' + v.cls + '">' + v.label + '</span>') + '</div>' +
          '<div class="mt">SOURCE ' + escapeHtml((x.source || 'rdap').toUpperCase()) + (x.source === 'dns' ? ' — RDAP WAS INCONCLUSIVE; ' + (x.available === true ? 'NO NS RECORDS FOUND' : x.available === false ? 'NS RECORDS FOUND' : 'DNS DID NOT ANSWER') : '') + '</div></div>'; };
        items = own.map(row).join('') + ((d.variants || []).length ? '<div class="k" style="margin-top:18px">ALIASES</div>' + d.variants.map(v => TLD_ORDER.map(t => v.domains && v.domains[t]).filter(Boolean).map(row).join('')).join('') : '');
      } else if (key === 'handles'){
        title = 'Social profiles';
        meta.push(['SOURCE', 'HTTP STATUS CHECK'], ['METHOD', '200 = TAKEN · 404 = OPEN · OTHER = UNKNOWN']);
        items = ['x', 'instagram'].filter(p => d.socials && d.socials[p]).map(p => { const x = d.socials[p], v = handleVerdict(x);
          return '<div class="dr-item"><div style="display:flex;justify-content:space-between;gap:10px"><span class="mono">@' + escapeHtml(x.handle) + ' · ' + escapeHtml(x.label) + '</span><span class="verdict-tag ' + v.cls + '">' + v.label + '</span></div>' +
            '<div class="mt">' + (x.note ? escapeHtml(x.note.toUpperCase()) : '<a href="' + escapeHtml(x.url) + '" target="_blank" rel="noopener">' + escapeHtml(x.url) + ' ↗</a>') + '</div></div>'; }).join('');
      } else if (key === 'collisions'){
        title = 'Search records';
        meta.push(['SOURCE', 'WEB SEARCH · "' + state.name + '" + YOUR ONE-LINER'], ['CONFIDENCE', 'ROUGH READ OF SNIPPETS']);
        items = (d.niche_matches || []).map((x, i) => { const r = roughRead(x); return '<div class="dr-item"><div class="mt">' + ref('collisions', i + 1) + ' · ' + escapeHtml(r.host) + ' · ' + r.match + ' · RISK ' + r.risk + '</div>' +
          '<a class="tt" href="' + escapeHtml(x.link) + '" target="_blank" rel="noopener">' + escapeHtml(x.title) + '</a><p>' + escapeHtml(x.snippet) + '</p></div>'; }).join('') ||
          '<p>' + escapeHtml(d.serp_error || 'No existing company or product turned up in your niche.') + '</p>';
      } else if (key === 'market'){
        title = 'Market note';
        meta.push(['SOURCE', 'WEB SEARCH · "' + state.name + '" TRADEMARK'], ['CONFIDENCE', 'SIGNAL — NOT A REGISTER SEARCH']);
        items = (d.trademark_matches || []).map((x, i) => '<div class="dr-item"><div class="mt">' + ref('market', i + 1) + ' · ' + escapeHtml(hostOf(x.link)) + '</div><a class="tt" href="' + escapeHtml(x.link) + '" target="_blank" rel="noopener">' + escapeHtml(x.title) + '</a><p>' + escapeHtml(x.snippet) + '</p></div>').join('') ||
          '<p>' + escapeHtml(d.trademark_error || 'No trademark mentions turned up in web search. Still not a clearance.') + '</p>';
      } else if (key === 'relatives'){
        title = 'Name family';
        meta.push(['SOURCE', 'RDAP · WEB SEARCH']);
        items = (d.variants || []).map((v, i) => '<div class="dr-item"><div class="mt">' + ref('relatives', i + 1) + '</div><div class="tt">' + escapeHtml(v.name) + '</div>' +
          '<div class="mt" style="margin-top:6px">' + TLD_ORDER.filter(t => v.domains && v.domains[t]).map(t => { const x = v.domains[t], dv = domainVerdict(x); return '<span class="' + dv.cls + '">.' + t + ' ' + dv.label + '</span>'; }).join(' &nbsp; ') + '</div>' +
          ((v.niche_matches || []).length ? v.niche_matches.map(m => '<p><a href="' + escapeHtml(m.link) + '" target="_blank" rel="noopener">' + escapeHtml(m.title) + '</a></p>').join('') : '<p>' + escapeHtml(v.serp_error || 'No sightings in your niche.') + '</p>') + '</div>').join('') || '<p>No close variants for this name.</p>';
      } else {
        title = 'Memory';
        meta.push(['SOURCE', 'JEV ASSESSMENT'], ['CONFIDENCE', 'MODEL JUDGEMENT']);
        const s2 = d.scores;
        items = [['Memorable — sticks after hearing it once', s2.memorable], ['Easy to say & spell', s2.easy_say_spell], ['Too generic (lower is better)', s2.too_generic], ['Sounds like an existing brand (lower is better)', s2.brand_collision]]
          .map(r => '<div class="dr-item" style="display:flex;justify-content:space-between;gap:10px"><span>' + escapeHtml(r[0]) + '</span><span class="mono">' + pct(r[1]) + '</span></div>').join('');
      }
      const xr = linksFor(key);
      $('drRef').textContent = 'REF ' + ref(key) + ' · ' + s.label;
      $('drBody').innerHTML = '<div class="k">EVIDENCE · ' + s.n + '</div><h2 class="dr-title" id="drTitle">' + escapeHtml(title) + '</h2>' +
        '<dl class="dr-meta">' + meta.map(m => '<dt>' + m[0] + '</dt><dd>' + escapeHtml(m[1]) + '</dd>').join('') + '</dl>' + items +
        (xr.length ? '<div class="dr-xref"><div class="k">CROSS-REFERENCES</div><ul>' + xr.map(x => '<li><span class="x">' + ref(x.other) + '</span>' + escapeHtml(SECTION[x.other].label) + ' — ' + escapeHtml(x.why) + '</li>').join('') + '</ul></div>' : '');
      $('drawer').classList.add('on'); $('drawer').setAttribute('aria-hidden', 'false');
      $('drawerScrim').classList.add('on');
      $('drClose').focus({ preventScroll: true });
    },
    close(){
      $('drawer').classList.remove('on'); $('drawer').setAttribute('aria-hidden', 'true');
      $('drawerScrim').classList.remove('on');
      if (this.returnTo) this.returnTo.focus({ preventScroll: true });
    }
  };
  $('drClose').addEventListener('click', () => EvidenceDrawer.close());
  $('drawerScrim').addEventListener('click', () => EvidenceDrawer.close());
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('drawer').classList.contains('on')) EvidenceDrawer.close(); });

  // ---------------------------------------------------------------------
  //  CaseReport — verdict logic unchanged; only the presentation is new
  // ---------------------------------------------------------------------
  const CLASSIFICATION = { IMPERSONATION: 'HIGH COLLISION', 'NO WITNESSES': 'LOW RECALL', CLEARED: 'CLEARED', 'UNDER WATCH': 'UNDER WATCH' };
  const CaseReport = {
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
        ['MARKET', (niche ? niche + ' direct/adjacent collision' + (niche === 1 ? '' : 's') : 'No collisions in your niche') + ' · ' + (tm ? tm + ' trademark mention' + (tm === 1 ? '' : 's') : 'no trademark chatter'), niche || tm ? 'found' : 'clear'],
        ['CLOSE RELATIVES', viable.length ? viable.length + ' viable alternative' + (viable.length === 1 ? '' : 's') + ' (free .com)' : 'None with a free .com', viable.length ? 'clear' : 'unk'],
        ['MEMORABILITY', pct(scores.memorable) + (g < 0.5 ? ' · distinctive' : ' · not very distinctive'), m >= 0.65 ? 'clear' : 'found']
      ];
      $('reportRows').innerHTML = rows.map(r => '<li><span class="l">' + r[0] + '</span><span class="v"><span class="m ' + (r[2] === 'found' ? 's-bad' : r[2] === 'clear' ? 's-ok' : 's-unk') + '">' + (r[2] === 'found' ? '●' : r[2] === 'clear' ? '✓' : '·') + '</span>' + escapeHtml(r[1]) + '</span></li>').join('');

      // NAME STATUS + WHY
      $('stampName').textContent = state.name;
      const stamp = $('stampEl');
      stamp.textContent = label;
      stamp.classList.toggle('good', verdictClass === 'good');
      $('classMeta').innerHTML = 'CLASSIFIED ' + escapeHtml(state.today) + '<br>FROM 06 CHECKS · DESK 01';
      const because = [];
      if (niche) because.push(niche + ' existing use' + (niche === 1 ? '' : 's') + ' turned up in your niche');
      if (com && com.available === false) because.push('the .com is already registered');
      if (hTaken.length) because.push('the handle is taken on ' + hTaken.map(x => x.label).join(' and '));
      $('stampSub').textContent = sub.charAt(0).toUpperCase() + sub.slice(1) + '.' + (because.length ? ' On the record: ' + because.join(', ') + '.' : '');

      // RECOMMENDED NEXT MOVE — only options the lookups actually returned
      const next = [];
      own.filter(x => x.available === true).slice(0, 3).forEach(x => next.push('Claim <a class="dom" href="' + buyUrl(x.domain) + '" target="_blank" rel="noopener">' + escapeHtml(x.domain) + '</a> while it\'s unregistered' + (x.source === 'dns' ? ' <span class="k">(DNS CHECK — CONFIRM)</span>' : '')));
      viable.forEach(v => next.push('Consider <b>' + escapeHtml(v.name) + '</b> — <a class="dom" href="' + buyUrl(v.domains.com.domain) + '" target="_blank" rel="noopener">' + escapeHtml(v.domains.com.domain) + '</a> is clear'));
      if (hTaken.length) next.push('Primary handles are occupied — plan a modifier for social and check it before launch');
      if (verdict === 'IMPERSONATION' || verdict === 'NO WITNESSES') next.push('Keep looking — this name carries real collision or recall risk');
      next.push('Run a formal trademark search before you file anything');
      $('nextMoves').innerHTML = next.map(t => '<li><span class="m">→</span><span>' + t + '</span></li>').join('');

      $('rawPre').textContent = JSON.stringify(d.raw, null, 2);
      $('pastLog').innerHTML = $('log').innerHTML;
      stamp.style.animation = 'none'; void stamp.offsetWidth; stamp.style.animation = '';
      $('intel').classList.add('reporting');

      $('result').dataset.shareText =
        'Name Worth It case file on "' + state.name + '": ' + label + ' (' + pct(m) + ' memorable, ' + pct(e) + ' easy to say/spell, ' +
        pct(g) + ' too generic, ' + pct(c) + ' brand collision risk).';
    }
  };

  // ---------------------------------------------------------------------
  //  Screens & the opening moment
  // ---------------------------------------------------------------------
  function showScreen(which){
    $('intakeScreen').classList.toggle('on', which === 'intake');
    $('intakeFoot').classList.toggle('on', which === 'intake');
    $('deskScreen').classList.toggle('on', which === 'desk');
  }
  async function openingMoment(name){
    const o = $('opening');
    $('openingSub').textContent = 'SUBJECT · ' + name.toUpperCase();
    o.classList.remove('out'); o.classList.add('on');
    await sleep(720);
    o.classList.add('out');
    await sleep(240);
    o.classList.remove('on', 'out');
  }

  function showError(title, detail, extra){
    const onDesk = $('deskScreen').classList.contains('on');
    const box = onDesk ? $('wsError') : $('errorBox');
    box.innerHTML = '<strong>' + title + '</strong><br>' + detail + (extra ? '<pre>' + escapeHtml(extra) + '</pre>' : '') +
      (onDesk ? '<br><button class="btn-quiet" type="button" data-back>← Back to intake</button>' : '');
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
    state.name = name; state.context = context; state.data = null; state.links = [];
    state.sections = {}; state.evidence = 0; state.filed = 0;
    CaseFileSidebar.render();
    SECTIONS.forEach(s => { state.sections[s.key] = 'idle'; });
    $('cfSubject').textContent = name;
    $('cfStatus').textContent = 'INVESTIGATING';
    $('intel').classList.remove('reporting');
    SubjectCard.set(name, context);
    InvestigationCanvas.reset();
    InvestigationLog.reset();
    CaseHeader.set('INVESTIGATING', 'active', 'INVESTIGATION ACTIVE');
    CaseHeader.counts(); CaseFileSidebar.counts();
    // every lookup is dispatched at once on the server — log them as they go out
    FILING.forEach((f, i) => queued.push(setTimeout(() => {
      InvestigationLog.add(f.query + '…', 'pending');
      CaseFileSidebar.mark(f.key, 'active');
    }, reduceMotion ? 0 : 160 + i * 170)));
    let i = 0;
    walkTimer = setInterval(() => { InvestigationLog.now(FILING[i % FILING.length].query + '…'); i++; }, 900);
    InvestigationLog.now('OPENING FILE…');
  }

  async function fileEvidence(d){
    stopQueued();
    state.data = d;
    state.receivedAt = new Date();
    state.links = computeLinks(d);
    if (d.cached){ InvestigationLog.add('CASE ON FILE — RECORDS RETRIEVED FROM THE CABINET', 'clear'); await sleep(250); }
    const step = d.cached ? 260 : 620;
    for (const f of FILING){
      const key = f.key, outcome = leadOutcome(key, d);
      InvestigationLog.now(f.query + '…');
      await sleep(Math.round(step * 0.35));
      InvestigationCanvas.file(key, RENDER[key](d));
      state.evidence += evidenceCount(key, d);
      state.filed += 1;
      CaseFileSidebar.mark(key, outcome);
      InvestigationLog.add(receivedLine(key, d), outcome);
      InvestigationLog.finding(findingLine(key, d), outcome);
      CaseHeader.counts(); CaseFileSidebar.counts();
      await sleep(Math.round(step * 0.25));
      EvidenceConnection.retether();
      EvidenceConnection.tether(key, true);
      await sleep(Math.round(step * 0.4));
    }
    EvidenceConnection.retether();
    InvestigationLog.add('BUILDING CASE REPORT', 'pending');
    InvestigationLog.now('BUILDING CASE REPORT…');
    await sleep(d.cached ? 200 : 520);
    InvestigationLog.add('CASE COMPLETE', 'clear');
    InvestigationLog.now('CASE COMPLETE', true);
    SubjectCard.complete();
    $('cfStatus').textContent = 'COMPLETE';
    CaseHeader.set('COMPLETE', 'complete', 'CASE COMPLETE');
    CaseReport.render(d);
  }

  function holdCase(reason){
    stopQueued();
    SECTIONS.forEach(s => { if (state.sections[s.key] === 'active' || state.sections[s.key] === 'idle'){ CaseFileSidebar.mark(s.key, 'cold'); InvestigationCanvas.cold(s.key); } });
    InvestigationLog.add(reason, 'cold');
    InvestigationLog.now(reason, true);
    $('cfStatus').textContent = 'ON HOLD';
    SubjectCard.state('ON HOLD');
    CaseHeader.set('ON HOLD', 'hold', 'INVESTIGATION ON HOLD');
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

    // the lookups start now, while the case is being opened
    const request = fetch(RELAY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name, context: context })
    });

    await openingMoment(name);
    showScreen('desk');
    window.scrollTo(0, 0);
    beginInvestigation(name, context);

    try{
      const res = await request;
      const text = await res.text();
      let data;
      try{ data = JSON.parse(text); }catch(e){ data = { raw: text }; }

      if (res.status === 429){
        holdCase('TOO MANY CASES — WAIT A MINUTE');
        showError('Too many checks right now', data.error || 'Give it a minute and try again.');
        return;
      }
      if (!res.ok){
        holdCase('LOOKUP FAILED (' + res.status + ')');
        showError('Got an error back (' + res.status + ')', data.error || 'Something went wrong on the checker side.', JSON.stringify(data, null, 2));
        return;
      }
      if (!data.scores){
        holdCase('RECORDS UNREADABLE');
        showError('Got a response but couldn\'t read the scores out of it', 'Raw response below.', JSON.stringify(data, null, 2));
        return;
      }

      await sleep(250);
      await fileEvidence(data);
    }catch(err){
      holdCase('THE TRAIL WENT COLD');
      showError('Could not reach the checker', 'Try again in a moment.');
    }finally{
      runBtn.disabled = false;
      $('runBtnLabel').textContent = 'Open case';
    }
  }

  function newCase(){
    stopQueued();
    EvidenceDrawer.close();
    hideError();
    showScreen('intake');
    CaseHeader.set('OPEN', null, 'AWAITING SUBJECT');
    $('chChecks').textContent = '00/06'; $('chEvidence').textContent = '00'; $('chProgress').style.width = '0';
    window.scrollTo(0, 0);
    setTimeout(() => { $('nameInput').focus({ preventScroll: true }); $('nameInput').select(); }, 50);
  }

  // ---------------------------------------------------------------------
  //  Wiring
  // ---------------------------------------------------------------------
  $('intakeForm').addEventListener('submit', (e) => { e.preventDefault(); if (!$('runBtn').disabled) run(); });
  $('cfSections').addEventListener('click', (e) => { const b = e.target.closest('.sec'); if (b) InvestigationCanvas.focus(b.dataset.k); });
  $('cfNew').addEventListener('click', newCase);
  $('runAgainBtn').addEventListener('click', newCase);

  const copyBtn = $('copyBtn');
  copyBtn.addEventListener('click', async function(){
    const txt = $('result').dataset.shareText || '';
    try{
      await navigator.clipboard.writeText(txt);
      copyBtn.textContent = 'copied';
      setTimeout(function(){ copyBtn.textContent = 'copy report'; }, 1500);
    }catch(e){ showError('Could not copy', 'Select and copy the verdict manually.'); }
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
    rt = setTimeout(() => {
      EvidenceConnection.clearHot(); EvidenceConnection.retether();
      const fam = board.querySelector('.art[data-art="relatives"]'); if (fam) drawFamily(fam);
    }, 100);
  });
  CaseFileSidebar.render();
})();
