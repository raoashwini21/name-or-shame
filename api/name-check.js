// Vercel serverless function. Deployed alongside index.html, same origin —
// no CORS setup needed, no n8n, nothing else to stand up.
//
// Does two live checks, no LLM involved in either:
//   1. Domain availability for .com/.io/.net via RDAP (free, no API key).
//   2. A real web search (Serper.dev) for the name alongside your one-line
//      description, to catch an existing company already using it.
// Then asks Jev — using YOUR stored key (JEV_API_KEY env var), not a
// visitor-supplied one — a question grounded in those real search results.
//
// Because every visitor runs on your key with no key of their own to bring,
// this also does a basic per-IP rate limit below. It's in-memory, so it
// resets on cold start and isn't shared across server instances — it's a
// cheap first line of defense against a bot or a bad actor hammering the
// endpoint, not a hard cap. If usage grows enough to need a real one
// (persistent store, per-key quotas, etc.), that's the point to add it.

const TLDS = ['com', 'io', 'net'];

const RATE_LIMIT_MAX = 8;        // requests
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // per minute, per IP
const rateLimitBuckets = new Map();

function isRateLimited(ip) {
  const now = Date.now();
  const bucket = rateLimitBuckets.get(ip) || [];
  const recent = bucket.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  recent.push(now);
  rateLimitBuckets.set(ip, recent);
  // keep the map from growing forever across a long-lived instance
  if (rateLimitBuckets.size > 5000) rateLimitBuckets.clear();
  return recent.length > RATE_LIMIT_MAX;
}

function slugify(name) {
  return (name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))
  ]);
}

async function checkDomain(domain) {
  try {
    const res = await withTimeout(
      fetch('https://rdap.org/domain/' + domain, { method: 'GET' }),
      8000
    );
    if (res.status === 404) return { domain, available: true };
    if (res.status === 200) return { domain, available: false };
    return { domain, available: null };
  } catch (e) {
    return { domain, available: null };
  }
}

async function searchNiche(name, context) {
  const key = process.env.SERPER_API_KEY;
  if (!key) {
    return { matches: [], error: 'SERPER_API_KEY not set on the server — niche collision check is skipped. Add it in Vercel\'s Environment Variables and redeploy.' };
  }
  try {
    const res = await withTimeout(
      fetch('https://google.serper.dev/search', {
        method: 'POST',
        headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: '"' + name + '" ' + context, num: 6 })
      }),
      8000
    );
    if (!res.ok) {
      return { matches: [], error: 'Search failed this run — niche collision check skipped, domain availability is still live.' };
    }
    const data = await res.json();
    const organic = data.organic || [];
    const matches = organic.slice(0, 6).map((r) => ({
      title: r.title || '',
      link: r.link || '',
      snippet: r.snippet || ''
    }));
    return { matches, error: null };
  } catch (e) {
    return { matches: [], error: 'Search failed this run — niche collision check skipped, domain availability is still live.' };
  }
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
  if (isRateLimited(ip)) {
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

    const [domainResults, nicheResult] = await Promise.all([
      Promise.all(TLDS.map((tld) => checkDomain(slug + '.' + tld))),
      searchNiche(name, context)
    ]);

    const domains = {};
    for (const d of domainResults) {
      const tld = d.domain.split('.').pop();
      domains[tld] = d;
    }

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

    res.status(200).json({
      name,
      domains,
      niche_matches: nicheResult.matches,
      serp_error: nicheResult.error,
      scores,
      raw
    });
  } catch (e) {
    res.status(500).json({ error: 'Unexpected server error.', detail: String(e) });
  }
};
