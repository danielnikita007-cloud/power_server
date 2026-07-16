/**
 * ============================================================
 * Bharat Power Grid Monitor — Data Server
 * ============================================================
 * Serves every dashboard dataset as JSON, exposes a /api/live
 * feed in the shape the dashboard's sync plug-in expects, and
 * accepts authenticated updates so ministry staff can refresh
 * figures without touching the frontend.
 *
 * Run:      npm install && npm start
 * Config:   PORT     (default 8080)
 *           API_KEY  (default 'change-me' — SET THIS IN PROD)
 *
 * Endpoints:
 *   GET  /health              server status
 *   GET  /api/all             full dataset (dashboard boot)
 *   GET  /api/national        national headline metrics by FY
 *   GET  /api/genco           generation data
 *   GET  /api/transco         transmission data
 *   GET  /api/discom          distribution + regions + states + RDSS
 *   GET  /api/news            policy & market intelligence items
 *   GET  /api/insights        Challenges-tab analytics
 *   GET  /api/live            headline snapshot (CUSTOM_FEED_URL shape)
 *   PUT  /api/:section        replace a section   (x-api-key header)
 *   POST /api/reload          re-read JSON files  (x-api-key header)
 * ============================================================
 */
const express = require('express');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8080;
const API_KEY = process.env.API_KEY || 'change-me';
const DATA_DIR = path.join(__dirname, 'data');
const SECTIONS = ['national', 'genco', 'transco', 'discom', 'news', 'insights'];
const LATEST_FY = 'FY26';

/* ---------- in-memory store, backed by data/*.json ---------- */
const store = {};
let updatedAt = null;

function loadAll() {
  for (const s of SECTIONS) {
    store[s] = JSON.parse(fs.readFileSync(path.join(DATA_DIR, s + '.json'), 'utf8'));
  }
  updatedAt = new Date().toISOString();
  console.log(`[data] loaded ${SECTIONS.length} sections from ${DATA_DIR}`);
}
loadAll();

/* ---------- app ---------- */
const app = express();
app.use(express.json({ limit: '2mb' }));

/* CORS — the dashboard may be opened from file://, an intranet host,
   or claude.ai; keep permissive by default, tighten for production. */
app.use((req, res, next) => {
  res.set('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || '*');
  res.set('Access-Control-Allow-Headers', 'Content-Type, x-api-key');
  res.set('Access-Control-Allow-Methods', 'GET, PUT, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

/* ---------- read endpoints ---------- */
app.get('/health', (req, res) =>
  res.json({ ok: true, sections: SECTIONS, updatedAt })
);

app.get('/api/all', (req, res) => res.json({ ...store, updatedAt }));

for (const s of SECTIONS) {
  app.get('/api/' + s, (req, res) => res.json(store[s]));
}

/* Live headline snapshot — exactly the JSON shape the dashboard's
   Sync-Live-Data plug-in consumes (see CUSTOM_FEED_URL docs). */
app.get('/api/live', (req, res) => {
  const g = store.genco, t = store.transco, d = store.discom, n = store.national[LATEST_FY];
  const mix = g.mix[LATEST_FY];
  const total = mix.reduce((a, b) => a + b, 0);
  const nonFossil = (mix[2] + mix[3] + mix[4] + mix[5] + mix[6]) / total * 100;
  res.json({
    asOf: `${LATEST_FY} · served ${new Date().toISOString().slice(0, 10)}`,
    totalCapacityGW: +total.toFixed(1),
    nonFossilSharePct: +nonFossil.toFixed(1),
    coalPlfPct: g.coalPlf[LATEST_FY],
    transmissionLakhCkm: t.ckmLakh[LATEST_FY],
    transformationLakhMVA: t.mvaLakh[LATEST_FY],
    gridAvailabilityPct: t.availability[LATEST_FY],
    interRegionalGW: t.interRegional[LATEST_FY],
    atcLossPct: d.regions.all.atc[LATEST_FY],
    acsArrGapRs: d.regions.all.gap[LATEST_FY],
    rdssSmartMetersCr: d.rdss[0].done,
    peakDemandMetGW: n.peak,
    energySuppliedBU: n.energy,
    headlines: store.news.slice(0, 3)
  });
});

/* ---------- authenticated write endpoints ---------- */
function auth(req, res, next) {
  if (req.get('x-api-key') !== API_KEY)
    return res.status(401).json({ error: 'invalid or missing x-api-key' });
  next();
}

app.put('/api/:section', auth, (req, res) => {
  const s = req.params.section;
  if (!SECTIONS.includes(s)) return res.status(404).json({ error: 'unknown section', valid: SECTIONS });
  if (!req.body || typeof req.body !== 'object')
    return res.status(400).json({ error: 'body must be a JSON object/array' });
  store[s] = req.body;
  fs.writeFileSync(path.join(DATA_DIR, s + '.json'), JSON.stringify(req.body, null, 2));
  updatedAt = new Date().toISOString();
  res.json({ ok: true, section: s, updatedAt });
});

app.post('/api/reload', auth, (req, res) => {
  loadAll();
  res.json({ ok: true, updatedAt });
});

/* ---------- serve the dashboard itself ---------- */
app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, () => {
  console.log(`Bharat Power Grid data server → http://localhost:${PORT}`);
  console.log(`Dashboard:  http://localhost:${PORT}/`);
  console.log(`API:        http://localhost:${PORT}/api/all`);
  if (API_KEY === 'change-me') console.warn('[warn] API_KEY is the default — set API_KEY env var before production use');
});
