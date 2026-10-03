// Vercel serverless function. Deployed alongside index.html, same origin —
// no CORS setup needed, no n8n, nothing else to stand up.
//
// Does two live checks, no LLM involved in either:
//   1. Domain availability for .com/.io/.net/.ai/.app/.co via RDAP (free, no
//      API key). When RDAP is inconclusive (timeout, 5xx, rate-limited), falls
//      back to a DNS NS lookup: NS records = taken, NXDOMAIN = likely clear
//      (a registered domain with no DNS at all would slip through, so the UI
//      labels DNS-sourced "clear" as "likely clear").
//   2. A real web search (Serper.dev) for the name alongside your one-line
//      description, to catch an existing company already using it.
// Both checks are also run against 2-3 close variants of the name (a suffix,
// a prefix, a respelling) so there's a fallback to look at if the original
// is crowded.
// Also checks whether the name is taken as a handle on X and Instagram with a
// plain HEAD request: 200 = taken, 404 = open, anything else (redirect to a
// login wall, 429, timeout) = unknown. Redirects are NOT followed, since both
// sites bounce logged-out/blocked traffic to a login page that returns 200
// and would read as "taken" for every handle.
// Plus a separate "<name>" trademark web search, shown as a signal (not a
// legal clearance — it doesn't query any trademark register).
// Then asks Jev — using YOUR stored key (JEV_API_KEY env var), not a
// visitor-supplied one — a question grounded in those real search results.
//
// Because every visitor runs on your key with no key of their own to bring,
// this also does a per-IP rate limit, stored in Upstash Redis (REST API,
// UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN) so it survives cold
// starts and is shared across instances. It's a fixed one-minute window:
// one INCR + PEXPIRE pipeline per request. If Upstash isn't configured or
// can't be reached, it falls back to a per-instance in-memory limit rather
// than either blocking everyone or dropping the limit entirely.

const crypto = require('crypto');
const dns = require('dns');

const TLDS = ['com', 'io', 'net', 'ai', 'app', 'co'];

const dnsResolver = new dns.promises.Resolver({ timeout: 3000, tries: 1 });

const RATE_LIMIT_MAX = 8;        // requests
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // per minute, per IP
const rateLimitBuckets = new Map();

function isRateLimitedInMemory(ip) {
  const now = Date.now();
  const bucket = rateLimitBuckets.get(ip) || [];
  const recent = bucket.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  recent.push(now);
  rateLimitBuckets.set(ip, recent);
  // keep the map from growing forever across a long-lived instance
  if (rateLimitBuckets.size > 5000) rateLimitBuckets.clear();
  return recent.length > RATE_LIMIT_MAX;
}

// Returns the request count for this IP in the current window, or null if
// Upstash isn't configured / didn't answer cleanly.
async function upstashHit(ip) {
  const url = (process.env.UPSTASH_REDIS_REST_URL || '').replace(/\/+$/, '');
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  const windowId = Math.floor(Date.now() / RATE_LIMIT_WINDOW_MS);
  const key = 'nwi:rl:' + ip + ':' + windowId;
  try {
    const res = await withTimeout(
      fetch(url + '/pipeline', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        // key is unique per window, so re-setting the expiry on every hit is
        // harmless — it just guarantees old windows get cleaned up.
        body: JSON.stringify([
          ['INCR', key],
          ['PEXPIRE', key, String(RATE_LIMIT_WINDOW_MS * 2)]
        ])
      }),
      2000
    );
    if (!res.ok) return null;
    const data = await res.json();
    const count = Array.isArray(data) && data[0] ? data[0].result : null;
    return typeof count === 'number' ? count : null;
  } catch (e) {
    return null;
  }
}

async function isRateLimited(ip) {
  const count = await upstashHit(ip);
  if (count === null) return isRateLimitedInMemory(ip);
  return count > RATE_LIMIT_MAX;
}

// Full-response cache so repeat lookups of the same name + context within
// 10 minutes skip every external call (RDAP, DNS, Serper, socials, Jev).
// In-memory like the old limiter: per instance, gone on cold start — it's
// there to absorb double-clicks and re-runs, not to be a shared cache.
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX_ENTRIES = 500;
const responseCache = new Map();

function cacheKey(name, context, variants) {
  return crypto.createHash('sha256').update(JSON.stringify([name, context, variants])).digest('hex');
}

function cacheGet(key) {
  const hit = responseCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    responseCache.delete(key);
    return null;
  }
  return hit.value;
}

function cacheSet(key, value) {
  responseCache.delete(key);
  responseCache.set(key, { at: Date.now(), value });
  // Map keeps insertion order, so the first key is the oldest write.
  while (responseCache.size > CACHE_MAX_ENTRIES) {
    responseCache.delete(responseCache.keys().next().value);
  }
}

function slugify(name) {
  return (name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Deterministic, so the same name always yields the same variants: one
// suffixed, one prefixed, one respelled. Keeps the original's capitalization
// style; skips anything that collapses back to the original slug.
function respell(slug) {
  const rules = [
    [/ph/, 'f'], [/ck/, 'k'], [/c(?=[aou]|$)/, 'k'], [/qu/, 'kw'],
    [/i/, 'y'], [/y/, 'i'], [/s$/, 'z'], [/er$/, 'r'], [/x/, 'ks'], [/ee/, 'ea']
  ];
  for (const [re, rep] of rules) {
    const out = slug.replace(re, rep);
    if (out !== slug) return out;
  }
  return null;
}

function generateVariants(name) {
  const base = (name || '').replace(/[^A-Za-z0-9]/g, '');
  const slug = base.toLowerCase();
  if (!slug) return [];
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const upperFirst = base.charAt(0) !== base.charAt(0).toLowerCase();
  const respelled = respell(slug);
  const candidates = [
    base + (/(ly|y)$/i.test(base) ? (upperFirst ? 'HQ' : 'hq') : 'ly'),
    'Get' + cap(base),
    respelled && (upperFirst ? cap(respelled) : respelled)
  ];
  const seen = new Set([slug]);
  const out = [];
  for (const c of candidates) {
    if (!c) continue;
    const s = slugify(c);
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(c);
  }
  return out.slice(0, 3);
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))
  ]);
}

async function checkDomainDns(domain) {
  try {
    const ns = await withTimeout(dnsResolver.resolveNs(domain), 4000);
    return { domain, available: ns.length ? false : null, source: 'dns' };
  } catch (e) {
    // ENOTFOUND = NXDOMAIN: nothing delegated under that name.
    if (e.code === 'ENOTFOUND') return { domain, available: true, source: 'dns' };
    // ENODATA = the name exists in DNS, just without its own NS set.
    if (e.code === 'ENODATA') return { domain, available: false, source: 'dns' };
    return { domain, available: null, source: 'dns' };
  }
}

async function checkDomain(domain) {
  try {
    const res = await withTimeout(
      fetch('https://rdap.org/domain/' + domain, { method: 'GET' }),
      8000
    );
    if (res.status === 404) return { domain, available: true, source: 'rdap' };
    if (res.status === 200) return { domain, available: false, source: 'rdap' };
  } catch (e) {
    // fall through to DNS
  }
  return checkDomainDns(domain);
}

async function checkDomains(slug) {
  const results = await Promise.all(TLDS.map((tld) => checkDomain(slug + '.' + tld)));
  const domains = {};
  for (const d of results) {
    const tld = d.domain.split('.').pop();
    domains[tld] = d;
  }
  return domains;
}

async function checkVariant(variant, context) {
  const [domains, nicheResult] = await Promise.all([
    checkDomains(slugify(variant)),
    searchNiche(variant, context, 3)
  ]);
  return {
    name: variant,
    domains,
    niche_matches: nicheResult.matches,
    serp_error: nicheResult.error
  };
}

const SOCIALS = [
  { platform: 'x', label: 'X', maxLen: 15, url: (h) => 'https://x.com/' + h },
  { platform: 'instagram', label: 'Instagram', maxLen: 30, url: (h) => 'https://www.instagram.com/' + h + '/' }
];

async function checkHandle(social, handle) {
  const url = social.url(handle);
  const base = { platform: social.platform, label: social.label, handle, url };
  if (handle.length > social.maxLen) {
    return { ...base, taken: null, note: 'longer than ' + social.label + "'s " + social.maxLen + '-character limit' };
  }
  try {
    const res = await withTimeout(
      fetch(url, {
        method: 'HEAD',
        redirect: 'manual',
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NameWorthIt/1.0)' }
      }),
      6000
    );
    if (res.status === 200) return { ...base, taken: true };
    if (res.status === 404) return { ...base, taken: false };
    return { ...base, taken: null };
  } catch (e) {
    return { ...base, taken: null };
  }
}

async function checkSocials(slug) {
  const results = await Promise.all(SOCIALS.map((s) => checkHandle(s, slug)));
  const socials = {};
  for (const r of results) socials[r.platform] = r;
  return socials;
}

// One Serper call. Returns { matches, error } where error is 'no_key',
// 'failed', or null — callers turn that into their own user-facing message.
async function serperSearch(query, limit) {
  const key = process.env.SERPER_API_KEY;
  if (!key) return { matches: [], error: 'no_key' };
  try {
    const res = await withTimeout(
      fetch('https://google.serper.dev/search', {
        method: 'POST',
        headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: query, num: limit })
      }),
      8000
    );
    if (!res.ok) return { matches: [], error: 'failed' };
    const data = await res.json();
    const organic = data.organic || [];
    const matches = organic.slice(0, limit).map((r) => ({
      title: r.title || '',
      link: r.link || '',
      snippet: r.snippet || ''
    }));
    return { matches, error: null };
  } catch (e) {
    return { matches: [], error: 'failed' };
  }
}

async function searchNiche(name, context, limit = 6) {
  const { matches, error } = await serperSearch('"' + name + '" ' + context, limit);
  if (error === 'no_key') {
    return { matches, error: 'SERPER_API_KEY not set on the server — niche collision check is skipped. Add it in Vercel\'s Environment Variables and redeploy.' };
  }
  if (error) {
    return { matches, error: 'Search failed this run — niche collision check skipped, domain availability is still live.' };
  }
  return { matches, error: null };
}

// A web search for "<name>" trademark — surfaces registrations, filings and
// disputes that happen to be indexed. A signal only: it is not a search of
// any trademark register and says nothing definitive either way.
async function searchTrademark(name) {
  const { matches, error } = await serperSearch('"' + name + '" trademark', 6);
  if (error === 'no_key') {
    return { matches, error: 'SERPER_API_KEY not set on the server — trademark signal is skipped.' };
  }
  if (error) {
    return { matches, error: 'Search failed this run — trademark signal skipped.' };
  }
  return { matches, error: null };
}

function extractProb(v) {
  if (v == null) return null;
  if (typeof v === 'number') return v;
  if (typeof v === 'object') {
    if (typeof v.noul === 'number') return v.noul;
    if (typeof v.score === 'number') return v.score;
    if (typeof v.confidence === 'number') return v.confidence;
    if (typeof v.probability === 'number') return v.probability;
  }
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Use POST.' });
    return;
  }

  const ip = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown')
    .toString()
    .split(',')[0]
    .trim();
  if (await isRateLimited(ip)) {
    res.status(429).json({ error: 'Too many checks from this connection in the last minute. Wait a moment and try again.' });
    return;
  }

  const apiKey = process.env.JEV_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'Server is not configured with a Jev key yet (JEV_API_KEY env var missing).' });
    return;
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const name = (body.name || '').trim();
    const context = (body.context || '').trim();

    if (!name || !context) {
      res.status(400).json({ error: 'Missing name or context.' });
      return;
    }

    const slug = slugify(name);
    const variantNames = generateVariants(name);

    const key = cacheKey(name, context, variantNames);
    const cachedBody = cacheGet(key);
    if (cachedBody) {
      res.status(200).json({ ...cachedBody, cached: true });
      return;
    }

    const [domains, nicheResult, variants, socials, trademarkResult] = await Promise.all([
      checkDomains(slug),
      searchNiche(name, context),
      Promise.all(variantNames.map((v) => checkVariant(v, context))),
      checkSocials(slug),
      searchTrademark(name)
    ]);

    const groundingText = nicheResult.matches.length
      ? 'Real web search results for "' + name + '" alongside "' + context + '": ' +
        nicheResult.matches.map((m, i) => (i + 1) + '. ' + m.title + ' — ' + m.snippet).join(' | ')
      : 'No real search results were available to check against — judge from general knowledge only.';

    let scores = null;
    let raw = null;

    try {
      const jevRes = await withTimeout(
        fetch('https://api.typesafe.ai/v1/systemone', {
          method: 'POST',
          headers: {
            Authorization: 'Bearer ' + apiKey,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: 'jev-latest',
            state: { message: name + ' — ' + context },
            questions: {
              memorable: {
                type: 'noul',
                instructions: 'The name "' + name + '" is short, distinctive, and easy to remember after hearing it spoken just once — not a forgettable arrangement of common words.'
              },
              easy_say_spell: {
                type: 'noul',
                instructions: 'A stranger who heard the name "' + name + '" spoken aloud, with no spelling given, would spell it correctly on the first try, and could pronounce it correctly from seeing it written.'
              },
              too_generic: {
                type: 'noul',
                instructions: 'The name "' + name + '" is a generic or purely descriptive word or phrase for what it describes (context: "' + context + '"), the kind of name many unrelated products could just as easily use, rather than something distinctive to this one.'
              },
              brand_collision: {
                type: 'noul',
                instructions: 'Based on this evidence from a real web search: ' + groundingText + ' — the name "' + name + '" is already used by an existing company, product, or well-known brand (in this niche or any other) such that someone hearing it would likely confuse the two, or think of that other thing first.'
              }
            }
          })
        }),
        15000
      );

      raw = await jevRes.json();

      if (!jevRes.ok) {
        res.status(jevRes.status).json({ error: 'Jev request failed.', detail: raw });
        return;
      }

      const container = raw.answers || raw.questions || raw.results || raw;
      scores = {
        memorable: extractProb(container.memorable),
        easy_say_spell: extractProb(container.easy_say_spell),
        too_generic: extractProb(container.too_generic),
        brand_collision: extractProb(container.brand_collision)
      };
      const gotAny = Object.values(scores).some((v) => v !== null);
      if (!gotAny) scores = null;
    } catch (e) {
      res.status(502).json({ error: 'Could not reach Jev.', detail: String(e) });
      return;
    }

    const responseBody = {
      name,
      domains,
      niche_matches: nicheResult.matches,
      serp_error: nicheResult.error,
      variants,
      socials,
      trademark_matches: trademarkResult.matches,
      trademark_error: trademarkResult.error,
      scores,
      raw
    };

    // Don't pin a transient search failure in the cache for 10 minutes.
    const searchFailed = [nicheResult, trademarkResult, ...variants.map((v) => ({ error: v.serp_error }))]
      .some((r) => r.error);
    if (scores && !searchFailed) cacheSet(key, responseBody);

    res.status(200).json({ ...responseBody, cached: false });
  } catch (e) {
    res.status(500).json({ error: 'Unexpected server error.', detail: String(e) });
  }
};
