// Live results for the lab's iNaturalist project, fetched in the browser from the
// public iNaturalist API. No key, no build step.
(() => {
  const API = 'https://api.inaturalist.org/v1';
  const PROJECT_ID = 310448;
  // The county baseline the project is compared against: research-grade
  // vascular plants (taxon 211194) in Benton County, OR (place 484).
  const COUNTY_QUERY = { place_id: 484, taxon_id: 211194, quality_grade: 'research' };

  const REFRESH_MS = 30 * 60 * 1000; // if the page is left open, refresh project data every 30 minutes
  const RETRY_MS = 5 * 60 * 1000; // try again sooner after a failed refresh
  const REQUEST_GAP_MS = 1100; // iNaturalist asks for about one request per second
  const COUNTY_CACHE_MS = 24 * 60 * 60 * 1000; // the county list changes slowly
  // The compact layout (class="bc-compact" on <html> in index.html) shows shorter
  // lists. Remove that class to get the original sizes and list lengths back.
  const compact = document.documentElement.classList.contains('bc-compact');
  const TOP_SPECIES = compact ? 6 : 8;
  const RECENT = compact ? 6 : 12;
  const LEADERS = compact ? 5 : 10;
  const WANTED = compact ? 12 : 25;

  // County firsts. The project only counts observations made from this date on
  // (its own start-date rule on iNaturalist), so anything seen in the county
  // before it was seen by someone else first.
  const PROJECT_START = '2026-08-01';
  // Any verifiable record (research grade or still needing ID) counts as an
  // earlier county record, so a "first" really has nothing before it.
  const COUNTY_ANY_QUERY = { place_id: 484, taxon_id: 211194, verifiable: true };
  const FIRSTS_LOOKUPS = 30; // most species checked one by one per page load

  const $ = (id) => document.getElementById(id);
  const fmt = (n) => Number(n).toLocaleString('en-US');

  // ---------- small DOM helpers (text is always set as text, never as HTML) ----------

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function photo(url, alt, credit) {
    if (!url) return el('div', 'bc-photo bc-photo-empty', 'No photo');
    const img = el('img', 'bc-photo');
    img.src = url;
    img.alt = alt || '';
    img.loading = 'lazy';
    if (credit) img.title = credit;
    return img;
  }

  function fill(list, items, emptyText) {
    list.replaceChildren(...(items.length ? items : [el('li', 'bc-status', emptyText)]));
  }

  function showUnavailable(id) {
    const list = $(id);
    // Keep whatever is already on screen if an earlier load succeeded.
    if (list.querySelector(':scope > :not(.bc-status)')) return;
    fill(list, [], 'Not available right now. will try again shortly.');
  }

  const capitalize = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
  const commonName = (taxon) => capitalize(taxon.preferred_common_name) || taxon.name;
  const taxonUrl = (id) => `https://www.inaturalist.org/taxa/${id}`;

  function linked(node, href) {
    const a = el('a');
    a.href = href;
    a.target = '_blank';
    a.rel = 'noreferrer';
    a.append(node);
    return a;
  }

  // ---------- API access: one request at a time, spaced out ----------

  let queue = Promise.resolve();
  let lastRequest = 0;

  function api(path, params) {
    const url = `${API}${path}?${new URLSearchParams(params)}`;
    const run = async () => {
      const wait = lastRequest + REQUEST_GAP_MS - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      try {
        const response = await fetch(url, { headers: { Accept: 'application/json' } });
        if (!response.ok) throw new Error(`iNaturalist returned ${response.status} for ${path}`);
        return await response.json();
      } finally {
        lastRequest = Date.now();
      }
    };
    const result = queue.then(run, run);
    queue = result.catch(() => {});
    return result;
  }

  // Fetch every page of an endpoint (500 per page is the API maximum).
  async function allPages(path, params) {
    const results = [];
    let total = 0;
    for (let page = 1; page <= 10; page += 1) {
      const data = await api(path, { ...params, per_page: 500, page });
      total = data.total_results;
      results.push(...data.results);
      if (!data.results.length || results.length >= total) break;
    }
    return { total, results };
  }

  // County species list, most observed first. `month` (1-12) limits it to
  // observations made in that calendar month, in any year. Cached in
  // sessionStorage because it changes slowly and takes several requests.
  async function countySpecies(month) {
    const key = `bc-county-v1-${month || 'all'}`;
    try {
      const cached = JSON.parse(sessionStorage.getItem(key));
      if (cached && Date.now() - cached.savedAt < COUNTY_CACHE_MS) return cached.species;
    } catch (error) { /* storage unavailable or unreadable: fetch instead */ }

    const params = month ? { ...COUNTY_QUERY, month } : COUNTY_QUERY;
    const { results } = await allPages('/observations/species_counts', params);
    const species = results.map(({ count, taxon }) => ({
      id: taxon.id,
      name: taxon.name,
      common: taxon.preferred_common_name || '',
      photo: taxon.default_photo ? taxon.default_photo.medium_url : '',
      credit: taxon.default_photo ? taxon.default_photo.attribution : '',
      count,
      // Nearest ancestors only (genus, section, tribe...), used to notice when the
      // project has the plant logged at a coarser rank than species.
      ancestors: (taxon.ancestor_ids || []).slice(-6),
    }));
    try {
      sessionStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), species }));
    } catch (error) { /* storage full or unavailable: carry on without the cache */ }
    return species;
  }

  // Ids of every species with a verifiable county observation made before the
  // project started. Cached like the county list above.
  async function countyBeforeProject() {
    const key = 'bc-county-before-v1';
    try {
      const cached = JSON.parse(sessionStorage.getItem(key));
      if (cached && Date.now() - cached.savedAt < COUNTY_CACHE_MS) return new Set(cached.ids);
    } catch (error) { /* storage unavailable or unreadable: fetch instead */ }

    const [y, m, d] = PROJECT_START.split('-').map(Number);
    const dayBefore = new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
    const { results } = await allPages('/observations/species_counts', { ...COUNTY_ANY_QUERY, d2: dayBefore });
    const ids = results.map(({ taxon }) => taxon.id);
    try {
      sessionStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), ids }));
    } catch (error) { /* storage full or unavailable: carry on without the cache */ }
    return new Set(ids);
  }

  // Project observations that are the earliest record of their species in the
  // county on iNaturalist, newest first.
  const earliestInCounty = new Map(); // taxon id -> earliest county observation (kept while the page is open)
  async function countyFirsts(projectTaxa) {
    const before = await countyBeforeProject();
    const candidates = projectTaxa
      .filter(({ taxon }) => taxon.rank_level <= 10 && !before.has(taxon.id))
      .slice(0, FIRSTS_LOOKUPS);
    // Nobody saw these before the project started, but a non-member could still
    // have beaten us to one since. Look up each one's earliest county record...
    for (const { taxon } of candidates) {
      if (earliestInCounty.has(taxon.id)) continue;
      const data = await api('/observations', {
        ...COUNTY_ANY_QUERY, taxon_id: taxon.id, order_by: 'observed_on', order: 'asc', per_page: 1,
      });
      if (data.results[0]) earliestInCounty.set(taxon.id, data.results[0]);
    }
    const earliest = candidates.map(({ taxon }) => earliestInCounty.get(taxon.id)).filter(Boolean);
    if (!earliest.length) return [];
    // ...and keep the ones where that record is one of ours.
    const ours = await api('/observations', {
      project_id: PROJECT_ID, id: earliest.map((observation) => observation.id).join(','), per_page: 200,
    });
    const inProject = new Set(ours.results.map((observation) => observation.id));
    return earliest
      .filter((observation) => inProject.has(observation.id))
      .sort((a, b) => (b.observed_on || '').localeCompare(a.observed_on || ''));
  }

  // ---------- rendering ----------

  function renderTopSpecies(projectTaxa) {
    // The project list includes entries identified only to genus or coarser; skip those here.
    const species = projectTaxa.filter(({ taxon }) => taxon.rank_level <= 10).slice(0, TOP_SPECIES);
    fill($('bc-top'), species.map(({ count, taxon }) => {
      const card = el('li', 'bc-card');
      const copy = el('div', 'bc-card-copy');
      const countBox = el('span', 'bc-count', fmt(count));
      countBox.append(el('small', '', count === 1 ? 'observation' : 'observations'));
      copy.append(el('p', 'bc-name', commonName(taxon)), countBox, el('p', 'bc-sci', taxon.name));
      const shot = taxon.default_photo || {};
      const inner = document.createDocumentFragment();
      inner.append(photo(shot.medium_url, commonName(taxon), shot.attribution), copy);
      card.append(linked(inner, taxonUrl(taxon.id)));
      return card;
    }), 'No species recorded yet.');
  }

  function formatDate(observation) {
    // observed_on is a plain YYYY-MM-DD date; build it from its parts so the
    // viewer's time zone cannot shift it by a day.
    const source = observation.observed_on || (observation.created_at || '').slice(0, 10);
    const [y, m, d] = source.split('-').map(Number);
    if (!y || !m || !d) return '';
    return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function observationCard(observation, tag) {
      const taxon = observation.taxon;
      const name = taxon ? commonName(taxon) : 'Not yet identified';
      const shot = (observation.photos || [])[0];
      const user = observation.user || {};
      const card = el('li', 'bc-card');
      const copy = el('div');
      copy.style.paddingTop = '.8rem';
      copy.append(el('p', 'bc-name', name));
      if (taxon && taxon.name !== name) copy.append(el('p', 'bc-sci', taxon.name));
      copy.append(el('p', 'bc-meta', [user.name || user.login, formatDate(observation)].filter(Boolean).join(' · ')));
      const inner = document.createDocumentFragment();
      inner.append(
        photo(shot && shot.url.replace('/square.', '/medium.'), name, shot && `Photo ${shot.attribution}`),
        copy
      );
      if (tag) copy.append(el('p', 'bc-hint', tag));
      card.append(linked(inner, observation.uri || `https://www.inaturalist.org/observations/${observation.id}`));
      return card;
  }

  function renderRecent(observations) {
    fill($('bc-recent'), observations.map((observation) => observationCard(observation)), 'No observations yet.');
  }

  function renderFirsts(observations) {
    fill($('bc-firsts-inat'), observations.map((observation) => observationCard(
      observation,
      observation.quality_grade === 'research' ? '' : 'ID not confirmed yet'
    )), 'None yet. Every species we’ve logged so far had already been recorded in the county.');
  }

  function renderBoard(id, observers, field, unit) {
    fill($(id), observers.slice(0, LEADERS).map((entry, index) => {
      const user = entry.user || {};
      const row = el('li');
      let avatar;
      if (user.icon) {
        avatar = el('img', 'bc-avatar');
        avatar.src = user.icon.replace('/thumb.', '/medium.');
        avatar.alt = '';
        avatar.loading = 'lazy';
      } else {
        avatar = el('span', 'bc-avatar', (user.name || user.login || '?').charAt(0).toUpperCase());
      }
      const name = el('p', 'bc-name', user.name || user.login);
      if (user.name && user.login) name.append(el('small', '', `@${user.login}`));
      const score = el('span', 'bc-score', fmt(entry[field]));
      score.title = unit;
      row.append(el('span', 'bc-rank', String(index + 1)), avatar, name, score);
      return row;
    }), 'No observers yet.');
  }

  // County species the project has not recorded, keeping the county's
  // most-observed-first order. Comparison is by species: the API already rolls
  // subspecies and varieties up to their species in both lists. Project entries
  // identified only to genus (or another coarse rank) do not count as recording
  // any species, but county species in the same genus (or narrower group) are
  // flagged so they are easy to spot.
  function renderWanted(id, noteId, county, projectTaxa, describe) {
    const recorded = new Set(projectTaxa.map(({ taxon }) => taxon.id));
    // Only genus (rank level 20) and narrower count as a hint; a tribe or family is too broad.
    const coarse = new Map(projectTaxa
      .filter(({ taxon }) => taxon.rank_level > 10 && taxon.rank_level <= 20)
      .map(({ taxon }) => [taxon.id, taxon]));
    const missing = county.filter((species) => !recorded.has(species.id));

    fill($(id), missing.slice(0, WANTED).map((species, index) => {
      const row = el('li');
      const copy = el('div');
      const name = capitalize(species.common) || species.name;
      copy.append(el('p', 'bc-name', name), el('p', 'bc-sci', species.name));
      const meta = el('p', 'bc-meta');
      meta.append(el('strong', '', fmt(species.count)), ` ${describe(species.count)}`);
      copy.append(meta);
      // Closest coarse project entry (usually the genus) that this species falls under.
      // It is only a maybe: that observation could be a different species in the group.
      const group = coarse.get([...species.ancestors].reverse().find((ancestor) => coarse.has(ancestor)));
      if (group) {
        copy.append(el('p', 'bc-hint', `We might already have this one! We've logged a ${group.name} that's only ID'd to ${group.rank} so far`));
      }
      const inner = document.createDocumentFragment();
      inner.append(el('span', 'bc-rank', String(index + 1)), photo(species.photo, name, species.credit), copy);
      row.append(linked(inner, taxonUrl(species.id)));
      return row;
    }), 'Nothing left to find. Every species on this list has been recorded!');

    return { missing: missing.length, total: county.length };
  }

  // ---------- load and refresh ----------

  let lastSuccess = null;

  function setStatus(failed) {
    const time = (date) => date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    let text;
    if (!failed) {
      text = `Last updated ${time(lastSuccess)}.`;
    } else if (lastSuccess) {
      text = `can’t reach iNaturalist right now, so this is the data from ${time(lastSuccess)}. will keep trying.`;
    } else {
      text = 'can’t reach iNaturalist right now. This page will keep trying, or you can visit the project on iNaturalist directly.';
    }
    $('bc-updated').textContent = text;
    $('bc-updated').classList.toggle('is-error', failed);
  }

  async function refresh() {
    let failed = false;
    const step = async (work, onError) => {
      try {
        await work();
      } catch (error) {
        console.error(error);
        failed = true;
        if (onError) onError();
      }
    };
    const project = { project_id: PROJECT_ID };
    let projectTaxa = null;

    await step(async () => {
      const data = await api('/observations', { ...project, per_page: RECENT, order_by: 'created_at' });
      $('bc-stat-observations').textContent = fmt(data.total_results);
      renderRecent(data.results);
    }, () => showUnavailable('bc-recent'));

    await step(async () => {
      const data = await allPages('/observations/species_counts', project);
      $('bc-stat-species').textContent = fmt(data.total);
      projectTaxa = data.results;
      renderTopSpecies(projectTaxa);
    }, () => showUnavailable('bc-top'));

    await step(async () => {
      const data = await api('/observations/observers', { ...project, per_page: LEADERS });
      $('bc-stat-observers').textContent = fmt(data.total_results);
      renderBoard('bc-board-observations', data.results, 'observation_count', 'observations');
    }, () => showUnavailable('bc-board-observations'));

    await step(async () => {
      const data = await api('/observations/observers', { ...project, per_page: LEADERS, order_by: 'species_count' });
      renderBoard('bc-board-species', data.results, 'species_count', 'species');
    }, () => showUnavailable('bc-board-species'));

    const now = new Date();
    const monthName = now.toLocaleDateString('en-US', { month: 'long' });

    await step(async () => {
      if (!projectTaxa) throw new Error('Project species list unavailable');
      const county = await countySpecies(now.getMonth() + 1);
      $('bc-wanted-now-title').textContent = `${monthName}'s most wanted:`;
      const { missing, total } = renderWanted('bc-wanted-now', 'bc-wanted-now-note', county, projectTaxa,
        (n) => `county ${n === 1 ? 'observation' : 'observations'} in ${monthName}`);
      $('bc-wanted-now-note').textContent = `We're still missing ${fmt(missing)} of the ${fmt(total)} plant species seen in Benton County in ${monthName} (any year).`;
    }, () => showUnavailable('bc-wanted-now'));

    await step(async () => {
      if (!projectTaxa) throw new Error('Project species list unavailable');
      const county = await countySpecies(null);
      const { missing, total } = renderWanted('bc-wanted-all', 'bc-wanted-all-note', county, projectTaxa,
        (n) => `county ${n === 1 ? 'observation' : 'observations'}`);
      $('bc-wanted-all-note').textContent = `We're still missing ${fmt(missing)} of Benton County’s ${fmt(total)} recorded plant species.`;
    }, () => showUnavailable('bc-wanted-all'));

    await step(async () => {
      if (!projectTaxa) throw new Error('Project species list unavailable');
      renderFirsts(await countyFirsts(projectTaxa));
    }, () => showUnavailable('bc-firsts-inat'));

    if (!failed) lastSuccess = new Date();
    setStatus(failed);
    setTimeout(refresh, failed ? RETRY_MS : REFRESH_MS);
  }

  refresh();
})();
