/**
 * ============================================================
 * Automated Power-Sector News Fetcher
 * ============================================================
 * Pulls the latest headlines from Google News RSS (free, no
 * API key) for a curated set of power-sector search terms,
 * classifies each into Positive/Watch/Critical, and writes
 * data/news.json in the exact shape the dashboard expects.
 * ============================================================
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const DATA_FILE = path.join(process.cwd(), 'data', 'news.json');
const MAX_ITEMS = 9;

const QUERIES = [
  'India power ministry discom',
  'RDSS smart meter India',
  'CEA installed capacity India',
  'India transmission grid POWERGRID',
  'India coal thermal power plant'
];

const CRITICAL_WORDS = ['crisis', 'shortage', 'blackout', 'default', 'critical', 'fails', 'failure', 'stalled', 'delay', 'debt', 'loss', 'shut down', 'protest', 'outage'];
const POSITIVE_WORDS  = ['approve', 'record', 'growth', 'milestone', 'profit', 'launch', 'boost', 'commission', 'inaugurat', 'target met', 'surge', 'expand', 'achieve'];

function classify(title) {
  const t = title.toLowerCase();
  if (CRITICAL_WORDS.some(w => t.includes(w))) return 'Critical';
  if (POSITIVE_WORDS.some(w => t.includes(w))) return 'Positive';
  return 'Watch';
}

function fetchRss(query) {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-IN&gl=IN&ceid=IN:en`;
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve(body));
    }).on('error', reject);
  });
}

function parseItems(xml) {
  const items = [];
  const blocks = xml.split('<item>').slice(1);
  for (const block of blocks) {
    const titleMatch = block.match(/<title>([\s\S]*?)<\/title>/);
    const sourceMatch = block.match(/<source[^>]*>([\s\S]*?)<\/source>/);
    const pubMatch = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/);
    if (!titleMatch) continue;
    let title = titleMatch[1].replace('<![CDATA[', '').replace(']]>', '').trim();
    title = title.replace(/\s+-\s+[^-]+$/, '').trim();
    const source = sourceMatch ? sourceMatch[1].replace('<![CDATA[', '').replace(']]>', '').trim() : 'Google News';
    const date = pubMatch ? new Date(pubMatch[1]) : new Date();
    const dateLabel = date.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
    items.push({ t: title, tag: classify(title), src: `${source} · ${dateLabel}` });
  }
  return items;
}

async function main() {
  console.log('[news-fetch] querying', QUERIES.length, 'search terms...');
  const all = [];
  for (const q of QUERIES) {
    try {
      const xml = await fetchRss(q);
      const items = parseItems(xml);
      console.log(`[news-fetch] "${q}" → ${items.length} items`);
      all.push(...items);
    } catch (err) {
      console.warn(`[news-fetch] failed for "${q}":`, err.message);
    }
  }

  const seen = new Set();
  const deduped = [];
  for (const item of all) {
    const key = item.t.toLowerCase().slice(0, 60);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
    if (deduped.length >= MAX_ITEMS) break;
  }

  if (deduped.length === 0) {
    console.warn('[news-fetch] no items fetched — leaving existing news.json untouched');
    return;
  }

  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(deduped, null, 2) + '\n');
  console.log(`[news-fetch] wrote ${deduped.length} items to ${DATA_FILE}`);
}

main().catch((err) => {
  console.error('[news-fetch] fatal error:', err);
  process.exit(1);
});
