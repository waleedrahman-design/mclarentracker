/*
 * McLaren F1 Tracker - unofficial fan dashboard.
 *
 * Every value rendered by this file is fetched at runtime from:
 *   - Jolpica-F1 (Ergast-compatible)  https://api.jolpi.ca/ergast/f1/
 *   - OpenF1                          https://api.openf1.org/v1/
 *
 * Nothing about drivers, seasons, results, schedules, colours or points is
 * hardcoded. The only data constants are the subject team identifiers below.
 *
 * Not affiliated with McLaren Racing, Formula 1, the FIA or Google.
 */
(function () {
  'use strict';

  /* ------------------------------------------------------------------ */
  /* Subject identifiers (the only data constants)                       */
  /* ------------------------------------------------------------------ */
  const TEAM_ID = 'mclaren';       // Jolpica-F1 constructorId
  const TEAM_OPENF1 = 'McLaren';   // OpenF1 team_name

  const JOLPICA = 'https://api.jolpi.ca/ergast/f1';
  const OPENF1 = 'https://api.openf1.org/v1';

  const SEC = 1000;
  const MIN = 60 * SEC;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;
  const TTL = {
    live: 20 * SEC,
    short: 2 * MIN,
    empty: 3 * MIN,                 // cap for empty ("No results found") answers, which may fill in later
    standings: 10 * MIN,
    session: 30 * MIN,
    schedule: 6 * HOUR,
    history: 7 * DAY
  };
  // v2: entries written by v1 could hold a week-long copy of a session that was still running.
  const CACHE_PREFIX = 'mft:v2:';
  const CACHE_ROOT = 'mft:';
  const THEME_KEY = 'mft-theme';
  const PAGE_SIZE = 100;            // Jolpica maximum page size
  const LIVE_POLL_MS = 4 * SEC;     // one OpenF1 request per tick while live
  const LAP_LOOKBACK_MS = 6 * MIN;  // live lap polling re-reads laps started this long before the newest one

  const state = {
    season: null,                 // live "current" season string from Jolpica
    teamColour: null,             // live team colour from OpenF1
    colours: new Map(),           // OpenF1 name_acronym -> #hex
    teamColours: new Map(),       // OpenF1 team_name (lowercase) -> #hex
    consColours: new Map()        // Jolpica constructorId -> #hex (derived from the two maps above)
  };

  let routeToken = 0;
  const leaveHooks = [];
  const onLeave = (fn) => leaveHooks.push(fn);

  /* ------------------------------------------------------------------ */
  /* Small utilities                                                     */
  /* ------------------------------------------------------------------ */
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ESC_MAP[c]);
  const num = (v) => {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const isClassified = (res) => !!res && /^\d+$/.test(String(res.positionText || ''));
  const byRound = (a, b) => Number(a.round) - Number(b.round);
  const uniq = (arr) => Array.from(new Set(arr));
  const plural = (n, word, many) => `${n} ${n === 1 ? word : (many || word + 's')}`;

  function debounce(fn, ms) {
    let t = null;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }

  /** Parse API timestamps (OpenF1 uses up to 6 fractional digits). */
  function parseTime(s) {
    if (!s) return null;
    const t = Date.parse(String(s).replace(/(\.\d{3})\d+/, '$1'));
    return Number.isFinite(t) ? t : null;
  }

  /** Jolpica date + optional time to epoch ms (UTC). */
  function ergastTime(date, time) {
    if (!date) return null;
    let iso = `${date}T00:00:00Z`;
    if (time) iso = `${date}T${/Z$|[+-]\d\d:?\d\d$/.test(time) ? time : time + 'Z'}`;
    const t = Date.parse(iso);
    return Number.isFinite(t) ? t : null;
  }

  const isoAt = (ms) => new Date(ms).toISOString();

  function fmt(ms, opts) {
    if (ms == null) return '-';
    try { return new Intl.DateTimeFormat(undefined, opts).format(new Date(ms)); } catch (e) { return new Date(ms).toString(); }
  }
  const fmtClock = (ms) => fmt(ms, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const fmtHM = (ms) => fmt(ms, { hour: '2-digit', minute: '2-digit' });
  const fmtDate = (ms) => fmt(ms, { year: 'numeric', month: 'short', day: 'numeric' });
  const fmtDateTime = (ms) => fmt(ms, { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const fmtDayHM = (ms) => fmt(ms, { weekday: 'short', hour: '2-digit', minute: '2-digit' });
  // Date-only values (no start time published) are calendar dates, so format them in UTC
  // to avoid shifting them to the previous/next day in the viewer's time zone.
  const fmtDayUTC = (ms) => fmt(ms, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
  const fmtDateUTC = (ms) => fmt(ms, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
  const raceDateLabel = (race) => {
    const t = ergastTime(race && race.date, race && race.time);
    return race && race.time ? fmtDate(t) : fmtDateUTC(t);
  };
  function tzName() {
    try {
      const p = new Intl.DateTimeFormat(undefined, { timeZoneName: 'short' }).formatToParts(new Date());
      const z = p.find((x) => x.type === 'timeZoneName');
      return z ? z.value : '';
    } catch (e) { return ''; }
  }

  function fmtLap(sec) {
    if (sec == null || !Number.isFinite(sec)) return '-';
    const m = Math.floor(sec / 60);
    const s = sec - m * 60;
    return m ? `${m}:${s.toFixed(3).padStart(6, '0')}` : s.toFixed(3);
  }
  function fmtPts(p) {
    const n = num(p);
    if (n == null) return '-';
    return Number.isInteger(n) ? String(n) : n.toFixed(1);
  }
  function fmtSigned(n, digits) {
    if (n == null || !Number.isFinite(n)) return '-';
    const d = digits == null ? 3 : digits;
    return (n > 0 ? '+' : n < 0 ? '-' : '') + Math.abs(n).toFixed(d);
  }
  const fmtNum = (n, d) => (n == null || !Number.isFinite(n) ? '-' : n.toFixed(d || 0));
  const driverName = (d) => (d ? `${d.givenName || ''} ${d.familyName || ''}`.trim() : '-');
  const driverCode = (d) => (d ? (d.code || (d.familyName || '').slice(0, 3).toUpperCase()) : '-');
  const posLabel = (p) => (p == null || p === '' ? '-' : `P${p}`);
  const normName = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

  function cardinal(deg) {
    const d = num(deg);
    if (d == null) return '';
    const names = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    return names[Math.round(((d % 360) + 360) % 360 / 45) % names.length];
  }

  /* ------------------------------------------------------------------ */
  /* Colours (from OpenF1 team_colour)                                   */
  /* ------------------------------------------------------------------ */
  const validHex = (h) => (/^#[0-9a-f]{6}$/i.test(h) ? h : null);
  const fallbackColour = (i) => `hsl(${(i * 67 + 200) % 360} 45% 52%)`;
  const isTeamName = (name) => normName(name) === normName(TEAM_OPENF1);

  function applyOpenF1Colours(drivers) {
    for (const d of drivers || []) {
      if (!d || !d.team_colour) continue;
      const hex = validHex('#' + String(d.team_colour).replace('#', ''));
      if (!hex) continue;
      if (d.name_acronym) state.colours.set(d.name_acronym, hex);
      if (d.team_name) state.teamColours.set(normName(d.team_name), hex);
      if (isTeamName(d.team_name) && !state.teamColour) state.teamColour = hex;
    }
    if (state.teamColour) {
      document.documentElement.style.setProperty('--team', state.teamColour);
      const meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute('content', state.teamColour);
    }
  }
  function driverColour(code, i) {
    return state.colours.get(code) || fallbackColour(i || 0);
  }
  /**
   * constructorId -> colour, derived from the live colours of drivers who raced for it. Rounds are
   * read newest first, because a driver's OpenF1 colour is that of their current team: pairing it
   * with an old result from before a mid-season move would paint another team's colour.
   */
  function constructorColourMap(races, key) {
    const m = new Map();
    const list = (races || []).slice().sort((a, b) => byRound(b, a));
    for (const r of list) {
      for (const x of r[key || 'Results'] || []) {
        const cid = x.Constructor && x.Constructor.constructorId;
        const c = x.Driver && state.colours.get(x.Driver.code);
        if (cid && c && !m.has(cid)) m.set(cid, c);
      }
    }
    return m;
  }
  /** driverId -> Constructor from each driver's most recent race result. */
  function latestTeamMap(races) {
    const m = new Map();
    for (const r of (races || []).slice().sort(byRound)) {
      for (const x of r.Results || []) if (x.Driver && x.Constructor) m.set(x.Driver.driverId, x.Constructor);
    }
    return m;
  }
  /**
   * A driver's current team. Jolpica lists a standing's Constructors[] in order of first
   * appearance, not by most recent race, so the latest race result is the authority; the list is
   * only used when it is unambiguous (a single constructor). Returns null when unknown.
   */
  function teamOfStanding(s, teams) {
    const id = s && s.Driver && s.Driver.driverId;
    if (teams && id && teams.has(id)) return teams.get(id);
    const cs = (s && s.Constructors) || [];
    return cs.length === 1 ? cs[0] : null;
  }
  /** Learn constructorId -> colour from a Jolpica driver standings list and live OpenF1 driver colours. */
  function learnConstructorColours(standings, teams) {
    for (const s of standings || []) {
      const team = teamOfStanding(s, teams);
      const c = s && s.Driver && state.colours.get(s.Driver.code);
      if (team && c && !state.consColours.has(team.constructorId)) state.consColours.set(team.constructorId, c);
    }
  }
  /** Best available live colour for a Jolpica constructor, or null when none is known. */
  function consColour(constructor) {
    if (!constructor) return null;
    const byId = state.consColours.get(constructor.constructorId);
    if (byId) return byId;
    const n = normName(constructor.name);
    if (state.teamColours.has(n)) return state.teamColours.get(n);
    for (const [k, v] of state.teamColours) if (n && (k.indexOf(n) >= 0 || n.indexOf(k) >= 0)) return v;
    return null;
  }
  const barHTML = (c) => `<span class="tbar" style="--c:${esc(c || 'var(--rule-strong)')}" aria-hidden="true"></span>`;

  /* ------------------------------------------------------------------ */
  /* Cache (memory + localStorage)                                       */
  /* ------------------------------------------------------------------ */
  const mem = new Map();
  /** Fresh within ttl; empty answers (OpenF1 "No results found") are never trusted for longer than TTL.empty. */
  const isFresh = (o, ttl) => !!o && typeof o.at === 'number' && Date.now() - o.at < (o.empty ? Math.min(ttl, TTL.empty) : ttl);
  function cacheGet(key, ttl, persist) {
    const m = mem.get(key);
    if (isFresh(m, ttl)) return m;
    if (!persist) return null;
    try {
      const raw = localStorage.getItem(CACHE_PREFIX + key);
      if (!raw) return null;
      const o = JSON.parse(raw);
      if (isFresh(o, ttl)) { mem.set(key, o); return o; }
    } catch (e) { /* ignore */ }
    return null;
  }
  function cacheSet(key, entry, persist) {
    mem.set(key, entry);
    if (!persist || entry.empty) return;
    let s;
    try { s = JSON.stringify(entry); } catch (e) { return; }
    try { localStorage.setItem(CACHE_PREFIX + key, s); }
    catch (e) {
      pruneCache(true);
      try { localStorage.setItem(CACHE_PREFIX + key, s); } catch (e2) { /* storage full */ }
    }
  }
  function pruneCache(aggressive) {
    try {
      const items = [];
      const outdated = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k) continue;
        if (k.indexOf(CACHE_PREFIX) !== 0) {
          if (k.indexOf(CACHE_ROOT) === 0) outdated.push(k);   // earlier cache namespaces
          continue;
        }
        let at = 0;
        let empty = false;
        try { const o = JSON.parse(localStorage.getItem(k)); at = o.at || 0; empty = !!o.empty; } catch (e) { at = 0; }
        items.push([k, empty ? 0 : at]);
      }
      outdated.forEach((k) => localStorage.removeItem(k));
      items.sort((a, b) => a[1] - b[1]);
      const now = Date.now();
      items.forEach(([k, at], idx) => {
        if (now - at > TTL.history || (aggressive && idx < Math.ceil(items.length / 2))) localStorage.removeItem(k);
      });
    } catch (e) { /* ignore */ }
  }

  /* ------------------------------------------------------------------ */
  /* Request queues (rate limiting)                                      */
  /* ------------------------------------------------------------------ */
  function makeQueue(minGapMs, maxPerMinute) {
    let chain = Promise.resolve();
    let last = 0;
    const stamps = [];
    return function acquire() {
      const slot = chain.then(async () => {
        for (;;) {
          const now = Date.now();
          while (stamps.length && now - stamps[0] > MIN) stamps.shift();
          let wait = Math.max(0, last + minGapMs - now);
          if (stamps.length >= maxPerMinute) wait = Math.max(wait, MIN - (now - stamps[0]) + 50);
          if (wait <= 0) break;
          await sleep(wait);
        }
        last = Date.now();
        stamps.push(last);
      });
      chain = slot.catch(() => {});
      return slot;
    };
  }
  // Jolpica: ~4 req/s burst, 500 req/hour sustained. Caching keeps us far below.
  const jolpicaQueue = makeQueue(300, 60);
  // OpenF1 free tier: keep to a few requests per second and under 30 per minute.
  const openf1Queue = makeQueue(400, 28);

  class ApiError extends Error {
    constructor(message, status) { super(message); this.status = status; }
  }

  const inflight = new Map();
  async function getJSON(url, opts) {
    const o = opts || {};
    const ttl = o.ttl || 0;
    if (ttl > 0) {
      const c = cacheGet(url, ttl, o.persist);
      if (c) return c;
    }
    if (inflight.has(url)) return inflight.get(url);
    const p = (async () => {
      let attempt = 0;
      for (;;) {
        await o.queue();
        let res;
        try {
          res = await fetch(url, { cache: 'no-store' });
        } catch (e) {
          if (attempt++ < 2) { await sleep(1200 * attempt); continue; }
          return staleOr(url, o, new ApiError(`Could not reach ${o.source} (network problem or a temporary rate limit). Please try again in a moment.`, 0));
        }
        if ((res.status === 429 || res.status >= 500) && attempt < 3) {
          attempt++;
          const ra = num(res.headers.get('Retry-After'));
          await sleep(ra ? ra * SEC : 1500 * attempt);
          continue;
        }
        let body = null;
        try { body = await res.json(); } catch (e) { body = null; }
        if (!res.ok) {
          if (res.status === 404 && o.emptyOn404) {
            // OpenF1 answers 404 "No results found" for data that may simply not exist yet.
            const entry = { data: [], at: Date.now(), empty: true };
            if (ttl > 0) cacheSet(url, entry, false);
            return entry;
          }
          let detail = body && (body.detail || body.error || body.message);
          if (detail && typeof detail !== 'string') detail = JSON.stringify(detail);
          const hint = res.status === 429 ? ' (rate limited - please wait a moment)' : '';
          return staleOr(url, o, new ApiError(`${o.source} responded with HTTP ${res.status}${detail ? ': ' + detail : ''}${hint}`, res.status));
        }
        if (body == null) return staleOr(url, o, new ApiError(`${o.source} returned an unreadable response.`, res.status));
        const entry = { data: body, at: Date.now() };
        if (Array.isArray(body) && !body.length) entry.empty = true;
        if (ttl > 0) cacheSet(url, entry, o.persist);
        return entry;
      }
    })();
    inflight.set(url, p);
    try { return await p; } finally { inflight.delete(url); }
  }
  /** On failure, fall back to an expired cached copy of real data if we have one. */
  function staleOr(url, o, err) {
    if (o.allowStale !== false) {
      const c = cacheGet(url, Infinity, o.persist);
      if (c) return Object.assign({}, c, { stale: true });
    }
    throw err;
  }

  /* ------------------------------------------------------------------ */
  /* Jolpica-F1                                                          */
  /* ------------------------------------------------------------------ */
  const ttlForSeason = (season) =>
    season === 'current' || (state.season && String(season) === String(state.season)) || !state.season ? TTL.standings : TTL.history;

  function jget(path, ttl) {
    return getJSON(`${JOLPICA}/${path}`, { ttl, persist: true, queue: jolpicaQueue, source: 'Jolpica' });
  }

  const metaOf = (...entries) => {
    const list = entries.filter(Boolean);
    return {
      at: list.length ? Math.min(...list.map((e) => e.at || Date.now())) : Date.now(),
      stale: list.some((e) => e.stale)
    };
  };

  /** Fetch every page of a race-table endpoint and merge races split across pages. */
  async function jolpicaRaces(path, listKey, ttl) {
    const races = new Map();
    const metas = [];
    let offset = 0;
    let total = Infinity;
    let season = null;
    for (let page = 0; offset < total && page < 20; page++) {
      const sep = path.indexOf('?') >= 0 ? '&' : '?';
      const e = await jget(`${path}${sep}limit=${PAGE_SIZE}&offset=${offset}`, ttl);
      metas.push(e);
      const mr = e.data && e.data.MRData;
      if (!mr || !mr.RaceTable) throw new ApiError('Jolpica returned an unexpected payload.', 200);
      season = season || mr.RaceTable.season || null;
      total = num(mr.total) || 0;
      for (const r of mr.RaceTable.Races || []) {
        const k = `${r.season}-${r.round}`;
        if (!races.has(k)) races.set(k, Object.assign({}, r, { [listKey]: [] }));
        races.get(k)[listKey].push(...(r[listKey] || []));
      }
      offset += PAGE_SIZE;
    }
    return Object.assign({ season, races: Array.from(races.values()).sort(byRound) }, metaOf(...metas));
  }

  async function getSchedule(season) {
    const s = season || 'current';
    const e = await jget(`${s}.json?limit=${PAGE_SIZE}`, s === 'current' ? TTL.schedule : ttlForSeason(s));
    const rt = e.data.MRData.RaceTable;
    if (s === 'current' && rt.season) {
      const changed = state.season !== String(rt.season);
      state.season = String(rt.season);
      if (changed) paintSeasonTags();
    }
    return Object.assign({ season: rt.season, races: (rt.Races || []).slice().sort(byRound) }, metaOf(e));
  }
  async function currentSeason() {
    if (state.season) return state.season;
    const s = await getSchedule('current');
    return s.season;
  }
  async function getDriverStandings(season) {
    const s = season || 'current';
    const e = await jget(`${s}/driverStandings.json?limit=${PAGE_SIZE}`, ttlForSeason(s));
    const t = e.data.MRData.StandingsTable;
    const sl = (t.StandingsLists || [])[0];
    return Object.assign({ season: t.season, round: sl ? sl.round : null, list: sl ? sl.DriverStandings || [] : [] }, metaOf(e));
  }
  async function getConstructorStandings(season) {
    const s = season || 'current';
    const e = await jget(`${s}/constructorStandings.json?limit=${PAGE_SIZE}`, ttlForSeason(s));
    const t = e.data.MRData.StandingsTable;
    const sl = (t.StandingsLists || [])[0];
    return Object.assign({ season: t.season, round: sl ? sl.round : null, list: sl ? sl.ConstructorStandings || [] : [] }, metaOf(e));
  }
  const getSeasonResults = (s) => jolpicaRaces(`${s || 'current'}/results.json`, 'Results', ttlForSeason(s || 'current'));
  const getSeasonSprints = (s) => jolpicaRaces(`${s || 'current'}/sprint.json`, 'SprintResults', ttlForSeason(s || 'current'));
  const getTeamResults = (s) => jolpicaRaces(`${s || 'current'}/constructors/${TEAM_ID}/results.json`, 'Results', ttlForSeason(s || 'current'));
  const getTeamSprints = (s) => jolpicaRaces(`${s || 'current'}/constructors/${TEAM_ID}/sprint.json`, 'SprintResults', ttlForSeason(s || 'current'));
  const getTeamQualifying = (s) => jolpicaRaces(`${s || 'current'}/constructors/${TEAM_ID}/qualifying.json`, 'QualifyingResults', ttlForSeason(s || 'current'));
  const getDriverResults = (s, id) => jolpicaRaces(`${s}/drivers/${encodeURIComponent(id)}/results.json`, 'Results', ttlForSeason(s));
  const getDriverQualifying = (s, id) => jolpicaRaces(`${s}/drivers/${encodeURIComponent(id)}/qualifying.json`, 'QualifyingResults', ttlForSeason(s));
  const getRoundResults = (y, r) => jolpicaRaces(`${y}/${r}/results.json`, 'Results', ttlForSeason(y));
  const getRoundSprint = (y, r) => jolpicaRaces(`${y}/${r}/sprint.json`, 'SprintResults', ttlForSeason(y));
  const getRoundQualifying = (y, r) => jolpicaRaces(`${y}/${r}/qualifying.json`, 'QualifyingResults', ttlForSeason(y));
  /** The most recent Grand Prix classification of the current season. */
  async function getLastResults() {
    const e = await jget(`current/last/results.json?limit=${PAGE_SIZE}`, TTL.standings);
    return Object.assign({ races: ((e.data.MRData.RaceTable || {}).Races || []) }, metaOf(e));
  }

  async function getTeamDriverList(season) {
    const e = await jget(`${season}/constructors/${TEAM_ID}/drivers.json?limit=${PAGE_SIZE}`, ttlForSeason(season));
    return Object.assign({ drivers: (e.data.MRData.DriverTable || {}).Drivers || [] }, metaOf(e));
  }
  async function getSeasons() {
    const out = [];
    const metas = [];
    let offset = 0;
    let total = Infinity;
    for (let page = 0; offset < total && page < 5; page++) {
      const e = await jget(`seasons.json?limit=${PAGE_SIZE}&offset=${offset}`, TTL.history);
      metas.push(e);
      total = num(e.data.MRData.total) || 0;
      out.push(...((e.data.MRData.SeasonTable || {}).Seasons || []).map((s) => s.season));
      offset += PAGE_SIZE;
    }
    return Object.assign({ seasons: uniq(out).sort((a, b) => Number(b) - Number(a)) }, metaOf(...metas));
  }
  async function getTeamSeasonStanding(year) {
    const e = await jget(`${year}/constructors/${TEAM_ID}/constructorStandings.json`, ttlForSeason(year));
    const sl = ((e.data.MRData.StandingsTable || {}).StandingsLists || [])[0];
    return Object.assign({ standing: sl && sl.ConstructorStandings ? sl.ConstructorStandings[0] : null }, metaOf(e));
  }

  /** Drivers who represented the team in its most recent race with results. */
  function currentTeamDrivers(teamRaces) {
    const withRes = (teamRaces || []).filter((r) => (r.Results || []).length);
    if (!withRes.length) return [];
    return withRes[withRes.length - 1].Results.map((x) => x.Driver).filter(Boolean);
  }
  function sortByStanding(drivers, standings) {
    const posOf = (d) => {
      const s = (standings || []).find((x) => x.Driver && x.Driver.driverId === d.driverId);
      const p = s ? num(s.position) : null;
      return p == null ? Infinity : p;
    };
    return (drivers || []).slice().sort((a, b) => posOf(a) - posOf(b));
  }
  async function resolveTeamDrivers(season, teamRaces) {
    const fromResults = currentTeamDrivers(teamRaces);
    if (fromResults.length) return { drivers: fromResults, basis: 'results' };
    const list = await getTeamDriverList(season);
    return { drivers: list.drivers, basis: 'entry' };
  }

  /* ------------------------------------------------------------------ */
  /* OpenF1                                                              */
  /* ------------------------------------------------------------------ */
  /** Build an OpenF1 query string. Keys may carry comparison operators, e.g. 'date>='. */
  function of1Query(params) {
    const parts = [];
    for (const k of Object.keys(params || {})) {
      const v = params[k];
      if (v === null || v === undefined || v === '') continue;
      const m = /^([a-z0-9_]+)(>=|<=|>|<)?$/i.exec(k);
      if (m && m[2]) {
        const op = m[2];
        parts.push(`${m[1]}${encodeURIComponent(op.replace('=', ''))}${op.indexOf('=') >= 0 ? '=' : ''}${encodeURIComponent(v)}`);
      } else {
        parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
      }
    }
    return parts.length ? '?' + parts.join('&') : '';
  }
  function oget(endpoint, params, opts) {
    const o = opts || {};
    return getJSON(`${OPENF1}/${endpoint}${of1Query(params)}`, {
      ttl: o.ttl || 0,
      persist: !!o.persist,
      queue: openf1Queue,
      source: 'OpenF1',
      emptyOn404: true,
      allowStale: o.allowStale
    }).then((e) => Object.assign({}, e, { data: Array.isArray(e.data) ? e.data : [] }));
  }
  /* ------------------------------------------------------------------ */
  /* Session state                                                       */
  /* ------------------------------------------------------------------ */
  // Whether a session is live or finished is decided from race control data, not from OpenF1's
  // scheduled date_end: sessions overrun (delays, red flags) and the schedule does not move.
  const LIVE_LEAD_MS = 5 * MIN;     // live mode starts this long before the scheduled start
  const END_CAP_MS = 2 * HOUR;      // with no finish marker seen, a session stays live until this long after its scheduled end
  const SETTLE_MS = 2 * HOUR;       // after a confirmed finish, wait this long before caching the session for a week
  const endMarks = new Map();       // session_key -> finish time (ms) read from race control

  const isQualiType = (s) => /qualifying|shootout/i.test(`${(s && s.session_type) || ''} ${(s && s.session_name) || ''}`);
  /**
   * Finish time from race control messages, or null. The latest start/finish marker must be a
   * finish ('SESSION FINISHED' status or the chequered flag). Qualifying shows the chequered flag
   * after every segment, so there only the final segment counts.
   */
  function finishFromRaceControl(session, msgs) {
    let last = null;
    for (const m of msgs || []) {
      const t = parseTime(m && m.date);
      if (t == null) continue;
      const text = String(m.message || '').toUpperCase();
      let kind = null;
      if (m.category === 'SessionStatus') {
        if (/\bSTARTED\b|\bRESUMED\b/.test(text)) kind = 'start';
        else if (/\bFINISHED\b|\bFINALI[SZ]ED\b|\bENDED\b/.test(text)) kind = 'end';
      } else if (String(m.flag || '').toUpperCase() === 'CHEQUERED') {
        kind = 'end';
      }
      if (kind && (!last || t >= last.t)) last = { t, kind, phase: num(m.qualifying_phase) };
    }
    if (!last || last.kind !== 'end') return null;
    if (isQualiType(session)) {
      if (last.phase != null) return last.phase >= 3 ? last.t : null;
      const end = parseTime(session && session.date_end);
      if (end != null && last.t < end - 5 * MIN) return null;
    }
    return last.t;
  }
  function noteRaceControl(session, msgs) {
    const t = session ? finishFromRaceControl(session, msgs) : null;
    if (t != null) endMarks.set(String(session.session_key), t);
    return t;
  }
  /** 'upcoming' | 'live' | 'done' | 'cancelled' | 'unknown', from what is known now (no network). */
  function sessionStatus(session) {
    if (!session) return 'unknown';
    if (session.is_cancelled) return 'cancelled';
    const start = parseTime(session.date_start);
    if (start == null) return 'unknown';
    const now = Date.now();
    if (now < start) return 'upcoming';
    const fin = endMarks.get(String(session.session_key));
    if (fin != null && fin <= now) return 'done';
    const end = parseTime(session.date_end);
    // No finish marker seen yet: the session may be overrunning, so it stays live up to a hard cap.
    return now > (end != null ? end : start) + END_CAP_MS ? 'done' : 'live';
  }
  /** sessionStatus, after checking race control for a finish marker whenever the session could be running. */
  async function resolveSessionStatus(session) {
    if (sessionStatus(session) === 'live') {
      try {
        const e = await oget('race_control', { session_key: session.session_key, category: 'SessionStatus' }, { ttl: MIN });
        noteRaceControl(session, e.data);
      } catch (err) { /* keep the cap-based answer */ }
    }
    return sessionStatus(session);
  }
  /** Live polling window: from shortly before the scheduled start until the session is confirmed over. */
  function inLiveWindow(session) {
    const st = sessionStatus(session);
    if (st === 'live') return true;
    const start = parseTime(session && session.date_start);
    return st === 'upcoming' && start != null && Date.now() >= start - LIVE_LEAD_MS;
  }
  /** True once a session's data may be cached for a week: finished, plus time for late data to land. */
  function sessionSettled(session) {
    if (sessionStatus(session) !== 'done') return false;
    const now = Date.now();
    const fin = endMarks.get(String(session.session_key));
    if (fin != null) return now >= fin + SETTLE_MS;
    const end = parseTime(session.date_end);
    const base = end != null ? end : parseTime(session.date_start);
    return base != null && now >= base + END_CAP_MS + SETTLE_MS;
  }
  function getYearSessions(year) {
    const past = state.season && String(year) !== String(state.season);
    return oget('sessions', { year }, { ttl: past ? TTL.history : HOUR, persist: true });
  }
  function getYearMeetings(year) {
    const past = state.season && String(year) !== String(state.season);
    return oget('meetings', { year }, { ttl: past ? TTL.history : HOUR, persist: true });
  }
  function getSessionDrivers(session) {
    return oget('drivers', { session_key: session.session_key }, sessionSettled(session) ? { ttl: TTL.history, persist: true } : { ttl: TTL.short });
  }
  function getDriverLaps(session, driverNumber) {
    return oget('laps', { session_key: session.session_key, driver_number: driverNumber },
      sessionSettled(session) ? { ttl: TTL.history, persist: true } : { ttl: TTL.live });
  }

  /** Map a Jolpica driver to an OpenF1 driver row for a session. */
  function matchOpenF1Driver(jd, of1Drivers) {
    if (!jd) return null;
    const list = of1Drivers || [];
    const fam = normName(jd.familyName);
    return list.find((d) => jd.code && d.name_acronym === jd.code) ||
      list.find((d) => fam && normName(d.last_name) === fam) ||
      list.find((d) => jd.permanentNumber && String(d.driver_number) === String(jd.permanentNumber)) ||
      null;
  }

  let coloursP = null;
  function loadColours() {
    if (!coloursP) {
      coloursP = (async () => {
        try {
          const e = await oget('drivers', { session_key: 'latest' }, { ttl: 30 * MIN, persist: true });
          applyOpenF1Colours(e.data);
          if (!state.teamColour) {
            // The latest session may not have its entry list yet: use the most recent session that does.
            const ss = await getYearSessions(await currentSeason());
            const now = Date.now();
            const recent = ss.data
              .filter((s) => !s.is_cancelled && (parseTime(s.date_start) || Infinity) <= now)
              .sort((a, b) => (parseTime(b.date_start) || 0) - (parseTime(a.date_start) || 0))
              .slice(0, 3);
            for (const s of recent) {
              const d = await oget('drivers', { session_key: s.session_key }, { ttl: 30 * MIN, persist: true });
              applyOpenF1Colours(d.data);
              if (state.teamColour) break;
            }
          }
          chartEls.forEach(drawChart);
        } catch (err) {
          console.warn('OpenF1 team colours unavailable:', err && err.message);
        }
      })();
    }
    return coloursP;
  }
  /** Wait briefly for live colours; colour is decoration, so never hold data back for long. */
  const whenColours = () => Promise.race([loadColours(), sleep(3500)]);

  /* ------------------------------------------------------------------ */
  /* Schedule helpers                                                    */
  /* ------------------------------------------------------------------ */
  // Mapping of Jolpica schedule field names to readable labels (API schema, not data).
  const WEEKEND_FIELDS = [
    ['FirstPractice', 'Practice 1'],
    ['SecondPractice', 'Practice 2'],
    ['ThirdPractice', 'Practice 3'],
    ['SprintShootout', 'Sprint Shootout'],
    ['SprintQualifying', 'Sprint Qualifying'],
    ['Sprint', 'Sprint'],
    ['Qualifying', 'Qualifying']
  ];
  function weekendSessions(race) {
    const out = [];
    for (const [field, label] of WEEKEND_FIELDS) {
      const s = race[field];
      if (s && s.date) out.push({ field, name: label, start: ergastTime(s.date, s.time), timed: !!s.time });
    }
    out.push({ field: 'Race', name: 'Race', start: ergastTime(race.date, race.time), timed: !!race.time });
    return out.filter((s) => s.start != null).sort((a, b) => a.start - b.start);
  }
  function flattenSessions(races) {
    const out = [];
    for (const r of races || []) for (const s of weekendSessions(r)) out.push(Object.assign({ race: r }, s));
    return out.sort((a, b) => a.start - b.start);
  }
  const hasSprint = (race) => !!(race && (race.Sprint));
  /**
   * Still to come? A session with only a date (no published start time) is placed at 00:00 UTC on
   * that date, which is not a real start time, so it stays upcoming until its calendar day ends.
   */
  const isPending = (s, now) => (s.timed ? s.start > now : s.start + DAY > now);

  /* ------------------------------------------------------------------ */
  /* UI helpers                                                          */
  /* ------------------------------------------------------------------ */
  /** Page header: eyebrow label, display title, subline, and the live season once known. */
  function pageHead(title, sub, eyebrow) {
    return `<header class="page-head">
      <p class="ph-eyebrow">${esc(eyebrow || 'Unofficial McLaren F1 tracker')}</p>
      <h1>${esc(title)}</h1>
      <p class="ph-season" data-season-tag>${seasonTagHTML()}</p>
      ${sub ? `<p class="page-sub">${esc(sub)}</p>` : ''}
    </header>`;
  }
  const seasonTagHTML = () => (state.season ? `Season <b>${esc(state.season)}</b>` : '');
  function paintSeasonTags() {
    $$('[data-season-tag]').forEach((el) => { if (!el.dataset.fixed) el.innerHTML = seasonTagHTML(); });
  }
  function skeleton(lines) {
    const n = lines || 4;
    let s = '<div class="skeleton" aria-hidden="true">';
    for (let i = 0; i < n; i++) s += `<span class="sk-line" style="width:${92 - ((i * 17) % 38)}%"></span>`;
    return s + '</div><span class="sr-only">Loading</span>';
  }
  const emptyState = (msg) => `<div class="state state-empty"><p>${esc(msg)}</p></div>`;
  const note = (msg) => `<p class="note">${esc(msg)}</p>`;

  function panel(id, title, source, cls) {
    return `<section class="panel ${cls || ''}" id="${id}" data-source="${esc(source)}" aria-busy="true">
      <header class="panel-head"><h2>${esc(title)}</h2><div class="panel-tools" data-tools></div></header>
      <div class="panel-body" data-body>${skeleton()}</div>
      <footer class="panel-meta" data-meta><span class="meta-src">Source: ${esc(source)}</span><span>loading</span></footer>
    </section>`;
  }
  function setMeta(id, meta) {
    const el = document.getElementById(id);
    if (!el) return;
    const m = meta || {};
    const source = m.source || el.dataset.source || '';
    const parts = [`<span class="meta-src">Source: ${esc(source)}</span>`];
    if (m.at) parts.push(`<span>Updated ${esc(fmtClock(m.at))}</span>`);
    if (m.stale) parts.push('<span class="warn-text">showing cached copy, refresh failed</span>');
    if (m.note) parts.push(`<span>${esc(m.note)}</span>`);
    $('[data-meta]', el).innerHTML = parts.join('');
  }
  function setPanel(id, html, meta) {
    const el = document.getElementById(id);
    if (!el) return null;
    $('[data-body]', el).innerHTML = html;
    el.setAttribute('aria-busy', 'false');
    if (meta) setMeta(id, meta);
    return el;
  }
  function setTools(id, html) {
    const el = document.getElementById(id);
    if (!el) return null;
    const t = $('[data-tools]', el);
    t.innerHTML = html || '';
    return t;
  }
  function panelError(id, err, retry) {
    const msg = (err && err.message) || String(err);
    const el = setPanel(id, `<div class="state state-error" role="alert">
        <p><strong>Live data could not be loaded.</strong></p>
        <p class="muted">${esc(msg)}</p>
        ${retry ? '<button type="button" class="btn" data-retry>Retry</button>' : ''}
      </div>`);
    if (!el) return;
    setMeta(id, { note: `failed at ${fmtClock(Date.now())}` });
    if (retry) {
      $('[data-retry]', el).addEventListener('click', () => {
        setPanel(id, skeleton(), { note: 'retrying' });
        retry();
      });
    }
  }
  /** Run a loader for a panel, handling stale routes and errors uniformly. */
  async function load(id, fn, tok) {
    try {
      const out = await fn();
      if (tok !== routeToken || !out) return;
      setPanel(id, out.html, out);
      if (out.after) out.after(document.getElementById(id));
    } catch (e) {
      if (tok !== routeToken) return;
      console.error(e);
      panelError(id, e, () => load(id, fn, tok));
    }
  }

  function stat(label, value, sub, cls) {
    return `<div class="stat ${cls || ''}"><span class="stat-label">${esc(label)}</span><span class="stat-value">${value}</span>${sub ? `<span class="stat-sub">${sub}</span>` : ''}</div>`;
  }
  const swatch = (c) => `<span class="dot" style="--c:${esc(c)}"></span>`;
  function chip(text, kind) {
    return `<span class="chip ${kind ? 'chip-' + esc(kind) : ''}">${esc(text)}</span>`;
  }

  function sparkline(values, opts) {
    const o = opts || {};
    const v = (values || []).filter((x) => x != null && Number.isFinite(x));
    const cls = `spark ${o.cls || ''}`;
    if (v.length < 2) return `<svg class="${cls}" viewBox="0 0 100 24" preserveAspectRatio="none" aria-hidden="true"></svg>`;
    const lo = o.min != null ? o.min : Math.min(...v);
    const hi = o.max != null ? o.max : Math.max(...v);
    const span = hi - lo || 1;
    const n = values.length - 1 || 1;
    const pts = [];
    values.forEach((y, i) => {
      if (y == null || !Number.isFinite(y)) return;
      pts.push(`${((i / n) * 100).toFixed(2)},${(23 - ((y - lo) / span) * 22).toFixed(2)}`);
    });
    return `<svg class="${cls}" viewBox="0 0 100 24" preserveAspectRatio="none" aria-hidden="true"><polyline points="${pts.join(' ')}" fill="none" stroke="currentColor" stroke-width="1.6" vector-effect="non-scaling-stroke" stroke-linejoin="round"/></svg>`;
  }

  /* ------------------------------------------------------------------ */
  /* Line charts (hand-rolled SVG)                                       */
  /* ------------------------------------------------------------------ */
  const chartSpecs = new WeakMap();
  const chartEls = new Set();

  function niceTicks(min, max, count) {
    const span = max - min;
    if (!(span > 0)) return [min];
    const raw = span / Math.max(1, count);
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const norm = raw / mag;
    const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
    const out = [];
    for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-6; v += step) out.push(Number(v.toFixed(10)));
    return out;
  }
  function mountChart(el, spec) {
    if (!el) return;
    chartSpecs.set(el, spec);
    chartEls.add(el);
    drawChart(el);
  }
  function drawChart(el) {
    const spec = chartSpecs.get(el);
    if (!spec) return;
    if (!el.isConnected) { chartEls.delete(el); return; }
    const series = (spec.series || []).map((s) => Object.assign({}, s, {
      points: (s.points || []).filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y)).sort((a, b) => a.x - b.x)
    })).filter((s) => s.points.length);
    if (!series.length) { el.innerHTML = emptyState(spec.emptyText || 'No data to chart yet.'); return; }
    const yFmt = spec.yFmt || ((v) => String(v));
    const xFmt = spec.xFmt || ((v) => String(v));
    const W = Math.max(260, Math.floor(el.clientWidth || 640));
    const H = spec.height || Math.round(Math.max(230, Math.min(400, W * 0.46)));
    const colourOf = (s, si) => (typeof s.color === 'function' ? s.color() : s.color) || fallbackColour(si);
    // Direct labels at the line ends replace a legend; reserve room on the right for them.
    const labelText = (s) => String(s.short || s.label || '').slice(0, 14);
    const maxChars = Math.max(0, ...series.map((s) => labelText(s).length));
    const m = { t: 18, r: spec.legend ? 16 : Math.round(34 + maxChars * 7.4), b: 30, l: spec.yWidth || 56 };
    const all = series.flatMap((s) => s.points);
    let x0 = Math.min(...all.map((p) => p.x));
    let x1 = Math.max(...all.map((p) => p.x));
    if (x0 === x1) { x0 -= 1; x1 += 1; }
    let y0 = Math.min(...all.map((p) => p.y));
    let y1 = Math.max(...all.map((p) => p.y));
    if (spec.includeZero) { y0 = Math.min(0, y0); y1 = Math.max(0, y1); }
    if (y0 === y1) { y0 -= 1; y1 += 1; }
    const pad = (y1 - y0) * 0.06;
    if (!(spec.includeZero && y0 === 0)) y0 -= pad;
    y1 += pad;
    const iw = W - m.l - m.r;
    const ih = H - m.t - m.b;
    const X = (x) => m.l + ((x - x0) / (x1 - x0)) * iw;
    const Y = (y) => m.t + (1 - (y - y0) / (y1 - y0)) * ih;
    let g = '';
    for (const v of niceTicks(y0, y1, Math.max(3, Math.round(ih / 52)))) {
      if (v < y0 || v > y1) continue;
      g += `<line class="c-grid" x1="${m.l}" x2="${W - m.r}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}"/>`;
      g += `<text class="c-axis" x="${m.l - 8}" y="${Y(v).toFixed(1)}" text-anchor="end" dominant-baseline="middle">${esc(yFmt(v))}</text>`;
    }
    if (spec.includeZero && y0 < 0 && y1 > 0) g += `<line class="c-zero" x1="${m.l}" x2="${W - m.r}" y1="${Y(0).toFixed(1)}" y2="${Y(0).toFixed(1)}"/>`;
    g += `<line class="c-zero" x1="${m.l}" x2="${W - m.r}" y1="${(H - m.b).toFixed(1)}" y2="${(H - m.b).toFixed(1)}"/>`;
    const xs = uniq(all.map((p) => p.x)).sort((a, b) => a - b);
    const maxTicks = Math.max(2, Math.floor(iw / 46));
    const stepX = Math.ceil(xs.length / maxTicks);
    xs.forEach((v, i) => {
      if (i % stepX !== 0) return;
      g += `<text class="c-axis" x="${X(v).toFixed(1)}" y="${H - m.b + 18}" text-anchor="middle">${esc(xFmt(v))}</text>`;
    });
    if (spec.yTitle) g += `<text class="c-axis c-title" x="${m.l}" y="${m.t - 6}">${esc(spec.yTitle)}</text>`;
    const dots = series.every((s) => s.points.length <= 40);
    series.forEach((s, si) => {
      const c = colourOf(s, si);
      const d = s.points.map((p, i) => `${i ? 'L' : 'M'}${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join('');
      g += `<path d="${d}" fill="none" stroke="${esc(c)}" stroke-width="${s.width || 2}" ${s.dash ? 'stroke-dasharray="6 4"' : ''} stroke-linejoin="round" stroke-linecap="round"><title>${esc(s.label)}</title></path>`;
      if (dots) {
        for (const p of s.points) {
          g += `<circle cx="${X(p.x).toFixed(1)}" cy="${Y(p.y).toFixed(1)}" r="2.3" fill="${esc(c)}"><title>${esc(p.title || `${s.label}: ${yFmt(p.y)}`)}</title></circle>`;
        }
      }
      const last = s.points[s.points.length - 1];
      g += `<circle cx="${X(last.x).toFixed(1)}" cy="${Y(last.y).toFixed(1)}" r="3.6" fill="${esc(c)}"/>`;
    });
    let legend = '';
    if (spec.legend) {
      legend = `<ul class="legend">${series.map((s, si) => `<li><span class="swatch${s.dash ? ' dash' : ''}" style="--c:${esc(colourOf(s, si))}"></span>${esc(s.label)}</li>`).join('')}</ul>`;
    } else {
      // Resolve label collisions: keep at least 15px apart, clamped inside the plot.
      const labs = series.map((s, si) => {
        const last = s.points[s.points.length - 1];
        return { s, c: colourOf(s, si), ex: X(last.x), ey: Y(last.y), y: Y(last.y) };
      }).sort((a, b) => a.ey - b.ey);
      const gapY = 15;
      const top = m.t + 4;
      const bottom = H - m.b - 4;
      labs.forEach((l, i) => { l.y = Math.max(l.ey, i ? labs[i - 1].y + gapY : top); });
      for (let i = labs.length - 1; i >= 0; i--) {
        const limit = i === labs.length - 1 ? bottom : labs[i + 1].y - gapY;
        if (labs[i].y > limit) labs[i].y = limit;
      }
      const lx = W - m.r + 10;
      for (const l of labs) {
        if (Math.abs(l.y - l.ey) > 2 || lx - l.ex > 14) {
          g += `<path d="M${(l.ex + 5).toFixed(1)},${l.ey.toFixed(1)} L${(lx - 4).toFixed(1)},${l.y.toFixed(1)}" stroke="${esc(l.c)}" stroke-width="1" stroke-dasharray="2 2" opacity="0.6" fill="none"/>`;
        }
        g += `<line x1="${lx}" x2="${lx + 10}" y1="${l.y.toFixed(1)}" y2="${l.y.toFixed(1)}" stroke="${esc(l.c)}" stroke-width="3" ${l.s.dash ? 'stroke-dasharray="3 2"' : ''}/>`;
        g += `<text class="c-label" x="${lx + 15}" y="${l.y.toFixed(1)}" dominant-baseline="middle">${esc(labelText(l.s))}<title>${esc(l.s.label)}</title></text>`;
      }
    }
    el.innerHTML = `<svg class="chart-svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(spec.label || 'Chart')}: ${esc(series.map((s) => s.label).join(', '))}">${g}</svg>${legend}`;
  }
  window.addEventListener('resize', debounce(() => chartEls.forEach(drawChart), 150));

  /* ------------------------------------------------------------------ */
  /* Theme                                                               */
  /* ------------------------------------------------------------------ */
  function initTheme() {
    const btn = $('#theme-btn');
    if (!btn) return;
    let mode = 'auto';
    try { mode = localStorage.getItem(THEME_KEY) || 'auto'; } catch (e) { mode = 'auto'; }
    const apply = () => {
      if (mode === 'light' || mode === 'dark') document.documentElement.setAttribute('data-theme', mode);
      else document.documentElement.removeAttribute('data-theme');
      const label = mode.charAt(0).toUpperCase() + mode.slice(1);
      $('[data-theme-label]', btn).textContent = label;
      btn.dataset.mode = mode;
      btn.setAttribute('aria-label', `Colour theme: ${label}. Activate to switch.`);
    };
    apply();
    btn.addEventListener('click', () => {
      mode = mode === 'auto' ? 'light' : mode === 'light' ? 'dark' : 'auto';
      try { localStorage.setItem(THEME_KEY, mode); } catch (e) { /* ignore */ }
      apply();
    });
  }

  /* ------------------------------------------------------------------ */
  /* Navigation drawer                                                   */
  /* ------------------------------------------------------------------ */
  const drawerCtl = { close: () => {} };
  function initDrawer() {
    const btn = $('#menu-btn');
    const drawer = $('#drawer');
    const scrim = $('#scrim');
    const closeBtn = $('#drawer-close');
    let open = false;
    const set = (v, restoreFocus) => {
      open = v;
      drawer.classList.toggle('open', v);
      scrim.classList.toggle('show', v);
      drawer.setAttribute('aria-hidden', String(!v));
      if (v) drawer.removeAttribute('inert'); else drawer.setAttribute('inert', '');
      btn.setAttribute('aria-expanded', String(v));
      btn.setAttribute('aria-label', v ? 'Close navigation' : 'Open navigation');
      document.body.classList.toggle('no-scroll', v);
      if (v) initDrawerStatus();
      if (v) {
        const target = $('a.active', drawer) || $('a', drawer);
        if (target) setTimeout(() => target.focus(), 30);
      } else if (restoreFocus) {
        btn.focus();
      }
    };
    btn.addEventListener('click', () => set(!open, true));
    closeBtn.addEventListener('click', () => set(false, true));
    scrim.addEventListener('click', () => set(false, true));
    drawer.addEventListener('click', (e) => { if (e.target.closest('a')) set(false, false); });
    document.addEventListener('keydown', (e) => {
      if (!open) return;
      if (e.key === 'Escape') { e.preventDefault(); set(false, true); return; }
      if (e.key === 'Tab') {
        const items = $$('a, button', drawer).filter((x) => !x.disabled);
        if (!items.length) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    });
    drawerCtl.close = () => { if (open) set(false, false); };
  }

  /* ------------------------------------------------------------------ */
  /* Router                                                              */
  /* ------------------------------------------------------------------ */
  const ROUTES = {};
  /** decodeURIComponent that never throws: malformed escapes are kept as typed. */
  const safeDecode = (s) => { try { return decodeURIComponent(s); } catch (e) { return s; } };
  function parseHash() {
    const raw = (location.hash || '').replace(/^#\/?/, '');
    const qi = raw.indexOf('?');
    const path = qi >= 0 ? raw.slice(0, qi) : raw;
    let query;
    try { query = new URLSearchParams(qi >= 0 ? raw.slice(qi + 1) : ''); } catch (e) { query = new URLSearchParams(''); }
    const parts = path.split('/').filter(Boolean).map(safeDecode);
    return { name: parts[0] || 'overview', args: parts.slice(1), query };
  }
  function route() {
    while (leaveHooks.length) {
      try { leaveHooks.pop()(); } catch (e) { console.error(e); }
    }
    const tok = ++routeToken;
    const r = parseHash();
    const def = ROUTES[r.name];
    drawerCtl.close();
    $$('#drawer a[data-route]').forEach((a) => {
      const on = a.dataset.route === r.name;
      a.classList.toggle('active', on);
      if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    const main = $('#main');
    window.scrollTo(0, 0);
    if (!def) {
      $('#route-label').textContent = '';
      main.innerHTML = pageHead('Page not found', 'Use the menu to choose a page.');
      return;
    }
    $('#route-label').textContent = def.title;
    document.title = `${def.title} - McLaren F1 Tracker (unofficial)`;
    main.innerHTML = '';
    Promise.resolve()
      .then(() => def.fn(main, r, tok))
      .catch((e) => { if (e !== STOP) console.error(e); });
  }
  const STOP = { stop: true };
  const guard = (tok) => { if (tok !== routeToken) throw STOP; };

  /* ------------------------------------------------------------------ */
  /* Countdown ticker                                                    */
  /* ------------------------------------------------------------------ */
  function countdownParts(ms) {
    const s = Math.floor(ms / 1000);
    return [
      ['days', Math.floor(s / 86400)],
      ['hrs', Math.floor((s % 86400) / 3600)],
      ['min', Math.floor((s % 3600) / 60)],
      ['sec', s % 60]
    ];
  }
  function countdownHTML(ms, compact) {
    if (ms <= 0) return '<span class="cd-live">Session start time reached</span>';
    const units = countdownParts(ms);
    if (compact) return units.map(([lab, v]) => `<span>${String(v).padStart(2, '0')}</span><i>${lab.charAt(0)}</i>`).join('');
    return units.map(([lab, v], i) => `${i ? '<span class="cd-sep" aria-hidden="true">:</span>' : ''}<span class="cd-unit${lab === 'sec' ? ' is-sec' : ''}"><span class="cd-num">${String(v).padStart(2, '0')}</span><span class="cd-lab">${lab}</span></span>`).join('');
  }
  function tickCountdowns() {
    $$('[data-countdown]').forEach((el) => {
      const t = Number(el.dataset.countdown);
      if (Number.isFinite(t)) el.innerHTML = countdownHTML(t - Date.now(), el.classList.contains('cd-compact'));
    });
  }
  // One shared 1-second ticker for every countdown on screen (local clock only, no network).
  let tickerId = null;
  function startTicker() {
    tickCountdowns();
    if (!tickerId) tickerId = setInterval(tickCountdowns, 1000);
  }

  /* ================================================================== */
  /* Shared result helpers                                               */
  /* ================================================================== */
  function driverSeasonStats(driverId, raceList, qualiList) {
    const s = { starts: 0, wins: 0, podiums: 0, dnf: 0, best: null, pointsFinishes: 0, finSum: 0, finN: 0, fastest: 0, poles: 0, gridSum: 0, gridN: 0 };
    for (const r of raceList || []) {
      const res = (r.Results || []).find((x) => x.Driver && x.Driver.driverId === driverId);
      if (!res) continue;
      s.starts++;
      const p = num(res.position);
      if (isClassified(res) && p != null) {
        if (p === 1) s.wins++;
        if (p <= 3) s.podiums++;
        s.best = s.best == null ? p : Math.min(s.best, p);
        s.finSum += p;
        s.finN++;
      } else {
        s.dnf++;
      }
      if ((num(res.points) || 0) > 0) s.pointsFinishes++;
      if (res.FastestLap && String(res.FastestLap.rank) === '1') s.fastest++;
      const g = num(res.grid);
      if (g != null && g > 0) { s.gridSum += g; s.gridN++; }
    }
    for (const r of qualiList || []) {
      const q = (r.QualifyingResults || []).find((x) => x.Driver && x.Driver.driverId === driverId);
      if (q && String(q.position) === '1') s.poles++;
    }
    s.avgFinish = s.finN ? s.finSum / s.finN : null;
    s.avgGrid = s.gridN ? s.gridSum / s.gridN : null;
    return s;
  }
  const findResult = (race, driverId, key) => ((race && race[key || 'Results']) || []).find((x) => x.Driver && x.Driver.driverId === driverId) || null;
  const standingFor = (list, driverId) => (list || []).find((s) => s.Driver && s.Driver.driverId === driverId) || null;
  const isTeamStanding = (s) => ((s && s.Constructors) || []).some((c) => c.constructorId === TEAM_ID);

  function resultCell(res) {
    if (!res) return '<span class="muted">-</span>';
    const label = isClassified(res) ? `P${res.positionText}` : (res.positionText === 'R' ? 'DNF' : res.positionText === 'D' ? 'DSQ' : res.positionText === 'W' ? 'DNS' : esc(res.positionText || '-'));
    return `<span class="${isClassified(res) ? '' : 'muted'}">${label}</span>`;
  }

  /* ================================================================== */
  /* Overview                                                            */
  /* ================================================================== */
  ROUTES.overview = { title: 'Overview', fn: pageOverview };

  async function pageOverview(root, r, tok) {
    root.innerHTML = pageHead('Overview', 'The team\u2019s season at a glance, refreshed from live sources.', 'Team dashboard') + `
      <div class="grid grid-12">
        ${panel('ov-next', 'Next session', 'Jolpica', 'panel-board span-8')}
        ${panel('ov-team', 'Constructors\u2019 championship', 'Jolpica', 'span-4')}
      </div>
      ${panel('ov-drivers', 'Team drivers', 'Jolpica')}
      <div class="grid grid-12">
        ${panel('ov-last', 'Last Grand Prix', 'Jolpica', 'span-7')}
        ${panel('ov-sprint', 'Last sprint', 'Jolpica', 'span-5')}
      </div>
      ${panel('ov-h2h', 'Teammate head-to-head', 'Jolpica')}`;
    startTicker();

    load('ov-next', async () => {
      const sch = await getSchedule('current');
      const now = Date.now();
      const sessions = flattenSessions(sch.races);
      const next = sessions.find((s) => isPending(s, now));
      if (!next) {
        return Object.assign({ html: emptyState(`The ${sch.season} season schedule has no upcoming sessions.`) }, sch);
      }
      const race = next.race;
      const loc = race.Circuit && race.Circuit.Location ? race.Circuit.Location : {};
      const place = [loc.locality, loc.country].filter(Boolean).join(', ');
      const weekend = weekendSessions(race);
      const when = (s) => (s.timed ? fmtDayHM(s.start) : fmtDayUTC(s.start));
      return Object.assign({
        html: `<div class="hero">
            <div class="hero-main">
              <p class="hero-kicker"><span>Round <b>${esc(race.round)}</b> of ${sch.races.length}</span><span>${esc(sch.season)} season</span>${hasSprint(race) ? chip('Sprint weekend', 'next') : ''}</p>
              <h3 class="hero-title">${esc(next.name)}</h3>
              <p class="hero-event">${esc(race.raceName)}</p>
              <p class="hero-venue">${esc(race.Circuit ? race.Circuit.circuitName : '')}${place ? ` &middot; ${esc(place)}` : ''}</p>
              ${next.timed
                ? `<div class="cd" data-countdown="${next.start}" aria-hidden="true">${countdownHTML(next.start - now)}</div>`
                : '<div class="cd"><span class="cd-live">Start time not yet published</span></div>'}
              <p class="hero-when">${esc(next.timed ? fmtDateTime(next.start) : fmtDayUTC(next.start))} <span>${esc(next.timed ? tzName() : 'date only, no countdown until a time is published')}</span></p>
            </div>
            <div class="hero-side">
              <h3>Weekend schedule &middot; ${esc(tzName())}</h3>
              <ol class="wk">${weekend.map((s, i) => {
                const isNext = s.start === next.start && s.field === next.field;
                return `<li class="${isNext ? 'is-next' : !isPending(s, now) ? 'is-done' : ''}">
                  <span class="wk-i">${String(i + 1).padStart(2, '0')}</span>
                  <span class="wk-name">${esc(s.name)}${isNext ? chip('Next', 'next') : ''}</span>
                  <span class="wk-time">${esc(when(s))}</span>
                </li>`;
              }).join('')}</ol>
            </div>
            <span class="hero-round" aria-hidden="true">${esc(race.round)}</span>
          </div>`
      }, sch);
    }, tok);

    load('ov-team', async () => {
      const [cs, ds, lr] = await Promise.all([getConstructorStandings('current'), getDriverStandings('current').catch(() => null), getLastResults().catch(() => null)]);
      await whenColours();
      if (ds) learnConstructorColours(ds.list, lr ? latestTeamMap(lr.races) : null);
      const list = cs.list;
      if (!list.length) return Object.assign({ html: emptyState('No constructors\u2019 standings published for this season yet.') }, cs);
      const i = list.findIndex((s) => s.Constructor && s.Constructor.constructorId === TEAM_ID);
      if (i < 0) return Object.assign({ html: emptyState('The team does not appear in the current constructors\u2019 standings.') }, cs);
      const me = list[i];
      const pts = num(me.points) || 0;
      const leaderPts = num(list[0].points) || 0;
      const ahead = list[i - 1];
      const behind = list[i + 1];
      const idx = uniq([0, i - 1, i, i + 1].filter((x) => x >= 0 && x < list.length)).sort((a, b) => a - b);
      let rows = '';
      idx.forEach((x, k) => {
        if (k && x - idx[k - 1] > 1) rows += '<li class="tw-row tw-gapline" aria-hidden="true"></li>';
        const s = list[x];
        const p = num(s.points) || 0;
        rows += `<li class="tw-row ${x === i ? 'is-team' : ''}">
          <span class="tw-pos">${esc(s.positionText || s.position)}</span>
          <span class="tw-bar" style="--c:${esc(consColour(s.Constructor) || 'var(--rule-strong)')}"></span>
          <span class="tw-name">${esc(s.Constructor.name)}</span>
          <span class="tw-pts">${fmtPts(p)}</span>
          <span class="tw-gap">${x === 0 ? 'Leader' : '-' + fmtPts(leaderPts - p)}</span>
        </li>`;
      });
      const margins = [
        ahead ? `${fmtPts((num(ahead.points) || 0) - pts)} pts behind ${esc(ahead.Constructor.name)}` : '',
        behind ? `${fmtPts(pts - (num(behind.points) || 0))} pts clear of ${esc(behind.Constructor.name)}` : ''
      ].filter(Boolean).join(' &middot; ');
      return Object.assign({
        html: `
          <div class="champ-top">
            <span class="champ-pos"><small>P</small>${esc(me.position || me.positionText)}</span>
            <div><p class="champ-name">${esc(me.Constructor.name)}</p><p class="champ-sub">After round ${esc(cs.round)} &middot; ${esc(cs.season)}</p></div>
          </div>
          <ol class="tower" aria-label="Constructors around the team">${rows}</ol>
          ${margins ? `<p class="note">${margins}.</p>` : ''}
          <div class="stats stats-3">
            ${stat('Points', fmtPts(pts))}
            ${stat('Wins', esc(me.wins))}
            ${stat(i === 0 ? 'Lead' : 'To leader', i === 0 ? (list[1] ? '+' + fmtPts(pts - (num(list[1].points) || 0)) : '-') : `-${fmtPts(leaderPts - pts)}`)}
          </div>`
      }, cs);
    }, tok);

    // Driver cards, last race, last sprint and head-to-head share team data.
    // Memoised so the panels share one fetch; reset on failure so Retry refetches.
    let teamDataP = null;
    const teamData = () => {
      if (!teamDataP) {
        teamDataP = (async () => {
          const season = await currentSeason();
          const [team, quali, sprints, ds] = await Promise.all([
            getTeamResults('current'), getTeamQualifying('current'), getTeamSprints('current'), getDriverStandings('current')
          ]);
          const resolved = await resolveTeamDrivers(season, team.races);
          return { season, team, quali, sprints, ds, drivers: sortByStanding(resolved.drivers, ds.list), basis: resolved.basis };
        })();
        teamDataP.catch(() => { teamDataP = null; });
      }
      return teamDataP;
    };

    load('ov-drivers', async () => {
      const d = await teamData();
      if (!d.drivers.length) return Object.assign({ html: emptyState('No drivers are listed for the team this season yet.') }, metaOf(d.team, d.ds));
      const ps = (label, value, sub) => `<div class="ps"><dt>${esc(label)}</dt><dd>${value}${sub ? `<small>${sub}</small>` : ''}</dd></div>`;
      const plates = d.drivers.map((drv) => {
        const st = standingFor(d.ds.list, drv.driverId);
        const s = driverSeasonStats(drv.driverId, d.team.races, d.quali.races);
        const sprintPodiums = d.sprints.races.filter((r) => {
          const x = findResult(r, drv.driverId, 'SprintResults');
          return x && isClassified(x) && num(x.position) <= 3;
        }).length;
        return `
          <article class="plate">
            <span class="plate-num">${drv.permanentNumber ? `<span class="sr-only">Car number </span>${esc(drv.permanentNumber)}` : ''}</span>
            <div class="plate-id">
              <p class="plate-given">${esc(drv.givenName || '')}</p>
              <h3 class="plate-family">${esc(drv.familyName || driverName(drv))}</h3>
              <p class="plate-meta">${esc(drv.code || '')}${drv.nationality ? ` &middot; ${esc(drv.nationality)}` : ''}</p>
            </div>
            <div class="plate-champ">
              <span class="lab">Championship</span>
              <span class="plate-pos">${st ? `P${esc(st.position || st.positionText)}` : '-'}</span>
              <span class="plate-pts"><b>${st ? fmtPts(st.points) : '-'}</b> pts</span>
            </div>
            <dl class="plate-stats">
              ${ps('Wins', String(s.wins))}
              ${ps('Podiums', String(s.podiums), sprintPodiums ? `+${sprintPodiums} sprint` : '')}
              ${ps('Poles', String(s.poles))}
              ${ps('Fastest laps', String(s.fastest))}
              ${ps('Best finish', s.best != null ? `P${s.best}` : '-')}
              ${ps('Avg finish', s.avgFinish != null ? s.avgFinish.toFixed(1) : '-')}
              ${ps('Points finishes', String(s.pointsFinishes), `of ${s.starts}`)}
              ${ps('DNF / DNS', String(s.dnf))}
            </dl>
          </article>`;
      }).join('');
      return Object.assign({
        html: `<div class="plates">${plates}</div>${d.basis === 'entry' ? note('No races completed yet - drivers shown from the season entry list.') : ''}`
      }, metaOf(d.team, d.quali, d.sprints, d.ds));
    }, tok);

    load('ov-last', async () => {
      const e = await jget(`current/last/results.json?limit=${PAGE_SIZE}`, TTL.standings);
      const race = (e.data.MRData.RaceTable.Races || [])[0];
      if (!race || !(race.Results || []).length) return Object.assign({ html: emptyState('No Grand Prix results yet this season.') }, metaOf(e));
      await whenColours();
      return Object.assign({ html: raceSummaryHTML(race, 'Results') }, metaOf(e));
    }, tok);

    load('ov-sprint', async () => {
      const d = await teamData();
      const done = d.sprints.races.filter((r) => (r.SprintResults || []).length);
      if (!done.length) return Object.assign({ html: emptyState('No sprint has been held yet this season.') }, metaOf(d.sprints));
      const last = done[done.length - 1];
      const full = await getRoundSprint(last.season, last.round);
      const race = full.races[0] || last;
      await whenColours();
      return Object.assign({ html: raceSummaryHTML(race, 'SprintResults') }, metaOf(d.sprints, full));
    }, tok);

    load('ov-h2h', async () => {
      const d = await teamData();
      if (d.drivers.length < 2) return Object.assign({ html: emptyState('Head-to-head needs two team drivers with results.') }, metaOf(d.team));
      const [a, b] = d.drivers;
      let raceA = 0, raceB = 0, qA = 0, qB = 0, ptsA = 0, ptsB = 0, n = 0, qn = 0;
      for (const r of d.team.races) {
        const ra = findResult(r, a.driverId);
        const rb = findResult(r, b.driverId);
        if (ra) ptsA += num(ra.points) || 0;
        if (rb) ptsB += num(rb.points) || 0;
        if (ra && rb) {
          n++;
          if (num(ra.position) < num(rb.position)) raceA++; else if (num(rb.position) < num(ra.position)) raceB++;
        }
      }
      for (const r of d.sprints.races) {
        const ra = findResult(r, a.driverId, 'SprintResults');
        const rb = findResult(r, b.driverId, 'SprintResults');
        if (ra) ptsA += num(ra.points) || 0;
        if (rb) ptsB += num(rb.points) || 0;
      }
      for (const r of d.quali.races) {
        const qa = findResult(r, a.driverId, 'QualifyingResults');
        const qb = findResult(r, b.driverId, 'QualifyingResults');
        if (qa && qb) {
          qn++;
          if (num(qa.position) < num(qb.position)) qA++; else if (num(qb.position) < num(qa.position)) qB++;
        }
      }
      const row = (label, va, vb, fmtv) => {
        const total = (va + vb) || 1;
        const f = fmtv || String;
        return `<div class="h2h-row">
          <span class="h2h-val ${va > vb ? 'lead' : ''}">${esc(f(va))}</span>
          <div class="h2h-bar" aria-hidden="true"><span class="h2h-a" style="width:${(va / total) * 100}%"></span><span class="h2h-b" style="width:${(vb / total) * 100}%"></span></div>
          <span class="h2h-val ${vb > va ? 'lead' : ''}">${esc(f(vb))}</span>
          <span class="h2h-label">${esc(label)}</span>
        </div>`;
      };
      const name = (x) => `<span class="code">${esc(driverCode(x))}</span><span class="muted">${esc(driverName(x))}</span>`;
      return Object.assign({
        html: `<div class="h2h">
            <div class="h2h-names"><span class="h2h-name">${name(a)}</span><span class="h2h-name">${name(b)}</span></div>
            <div class="h2h-rows">
              ${row(`Qualifying \u00b7 ${plural(qn, 'session')}`, qA, qB)}
              ${row(`Race finishes \u00b7 ${plural(n, 'race')}`, raceA, raceB)}
              ${row('Points \u00b7 races + sprints', ptsA, ptsB, fmtPts)}
            </div>
          </div>`
      }, metaOf(d.team, d.quali, d.sprints));
    }, tok);
  }

  function raceSummaryHTML(race, key) {
    const results = race[key] || [];
    const winner = results.find((x) => String(x.position) === '1') || results[0];
    const team = results.filter((x) => x.Constructor && x.Constructor.constructorId === TEAM_ID);
    const delta = (x) => {
      const g = num(x.grid);
      const p = num(x.position);
      if (!isClassified(x) || !g || p == null) return '<span class="muted">-</span>';
      const dv = g - p;
      return dv > 0 ? `<span class="pos-up">+${dv}</span>` : dv < 0 ? `<span class="pos-down">${dv}</span>` : '<span class="muted">0</span>';
    };
    const rows = team.map((x) => `
      <tr class="is-team">
        <td><span class="who">${barHTML(consColour(x.Constructor))}<span class="who-name"><span class="given">${esc(x.Driver.givenName || '')}</span> <span class="family">${esc(x.Driver.familyName || '')}</span></span></span></td>
        <td class="r num">${esc(x.grid === '0' ? 'Pit lane' : posLabel(x.grid))}</td>
        <td class="r"><span class="fin">${resultCell(x)}</span></td>
        <td class="r num hide-xs">${delta(x)}</td>
        <td class="pts">${fmtPts(x.points)}</td>
        <td class="hide-sm muted">${esc(x.status || '')}</td>
      </tr>`).join('');
    return `
      <p class="eyebrow">Round ${esc(race.round)} &middot; ${esc(raceDateLabel(race))}</p>
      <h3 class="card-title">${esc(race.raceName)}</h3>
      ${winner ? `<p class="winner"><span class="lab">Winner</span><span class="who">${barHTML(consColour(winner.Constructor))}<strong>${esc(driverName(winner.Driver))}</strong></span><span>${esc(winner.Constructor ? winner.Constructor.name : '')}</span>${winner.Time && winner.Time.time ? `<span class="mono">${esc(winner.Time.time)}</span>` : ''}</p>` : ''}
      ${team.length ? `<div class="table-wrap"><table class="table">
        <thead><tr><th>Driver</th><th class="r">Grid</th><th class="r">Finish</th><th class="r hide-xs">+/-</th><th class="pts">Pts</th><th class="hide-sm">Status</th></tr></thead>
        <tbody>${rows}</tbody></table></div>` : emptyState('The team did not take part in this event.')}`;
  }

  /* ================================================================== */
  /* Standings                                                           */
  /* ================================================================== */
  ROUTES.standings = { title: 'Standings', fn: pageStandings };

  async function pageStandings(root, r, tok) {
    root.innerHTML = pageHead('Standings', 'Drivers\u2019 and constructors\u2019 championships, with the gap to the leader.', 'Championship') + `
      <div class="grid grid-12">
        ${panel('st-drivers', 'Drivers', 'Jolpica + OpenF1 colours', 'span-7')}
        ${panel('st-cons', 'Constructors', 'Jolpica + OpenF1 colours', 'span-5')}
      </div>`;
    load('st-drivers', async () => {
      const [ds, res] = await Promise.all([getDriverStandings('current'), getSeasonResults('current').catch(() => null)]);
      await whenColours();
      const teams = res ? latestTeamMap(res.races) : null;
      learnConstructorColours(ds.list, teams);
      if (!ds.list.length) return Object.assign({ html: emptyState('No drivers\u2019 standings published yet.') }, ds);
      const lead = num(ds.list[0].points) || 0;
      const rows = ds.list.map((s, i) => {
        const team = teamOfStanding(s, teams);
        const teamLabel = team ? team.name : ((s.Constructors || []).map((c) => c.name).join(' / '));
        const pts = num(s.points) || 0;
        const c = state.colours.get(s.Driver.code) || consColour(team);
        return `<tr class="${isTeamStanding(s) ? 'is-team' : ''}">
          <td class="pos">${esc(s.positionText || s.position || '-')}</td>
          <td><span class="who">${barHTML(c)}<span class="who-name"><span class="given hide-xs">${esc(s.Driver.givenName || '')} </span><span class="family">${esc(s.Driver.familyName || '')}</span></span><span class="code hide-xs">${esc(s.Driver.code || '')}</span></span></td>
          <td class="hide-sm muted">${esc(teamLabel)}</td>
          <td class="r num">${esc(s.wins)}</td>
          <td class="hide-sm bar-col"><span class="ptsbar" aria-hidden="true"><i style="width:${lead ? ((pts / lead) * 100).toFixed(1) : 0}%;--c:${esc(c || 'var(--fg)')}"></i></span></td>
          <td class="pts">${fmtPts(pts)}</td>
          <td class="r num muted hide-xs">${i === 0 ? '' : '-' + fmtPts(lead - pts)}</td>
        </tr>`;
      }).join('');
      return Object.assign({
        html: `<p class="eyebrow">${esc(ds.season)} season &middot; after round ${esc(ds.round)}</p>
          <div class="table-wrap"><table class="table">
          <thead><tr><th class="r">Pos</th><th>Driver</th><th class="hide-sm">Team</th><th class="r">Wins</th><th class="hide-sm"><span class="sr-only">Share of leader's points</span></th><th class="pts">Pts</th><th class="r hide-xs">Gap</th></tr></thead>
          <tbody>${rows}</tbody></table></div>`
      }, metaOf(ds, res));
    }, tok);
    load('st-cons', async () => {
      const [cs, ds, lr] = await Promise.all([getConstructorStandings('current'), getDriverStandings('current').catch(() => null), getLastResults().catch(() => null)]);
      await whenColours();
      if (ds) learnConstructorColours(ds.list, lr ? latestTeamMap(lr.races) : null);
      if (!cs.list.length) return Object.assign({ html: emptyState('No constructors\u2019 standings published yet.') }, cs);
      const lead = num(cs.list[0].points) || 0;
      const rows = cs.list.map((s, i) => {
        const pts = num(s.points) || 0;
        const c = consColour(s.Constructor);
        return `<tr class="${s.Constructor.constructorId === TEAM_ID ? 'is-team' : ''}">
          <td class="pos">${esc(s.positionText || s.position || '-')}</td>
          <td><span class="who">${barHTML(c)}<span class="who-name cell-main">${esc(s.Constructor.name)}</span></span></td>
          <td class="r num">${esc(s.wins)}</td>
          <td class="hide-sm bar-col"><span class="ptsbar" aria-hidden="true"><i style="width:${lead ? ((pts / lead) * 100).toFixed(1) : 0}%;--c:${esc(c || 'var(--fg)')}"></i></span></td>
          <td class="pts">${fmtPts(pts)}</td>
          <td class="r num muted hide-xs">${i === 0 ? '' : '-' + fmtPts(lead - pts)}</td>
        </tr>`;
      }).join('');
      return Object.assign({
        html: `<p class="eyebrow">${esc(cs.season)} season &middot; after round ${esc(cs.round)}</p>
          <div class="table-wrap"><table class="table">
          <thead><tr><th class="r">Pos</th><th>Constructor</th><th class="r">Wins</th><th class="hide-sm"><span class="sr-only">Share of leader's points</span></th><th class="pts">Pts</th><th class="r hide-xs">Gap</th></tr></thead>
          <tbody>${rows}</tbody></table></div>`
      }, metaOf(cs, ds));
    }, tok);
  }

  /* ================================================================== */
  /* Title fight - championship mathematics                              */
  /* ================================================================== */
  ROUTES.title = { title: 'Title Fight', fn: pageTitle };

  /** Points available per event, derived from points actually awarded this season. */
  function derivePoints(races, key) {
    let driver = 0;
    let team = 0;
    let n = 0;
    for (const r of races || []) {
      const pts = (r[key] || []).map((x) => num(x.points) || 0).sort((a, b) => b - a);
      if (!pts.length) continue;
      n++;
      driver = Math.max(driver, pts[0]);
      team = Math.max(team, pts[0] + (pts[1] || 0));
    }
    return { driver, team, n };
  }

  async function pageTitle(root, r, tok) {
    root.innerHTML = pageHead('Title Fight', 'Who can still win, from the live schedule and the points actually awarded so far.', 'Championship mathematics') + `
      ${panel('tf-summary', 'Season status', 'Jolpica')}
      <div class="grid grid-12">
        ${panel('tf-drivers', 'Drivers\u2019 title contention', 'Jolpica', 'span-6')}
        ${panel('tf-cons', 'Constructors\u2019 title contention', 'Jolpica', 'span-6')}
      </div>
      ${panel('tf-chart', 'Points progression', 'Jolpica')}`;

    let data;
    try {
      const [sch, res, spr, ds, cs] = await Promise.all([
        getSchedule('current'), getSeasonResults('current'), getSeasonSprints('current'),
        getDriverStandings('current'), getConstructorStandings('current')
      ]);
      guard(tok);
      const raceDone = new Set(res.races.filter((x) => x.Results.length).map((x) => String(x.round)));
      const sprintDone = new Set(spr.races.filter((x) => x.SprintResults.length).map((x) => String(x.round)));
      const remRaces = sch.races.filter((x) => !raceDone.has(String(x.round)));
      const remSprints = sch.races.filter((x) => hasSprint(x) && !sprintDone.has(String(x.round)));
      const racePts = derivePoints(res.races, 'Results');
      let sprintPts = derivePoints(spr.races, 'SprintResults');
      let sprintBasis = 'this season';
      if (!sprintPts.n && remSprints.length && Number(sch.season) > 0) {
        const prev = await getSeasonSprints(String(Number(sch.season) - 1)).catch(() => null);
        guard(tok);
        if (prev && prev.races.length) { sprintPts = derivePoints(prev.races, 'SprintResults'); sprintBasis = `the ${Number(sch.season) - 1} season`; }
      }
      data = { sch, res, spr, ds, cs, remRaces, remSprints, racePts, sprintPts, sprintBasis };
    } catch (e) {
      if (e === STOP) return;
      ['tf-summary', 'tf-drivers', 'tf-cons', 'tf-chart'].forEach((id) => panelError(id, e, () => route()));
      return;
    }
    const d = data;
    const meta = metaOf(d.sch, d.res, d.spr, d.ds, d.cs);
    const maxDriver = d.remRaces.length * d.racePts.driver + d.remSprints.length * d.sprintPts.driver;
    const maxTeam = d.remRaces.length * d.racePts.team + d.remSprints.length * d.sprintPts.team;
    const noPointsYet = !d.racePts.n;

    setPanel('tf-summary', `
      <div class="stats stats-4 stats-big">
        ${stat('Grands Prix remaining', String(d.remRaces.length), `of ${d.sch.races.length}`)}
        ${stat('Sprints remaining', String(d.remSprints.length), `of ${d.sch.races.filter(hasSprint).length}`)}
        ${stat('Max driver points left', noPointsYet ? '-' : fmtPts(maxDriver), noPointsYet ? '' : `${fmtPts(d.racePts.driver)} per GP, ${fmtPts(d.sprintPts.driver)} per sprint`)}
        ${stat('Max constructor points left', noPointsYet ? '-' : fmtPts(maxTeam), noPointsYet ? '' : `${fmtPts(d.racePts.team)} per GP, ${fmtPts(d.sprintPts.team)} per sprint`)}
      </div>
      ${note(`Points per event are derived from the highest points actually awarded in ${d.racePts.n} Grand Prix results this season${d.remSprints.length ? ` and sprint results from ${d.sprintBasis}` : ''}. A tie on points is treated as still in contention (countback is not modelled).`)}
      ${d.remRaces.length ? `<p class="muted small">Next Grand Prix: ${esc(d.remRaces[0].raceName)} (round ${esc(d.remRaces[0].round)})</p>` : ''}`, meta);

    const contention = (list, nameOf, idOf, isTeamRow, maxLeft) => {
      if (!list.length) return emptyState('No standings published yet.');
      if (noPointsYet) return emptyState('No races completed yet - contention will be computed after the first results.');
      const leaderPts = num(list[0].points) || 0;
      const second = list[1] ? num(list[1].points) || 0 : 0;
      const decided = list.length > 1 && leaderPts - second > maxLeft;
      const rows = list.map((s, i) => {
        const pts = num(s.points) || 0;
        const gap = leaderPts - pts;
        const best = pts + maxLeft;
        const alive = i === 0 || best >= leaderPts;
        const perEvent = (d.remRaces.length + d.remSprints.length) ? gap / (d.remRaces.length + d.remSprints.length) : null;
        return { s, i, pts, gap, best, alive, perEvent };
      });
      const shown = rows.filter((x) => x.alive || isTeamRow(x.s));
      const hidden = rows.length - shown.length;
      const aliveCount = rows.filter((x) => x.alive).length;
      // Reach bar: points now (solid), still available (hatched), leader's total (rule).
      const scale = Math.max(leaderPts, ...shown.map((x) => x.best)) || 1;
      const pct = (v) => ((v / scale) * 100).toFixed(2);
      const reach = (x) => `<span class="reach" role="img" aria-label="${esc(`${fmtPts(x.pts)} points now, up to ${fmtPts(x.best)} possible; leader has ${fmtPts(leaderPts)}`)}"><i class="reach-now" style="width:${pct(x.pts)}%"></i><i class="reach-max" style="left:${pct(x.pts)}%;width:${pct(x.best - x.pts)}%"></i><b class="reach-line" style="left:calc(${pct(leaderPts)}% - 1px)"></b></span>`;
      return `
        <p class="verdict">${decided ? `<strong>Decided.</strong> ${esc(nameOf(list[0]))} cannot be caught.` : `<strong>${aliveCount}</strong> still mathematically in contention.`}</p>
        <div class="table-wrap"><table class="table">
          <thead><tr><th class="r">Pos</th><th>Name</th><th class="pts">Pts</th><th class="r">Gap</th><th class="r hide-xs">Max</th><th class="hide-sm">Reach</th><th class="status-col">Status</th></tr></thead>
          <tbody>${shown.map((x) => `
            <tr class="${isTeamRow(x.s) ? 'is-team' : ''}">
              <td class="pos">${esc(x.s.positionText || x.s.position)}</td>
              <td><span class="cell-main">${esc(nameOf(x.s))}</span></td>
              <td class="pts">${fmtPts(x.pts)}</td>
              <td class="r num">${x.i === 0 ? '' : '-' + fmtPts(x.gap)}</td>
              <td class="r num hide-xs">${fmtPts(x.best)}</td>
              <td class="hide-sm bar-col">${reach(x)}</td>
              <td>${x.i === 0 ? chip(decided ? 'Champion' : 'Leader', 'lead') : x.alive ? chip('In contention', 'ok') : chip('Eliminated', 'out')}${x.i > 0 && x.alive && x.perEvent != null ? `<span class="needs" title="Points per remaining event needed over the leader">+${fmtPts(Math.round(x.perEvent * 10) / 10)} / event</span>` : ''}</td>
            </tr>`).join('')}
          </tbody></table></div>
        ${note(`Per-event figures are the average points a contender must outscore the leader by in every remaining event.${hidden ? ` ${plural(hidden, 'other entrant')} can no longer reach the leader's total and ${hidden === 1 ? 'is' : 'are'} hidden.` : ''}`)}`;
    };
    setPanel('tf-drivers', contention(d.ds.list, (s) => driverName(s.Driver), (s) => s.Driver.driverId, isTeamStanding, maxDriver), meta);
    setPanel('tf-cons', contention(d.cs.list, (s) => s.Constructor.name, (s) => s.Constructor.constructorId, (s) => s.Constructor.constructorId === TEAM_ID, maxTeam), meta);

    // Progression chart
    const raceByRound = new Map(d.res.races.map((x) => [String(x.round), x]));
    const sprintByRound = new Map(d.spr.races.map((x) => [String(x.round), x]));
    const rounds = uniq([...raceByRound.keys(), ...sprintByRound.keys()]).map(Number).sort((a, b) => a - b);
    const raceName = (rd) => {
      const x = d.sch.races.find((y) => Number(y.round) === rd) || raceByRound.get(String(rd)) || sprintByRound.get(String(rd));
      return x ? x.raceName : `Round ${rd}`;
    };
    const cumulative = (idOf) => {
      const totals = new Map();
      const series = new Map();
      for (const rd of rounds) {
        const add = (list) => {
          for (const x of list || []) {
            const id = idOf(x);
            if (!id) continue;
            totals.set(id, (totals.get(id) || 0) + (num(x.points) || 0));
          }
        };
        add((raceByRound.get(String(rd)) || {}).Results);
        add((sprintByRound.get(String(rd)) || {}).SprintResults);
        for (const [id, t] of totals) {
          if (!series.has(id)) series.set(id, []);
          series.get(id).push({ x: rd, y: t, title: `${raceName(rd)} (R${rd}): ${fmtPts(t)} pts` });
        }
      }
      return series;
    };
    const teams = latestTeamMap(d.res.races);
    // Colours are resolved when the chart draws (and redraws once OpenF1 colours arrive).
    const consColourFor = (id, constructor, i) => {
      learnConstructorColours(d.ds.list, teams);
      return consColour(constructor || { constructorId: id }) || constructorColourMap(d.res.races).get(id) || fallbackColour(i);
    };
    const driverSeries = () => {
      const cum = cumulative((x) => x.Driver && x.Driver.driverId);
      const pick = [];
      const add = (id) => { if (id && !pick.includes(id) && cum.has(id)) pick.push(id); };
      d.ds.list.filter((s) => isTeamStanding(s)).forEach((s) => add(s.Driver.driverId));
      d.ds.list.slice(0, 6).forEach((s) => add(s.Driver.driverId));
      const usedColours = new Map();
      return pick.map((id, i) => {
        const st = standingFor(d.ds.list, id);
        const drv = st ? st.Driver : { driverId: id, code: id };
        const team = teams.get(id) || teamOfStanding(st, null);
        const tKey = team ? team.constructorId : id;
        const dash = usedColours.has(tKey);
        usedColours.set(tKey, true);
        return { label: `${driverCode(drv)}${team ? ' - ' + team.name : ''}`, short: driverCode(drv), color: () => driverColour(drv.code, i), dash, points: cum.get(id) };
      });
    };
    const consSeries = () => {
      const cum = cumulative((x) => x.Constructor && x.Constructor.constructorId);
      const ids = uniq([TEAM_ID, ...d.cs.list.slice(0, 6).map((s) => s.Constructor.constructorId)]).filter((id) => cum.has(id));
      return ids.map((id, i) => {
        const s = d.cs.list.find((x) => x.Constructor.constructorId === id);
        return { label: s ? s.Constructor.name : id, short: s ? s.Constructor.name : id, color: () => consColourFor(id, s && s.Constructor, i), points: cum.get(id) };
      });
    };
    const drawProgression = (mode) => {
      const el = setPanel('tf-chart', `<div class="chart" id="tf-svg"></div>${note('Cumulative points after each round, including sprint points in the round they were scored. Team drivers plus the top of the table are shown; teammates share a colour, the second is dashed.')}`, meta);
      if (!el) return;
      mountChart($('#tf-svg'), {
        label: mode === 'drivers' ? 'Drivers points progression' : 'Constructors points progression',
        series: mode === 'drivers' ? driverSeries() : consSeries(),
        xFmt: (v) => `R${v}`,
        yFmt: (v) => fmtPts(v),
        yTitle: 'Points',
        emptyText: 'No results yet this season.'
      });
    };
    const tools = setTools('tf-chart', `<div class="seg" role="group" aria-label="Chart type">
        <button type="button" class="seg-btn active" data-mode="drivers" aria-pressed="true">Drivers</button>
        <button type="button" class="seg-btn" data-mode="constructors" aria-pressed="false">Constructors</button></div>`);
    if (tools) {
      tools.addEventListener('click', (e) => {
        const b = e.target.closest('[data-mode]');
        if (!b) return;
        $$('[data-mode]', tools).forEach((x) => { x.classList.toggle('active', x === b); x.setAttribute('aria-pressed', String(x === b)); });
        drawProgression(b.dataset.mode);
      });
    }
    drawProgression('drivers');
  }

  /* ================================================================== */
  /* Schedule                                                            */
  /* ================================================================== */
  ROUTES.schedule = { title: 'Schedule', fn: pageSchedule };

  async function pageSchedule(root, r, tok) {
    root.innerHTML = pageHead('Schedule', `Every round and session, shown in your local time (${tzName()}).`, 'Race calendar') + panel('sc-list', 'Season calendar', 'Jolpica + OpenF1');
    load('sc-list', async () => {
      const sch = await getSchedule('current');
      // OpenF1 session end times (optional enrichment for live / completed status).
      let of1 = [];
      let of1Meta = null;
      try { const e = await getYearSessions(sch.season); of1 = e.data; of1Meta = e; } catch (e) { of1 = []; }
      // Sessions that may be running are checked against race control for a finish marker.
      for (const s of of1.filter((x) => sessionStatus(x) === 'live').slice(0, 3)) await resolveSessionStatus(s);
      const now = Date.now();
      const findOf1 = (start) => {
        let best = null;
        for (const s of of1) {
          const st = parseTime(s.date_start);
          if (st == null) continue;
          const diff = Math.abs(st - start);
          if (diff <= HOUR && (!best || diff < best.diff)) best = { s, diff };
        }
        return best ? best.s : null;
      };
      const all = flattenSessions(sch.races);
      const next = all.find((s) => isPending(s, now));
      const statusOf = (s) => {
        const o = findOf1(s.start);
        if (o && o.is_cancelled) return ['Cancelled', 'out'];
        if (isPending(s, now)) return next && next.start === s.start && next.field === s.field && next.race.round === s.race.round ? ['Next', 'next'] : ['Upcoming', 'up'];
        if (o) return sessionStatus(o) === 'live' ? ['Live', 'live'] : ['Completed', 'done'];
        // No OpenF1 record to confirm the finish: say it has started until a later session begins or a day passes.
        const later = all.some((x) => x.start > s.start && !isPending(x, now));
        return later || now > s.start + DAY ? ['Completed', 'done'] : ['Started', 'next'];
      };
      const html = sch.races.map((race) => {
        const ws = weekendSessions(race).map((s) => Object.assign({ race }, s));
        const statuses = ws.map(statusOf);
        const raceStatus = statuses.some((x) => x[1] === 'live') ? ['Live', 'live'] : statuses.some((x) => x[1] === 'next') ? ['Next', 'next'] : statuses.every((x) => x[1] === 'done' || x[1] === 'out') ? ['Completed', 'done'] : ['Upcoming', 'up'];
        const loc = race.Circuit && race.Circuit.Location ? race.Circuit.Location : {};
        return `<article class="round ${raceStatus[1] === 'done' ? 'round-done' : ''} ${raceStatus[1] === 'next' || raceStatus[1] === 'live' ? 'round-next' : ''}" id="round-${esc(race.round)}">
          <header class="round-head">
            <span class="round-num tnum">${esc(race.round)}</span>
            <div class="round-title"><h3>${esc(race.raceName)}${hasSprint(race) ? ' ' + chip('Sprint', 'tag') : ''}</h3>
            <p class="muted">${esc(race.Circuit ? race.Circuit.circuitName : '')}${loc.locality ? ', ' + esc(loc.locality) : ''}${loc.country ? ', ' + esc(loc.country) : ''}</p></div>
            ${chip(raceStatus[0], raceStatus[1])}
          </header>
          <ul class="session-list">${ws.map((s, i) => `
            <li class="${'st-' + statuses[i][1]}"><span>${esc(s.name)}</span><span class="tnum">${esc(s.timed ? fmtDateTime(s.start) : fmtDayUTC(s.start))}</span>${statuses[i][1] === 'done' ? '<span class="st-tag">Done</span>' : statuses[i][1] === 'up' ? '<span class="st-tag"><span class="sr-only">Upcoming</span></span>' : chip(statuses[i][0], statuses[i][1])}</li>`).join('')}
          </ul>
        </article>`;
      }).join('');
      return {
        html: sch.races.length ? `<div class="sched-bar"><p class="eyebrow">${esc(sch.season)} season &middot; ${plural(sch.races.length, 'round')} &middot; ${plural(sch.races.filter(hasSprint).length, 'sprint weekend')}</p>${next ? `<button type="button" class="btn" data-jump="${esc(next.race.round)}">Jump to round ${esc(next.race.round)}</button>` : ''}</div><div class="rounds">${html}</div>` : emptyState('No schedule published for the current season yet.'),
        at: metaOf(sch, of1Meta).at,
        stale: metaOf(sch, of1Meta).stale,
        source: of1Meta ? 'Jolpica + OpenF1' : 'Jolpica',
        after: (el) => {
          const j = $('[data-jump]', el);
          if (j) j.addEventListener('click', (e) => {
            e.preventDefault();
            const t = document.getElementById(`round-${j.dataset.jump}`);
            if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' });
          });
        }
      };
    }, tok);
  }

  /* ================================================================== */
  /* Watch & links                                                       */
  /* ================================================================== */
  ROUTES.links = { title: 'Watch & Links', fn: pageLinks };

  function pageLinks(root) {
    const groups = [
      ['Watch', [
        ['F1 TV', 'https://f1tv.formula1.com/', 'Official Formula 1 streaming service'],
        ['Formula1.com', 'https://www.formula1.com/', 'News, timing and highlights'],
        ['Formula1.com - McLaren team page', 'https://www.formula1.com/en/teams/mclaren', 'Team profile on the official F1 site']
      ]],
      ['Team', [
        ['McLaren Racing', 'https://www.mclaren.com/racing/', 'Official team site'],
        ['McLaren Formula 1 Team', 'https://www.mclaren.com/racing/formula-1/', 'Formula 1 team news and drivers']
      ]],
      ['Data sources used by this dashboard', [
        ['Jolpica-F1', 'https://github.com/jolpica/jolpica-f1', 'Open, Ergast-compatible results and schedule API'],
        ['OpenF1', 'https://openf1.org/', 'Open timing, telemetry, radio and session API'],
        ['FIA', 'https://www.fia.com/', 'Governing body - regulations and documents']
      ]]
    ];
    root.innerHTML = pageHead('Watch & Links', 'Official places to watch and follow, plus the open data sources behind this site.', 'Elsewhere') +
      `<div class="grid grid-3">${groups.map(([title, links]) => `
        <section class="panel"><header class="panel-head"><h2>${esc(title)}</h2></header>
          <div class="panel-body"><ul class="link-list">${links.map(([label, href, desc]) => `
            <li><a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(label)}<span class="ext" aria-hidden="true">&#8599;</span></a><span class="muted small">${esc(desc)}</span></li>`).join('')}
          </ul></div>
          <footer class="panel-meta"><span class="meta-src">Source: curated outbound links</span><span>static list, no live data</span></footer></section>`).join('')}
      </div>`;
  }

  /* ================================================================== */
  /* Live / latest session (OpenF1)                                      */
  /* ================================================================== */
  ROUTES.live = { title: 'Live Session', fn: pageLive };

  const TYRE_CLASS = (c) => {
    const k = String(c || '').toLowerCase();
    return /^(soft|medium|hard|intermediate|wet)$/.test(k) ? k : 'unknown';
  };
  const tyreChip = (st) => {
    if (!st || !st.compound) return '<span class="muted">-</span>';
    const laps = st.lap_end != null && st.lap_start != null ? st.lap_end - st.lap_start + 1 : null;
    const title = `${st.compound}${laps != null ? `, laps ${st.lap_start}-${st.lap_end}` : ''}${st.tyre_age_at_start != null ? `, ${st.tyre_age_at_start} laps old at fit` : ''}`;
    return `<span class="tyre tyre-${TYRE_CLASS(st.compound)}" title="${esc(title)}"><span aria-hidden="true">${esc(String(st.compound).charAt(0))}</span><span class="sr-only">${esc(st.compound)}</span></span>${laps != null ? `<span class="tyre-age" title="Laps on this stint">${laps}L</span>` : ''}`;
  };
  const drsLabel = (v) => {
    if (v == null) return 'n/a';
    if (v === 10 || v === 12 || v === 14) return 'Open';
    if (v === 8) return 'Eligible';
    return 'Closed';
  };
  function maxDateRaw(rows, prev) {
    let best = prev || null;
    let bt = parseTime(prev);
    if (bt == null) bt = -Infinity;
    for (const row of rows || []) {
      const t = parseTime(row.date);
      if (t != null && t > bt) { bt = t; best = row.date; }
    }
    return best;
  }
  const lapEnd = (lp) => {
    const s = parseTime(lp && lp.date_start);
    if (s == null) return null;
    return s + (num(lp.lap_duration) || 0) * SEC;
  };

  async function pageLive(root, r, tok) {
    root.innerHTML = pageHead('Live Session', 'Timing, telemetry, radio and strategy from the current or most recent session.', 'OpenF1 timing') + `
      ${panel('lv-head', 'Current or latest session', 'OpenF1', 'panel-board')}
      <div class="grid grid-live">
        ${panel('lv-board', 'Timing', 'OpenF1', 'panel-tower')}
        <div class="stack">
          ${panel('lv-weather', 'Weather', 'OpenF1')}
          ${panel('lv-pits', 'Team pit stops', 'OpenF1')}
        </div>
      </div>
      ${panel('lv-tele', 'Team telemetry', 'OpenF1')}
      <div class="grid grid-2">
        ${panel('lv-rc', 'Race control', 'OpenF1')}
        ${panel('lv-radio', 'Team radio', 'OpenF1')}
      </div>
      ${panel('lv-stints', 'Tyre stints', 'OpenF1')}`;

    const ALL = ['lv-board', 'lv-weather', 'lv-pits', 'lv-tele', 'lv-rc', 'lv-radio', 'lv-stints'];
    const L = {
      session: null, meeting: null, meetingSessions: [], drivers: new Map(), team: [],
      pos: new Map(), posLast: null, ints: new Map(), intsLast: null, laps: new Map(),
      stints: new Map(), pits: [], pitLast: null, rc: [], rcLast: null, weather: [], wLast: null,
      radio: [], radioLast: null, car: new Map(), carLast: new Map(), fastest: new Map(),
      at: {}, mode: 'final', isRace: false, timer: null, busy: false, ti: 0, tasks: [],
      authFails: 0, stopped: false, pollMsg: '', lastPoll: null, rcFilter: 'all'
    };

    // 1. Session
    try {
      const want = r.query.get('session');
      const e = want && /^\d+$/.test(want)
        ? await oget('sessions', { session_key: want }, { ttl: TTL.short })
        : await oget('sessions', { session_key: 'latest' }, { ttl: TTL.live });
      guard(tok);
      L.session = e.data[0] || null;
      L.at.head = e.at;
      if (!L.session) throw new ApiError('OpenF1 has no session information available yet.', 404);
    } catch (e) {
      if (e === STOP) return;
      panelError('lv-head', e, () => route());
      ALL.forEach((id) => setPanel(id, emptyState('Waiting for session information.'), { note: 'not loaded' }));
      return;
    }
    const S = L.session;
    const sk = S.session_key;
    L.isRace = S.session_type === 'Race';
    await resolveSessionStatus(S);
    if (tok !== routeToken) return;
    L.mode = inLiveWindow(S) ? 'live' : 'final';
    // Week-long caching only once the finish is confirmed and late data has had time to land.
    const ttlFinal = L.mode === 'final' && sessionSettled(S) ? { ttl: TTL.history, persist: true } : { ttl: 0 };
    L.failed = {};
    const onLiveClick = (e) => { if (e.target.closest && e.target.closest('[data-live-reload]')) route(); };
    document.addEventListener('click', onLiveClick);
    onLeave(() => document.removeEventListener('click', onLiveClick));
    /** setPanel for the live panels: keeps a visible notice if part of the panel's data failed to load. */
    function setLive(id, html, meta) {
      const msg = L.failed[id];
      const warn = msg ? `<div class="note warn-text" role="alert">Part of this panel could not be loaded: ${esc(msg)} <button type="button" class="btn" data-live-reload>Retry</button></div>` : '';
      return setPanel(id, warn + html, meta);
    }

    const teamNums = () => new Set(L.team.map((d) => d.driver_number));
    const drvLabel = (n) => {
      const d = L.drivers.get(n);
      return d ? (d.name_acronym || d.last_name || `#${n}`) : `#${n}`;
    };
    const drvColour = (n, i) => {
      const d = L.drivers.get(n);
      return (d && validHex('#' + String(d.team_colour || '').replace('#', ''))) || fallbackColour(i || 0);
    };

    /* ---------------- renderers ---------------- */
    function renderHead() {
      const start = parseTime(S.date_start);
      const end = parseTime(S.date_end);
      const now = Date.now();
      const status = L.mode === 'live' ? (now < start ? ['Starting soon', 'next'] : ['Live', 'live']) : (now < start ? ['Scheduled', 'up'] : ['Completed', 'done']);
      const options = L.meetingSessions
        .filter((x) => (parseTime(x.date_start) || Infinity) <= now)
        .sort((a, b) => (parseTime(a.date_start) || 0) - (parseTime(b.date_start) || 0))
        .map((x) => `<option value="${esc(x.session_key)}" ${x.session_key === sk ? 'selected' : ''}>${esc(x.session_name)}</option>`).join('');
      const el = setPanel('lv-head', `
        <div class="session-head">
          <div>
            <p class="hero-kicker"><span><b>${esc(L.meeting ? L.meeting.meeting_name : S.location)}</b></span><span>${esc(S.year)}</span>${S.session_type && S.session_type !== S.session_name ? `<span>${esc(S.session_type)}</span>` : ''}</p>
            <h3 class="session-title">${esc(S.session_name)} ${chip(status[0], status[1])}</h3>
            <p class="session-meta">${esc(S.circuit_short_name || '')}${S.country_name ? ', ' + esc(S.country_name) : ''} &middot; <span class="mono">${esc(fmtDateTime(start))} &ndash; ${esc(fmtHM(end))}</span> ${esc(tzName())} scheduled${endMarks.has(String(sk)) ? ` &middot; finished <span class="mono">${esc(fmtHM(endMarks.get(String(sk))))}</span>` : ''}</p>
          </div>
          ${options ? `<label class="field"><span>Session</span><select id="lv-session">${options}</select></label>` : ''}
        </div>
        <p class="poll-line" id="lv-poll">${pollText()}</p>`, { at: L.at.head, note: `session key ${sk}` });
      if (!el) return;
      const sel = $('#lv-session', el);
      if (sel) sel.addEventListener('change', () => { location.hash = `#/live?session=${encodeURIComponent(sel.value)}`; });
    }
    function pollText() {
      if (L.mode !== 'live' && L.endedWhileOpen) return 'Session finished, auto-refresh stopped. The panels show the last live update. <button type="button" class="btn" data-live-reload>Load final data</button>';
      if (L.mode !== 'live') return 'Final data for this session. Telemetry shows each team driver\u2019s fastest lap.';
      if (L.stopped) return `Auto-refresh paused: ${esc(L.pollMsg)}. OpenF1 serves real-time data to subscribers; free access fills in after the session.`;
      const vis = document.visibilityState === 'visible';
      return `${vis ? 'Auto-refreshing while this page is visible' : 'Auto-refresh paused while the tab is hidden'}${L.lastPoll ? ` &middot; last update ${esc(fmtClock(L.lastPoll))}` : ''}${L.pollMsg ? ` &middot; <span class="warn-text">${esc(L.pollMsg)}</span>` : ''}. OpenF1 real-time access may require a subscription; data can lag on free access.`;
    }
    function renderPollLine() {
      const el = document.getElementById('lv-poll');
      if (el) el.innerHTML = pollText();
    }

    function renderBoard() {
      if (!L.drivers.size) { setLive('lv-board', emptyState('No driver list published for this session yet.'), { at: L.at.drivers }); return; }
      const tn = teamNums();
      const rows = Array.from(L.drivers.values()).map((d) => {
        const n = d.driver_number;
        const p = L.pos.get(n);
        const laps = L.laps.get(n);
        let best = null;
        let lapCount = 0;
        if (laps) {
          for (const lp of laps.values()) {
            lapCount = Math.max(lapCount, lp.lap_number || 0);
            if (lp.lap_duration != null && !lp.is_pit_out_lap && (!best || lp.lap_duration < best.lap_duration)) best = lp;
          }
        }
        const st = L.stints.get(n) || [];
        return { d, n, pos: p ? num(p.position) : null, it: L.ints.get(n), best, lapCount, stint: st[st.length - 1], pits: L.pits.filter((x) => x.driver_number === n).length };
      }).sort((a, b) => (a.pos == null ? Infinity : a.pos) - (b.pos == null ? Infinity : b.pos) || a.n - b.n);
      const fastest = rows.reduce((m, x) => (x.best && (m == null || x.best.lap_duration < m) ? x.best.lap_duration : m), null);
      const head = L.isRace
        ? '<th class="r">Pos</th><th>Driver</th><th class="hide-sm">Team</th><th class="gap">Gap</th><th class="gap hide-xs">Int</th><th>Tyre</th><th class="r hide-xs">Pits</th>'
        : '<th class="r">Pos</th><th>Driver</th><th class="hide-sm">Team</th><th class="gap">Best lap</th><th class="gap hide-xs">Gap</th><th class="r hide-xs">Laps</th><th>Tyre</th>';
      const fmtGap = (v, leader) => {
        if (leader) return 'Leader';
        if (v == null) return '-';
        if (typeof v === 'string') return esc(v);
        return '+' + Number(v).toFixed(3);
      };
      const body = rows.map((x, i) => {
        const leader = x.pos === 1;
        const cells = L.isRace
          ? `<td class="gap">${fmtGap(x.it ? x.it.gap_to_leader : null, leader)}</td>
             <td class="gap hide-xs">${leader ? '' : fmtGap(x.it ? x.it.interval : null, false)}</td>
             <td class="tyre-cell">${tyreChip(x.stint)}</td>
             <td class="r num hide-xs">${x.pits}</td>`
          : `<td class="gap">${x.best ? fmtLap(x.best.lap_duration) : '-'}</td>
             <td class="gap hide-xs">${x.best && fastest != null ? (x.best.lap_duration === fastest ? '' : '+' + (x.best.lap_duration - fastest).toFixed(3)) : '-'}</td>
             <td class="r num hide-xs">${x.lapCount || '-'}</td>
             <td class="tyre-cell">${tyreChip(x.stint)}</td>`;
        return `<tr class="${tn.has(x.n) ? 'is-team' : ''}">
          <td class="pos">${x.pos != null ? x.pos : '-'}</td>
          <td><span class="who"><span class="stripe" style="--c:${esc(drvColour(x.n, i))}"></span><span class="code">${esc(x.d.name_acronym || '')}</span><span class="drv-last hide-xs">${esc(x.d.last_name || x.d.full_name || '')}</span></span></td>
          <td class="hide-sm muted">${esc(x.d.team_name || '')}</td>
          ${cells}
        </tr>`;
      }).join('');
      setLive('lv-board', `<div class="table-wrap"><table class="table board">
          <thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>
          ${L.isRace && !L.ints.size ? note('Interval data is not available for this session yet.') : ''}`,
      { at: Math.max(L.at.pos || 0, L.at.ints || 0, L.at.laps || 0, L.at.stints || 0) || L.at.drivers });
    }

    function renderWeather() {
      const w = L.weather;
      if (!w.length) { setLive('lv-weather', emptyState('No weather readings for this session yet.'), { at: L.at.weather }); return; }
      const cur = w[w.length - 1];
      const rain = num(cur.rainfall);
      setLive('lv-weather', `
        <div class="stats stats-2">
          ${stat('Air', `${fmtNum(num(cur.air_temperature), 1)}&deg;C`, sparkline(w.map((x) => num(x.air_temperature))))}
          ${stat('Track', `${fmtNum(num(cur.track_temperature), 1)}&deg;C`, sparkline(w.map((x) => num(x.track_temperature))))}
          ${stat('Humidity', `${fmtNum(num(cur.humidity), 0)}%`)}
          ${stat('Wind', `${fmtNum(num(cur.wind_speed), 1)} m/s`, `${esc(cardinal(cur.wind_direction))} ${cur.wind_direction != null ? esc(cur.wind_direction) + '&deg;' : ''}`)}
          ${stat('Pressure', `${fmtNum(num(cur.pressure), 1)} mbar`)}
          ${stat('Rain', rain ? 'Rain' : 'Dry')}
        </div>
        <p class="muted small">Reading at ${esc(fmtClock(parseTime(cur.date)))}</p>`, { at: L.at.weather });
    }

    function renderPits() {
      const tn = teamNums();
      const rows = L.pits.filter((p) => tn.has(p.driver_number)).sort((a, b) => (parseTime(a.date) || 0) - (parseTime(b.date) || 0));
      if (!L.team.length) { setLive('lv-pits', emptyState('No team drivers found in this session.'), { at: L.at.pits }); return; }
      if (!rows.length) { setLive('lv-pits', emptyState('No pit stops recorded for team drivers.'), { at: L.at.pits }); return; }
      setLive('lv-pits', `<div class="table-wrap"><table class="table">
        <thead><tr><th>Driver</th><th>Lap</th><th>Pit lane</th><th>Stationary</th></tr></thead>
        <tbody>${rows.map((p) => {
          const lane = num(p.lane_duration) != null ? num(p.lane_duration) : num(p.pit_duration);
          const stop = num(p.stop_duration);
          return `<tr><td><span class="code">${esc(drvLabel(p.driver_number))}</span></td><td class="tnum">${esc(p.lap_number != null ? p.lap_number : '-')}</td><td class="tnum">${lane != null ? lane.toFixed(1) + 's' : '-'}</td><td class="tnum">${stop != null ? stop.toFixed(1) + 's' : '-'}</td></tr>`;
        }).join('')}</tbody></table></div>`, { at: L.at.pits });
    }

    function renderRC() {
      const tn = teamNums();
      const teamCodes = L.team.map((d) => d.name_acronym).filter(Boolean);
      let list = L.rc.slice().reverse();
      if (L.rcFilter === 'flags') list = list.filter((m) => m.category === 'Flag' || m.flag);
      if (L.rcFilter === 'team') list = list.filter((m) => tn.has(m.driver_number) || teamCodes.some((c) => String(m.message || '').indexOf(`(${c})`) >= 0));
      const flagKind = (f) => {
        const k = String(f || '').toUpperCase();
        if (k.indexOf('RED') >= 0) return 'red';
        if (k.indexOf('YELLOW') >= 0) return 'yellow';
        if (k.indexOf('GREEN') >= 0 || k === 'CLEAR') return 'green';
        if (k.indexOf('BLUE') >= 0) return 'blue';
        if (k.indexOf('CHEQUERED') >= 0) return 'chequered';
        return 'neutral';
      };
      const items = list.slice(0, 120).map((m) => `
        <li>
          <span class="rc-time tnum">${esc(fmtHM(parseTime(m.date)))}${m.lap_number != null ? `<span class="muted"> L${esc(m.lap_number)}</span>` : ''}</span>
          <span class="rc-msg">${m.flag ? `<span class="flag flag-${flagKind(m.flag)}">${esc(m.flag)}</span>` : ''}${esc(m.message || '')}</span>
        </li>`).join('');
      const el = setLive('lv-rc', `
        <div class="seg seg-sm" role="group" aria-label="Filter messages">
          ${[['all', 'All'], ['flags', 'Flags'], ['team', 'Team cars']].map(([k, lab]) => `<button type="button" class="seg-btn ${L.rcFilter === k ? 'active' : ''}" data-rc="${k}" aria-pressed="${L.rcFilter === k}">${lab}</button>`).join('')}
        </div>
        ${items ? `<ol class="rc-list">${items}</ol>` : emptyState('No race control messages match.')}
        ${list.length > 120 ? note(`Showing the latest 120 of ${list.length} messages.`) : ''}`, { at: L.at.rc });
      if (el) $$('[data-rc]', el).forEach((b) => b.addEventListener('click', () => { L.rcFilter = b.dataset.rc; renderRC(); }));
    }

    function renderRadio() {
      if (!L.team.length) { setLive('lv-radio', emptyState('No team drivers found in this session.'), { at: L.at.radio }); return; }
      const seen = new Set();
      const clips = L.radio.filter((x) => {
        if (!x.recording_url || seen.has(x.recording_url) || !/^https:\/\//.test(x.recording_url)) return false;
        seen.add(x.recording_url);
        return true;
      }).sort((a, b) => (parseTime(b.date) || 0) - (parseTime(a.date) || 0));
      if (!clips.length) { setLive('lv-radio', emptyState('No team radio published for team drivers in this session.'), { at: L.at.radio }); return; }
      setLive('lv-radio', `<ul class="radio-list">${clips.slice(0, 40).map((c) => `
        <li>
          <div class="radio-meta"><span class="code">${esc(drvLabel(c.driver_number))}</span><span class="muted tnum">${esc(fmtClock(parseTime(c.date)))}</span></div>
          <audio controls preload="none" src="${esc(c.recording_url)}"></audio>
        </li>`).join('')}</ul>${clips.length > 40 ? note(`Showing the latest 40 of ${clips.length} clips.`) : ''}`, { at: L.at.radio });
    }

    function renderStints() {
      if (!L.stints.size) { setLive('lv-stints', emptyState('No tyre stint data for this session yet.'), { at: L.at.stints }); return; }
      let total = 0;
      for (const list of L.stints.values()) for (const s of list) total = Math.max(total, num(s.lap_end) || num(s.lap_start) || 0);
      if (!total) total = 1;
      const order = Array.from(L.drivers.values())
        .map((d) => ({ d, pos: L.pos.get(d.driver_number) ? num(L.pos.get(d.driver_number).position) : null }))
        .sort((a, b) => (a.pos == null ? Infinity : a.pos) - (b.pos == null ? Infinity : b.pos));
      const tn = teamNums();
      const rows = order.filter((x) => L.stints.has(x.d.driver_number)).map((x) => {
        const segs = L.stints.get(x.d.driver_number).map((s) => {
          const a = num(s.lap_start) || 1;
          const b = num(s.lap_end) != null ? num(s.lap_end) : total;
          const w = Math.max(0, ((b - a + 1) / total) * 100);
          const left = ((a - 1) / total) * 100;
          return `<span class="seg-tyre tyre-${TYRE_CLASS(s.compound)}" style="left:${left.toFixed(2)}%;width:${w.toFixed(2)}%" title="${esc(`${s.compound || 'Unknown'}: laps ${a}-${b}`)}">${w > 7 ? esc(String(s.compound || '?').charAt(0)) : ''}</span>`;
        }).join('');
        return `<li class="${tn.has(x.d.driver_number) ? 'is-team' : ''}"><span class="code">${esc(x.d.name_acronym || x.d.driver_number)}</span><span class="stint-track">${segs}</span></li>`;
      }).join('');
      setLive('lv-stints', `<ul class="stints">${rows}</ul>
        <div class="tyre-key">${['SOFT', 'MEDIUM', 'HARD', 'INTERMEDIATE', 'WET'].map((c) => `<span><span class="tyre tyre-${TYRE_CLASS(c)}">${c.charAt(0)}</span> ${c.charAt(0) + c.slice(1).toLowerCase()}</span>`).join('')}</div>
        <p class="muted small">Lap 1 to lap ${total}</p>`, { at: L.at.stints });
    }

    function teleCard(d, i) {
      const n = d.driver_number;
      const colour = drvColour(n, i);
      if (L.mode === 'live') {
        const samples = L.car.get(n) || [];
        if (!samples.length) return `<article class="tele-card" style="--c:${esc(colour)}"><header><span class="code">${esc(d.name_acronym)}</span><span class="muted">${esc(d.full_name || '')}</span></header>${emptyState('No live car data received yet.')}</article>`;
        const cur = samples[samples.length - 1];
        const ser = (k) => samples.map((x) => num(x[k]));
        return `<article class="tele-card" style="--c:${esc(colour)}">
          <header><span class="code">${esc(d.name_acronym)}</span><span class="muted">${esc(d.full_name || '')}</span><span class="muted small tnum">last sample ${esc(fmtClock(parseTime(cur.date)))}</span></header>
          <div class="tele-grid">
            ${stat('Speed', `${esc(cur.speed != null ? cur.speed : '-')} <small>km/h</small>`, sparkline(ser('speed'), { min: 0 }))}
            ${stat('Throttle', `${esc(cur.throttle != null ? cur.throttle : '-')}<small>%</small>`, sparkline(ser('throttle'), { min: 0, max: 100 }))}
            ${stat('Brake', `${esc(cur.brake != null ? cur.brake : '-')}<small>%</small>`, sparkline(ser('brake'), { min: 0, max: 100, cls: 'spark-brake' }))}
            ${stat('RPM', esc(cur.rpm != null ? cur.rpm : '-'), sparkline(ser('rpm')))}
            ${stat('Gear', esc(cur.n_gear != null ? cur.n_gear : '-'), sparkline(ser('n_gear'), { min: 0 }))}
            ${stat('DRS', esc(drsLabel(num(cur.drs))))}
          </div>
          <p class="muted small">Rolling window of the most recent ${samples.length} samples.</p>
        </article>`;
      }
      const f = L.fastest.get(n);
      if (!f || !f.lap) return `<article class="tele-card" style="--c:${esc(colour)}"><header><span class="code">${esc(d.name_acronym)}</span><span class="muted">${esc(d.full_name || '')}</span></header>${emptyState('No timed lap recorded in this session.')}</article>`;
      const s = f.samples || [];
      if (!s.length) return `<article class="tele-card" style="--c:${esc(colour)}"><header><span class="code">${esc(d.name_acronym)}</span><span class="muted">${esc(d.full_name || '')}</span></header>${emptyState(`Fastest lap ${fmtLap(f.lap.lap_duration)} (lap ${f.lap.lap_number}) - no car data published for it.`)}</article>`;
      const vals = (k) => s.map((x) => num(x[k]));
      const nonNull = (arr) => arr.filter((x) => x != null);
      const speeds = nonNull(vals('speed'));
      const thr = nonNull(vals('throttle'));
      const brk = nonNull(vals('brake'));
      const rpm = nonNull(vals('rpm'));
      const gears = nonNull(vals('n_gear'));
      const avg = (a) => (a.length ? a.reduce((p, c) => p + c, 0) / a.length : null);
      const share = (a, pred) => (a.length ? (a.filter(pred).length / a.length) * 100 : null);
      const drsVals = nonNull(vals('drs'));
      return `<article class="tele-card" style="--c:${esc(colour)}">
        <header><span class="code">${esc(d.name_acronym)}</span><span class="muted">${esc(d.full_name || '')}</span><span class="muted small tnum">fastest lap ${esc(fmtLap(f.lap.lap_duration))} &middot; lap ${esc(f.lap.lap_number)}</span></header>
        <div class="trace">
          <div class="trace-row"><span class="trace-lab">Speed</span>${sparkline(vals('speed'), { min: 0, cls: 'spark-lg' })}</div>
          <div class="trace-row"><span class="trace-lab">Throttle</span>${sparkline(vals('throttle'), { min: 0, max: 100 })}</div>
          <div class="trace-row"><span class="trace-lab">Brake</span>${sparkline(vals('brake'), { min: 0, max: 100, cls: 'spark-brake' })}</div>
          <div class="trace-row"><span class="trace-lab">RPM</span>${sparkline(vals('rpm'))}</div>
          <div class="trace-row"><span class="trace-lab">Gear</span>${sparkline(vals('n_gear'), { min: 0 })}</div>
        </div>
        <div class="tele-grid">
          ${stat('Top speed', speeds.length ? `${Math.max(...speeds)} <small>km/h</small>` : '-')}
          ${stat('Avg speed', speeds.length ? `${avg(speeds).toFixed(0)} <small>km/h</small>` : '-')}
          ${stat('Full throttle', thr.length ? `${share(thr, (x) => x >= 98).toFixed(0)}<small>%</small>` : '-')}
          ${stat('On brake', brk.length ? `${share(brk, (x) => x > 0).toFixed(0)}<small>%</small>` : '-')}
          ${stat('Max RPM', rpm.length ? String(Math.max(...rpm)) : '-')}
          ${stat('DRS', drsVals.length ? `${share(drsVals, (x) => x === 10 || x === 12 || x === 14).toFixed(0)}<small>% open</small>` : 'n/a', drsVals.length ? '' : 'not reported')}
        </div>
        <p class="muted small">${s.length} samples, top gear ${gears.length ? Math.max(...gears) : '-'}.</p>
      </article>`;
    }
    function renderTele() {
      if (!L.team.length) { setLive('lv-tele', emptyState('No team drivers found in this session.'), { at: L.at.car }); return; }
      setLive('lv-tele', `<div class="tele-cards">${L.team.map(teleCard).join('')}</div>`, { at: L.at.car });
    }

    /* ---------------- merges ---------------- */
    function mergePositions(rows) {
      for (const row of rows) {
        const prev = L.pos.get(row.driver_number);
        const t = parseTime(row.date);
        if (!prev || (t != null && t >= prev._t)) L.pos.set(row.driver_number, Object.assign({}, row, { _t: t }));
      }
      L.posLast = maxDateRaw(rows, L.posLast);
    }
    function mergeIntervals(rows) {
      const sorted = rows.slice().sort((a, b) => (parseTime(a.date) || 0) - (parseTime(b.date) || 0));
      for (const row of sorted) {
        const prev = L.ints.get(row.driver_number) || {};
        const next = Object.assign({}, prev, { date: row.date });
        if (row.gap_to_leader != null) next.gap_to_leader = row.gap_to_leader;
        if (row.interval != null) next.interval = row.interval;
        L.ints.set(row.driver_number, next);
      }
      L.intsLast = maxDateRaw(rows, L.intsLast);
    }
    function mergeLaps(rows) {
      for (const lp of rows) {
        if (!L.laps.has(lp.driver_number)) L.laps.set(lp.driver_number, new Map());
        L.laps.get(lp.driver_number).set(lp.lap_number, lp);
      }
    }
    function setStints(rows) {
      L.stints = new Map();
      for (const s of rows.slice().sort((a, b) => (a.stint_number || 0) - (b.stint_number || 0))) {
        if (!L.stints.has(s.driver_number)) L.stints.set(s.driver_number, []);
        L.stints.get(s.driver_number).push(s);
      }
    }
    const byDate = (a, b) => (parseTime(a.date) || 0) - (parseTime(b.date) || 0);

    /* ---------------- initial load ---------------- */
    async function step(ids, fn) {
      try { await fn(); } catch (e) {
        if (e === STOP) throw e;
        if (tok !== routeToken) throw STOP;
        console.error(e);
        ids.forEach((id) => {
          L.failed[id] = (e && e.message) || 'request failed';
          panelError(id, e, () => route());
        });
      }
      guard(tok);
    }

    try {
      await step([], async () => {
        const [m, ms] = await Promise.all([
          oget('meetings', { meeting_key: S.meeting_key }, { ttl: TTL.schedule, persist: true }),
          oget('sessions', { meeting_key: S.meeting_key }, { ttl: TTL.short })
        ]);
        L.meeting = m.data[0] || null;
        L.meetingSessions = ms.data;
      });
      renderHead();

      await step(ALL, async () => {
        const e = await oget('drivers', { session_key: sk }, L.mode === 'live' ? { ttl: TTL.short } : ttlFinal);
        for (const d of e.data) L.drivers.set(d.driver_number, d);
        L.team = e.data.filter((d) => isTeamName(d.team_name)).sort((a, b) => a.driver_number - b.driver_number);
        L.at.drivers = e.at;
        applyOpenF1Colours(e.data);
      });
      if (!L.drivers.size) {
        ALL.forEach((id) => setPanel(id, emptyState('OpenF1 has not published data for this session yet.'), { at: L.at.drivers }));
      }

      await step(['lv-board'], async () => {
        const e = await oget('position', { session_key: sk }, ttlFinal);
        mergePositions(e.data);
        L.at.pos = e.at;
        renderBoard();
      });

      await step(['lv-weather'], async () => {
        const e = await oget('weather', { session_key: sk }, ttlFinal);
        L.weather = e.data.slice().sort(byDate);
        L.wLast = maxDateRaw(e.data, null);
        L.at.weather = e.at;
        renderWeather();
      });

      await step(['lv-rc'], async () => {
        const e = await oget('race_control', { session_key: sk }, ttlFinal);
        L.rc = e.data.slice().sort(byDate);
        L.rcLast = maxDateRaw(e.data, null);
        L.at.rc = e.at;
        noteRaceControl(S, L.rc);
        if (endMarks.has(String(sk))) renderHead();
        renderRC();
      });

      // Laps: full session for timed sessions; leader + team drivers for races.
      await step(['lv-board', 'lv-tele'], async () => {
        if (!L.isRace) {
          const e = await oget('laps', { session_key: sk }, L.mode === 'live' ? { ttl: 0 } : ttlFinal);
          mergeLaps(e.data);
          L.at.laps = e.at;
        } else {
          const leader = Array.from(L.pos.values()).find((p) => num(p.position) === 1);
          const nums = uniq([leader ? leader.driver_number : null, ...L.team.map((d) => d.driver_number)].filter((x) => x != null));
          for (const n of nums) {
            const e = await oget('laps', { session_key: sk, driver_number: n }, L.mode === 'live' ? { ttl: 0 } : ttlFinal);
            mergeLaps(e.data);
            L.at.laps = e.at;
            guard(tok);
          }
        }
        renderBoard();
      });

      if (L.isRace) {
        await step(['lv-board'], async () => {
          if (L.mode === 'live') {
            const e = await oget('intervals', { session_key: sk, 'date>=': isoAt(Date.now() - MIN) }, { ttl: 0 });
            mergeIntervals(e.data);
            L.at.ints = e.at;
            renderBoard();
            return;
          }
          // Final gaps: anchor on the end of the race. Independent anchors are tried in turn (the
          // race-control finish, the last completed lap we hold, the last position update), so a
          // slow or failed laps request or an overrun past the scheduled end does not lose the gaps.
          let lapMax = null;
          for (const laps of L.laps.values()) for (const lp of laps.values()) { const t = lapEnd(lp); if (t != null && (lapMax == null || t > lapMax)) lapMax = t; }
          const anchors = uniq([endMarks.get(String(sk)), lapMax, parseTime(L.posLast)].filter((t) => t != null && Number.isFinite(t)));
          if (!anchors.length) return;
          let e = null;
          for (const a of anchors) {
            e = await oget('intervals', { session_key: sk, 'date>=': isoAt(a - 3 * MIN), 'date<=': isoAt(a + 5 * MIN) }, ttlFinal);
            guard(tok);
            if (e.data.length) break;
          }
          if (!e.data.length) {
            e = await oget('intervals', { session_key: sk, 'date>=': isoAt(anchors[0] - 20 * MIN), 'date<=': isoAt(anchors[0] + 10 * MIN) }, ttlFinal);
          }
          mergeIntervals(e.data);
          L.at.ints = e.at;
          renderBoard();
        });
      }

      await step(['lv-stints'], async () => {
        const e = await oget('stints', { session_key: sk }, ttlFinal);
        setStints(e.data);
        L.at.stints = e.at;
        renderStints();
        renderBoard();
      });

      await step(['lv-pits'], async () => {
        const e = await oget('pit', { session_key: sk }, ttlFinal);
        L.pits = e.data.slice().sort(byDate);
        L.pitLast = maxDateRaw(e.data, null);
        L.at.pits = e.at;
        renderPits();
        renderBoard();
      });

      await step(['lv-tele'], async () => {
        if (L.mode === 'live') {
          for (const d of L.team) {
            const e = await oget('car_data', { session_key: sk, driver_number: d.driver_number, 'date>=': isoAt(Date.now() - MIN) }, { ttl: 0 });
            L.car.set(d.driver_number, e.data.slice().sort(byDate));
            L.carLast.set(d.driver_number, maxDateRaw(e.data, null));
            L.at.car = e.at;
            guard(tok);
          }
        } else {
          for (const d of L.team) {
            const laps = Array.from((L.laps.get(d.driver_number) || new Map()).values())
              .filter((lp) => lp.lap_duration != null && !lp.is_pit_out_lap && lp.date_start);
            const best = laps.reduce((m, lp) => (!m || lp.lap_duration < m.lap_duration ? lp : m), null);
            if (!best) { L.fastest.set(d.driver_number, { lap: null, samples: [] }); continue; }
            const t0 = parseTime(best.date_start);
            const e = await oget('car_data', { session_key: sk, driver_number: d.driver_number, 'date>=': isoAt(t0), 'date<=': isoAt(t0 + best.lap_duration * SEC) }, ttlFinal);
            L.fastest.set(d.driver_number, { lap: best, samples: e.data.slice().sort(byDate) });
            L.at.car = e.at;
            guard(tok);
          }
        }
        renderTele();
      });

      await step(['lv-radio'], async () => {
        const e = await oget('team_radio', { session_key: sk }, ttlFinal);
        const tn = teamNums();
        L.radio = e.data.filter((x) => tn.has(x.driver_number));
        L.radioLast = maxDateRaw(e.data, null);
        L.at.radio = e.at;
        renderRadio();
      });
    } catch (e) {
      if (e === STOP) return;
      console.error(e);
    }

    /* ---------------- live polling ---------------- */
    if (L.mode !== 'live') return;
    const since = (raw) => raw || isoAt(Date.now() - MIN);
    L.tasks = [
      async () => { const e = await oget('position', { session_key: sk, 'date>': since(L.posLast) }); mergePositions(e.data); L.at.pos = e.at; renderBoard(); },
      L.isRace
        ? async () => { const e = await oget('intervals', { session_key: sk, 'date>': since(L.intsLast) }); mergeIntervals(e.data); L.at.ints = e.at; renderBoard(); }
        : async () => {
          // Poll by lap start time, not lap number: lap counts differ widely between drivers, so a
          // lap-number cut-off would starve anyone running fewer laps than the busiest car. The
          // lookback re-fetches recent laps so lap_duration fills in once each lap completes.
          let latest = null;
          for (const laps of L.laps.values()) for (const lp of laps.values()) { const t = parseTime(lp.date_start); if (t != null && (latest == null || t > latest)) latest = t; }
          const params = { session_key: sk };
          if (latest != null) params['date_start>='] = isoAt(latest - LAP_LOOKBACK_MS);
          const e = await oget('laps', params);
          mergeLaps(e.data); L.at.laps = e.at; renderBoard();
        },
      ...L.team.map((d) => async () => {
        const n = d.driver_number;
        const e = await oget('car_data', { session_key: sk, driver_number: n, 'date>': since(L.carLast.get(n)) });
        const merged = (L.car.get(n) || []).concat(e.data).sort(byDate);
        const lastT = parseTime(merged.length ? merged[merged.length - 1].date : null);
        L.car.set(n, lastT == null ? merged : merged.filter((x) => (parseTime(x.date) || 0) >= lastT - MIN));
        L.carLast.set(n, maxDateRaw(e.data, L.carLast.get(n)));
        L.at.car = e.at;
        renderTele();
      }),
      async () => {
        const e = await oget('race_control', { session_key: sk, 'date>': since(L.rcLast) });
        L.rc = L.rc.concat(e.data).sort(byDate);
        L.rcLast = maxDateRaw(e.data, L.rcLast);
        L.at.rc = e.at;
        noteRaceControl(S, L.rc);
        renderRC();
      },
      async () => { const e = await oget('weather', { session_key: sk, 'date>': since(L.wLast) }); L.weather = L.weather.concat(e.data).sort(byDate); L.wLast = maxDateRaw(e.data, L.wLast); L.at.weather = e.at; renderWeather(); },
      async () => { const e = await oget('stints', { session_key: sk }); setStints(e.data); L.at.stints = e.at; renderStints(); },
      async () => { const e = await oget('pit', { session_key: sk, 'date>': since(L.pitLast) }); L.pits = L.pits.concat(e.data).sort(byDate); L.pitLast = maxDateRaw(e.data, L.pitLast); L.at.pits = e.at; renderPits(); },
      async () => {
        const e = await oget('team_radio', { session_key: sk, 'date>': since(L.radioLast) });
        const tn = teamNums();
        L.radio = L.radio.concat(e.data.filter((x) => tn.has(x.driver_number)));
        L.radioLast = maxDateRaw(e.data, L.radioLast);
        L.at.radio = e.at;
        renderRadio();
      }
    ];
    async function tick() {
      if (L.busy || tok !== routeToken) return;
      // Stop as soon as race control reports the finish (or the hard cap passes), not at a fixed time.
      if (!inLiveWindow(S)) { stop(); L.mode = 'final'; L.endedWhileOpen = true; renderHead(); return; }
      L.busy = true;
      const task = L.tasks[L.ti % L.tasks.length];
      L.ti++;
      try {
        await task();
        L.authFails = 0;
        L.pollMsg = '';
        L.lastPoll = Date.now();
      } catch (e) {
        L.pollMsg = (e && e.message) || 'update failed';
        if (e && (e.status === 401 || e.status === 403)) {
          L.authFails++;
          if (L.authFails >= 3) { L.stopped = true; stop(); }
        }
      } finally {
        L.busy = false;
        if (tok === routeToken) renderPollLine();
      }
    }
    function start() {
      if (L.timer || L.stopped || L.mode !== 'live' || document.visibilityState !== 'visible') return;
      L.timer = setInterval(tick, LIVE_POLL_MS);
    }
    function stop() {
      if (L.timer) clearInterval(L.timer);
      L.timer = null;
    }
    const onVis = () => {
      if (document.visibilityState === 'visible') start(); else stop();
      renderPollLine();
    };
    document.addEventListener('visibilitychange', onVis);
    onLeave(() => { stop(); document.removeEventListener('visibilitychange', onVis); });
    start();
    renderPollLine();
  }

  /* ================================================================== */
  /* Lap comparison (OpenF1) - shared by Compare and Archive             */
  /* ================================================================== */
  async function lapCompare(id, session, jA, jB, tok) {
    setPanel(id, skeleton(6));
    const isRaceType = session.session_type === 'Race';
    try {
      const drivers = await getSessionDrivers(session);
      if (tok !== routeToken) return;
      applyOpenF1Colours(drivers.data);
      const a = matchOpenF1Driver(jA, drivers.data);
      const b = matchOpenF1Driver(jB, drivers.data);
      const missing = [!a ? driverName(jA) : null, !b ? driverName(jB) : null].filter(Boolean);
      if (missing.length) {
        setPanel(id, emptyState(`${missing.join(' and ')} did not take part in ${session.session_name}, so there are no laps to compare.`), drivers);
        return;
      }
      const [la, lb] = [await getDriverLaps(session, a.driver_number), await getDriverLaps(session, b.driver_number)];
      if (tok !== routeToken) return;
      const lapsA = la.data.slice().sort((x, y) => x.lap_number - y.lap_number);
      const lapsB = lb.data.slice().sort((x, y) => x.lap_number - y.lap_number);
      if (!lapsA.length && !lapsB.length) {
        setPanel(id, emptyState('OpenF1 has no lap data for this session.'), metaOf(la, lb));
        return;
      }
      const colA = validHex('#' + String(a.team_colour || '').replace('#', '')) || fallbackColour(0);
      let colB = validHex('#' + String(b.team_colour || '').replace('#', '')) || fallbackColour(3);
      const dashB = colA === colB;
      const timed = (laps) => laps.filter((lp) => lp.lap_duration != null && Number.isFinite(lp.lap_duration));
      const bestOf = (laps) => timed(laps).filter((lp) => !lp.is_pit_out_lap).reduce((m, lp) => (!m || lp.lap_duration < m.lap_duration ? lp : m), null);
      const bestA = bestOf(lapsA);
      const bestB = bestOf(lapsB);
      // "Clean" laps: not a pit-out lap and within 107% of the driver's own best lap.
      const clean = (laps, best) => timed(laps).filter((lp) => !lp.is_pit_out_lap && best && lp.lap_duration <= best.lap_duration * 1.07);
      const avg = (laps) => (laps.length ? laps.reduce((s, lp) => s + lp.lap_duration, 0) / laps.length : null);
      const minOf = (laps, k) => {
        const v = laps.map((lp) => num(lp[k])).filter((x) => x != null);
        return v.length ? Math.min(...v) : null;
      };
      const maxOf = (laps, k) => {
        const v = laps.map((lp) => num(lp[k])).filter((x) => x != null);
        return v.length ? Math.max(...v) : null;
      };
      const cA = clean(lapsA, bestA);
      const cB = clean(lapsB, bestB);
      const row = (label, va, vb, f, lowerIsBetter) => {
        const better = va != null && vb != null && va !== vb ? ((lowerIsBetter ? va < vb : va > vb) ? 'a' : 'b') : null;
        return `<tr><td class="muted">${esc(label)}</td><td class="tnum ${better === 'a' ? 'strong win' : ''}">${f(va)}</td><td class="tnum ${better === 'b' ? 'strong win' : ''}">${f(vb)}</td></tr>`;
      };
      const html = `
        <div class="table-wrap"><table class="table compare-table compare-narrow">
          <thead><tr><th>${esc(session.session_name)}</th><th><span class="stripe" style="--c:${esc(colA)}"></span>${esc(a.name_acronym)}</th><th><span class="stripe" style="--c:${esc(colB)}"></span>${esc(b.name_acronym)}</th></tr></thead>
          <tbody>
            ${row('Best lap', bestA ? bestA.lap_duration : null, bestB ? bestB.lap_duration : null, fmtLap, true)}
            ${row('Average clean lap', avg(cA), avg(cB), fmtLap, true)}
            ${row('Best sector 1', minOf(cA, 'duration_sector_1'), minOf(cB, 'duration_sector_1'), (v) => (v == null ? '-' : v.toFixed(3)), true)}
            ${row('Best sector 2', minOf(cA, 'duration_sector_2'), minOf(cB, 'duration_sector_2'), (v) => (v == null ? '-' : v.toFixed(3)), true)}
            ${row('Best sector 3', minOf(cA, 'duration_sector_3'), minOf(cB, 'duration_sector_3'), (v) => (v == null ? '-' : v.toFixed(3)), true)}
            ${row('Top speed trap (km/h)', maxOf(lapsA, 'st_speed'), maxOf(lapsB, 'st_speed'), (v) => (v == null ? '-' : String(v)), false)}
            ${row('Laps completed', lapsA.length, lapsB.length, (v) => String(v), false)}
          </tbody></table></div>
        <div class="chart-head"><h3>Lap times</h3>
          <label class="check"><input type="checkbox" data-clean checked> Hide pit and slow laps (over 107% of own best)</label></div>
        <div class="chart" data-chart-laps></div>
        ${isRaceType ? `<div class="chart-head"><h3>Gap between drivers</h3></div><div class="chart" data-chart-gap></div>
        ${note(`Time between the two cars crossing the line at the start of each lap. Above zero means ${a.name_acronym} is behind ${b.name_acronym}.`)}` : ''}`;
      const el = setPanel(id, html, Object.assign(metaOf(drivers, la, lb), { note: `session key ${session.session_key}` }));
      if (!el) return;
      const drawLaps = (onlyClean) => {
        const sel = (laps, best) => (onlyClean ? clean(laps, best) : timed(laps));
        mountChart($('[data-chart-laps]', el), {
          label: 'Lap time comparison',
          series: [
            { label: `${a.name_acronym} - ${a.full_name || ''}`, short: a.name_acronym, color: colA, points: sel(lapsA, bestA).map((lp) => ({ x: lp.lap_number, y: lp.lap_duration, title: `${a.name_acronym} lap ${lp.lap_number}: ${fmtLap(lp.lap_duration)}` })) },
            { label: `${b.name_acronym} - ${b.full_name || ''}`, short: b.name_acronym, color: colB, dash: dashB, points: sel(lapsB, bestB).map((lp) => ({ x: lp.lap_number, y: lp.lap_duration, title: `${b.name_acronym} lap ${lp.lap_number}: ${fmtLap(lp.lap_duration)}` })) }
          ],
          xFmt: (v) => `L${v}`,
          yFmt: (v) => fmtLap(v),
          yWidth: 64,
          emptyText: 'No timed laps to plot.'
        });
      };
      drawLaps(true);
      $('[data-clean]', el).addEventListener('change', (e) => drawLaps(e.target.checked));
      if (isRaceType) {
        const startsB = new Map(lapsB.map((lp) => [lp.lap_number, parseTime(lp.date_start)]));
        const pts = [];
        for (const lp of lapsA) {
          const ta = parseTime(lp.date_start);
          const tb = startsB.get(lp.lap_number);
          if (ta == null || tb == null) continue;
          const g = (ta - tb) / SEC;
          pts.push({ x: lp.lap_number, y: g, title: `Lap ${lp.lap_number}: ${fmtSigned(g, 3)}s` });
        }
        mountChart($('[data-chart-gap]', el), {
          label: 'Gap between drivers by lap',
          series: [{ label: `${a.name_acronym} relative to ${b.name_acronym}`, short: `${a.name_acronym} gap`, color: colA, points: pts }],
          includeZero: true,
          xFmt: (v) => `L${v}`,
          yFmt: (v) => `${fmtSigned(v, 1)}s`,
          yWidth: 60,
          emptyText: 'The drivers have no common laps with start times.'
        });
      }
    } catch (e) {
      if (tok !== routeToken) return;
      console.error(e);
      panelError(id, e, () => lapCompare(id, session, jA, jB, tok));
    }
  }

  /* ================================================================== */
  /* Compare                                                             */
  /* ================================================================== */
  ROUTES.compare = { title: 'Compare', fn: pageCompare };

  async function pageCompare(root, r, tok) {
    root.innerHTML = pageHead('Compare', 'A team driver against any driver on the grid, over the season and lap by lap.', 'Analysis') + `
      <section class="panel controls" id="cmp-controls" aria-busy="true"><div class="panel-body">${skeleton(2)}</div></section>
      ${panel('cmp-h2h', 'Season head-to-head', 'Jolpica')}
      ${panel('cmp-laps', 'Lap comparison', 'OpenF1')}`;
    let ds, team, season, teamDrivers;
    try {
      season = await currentSeason();
      [ds, team] = await Promise.all([getDriverStandings('current'), getTeamResults('current')]);
      guard(tok);
      teamDrivers = sortByStanding((await resolveTeamDrivers(season, team.races)).drivers, ds.list);
      guard(tok);
    } catch (e) {
      if (e === STOP) return;
      const c = document.getElementById('cmp-controls');
      if (c) c.innerHTML = `<div class="panel-body"><div class="state state-error" role="alert"><p><strong>Live data could not be loaded.</strong></p><p class="muted">${esc(e.message)}</p><button class="btn" type="button" id="cmp-retry">Retry</button></div></div>`;
      const b = document.getElementById('cmp-retry');
      if (b) b.addEventListener('click', () => route());
      setPanel('cmp-h2h', emptyState('Waiting for driver list.'), { note: 'driver list unavailable' });
      setPanel('cmp-laps', emptyState('Waiting for driver list.'), { note: 'driver list unavailable' });
      return;
    }
    const field = ds.list.map((s) => s.Driver);
    teamDrivers.forEach((d) => { if (!field.some((f) => f.driverId === d.driverId)) field.push(d); });
    if (!teamDrivers.length || field.length < 2) {
      document.getElementById('cmp-controls').innerHTML = `<div class="panel-body">${emptyState('Not enough drivers with results this season to compare yet.')}</div>`;
      setPanel('cmp-h2h', emptyState('No data yet.'), metaOf(ds, team));
      setPanel('cmp-laps', emptyState('No data yet.'), metaOf(ds, team));
      return;
    }
    const sel = { a: teamDrivers[0].driverId, b: null, session: null };
    const defaultB = () => {
      const leader = ds.list.find((s) => s.Driver.driverId !== sel.a);
      return leader ? leader.Driver.driverId : field.find((f) => f.driverId !== sel.a).driverId;
    };
    sel.b = r.query.get('b') && field.some((f) => f.driverId === r.query.get('b')) ? r.query.get('b') : defaultB();
    if (r.query.get('a') && teamDrivers.some((d) => d.driverId === r.query.get('a'))) sel.a = r.query.get('a');
    if (sel.a === sel.b) sel.b = defaultB();

    const controls = document.getElementById('cmp-controls');
    controls.setAttribute('aria-busy', 'false');
    controls.innerHTML = `<div class="panel-body controls-row">
      <label class="field"><span>Team driver</span><select id="cmp-a">${teamDrivers.map((d) => `<option value="${esc(d.driverId)}">${esc(driverName(d))}</option>`).join('')}</select></label>
      <span class="vs" aria-hidden="true">vs</span>
      <label class="field"><span>Compare with</span><select id="cmp-b"></select></label>
      <label class="field field-wide"><span>Session for lap comparison</span><select id="cmp-s"><option value="">Loading sessions</option></select></label>
    </div>`;
    const selA = $('#cmp-a');
    const selB = $('#cmp-b');
    const selS = $('#cmp-s');
    const fillB = () => {
      selB.innerHTML = field.filter((f) => f.driverId !== sel.a).map((f) => `<option value="${esc(f.driverId)}" ${f.driverId === sel.b ? 'selected' : ''}>${esc(driverName(f))}</option>`).join('');
    };
    selA.value = sel.a;
    fillB();
    const drvById = (id) => field.find((f) => f.driverId === id);

    let sessions = [];
    const runLaps = () => {
      const s = sessions.find((x) => String(x.session_key) === String(sel.session));
      if (!s) { setPanel('cmp-laps', emptyState('Choose a completed session to compare lap times.'), { note: 'awaiting session choice' }); return; }
      lapCompare('cmp-laps', s, drvById(sel.a), drvById(sel.b), tok);
    };
    const runH2H = () => load('cmp-h2h', () => headToHead(season, drvById(sel.a), drvById(sel.b), ds), tok);
    selA.addEventListener('change', () => { sel.a = selA.value; if (sel.b === sel.a) sel.b = defaultB(); fillB(); runH2H(); runLaps(); });
    selB.addEventListener('change', () => { sel.b = selB.value; runH2H(); runLaps(); });
    selS.addEventListener('change', () => { sel.session = selS.value; runLaps(); });
    runH2H();

    try {
      const [se, me] = await Promise.all([getYearSessions(season), getYearMeetings(season).catch(() => ({ data: [] }))]);
      guard(tok);
      const meetings = new Map(me.data.map((m) => [m.meeting_key, m]));
      // Sessions inside their live window are confirmed against race control before being offered.
      for (const s of se.data) if (sessionStatus(s) === 'live') await resolveSessionStatus(s);
      guard(tok);
      sessions = se.data
        .filter((s) => sessionStatus(s) === 'done' && !/^day\b/i.test(s.session_name || ''))
        .sort((a, b) => (parseTime(b.date_start) || 0) - (parseTime(a.date_start) || 0));
      if (!sessions.length) {
        selS.innerHTML = '<option value="">No completed sessions</option>';
        setPanel('cmp-laps', emptyState('OpenF1 has no completed sessions for this season yet.'), se);
        return;
      }
      const label = (s) => {
        const m = meetings.get(s.meeting_key);
        return `${m ? m.meeting_name : s.location} - ${s.session_name} (${fmtDate(parseTime(s.date_start))})`;
      };
      const def = sessions.find((s) => s.session_type === 'Race') || sessions[0];
      sel.session = String(def.session_key);
      selS.innerHTML = sessions.map((s) => `<option value="${esc(s.session_key)}" ${String(s.session_key) === sel.session ? 'selected' : ''}>${esc(label(s))}</option>`).join('');
      runLaps();
    } catch (e) {
      if (e === STOP) return;
      selS.innerHTML = '<option value="">Sessions unavailable</option>';
      panelError('cmp-laps', e, () => route());
    }
  }

  async function headToHead(season, A, B, ds) {
    const [ra, qa, rb, qb] = await Promise.all([
      getDriverResults(season, A.driverId), getDriverQualifying(season, A.driverId),
      getDriverResults(season, B.driverId), getDriverQualifying(season, B.driverId)
    ]);
    const sa = driverSeasonStats(A.driverId, ra.races, qa.races);
    const sb = driverSeasonStats(B.driverId, rb.races, qb.races);
    const stA = standingFor(ds.list, A.driverId);
    const stB = standingFor(ds.list, B.driverId);
    const rounds = uniq([...ra.races, ...rb.races, ...qa.races, ...qb.races].map((x) => Number(x.round))).sort((x, y) => x - y);
    const get = (list, rd) => list.find((x) => Number(x.round) === rd);
    let raceA = 0, raceB = 0, qA = 0, qB = 0;
    const lines = rounds.map((rd) => {
      const rA = findResult(get(ra.races, rd), A.driverId);
      const rB = findResult(get(rb.races, rd), B.driverId);
      const xA = findResult(get(qa.races, rd), A.driverId, 'QualifyingResults');
      const xB = findResult(get(qb.races, rd), B.driverId, 'QualifyingResults');
      const info = get(ra.races, rd) || get(rb.races, rd) || get(qa.races, rd) || get(qb.races, rd);
      let qWin = null;
      let rWin = null;
      if (xA && xB) { if (num(xA.position) < num(xB.position)) { qA++; qWin = 'a'; } else if (num(xB.position) < num(xA.position)) { qB++; qWin = 'b'; } }
      if (rA && rB) { if (num(rA.position) < num(rB.position)) { raceA++; rWin = 'a'; } else if (num(rB.position) < num(rA.position)) { raceB++; rWin = 'b'; } }
      return `<tr>
        <td class="tnum">${rd}</td><td>${esc(info ? info.raceName.replace(/ Grand Prix$/, ' GP') : '')}</td>
        <td class="tnum ${qWin === 'a' ? 'win' : ''}">${xA ? 'P' + esc(xA.position) : '-'}</td><td class="tnum ${qWin === 'b' ? 'win' : ''}">${xB ? 'P' + esc(xB.position) : '-'}</td>
        <td class="tnum ${rWin === 'a' ? 'win' : ''}">${resultCell(rA)}</td><td class="tnum ${rWin === 'b' ? 'win' : ''}">${resultCell(rB)}</td>
      </tr>`;
    }).join('');
    const cmp = (label, va, vb, f, lower) => {
      const better = va != null && vb != null && va !== vb ? ((lower ? va < vb : va > vb) ? 'a' : 'b') : null;
      return `<tr><td class="muted">${esc(label)}</td><td class="tnum ${better === 'a' ? 'strong win' : ''}">${f(va)}</td><td class="tnum ${better === 'b' ? 'strong win' : ''}">${f(vb)}</td></tr>`;
    };
    const i = (v) => (v == null ? '-' : String(v));
    const d1 = (v) => (v == null ? '-' : v.toFixed(1));
    const cA = driverColour(A.code, 0);
    const cB = driverColour(B.code, 3);
    return Object.assign({
      html: `<div class="grid grid-2 grid-tight">
        <div class="table-wrap"><table class="table compare-table">
          <thead><tr><th>Season</th><th>${swatch(cA)}${esc(driverCode(A))}</th><th>${swatch(cB)}${esc(driverCode(B))}</th></tr></thead>
          <tbody>
            ${cmp('Championship position', stA ? num(stA.position) : null, stB ? num(stB.position) : null, (v) => (v == null ? '-' : 'P' + v), true)}
            ${cmp('Points', stA ? num(stA.points) : null, stB ? num(stB.points) : null, fmtPts, false)}
            ${cmp('Qualifying head-to-head', qA, qB, i, false)}
            ${cmp('Race head-to-head', raceA, raceB, i, false)}
            ${cmp('Wins', sa.wins, sb.wins, i, false)}
            ${cmp('Podiums', sa.podiums, sb.podiums, i, false)}
            ${cmp('Poles', sa.poles, sb.poles, i, false)}
            ${cmp('Fastest laps', sa.fastest, sb.fastest, i, false)}
            ${cmp('Average grid', sa.avgGrid, sb.avgGrid, d1, true)}
            ${cmp('Average finish (classified)', sa.avgFinish, sb.avgFinish, d1, true)}
            ${cmp('Best finish', sa.best, sb.best, (v) => (v == null ? '-' : 'P' + v), true)}
            ${cmp('DNF / DNS / DSQ', sa.dnf, sb.dnf, i, true)}
          </tbody></table></div>
        <div class="table-wrap scroll-y"><table class="table compact">
          <thead><tr><th>Rd</th><th>Event</th><th>Q ${esc(driverCode(A))}</th><th>Q ${esc(driverCode(B))}</th><th>R ${esc(driverCode(A))}</th><th>R ${esc(driverCode(B))}</th></tr></thead>
          <tbody>${lines || `<tr><td colspan="6">${emptyState('No rounds completed yet.')}</td></tr>`}</tbody></table></div>
      </div>
      ${note('Head-to-head counts only rounds where both drivers set a qualifying position or took the start.')}`
    }, metaOf(ra, qa, rb, qb, ds));
  }

  /* ================================================================== */
  /* Seasons archive                                                     */
  /* ================================================================== */
  ROUTES.archive = { title: 'Seasons Archive', fn: pageArchive };

  async function pageArchive(root, r, tok) {
    root.innerHTML = pageHead('Seasons Archive', 'Every championship season, round by round.', 'History') + `
      <section class="panel controls" id="ar-controls" aria-busy="true"><div class="panel-body">${skeleton(1)}</div></section>
      <div class="grid grid-archive">
        ${panel('ar-rounds', 'Rounds', 'Jolpica')}
        ${panel('ar-results', 'Results', 'Jolpica')}
      </div>
      <div id="ar-laps-slot"></div>`;
    let seasons;
    let cur;
    try {
      cur = await currentSeason();
      seasons = await getSeasons();
      guard(tok);
    } catch (e) {
      if (e === STOP) return;
      const c = document.getElementById('ar-controls');
      if (c) c.innerHTML = `<div class="panel-body"><div class="state state-error" role="alert"><p><strong>Season list could not be loaded.</strong></p><p class="muted">${esc(e.message)}</p><button class="btn" type="button" id="ar-retry">Retry</button></div></div>`;
      const b = document.getElementById('ar-retry');
      if (b) b.addEventListener('click', () => route());
      setPanel('ar-rounds', emptyState('Waiting for season list.'), { note: 'season list unavailable' });
      setPanel('ar-results', emptyState('Waiting for season list.'), { note: 'season list unavailable' });
      return;
    }
    const year = r.args[0] && seasons.seasons.includes(r.args[0]) ? r.args[0] : (seasons.seasons.includes(cur) ? cur : seasons.seasons[0]);
    const round = r.args[1] && /^\d+$/.test(r.args[1]) ? r.args[1] : null;
    const tag = $('[data-season-tag]', root);
    if (tag) { tag.dataset.fixed = '1'; tag.innerHTML = `Viewing <b>${esc(year)}</b>`; }
    const c = document.getElementById('ar-controls');
    c.setAttribute('aria-busy', 'false');
    c.innerHTML = `<div class="panel-body controls-row">
      <label class="field"><span>Season</span><select id="ar-year">${seasons.seasons.map((s) => `<option value="${esc(s)}" ${s === year ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></label>
      <p class="muted small">${plural(seasons.seasons.length, 'season')} available from Jolpica-F1. Updated ${esc(fmtClock(seasons.at))}.</p>
    </div>`;
    $('#ar-year').addEventListener('change', (e) => { location.hash = `#/archive/${encodeURIComponent(e.target.value)}`; });

    let sched = null;
    load('ar-rounds', async () => {
      const [sch, standing] = await Promise.all([getSchedule(year), getTeamSeasonStanding(year).catch(() => null)]);
      sched = sch;
      if (!sch.races.length) return Object.assign({ html: emptyState(`No rounds listed for ${year}.`) }, sch);
      const now = Date.now();
      const st = standing && standing.standing;
      return Object.assign({
        html: `${st ? `<p class="team-season"><span class="muted">Team in ${esc(year)}:</span> <strong>P${esc(st.position || st.positionText)}</strong> &middot; ${fmtPts(st.points)} pts &middot; ${plural(num(st.wins) || 0, 'win')}</p>` : `<p class="team-season muted">No constructors\u2019 championship entry for the team in ${esc(year)}.</p>`}
          <ol class="round-list">${sch.races.map((x) => {
            const t = ergastTime(x.date, x.time);
            const future = t != null && isPending({ start: t, timed: !!x.time }, now);
            return `<li><a class="${String(x.round) === round ? 'active' : ''} ${future ? 'future' : ''}" href="#/archive/${esc(year)}/${esc(x.round)}" ${String(x.round) === round ? 'aria-current="true"' : ''}>
              <span class="tnum round-n">${esc(x.round)}</span><span class="round-name">${esc(x.raceName)}</span><span class="muted small tnum">${esc(raceDateLabel(x))}</span></a></li>`;
          }).join('')}</ol>`
      }, metaOf(sch, standing));
    }, tok);

    if (!round) {
      setPanel('ar-results', emptyState('Choose a round to see its classification.'), { note: 'awaiting selection' });
      // Offer the most recent completed round, using the cached schedule (no extra request).
      getSchedule(year).then((sch) => {
        if (tok !== routeToken) return;
        const now = Date.now();
        const done = sch.races.filter((x) => { const t = ergastTime(x.date, x.time); return t != null && !isPending({ start: t, timed: !!x.time }, now); });
        const last = done[done.length - 1];
        if (!last) return;
        setPanel('ar-results', `<div class="ar-pick">
          <p class="eyebrow">Most recent completed round</p>
          <a class="ar-pick-link" href="#/archive/${esc(year)}/${esc(last.round)}"><span class="ar-pick-n tnum">${esc(last.round)}</span><span><b>${esc(last.raceName)}</b><span class="muted small block">${esc(last.Circuit ? last.Circuit.circuitName : '')} &middot; ${esc(raceDateLabel(last))}</span></span><span class="ar-pick-go">Open results</span></a>
          <p class="muted small">Or choose any round from the list.</p>
        </div>`, Object.assign(metaOf(sch), { note: 'from the season schedule' }));
      }).catch(() => {});
      return;
    }
    const views = { race: 'Race', sprint: 'Sprint', quali: 'Qualifying' };
    let view = 'race';
    const renderView = () => load('ar-results', async () => {
      let data;
      let key;
      if (view === 'race') { data = await getRoundResults(year, round); key = 'Results'; }
      else if (view === 'sprint') { data = await getRoundSprint(year, round); key = 'SprintResults'; }
      else { data = await getRoundQualifying(year, round); key = 'QualifyingResults'; }
      const race = data.races[0];
      const list = race ? race[key] || [] : [];
      if (!list.length) return Object.assign({ html: tabsHTML() + emptyState(`No ${views[view].toLowerCase()} classification published for this round.`) }, data, { after: bindTabs });
      let table;
      if (key === 'QualifyingResults') {
        table = `<table class="table"><thead><tr><th>Pos</th><th>Driver</th><th class="hide-sm">Constructor</th><th>Q1</th><th class="hide-xs">Q2</th><th class="hide-xs">Q3</th></tr></thead><tbody>
          ${list.map((x) => `<tr class="${x.Constructor && x.Constructor.constructorId === TEAM_ID ? 'is-team' : ''}"><td class="tnum pos">${esc(x.position)}</td><td><span class="cell-main">${esc(driverName(x.Driver))}</span></td><td class="hide-sm muted">${esc(x.Constructor ? x.Constructor.name : '')}</td><td class="tnum">${esc(x.Q1 || '-')}</td><td class="tnum hide-xs">${esc(x.Q2 || '-')}</td><td class="tnum hide-xs">${esc(x.Q3 || '-')}</td></tr>`).join('')}
        </tbody></table>`;
      } else {
        table = `<table class="table"><thead><tr><th>Pos</th><th>Driver</th><th class="hide-sm">Constructor</th><th class="hide-xs">Grid</th><th class="hide-xs">Laps</th><th>Time / status</th><th>Pts</th></tr></thead><tbody>
          ${list.map((x) => `<tr class="${x.Constructor && x.Constructor.constructorId === TEAM_ID ? 'is-team' : ''}"><td class="tnum pos">${esc(x.positionText)}</td><td><span class="cell-main">${esc(driverName(x.Driver))}</span>${x.FastestLap && String(x.FastestLap.rank) === '1' ? ' ' + chip('FL', 'tag') : ''}</td><td class="hide-sm muted">${esc(x.Constructor ? x.Constructor.name : '')}</td><td class="tnum hide-xs">${esc(x.grid === '0' ? 'PL' : x.grid)}</td><td class="tnum hide-xs">${esc(x.laps)}</td><td class="tnum">${esc(x.Time && x.Time.time ? x.Time.time : x.status || '')}</td><td class="tnum strong">${fmtPts(x.points)}</td></tr>`).join('')}
        </tbody></table>`;
      }
      return Object.assign({
        html: `${tabsHTML()}<p class="eyebrow">Round ${esc(race.round)} &middot; ${esc(raceDateLabel(race))}</p><h3 class="card-title">${esc(race.raceName)}</h3>
          <p class="muted small">${esc(race.Circuit ? race.Circuit.circuitName : '')}</p>
          <div class="table-wrap">${table}</div><div id="ar-openf1"></div>`,
        after: (el) => { bindTabs(el); offerLapChart(race, list, key); }
      }, data);
    }, tok);
    const tabsHTML = () => `<div class="seg seg-sm" role="tablist" aria-label="Classification">${Object.keys(views).map((k) => `<button type="button" role="tab" class="seg-btn ${k === view ? 'active' : ''}" aria-selected="${k === view}" data-view="${k}">${views[k]}</button>`).join('')}</div>`;
    function bindTabs(el) {
      $$('[data-view]', el).forEach((b) => b.addEventListener('click', () => { view = b.dataset.view; setPanel('ar-results', skeleton(8)); renderView(); }));
    }
    renderView();

    async function offerLapChart(race, list, key) {
      const lapsHost = document.getElementById('ar-laps-slot');
      if (lapsHost) lapsHost.innerHTML = '';
      const slot = document.getElementById('ar-openf1');
      if (!slot || key === 'QualifyingResults') return;
      const wanted = key === 'SprintResults' ? 'Sprint' : 'Race';
      const startT = key === 'SprintResults' && race.Sprint ? ergastTime(race.Sprint.date, race.Sprint.time) : ergastTime(race.date, race.time);
      let match = null;
      try {
        const e = await getYearSessions(year);
        if (tok !== routeToken) return;
        match = e.data.filter((s) => s.session_name === wanted && startT != null)
          .map((s) => ({ s, d: Math.abs((parseTime(s.date_start) || 0) - startT) }))
          .filter((x) => x.d <= 36 * HOUR)
          .sort((a, b) => a.d - b.d)[0];
      } catch (e) { match = null; }
      if (!match) { slot.innerHTML = note('OpenF1 lap data is not available for this event.'); return; }
      const session = match.s;
      const teamRows = list.filter((x) => x.Constructor && x.Constructor.constructorId === TEAM_ID);
      const defA = (teamRows[0] || list[0]).Driver;
      const defB = (list.find((x) => x.Driver.driverId !== defA.driverId) || {}).Driver;
      if (!defB) { slot.innerHTML = ''; return; }
      slot.innerHTML = `<button type="button" class="btn" id="ar-open-laps">Open lap chart (OpenF1)</button>`;
      $('#ar-open-laps').addEventListener('click', () => {
        const host = document.getElementById('ar-laps-slot');
        if (!host) return;
        const opts = (selId) => list.map((x) => `<option value="${esc(x.Driver.driverId)}" ${x.Driver.driverId === selId ? 'selected' : ''}>${esc(driverName(x.Driver))}</option>`).join('');
        host.innerHTML = `<section class="panel controls"><div class="panel-body controls-row">
            <label class="field"><span>Driver A</span><select id="ar-la">${opts(defA.driverId)}</select></label>
            <span class="vs" aria-hidden="true">vs</span>
            <label class="field"><span>Driver B</span><select id="ar-lb">${opts(defB.driverId)}</select></label>
          </div></section>${panel('ar-laps', `Lap chart - ${race.raceName} ${wanted.toLowerCase()}`, 'OpenF1')}`;
        const drv = (id) => list.find((x) => x.Driver.driverId === id).Driver;
        const run = () => {
          const a = $('#ar-la').value;
          const b = $('#ar-lb').value;
          if (a === b) { setPanel('ar-laps', emptyState('Choose two different drivers.'), { note: 'awaiting a second driver' }); return; }
          lapCompare('ar-laps', session, drv(a), drv(b), tok);
        };
        $('#ar-la').addEventListener('change', run);
        $('#ar-lb').addEventListener('change', run);
        run();
        host.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
  }

  /* ================================================================== */
  /* Drawer session status                                               */
  /* ================================================================== */
  /** Live session or next session, shown in the drawer footer. Uses cached schedule data. */
  async function initDrawerStatus() {
    const box = $('#drawer-status');
    if (!box) return;
    const set = (k, html) => { const el = $(`[data-ds-${k}]`, box); if (el) el.innerHTML = html; };
    const dot = $('.ds-dot', box);
    try {
      const [sch, latest] = await Promise.all([
        getSchedule('current'),
        oget('sessions', { session_key: 'latest' }, { ttl: TTL.short }).catch(() => null)
      ]);
      const ls = latest && latest.data[0];
      const lsStatus = ls ? await resolveSessionStatus(ls) : null;
      const now = Date.now();
      if (lsStatus === 'live') {
        dot.className = 'ds-dot is-live';
        set('label', 'Session in progress');
        set('title', esc(ls.session_name));
        set('sub', `${esc(ls.circuit_short_name || ls.location || '')}${ls.country_name ? ', ' + esc(ls.country_name) : ''} &middot; <a href="#/live">Open live timing</a>`);
        set('cd', '');
      } else {
        const next = flattenSessions(sch.races).find((x) => isPending(x, now));
        if (next) {
          dot.className = 'ds-dot is-next';
          set('label', 'Next session');
          set('title', esc(next.name));
          set('sub', `${esc(next.race.raceName)} &middot; ${esc(next.timed ? fmtDayHM(next.start) : fmtDayUTC(next.start) + ', time not yet published')}`);
          // No countdown without a published start time: a countdown to midnight would be invented.
          set('cd', next.timed ? `<div class="cd-compact" data-countdown="${next.start}" aria-hidden="true">${countdownHTML(next.start - now, true)}</div>` : '');
        } else {
          dot.className = 'ds-dot';
          set('label', 'Season');
          set('title', 'No upcoming sessions');
          set('sub', `The ${esc(sch.season)} schedule has no sessions left.`);
          set('cd', '');
        }
      }
      set('meta', `Source: Jolpica${latest ? ' + OpenF1' : ''} &middot; updated ${esc(fmtClock(metaOf(sch, latest).at))}`);
    } catch (e) {
      dot.className = 'ds-dot';
      set('label', 'Session status');
      set('title', 'Unavailable');
      set('sub', esc((e && e.message) || 'The schedule could not be loaded.'));
      set('cd', '');
      set('meta', `failed at ${esc(fmtClock(Date.now()))}`);
    }
  }

  /* ================================================================== */
  /* Boot                                                                */
  /* ================================================================== */
  function boot() {
    pruneCache(false);
    initTheme();
    initDrawer();
    window.addEventListener('hashchange', route);
    if (!location.hash) history.replaceState(null, '', '#/overview');
    loadColours();
    route();
    startTicker();
    initDrawerStatus();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
