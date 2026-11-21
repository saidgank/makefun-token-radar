// Launch Radar's page. It reads window.RADAR (written beside dashboard/ by main.ts) and renders
// the ranked board, its filters, a per-protocol detail view with the model's own arithmetic,
// and the live comparables the model was fitted on. No network: every byte shown is in data.js.
(function () {
  'use strict';
  var D = window.RADAR;
  if (!D) return;
  var rows = D.rows;
  var bySlug = {};
  rows.forEach(function (r) { bySlug[r.slug] = r; });

  // ---------- formatting ----------
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(n);
  }
  function fmtFull(n) { return '$' + Math.round(n).toLocaleString('en-US'); }
  function fmtMult(n) { return n.toFixed(2) + '\u00d7'; }
  function fmtPct(n) {
    if (n === null || n === undefined) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 730) return (days / 365).toFixed(1) + 'y';
    return days + 'd';
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ---------- header stats ----------
  document.getElementById('stats').innerHTML =
    '<div><dt>Scanned</dt><dd>' + D.counts.scanned + '</dd></div>' +
    '<div><dt>Pre-token</dt><dd>' + D.counts.pre_token + '</dd></div>' +
    '<div><dt>Watchlist</dt><dd>' + D.counts.watchlist + '</dd></div>' +
    '<div><dt>Snapshot</dt><dd>' + esc(D.as_of) + '</dd></div>';
  document.getElementById('wl-count').textContent = '(' + D.counts.watchlist + ')';

  // ---------- methodology, with the fitted numbers ----------
  var f = D.fit;
  document.getElementById('method-text').innerHTML =
    'Implied value = <b>TVL &times; category multiple &times; size &times; momentum &times; maturity &times; breadth</b>. ' +
    'The category multiple is the median market-cap / TVL of that category\u2019s own tokenized protocols in this snapshot, ' +
    'shrunk toward the global median when a category has few peers. The size factor applies the snapshot\u2019s own fitted ' +
    'slope of log(multiple) on log(TVL), so large protocols are not valued like small ones. Momentum reads the week\u2019s TVL ' +
    'change, maturity rewards a long record with no token, and breadth adds a little for each extra chain. ' +
    'Every factor is printed on each protocol\u2019s detail view, and the range beside the value runs from the category\u2019s ' +
    'lower to its upper quartile multiple through the same factors.';
  document.getElementById('fit-list').innerHTML =
    '<dt>Tokenized peers fitted</dt><dd>' + f.peer_count + '</dd>' +
    '<dt>Global median multiple</dt><dd>' + fmtMult(f.global_multiple) + '</dd>' +
    '<dt>Global quartile range</dt><dd>' + fmtMult(f.global_low_multiple) + ' \u2013 ' + fmtMult(f.global_high_multiple) + '</dd>' +
    '<dt>Size slope (log-log)</dt><dd>' + f.size_slope.toFixed(3) + '</dd>' +
    '<dt>Size centre TVL</dt><dd>' + fmtUsd(f.size_center_tvl) + '</dd>' +
    '<dt>Median age, when a listed day is missing</dt><dd>' + f.median_age_days + 'd</dd>';
  document.getElementById('cat-chips').innerHTML = f.categories.slice(0, 10).map(function (c) {
    return '<span class="chip">' + esc(c.category || 'Uncategorized') + ' <b>' + fmtMult(c.multiple) + '</b> (' + c.peers + ' peers)</span>';
  }).join('');

  // ---------- state, from the URL hash so a view can be linked and screenshotted ----------
  var state = { q: '', cat: 'all', chain: 'all', wl: false, sort: 'rank', p: null };
  (function fromHash() {
    var h = new URLSearchParams(location.hash.replace(/^#/, ''));
    if (h.get('q')) state.q = h.get('q');
    if (h.get('cat')) state.cat = h.get('cat');
    if (h.get('chain')) state.chain = h.get('chain');
    if (h.get('wl') === '1') state.wl = true;
    if (h.get('sort')) state.sort = h.get('sort');
    if (h.get('p')) state.p = h.get('p');
  })();
  function toHash() {
    var h = new URLSearchParams();
    if (state.q) h.set('q', state.q);
    if (state.cat !== 'all') h.set('cat', state.cat);
    if (state.chain !== 'all') h.set('chain', state.chain);
    if (state.wl) h.set('wl', '1');
    if (state.sort !== 'rank') h.set('sort', state.sort);
    if (state.p) h.set('p', state.p);
    history.replaceState(null, '', '#' + h.toString());
  }

  // ---------- controls ----------
  var qEl = document.getElementById('q');
  var catEl = document.getElementById('cat');
  var chainEl = document.getElementById('chain');
  var sortEl = document.getElementById('sort');
  var wlEl = document.getElementById('wl');
  var cats = [];
  var chains = [];
  rows.forEach(function (r) {
    var c = r.category || 'Uncategorized';
    if (cats.indexOf(c) < 0) cats.push(c);
    r.chains.forEach(function (ch) { if (chains.indexOf(ch) < 0) chains.push(ch); });
  });
  cats.sort();
  chains.sort();
  catEl.innerHTML = '<option value="all">All categories</option>' + cats.map(function (c) {
    return '<option' + (state.cat === c ? ' selected' : '') + '>' + esc(c) + '</option>';
  }).join('');
  chainEl.innerHTML = '<option value="all">All chains</option>' + chains.map(function (c) {
    return '<option' + (state.chain === c ? ' selected' : '') + '>' + esc(c) + '</option>';
  }).join('');
  qEl.value = state.q;
  sortEl.value = state.sort;
  wlEl.checked = state.wl;
  qEl.addEventListener('input', function () { state.q = qEl.value; toHash(); render(); });
  catEl.addEventListener('change', function () { state.cat = catEl.value; toHash(); render(); });
  chainEl.addEventListener('change', function () { state.chain = chainEl.value; toHash(); render(); });
  sortEl.addEventListener('change', function () { state.sort = sortEl.value; toHash(); render(); });
  wlEl.addEventListener('change', function () { state.wl = wlEl.checked; toHash(); render(); });

  // ---------- the board ----------
  var tbody = document.getElementById('rows');
  var shownEl = document.getElementById('shown');
  var emptyEl = document.getElementById('empty');
  function visible() {
    var q = state.q.trim().toLowerCase();
    var out = rows.filter(function (r) {
      if (state.wl && !r.watchlist) return false;
      if (state.cat !== 'all' && (r.category || 'Uncategorized') !== state.cat) return false;
      if (state.chain !== 'all' && r.chains.indexOf(state.chain) < 0) return false;
      if (q && r.name.toLowerCase().indexOf(q) < 0 && r.slug.indexOf(q) < 0) return false;
      return true;
    });
    var by = {
      rank: function (a, b) { return a.rank - b.rank; },
      implied: function (a, b) { return b.implied_value_usd - a.implied_value_usd; },
      tvl: function (a, b) { return b.tvl_usd - a.tvl_usd; },
      change: function (a, b) { return (b.change_7d === null ? -1e9 : b.change_7d) - (a.change_7d === null ? -1e9 : a.change_7d); },
      age: function (a, b) { return (b.age_days === null ? -1 : b.age_days) - (a.age_days === null ? -1 : a.age_days); }
    };
    return out.sort(by[state.sort] || by.rank);
  }
  function render() {
    var vis = visible();
    shownEl.textContent = 'showing ' + vis.length + ' of ' + rows.length;
    emptyEl.hidden = vis.length > 0;
    tbody.innerHTML = vis.map(function (r) {
      var chg = r.change_7d === null ? '<td class="num dim">n/a</td>'
        : '<td class="num ' + (r.change_7d >= 0 ? 'pos' : 'neg') + '">' + fmtPct(r.change_7d) + '</td>';
      return '<tr data-slug="' + esc(r.slug) + '"' + (state.p === r.slug ? ' class="selected"' : '') + '>' +
        '<td class="rank">' + r.rank + '</td>' +
        '<td><span class="pname">' + esc(r.name) + '</span>' + (r.watchlist ? '<span class="badge">WATCHLIST</span>' : '') +
        '<span class="slug">' + esc(r.slug) + '</span></td>' +
        '<td class="cat">' + esc(r.category || 'Uncategorized') + '</td>' +
        '<td class="chains">' + esc(r.chains.slice(0, 4).join(', ') + (r.chains.length > 4 ? ' +' + (r.chains.length - 4) + ' more' : '') || '\u2014') + '</td>' +
        '<td class="num">' + fmtUsd(r.tvl_usd) + '</td>' + chg +
        '<td class="num imp">' + fmtUsd(r.implied_value_usd) + '</td>' +
        '<td class="num mult">' + (r.implied_value_usd / r.tvl_usd).toFixed(2) + '\u00d7</td></tr>';
    }).join('');
  }
  tbody.addEventListener('click', function (ev) {
    var tr = ev.target.closest('tr[data-slug]');
    if (tr) select(tr.getAttribute('data-slug'), true);
  });

  // ---------- detail view ----------
  var detail = document.getElementById('detail');
  function factorRow(label, value, note) {
    return '<tr><td>' + label + '</td><td>' + value + '</td><td class="dim">' + note + '</td></tr>';
  }
  function select(slug, scroll) {
    var r = bySlug[slug];
    if (!r) return;
    state.p = slug;
    toHash();
    render();
    var m = r.model;
    var catFit = null;
    f.categories.forEach(function (c) { if ((c.category || null) === r.category) catFit = c; });
    var peers = catFit ? catFit.peers : 0;
    var lo = Math.log(r.implied_low_usd / 3);
    var hi = Math.log(r.implied_high_usd * 3);
    function pos(v) { return Math.max(0, Math.min(100, ((Math.log(v) - lo) / (hi - lo)) * 100)); }
    detail.hidden = false;
    detail.innerHTML =
      '<div class="detail-head"><div>' +
      '<h2>' + esc(r.name) + (r.watchlist ? '<span class="badge">WATCHLIST</span>' : '') + '</h2>' +
      '<p class="sub">Rank #' + r.rank + ' of ' + rows.length + ' pre-token protocols \u00b7 ' + esc(r.category || 'Uncategorized') +
      ' \u00b7 records no token in the snapshot (no market cap, CoinGecko id or symbol)</p></div>' +
      '<button class="close" id="close-detail" type="button">Close</button></div>' +
      '<div class="detail-grid"><div>' +
      '<h3>The record</h3><dl class="facts">' +
      '<dt>TVL</dt><dd>' + fmtFull(r.tvl_usd) + '</dd>' +
      '<dt>7d change</dt><dd>' + fmtPct(r.change_7d) + '</dd>' +
      '<dt>Chains</dt><dd>' + esc(r.chains.join(', ') || 'none named') + '</dd>' +
      '<dt>Listed by DefiLlama</dt><dd>' + (r.listed_at || 'not reported') + '</dd>' +
      '<dt>Tokenless record</dt><dd>' + fmtAge(r.age_days) + '</dd>' +
      '<dt>On the house watchlist</dt><dd>' + (r.watchlist ? 'yes' : 'no \u2014 below or beside the $50M floor') + '</dd>' +
      '</dl></div><div>' +
      '<h3>The value, factor by factor</h3><table class="breakdown">' +
      factorRow('TVL', fmtFull(r.tvl_usd), 'the snapshot\u2019s figure') +
      factorRow('Category multiple', fmtMult(m.category_multiple), peers + ' tokenized ' + esc(r.category || 'Uncategorized') + ' peers, shrunk') +
      factorRow('Size factor', m.size_factor.toFixed(2) + '\u00d7', 'fitted slope ' + f.size_slope.toFixed(2) + ' around ' + fmtUsd(f.size_center_tvl)) +
      factorRow('Momentum factor', m.momentum_factor.toFixed(2) + '\u00d7', 'from the 7d change of ' + fmtPct(r.change_7d)) +
      factorRow('Maturity factor', m.maturity_factor.toFixed(2) + '\u00d7', fmtAge(r.age_days) + ' with no token') +
      factorRow('Breadth factor', m.breadth_factor.toFixed(2) + '\u00d7', r.chains.length + (r.chains.length === 1 ? ' chain' : ' chains')) +
      '<tr class="total"><td>Implied value</td><td>' + fmtFull(r.implied_value_usd) + '</td><td></td></tr>' +
      '</table>' +
      '<div class="rangebar"><div class="fill" style="left:' + pos(r.implied_low_usd) + '%;width:' + (pos(r.implied_high_usd) - pos(r.implied_low_usd)) + '%"></div>' +
      '<div class="point" style="left:' + pos(r.implied_value_usd) + '%"></div></div>' +
      '<div class="range-labels"><span>low ' + fmtUsd(r.implied_low_usd) + '</span><span>quartile range, same factors</span><span>high ' + fmtUsd(r.implied_high_usd) + '</span></div>' +
      '</div></div>' +
      '<div class="plan"><h3>Farm plan \u2014 what to do, what it costs, how long it takes</h3><ol>' +
      r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') +
      '</ol></div>';
    document.getElementById('close-detail').addEventListener('click', function () {
      detail.hidden = true;
      state.p = null;
      toHash();
      render();
    });
    if (scroll) {
      // Scroll at once, and again after a breath: the first layout can still shift as the
      // board below finishes rendering, and the panel must end at the top either way.
      window.scrollTo(0, Math.max(0, detail.offsetTop - 12));
      setTimeout(function () { window.scrollTo(0, Math.max(0, detail.offsetTop - 12)); }, 120);
    }
  }

  // ---------- live comparables ----------
  document.getElementById('live').innerHTML = D.live.map(function (p) {
    return '<div class="live-card"><span class="n">' + esc(p.name) + '</span>' +
      (p.symbol ? '<span class="s">' + esc(p.symbol) + '</span>' : '') +
      '<dl><dt>Market cap</dt><dd>' + fmtUsd(p.mcap_usd) + '</dd>' +
      '<dt>TVL</dt><dd>' + fmtUsd(p.tvl_usd) + '</dd>' +
      '<dt>Multiple</dt><dd>' + fmtMult(p.multiple) + '</dd></dl></div>';
  }).join('');

  document.getElementById('foot-note').textContent =
    'Board built from ' + D.source + ': ' + D.counts.scanned + ' protocols scanned, ' + D.counts.pre_token +
    ' record no token, ' + D.counts.watchlist + ' on the house watchlist at the ' + fmtFull(D.floor_usd) + ' floor.';

  render();
  if (state.p && bySlug[state.p]) select(state.p, true);
})();
