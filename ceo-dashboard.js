/* ============================================================
   MANGALAM LANDMARKS — BD CEO DASHBOARD (v3)
   Pulls sanitized summary data via the `getCeoSummary` action.
   Read-only. Sections:
     0. Summary — top highlights (potential / process / work done),
        click any figure to jump to the section it comes from.
     1. Project Pipeline — Greenfield/JD vs Redevelopment, "View"
        card per parcel, flags possible duplicate entries.
     2. Work Done — visits/meetings/calls done per parcel, category,
        status, next reminder.
     3. Deal Closing Checklist — Closed/Demarcation/Private/MOU/
        PA-DA/Compound Wall per parcel.
     4. P&L — GDV/Investment/PBIT/PAT/ROI/Profit-psf, totals + a
        per-parcel breakdown.
   A filter bar (search + stage + category + duplicates-only) applies
   across sections 1-4 so the CEO can drill into a subset without
   scrolling the whole pipeline. Each section's table is framed to a
   fixed height (scrolls internally) to keep the page compact.
   ============================================================ */

// ⚠️ Use the SAME Apps Script Web App URL as the BD entry tool.
const API_URL = "https://script.google.com/macros/s/AKfycbwnusKhEVckQbtT4BR_Txm15UjH4w1oaUylIuY6uvJK9kYpU0RdHVm6aa7IhMyg0U0_/exec";

const AUTO_REFRESH_MINUTES = 10;

let STATE = { dailyLogs: [], deals: [], targets: [], stageHistory: [], dealActivity: [], directory: [], documents: [] };
let PIPELINE_CATEGORY = 'Greenfield/JD'; // 'Greenfield/JD' | 'Redevelopment'
let FILTER = { search: '', stage: 'All', leadCategory: 'All', duplicatesOnly: false };

const STAGES = ['Lead', 'Site Visit Done', 'Feasibility', 'Negotiation', 'Term Sheet', 'Due Diligence', 'Signed', 'Dropped'];

document.addEventListener('DOMContentLoaded', () => {
  loadData();
  setInterval(loadData, AUTO_REFRESH_MINUTES * 60 * 1000);

  const plotModal = document.getElementById('plotModal');
  if (plotModal) plotModal.addEventListener('click', e => { if (e.target.id === 'plotModal') closePlotModal(); });

  const timelineModal = document.getElementById('timelineModal');
  if (timelineModal) timelineModal.addEventListener('click', e => { if (e.target.id === 'timelineModal') closeTimelineModal(); });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closePlotModal(); closeTimelineModal(); }
  });
});

async function loadData() {
  try {
    const url = `${API_URL}?action=getCeoSummary`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Network error: ' + res.status);
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || 'Unknown error');
    STATE = json.data;
    if (!STATE.dealActivity) STATE.dealActivity = [];
    if (!STATE.deals) STATE.deals = [];
    document.getElementById('refreshNote').textContent =
      'Last updated ' + new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
    render();
  } catch (err) {
    document.getElementById('refreshNote').textContent = 'Update failed — showing last loaded data';
    if (API_URL.includes('PASTE_YOUR')) {
      document.getElementById('dashboardRoot').innerHTML = `
        <div class="empty-state">
          <div class="icon">🔌</div>
          <b>Not connected yet</b><br>
          Paste the Apps Script Web App URL into <code>API_URL</code> in ceo-dashboard.js
        </div>`;
    } else if (STATE.deals.length === 0) {
      document.getElementById('dashboardRoot').innerHTML = `
        <div class="empty-state"><div class="icon">⚠️</div>Could not load data: ${escapeHTML(err.message)}</div>`;
    }
  }
}

function render() {
  const dupIds = computeDuplicateIds();

  const html = `
    <div class="section-heading"><span>Summary</span><div class="line"></div></div>
    <div class="section-sub">Key highlights across the pipeline. Click any figure to jump to where it comes from.</div>
    ${renderSummarySection(dupIds)}

    <div id="section-pipeline">
      <div class="section-heading"><span>1 · Project Pipeline</span><div class="line"></div></div>
      <div class="section-sub">Every parcel, split Greenfield/JD vs Redevelopment. Click View for full plot details.</div>
      ${renderFilterBar()}
      ${renderPipelineSection(dupIds)}
    </div>

    <div id="section-workdone">
      <div class="section-heading"><span>2 · Work Done</span><div class="line"></div></div>
      <div class="section-sub">Visits, meetings, and calls logged per parcel — plus lead temperature, status, and the next scheduled action.</div>
      ${renderWorkDoneSection()}
    </div>

    <div id="section-checklist">
      <div class="section-heading"><span>3 · Deal Closing Checklist</span><div class="line"></div></div>
      <div class="section-sub">Post-agreement execution milestones per parcel.</div>
      ${renderChecklistSection()}
    </div>

    <div id="section-pnl">
      <div class="section-heading"><span>4 · P&amp;L</span><div class="line"></div></div>
      <div class="section-sub">Aggregated across filtered parcels with figures entered (excludes Dropped deals).</div>
      ${renderPnLSection()}
    </div>

    <div class="footer-note">Auto-refreshes every ${AUTO_REFRESH_MINUTES} minutes</div>
  `;
  document.getElementById('dashboardRoot').innerHTML = html;
  bindCategoryTabs();
  bindFilterBar();
  bindJumpLinks();
}

/* ============================================================
   DUPLICATE DETECTION
   Flags parcels that share the same name + location + survey number
   (case/whitespace-insensitive) with another row — almost always a
   double-entry rather than two genuinely different plots. Flags
   only; nothing is hidden or removed automatically.
   ============================================================ */

function normKey(d) {
  return [d.parcelName, d.location, d.surveyNumber]
    .map(v => String(v || '').trim().toLowerCase())
    .join('|');
}

function computeDuplicateIds() {
  const groups = {};
  STATE.deals.forEach(d => {
    const key = normKey(d);
    if (!key.replace(/\|/g, '')) return; // skip blank/near-empty rows
    if (!groups[key]) groups[key] = [];
    groups[key].push(d.id);
  });
  const dupIds = new Set();
  Object.values(groups).forEach(ids => { if (ids.length > 1) ids.forEach(id => dupIds.add(id)); });
  return dupIds;
}

/* ============================================================
   FILTER BAR — applies to sections 1-4
   ============================================================ */

function renderFilterBar() {
  const stageOptions = STAGES.map(s => `<option value="${s}" ${FILTER.stage === s ? 'selected' : ''}>${s}</option>`).join('');
  return `
    <div class="filter-bar">
      <input type="text" id="filterSearch" placeholder="Search parcel, location, survey no…" value="${escapeHTML(FILTER.search)}">
      <select id="filterStage">
        <option value="All" ${FILTER.stage === 'All' ? 'selected' : ''}>All Stages</option>
        ${stageOptions}
      </select>
      <select id="filterCategory">
        <option value="All" ${FILTER.leadCategory === 'All' ? 'selected' : ''}>All Categories</option>
        <option value="Hot" ${FILTER.leadCategory === 'Hot' ? 'selected' : ''}>🟢 Hot</option>
        <option value="Warm" ${FILTER.leadCategory === 'Warm' ? 'selected' : ''}>🟡 Warm</option>
        <option value="Cold" ${FILTER.leadCategory === 'Cold' ? 'selected' : ''}>🔴 Cold</option>
      </select>
      <label class="chk"><input type="checkbox" id="filterDup" ${FILTER.duplicatesOnly ? 'checked' : ''}> Possible duplicates only</label>
      <button type="button" class="filter-clear" id="filterClearBtn">Clear</button>
    </div>`;
}

function bindFilterBar() {
  const s = document.getElementById('filterSearch');
  const st = document.getElementById('filterStage');
  const c = document.getElementById('filterCategory');
  const dup = document.getElementById('filterDup');
  const clear = document.getElementById('filterClearBtn');
  if (s) s.addEventListener('input', () => { FILTER.search = s.value; renderKeepScroll(); });
  if (st) st.addEventListener('change', () => { FILTER.stage = st.value; render(); });
  if (c) c.addEventListener('change', () => { FILTER.leadCategory = c.value; render(); });
  if (dup) dup.addEventListener('change', () => { FILTER.duplicatesOnly = dup.checked; render(); });
  if (clear) clear.addEventListener('click', () => {
    FILTER = { search: '', stage: 'All', leadCategory: 'All', duplicatesOnly: false };
    render();
  });
}

// Re-render without losing focus/cursor position in the search box
// (typing triggers a full re-render, so restore focus + caret after).
function renderKeepScroll() {
  const active = document.activeElement;
  const isSearch = active && active.id === 'filterSearch';
  const caret = isSearch ? active.selectionStart : null;
  render();
  if (isSearch) {
    const el = document.getElementById('filterSearch');
    if (el) { el.focus(); el.setSelectionRange(caret, caret); }
  }
}

function applyFilters(list, dupIds) {
  const term = FILTER.search.trim().toLowerCase();
  return list.filter(d => {
    if (FILTER.stage !== 'All' && d.stage !== FILTER.stage) return false;
    if (FILTER.leadCategory !== 'All' && (d.leadCategory || 'Warm') !== FILTER.leadCategory) return false;
    if (FILTER.duplicatesOnly && dupIds && !dupIds.has(d.id)) return false;
    if (term) {
      const hay = `${d.parcelName || ''} ${d.location || ''} ${d.surveyNumber || ''}`.toLowerCase();
      if (!hay.includes(term)) return false;
    }
    return true;
  });
}

/* ============================================================
   SUMMARY (top highlights, click to jump to source section)
   ============================================================ */

function renderSummarySection(dupIds) {
  const active = STATE.deals.filter(d => d.stage !== 'Dropped');
  const signed = STATE.deals.filter(d => d.stage === 'Signed');
  const totalGDV = active.reduce((s, d) => s + (Number(d.expectedGDV) || 0), 0);
  const totalInvestment = active.reduce((s, d) => s + (Number(d.totalInvestment) || 0), 0);

  const visits = STATE.dealActivity.filter(a => a.activityType === 'Site Visit').length;
  const meetings = STATE.dealActivity.filter(a => a.activityType === 'Meeting').length;
  const calls = STATE.dealActivity.filter(a => a.activityType === 'Call').length;

  const overdueCount = active.filter(d => d.nextActionDate && new Date(d.nextActionDate) < new Date() && !['Signed', 'Dropped'].includes(d.stage)).length;

  const checklistFields = ['closedStatus', 'demarcationStatus', 'privateStatus', 'mouStatus', 'paDaStatus', 'compoundWallStatus'];
  const totalChecklistItems = active.length * checklistFields.length;
  const doneChecklistItems = active.reduce((s, d) => s + checklistFields.filter(f => d[f] === 'Done').length, 0);

  const dupCount = dupIds.size;

  const stat = (jump, label, value, sub, warn, action) =>
    `<button type="button" class="summary-stat ${warn ? 'warn' : ''}" data-jump="${jump}" ${action ? `data-action="${action}"` : ''}>
      <div class="sm-label">${label}</div>
      <div class="sm-value">${value}</div>
      ${sub ? `<div class="sm-sub">${sub}</div>` : ''}
    </button>`;

  return `
    <div class="card">
      <div class="summary-group-label">Potential</div>
      <div class="summary-grid">
        ${stat('section-pipeline', 'Total Parcels', active.length, `${STATE.deals.length} tracked all-time`)}
        ${stat('section-pnl', 'Total GDV', totalGDV ? '₹' + totalGDV.toFixed(0) + ' Cr' : '—', 'active pipeline')}
        ${stat('section-pnl', 'Total Investment', totalInvestment ? '₹' + totalInvestment.toFixed(0) + ' Cr' : '—', 'active pipeline')}
      </div>
      <div class="summary-group-label">Process</div>
      <div class="summary-grid">
        ${stat('section-checklist', 'Deals Signed', signed.length, 'closed to date')}
        ${stat('section-checklist', 'Closing Checklist', totalChecklistItems ? Math.round(100 * doneChecklistItems / totalChecklistItems) + '%' : '—', `${doneChecklistItems}/${totalChecklistItems} milestones done`)}
        ${stat('section-workdone', 'Overdue Reminders', overdueCount, 'need action', overdueCount > 0)}
      </div>
      <div class="summary-group-label">Work Done</div>
      <div class="summary-grid">
        ${stat('section-workdone', 'Site Visits', visits, 'logged, all-time')}
        ${stat('section-workdone', 'Meetings', meetings, 'logged, all-time')}
        ${stat('section-workdone', 'Calls', calls, 'logged, all-time')}
        ${stat('section-pipeline', 'Possible Duplicates', dupCount, dupCount > 0 ? 'review in Pipeline' : 'none found', dupCount > 0, 'duplicates')}
      </div>
    </div>`;
}

function bindJumpLinks() {
  document.querySelectorAll('[data-jump]').forEach(el => {
    el.addEventListener('click', () => {
      // "Possible Duplicates" jump also switches the filter to
      // duplicates-only so the CEO lands directly on the rows to review.
      if (el.dataset.action === 'duplicates') {
        FILTER.duplicatesOnly = true;
        render();
      }
      jumpToSource(el.dataset.jump);
    });
  });
}

function jumpToSource(targetId) {
  const el = document.getElementById(targetId);
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  el.classList.remove('section-flash');
  void el.offsetWidth;
  el.classList.add('section-flash');
  setTimeout(() => el.classList.remove('section-flash'), 1800);
}

/* ============================================================
   SECTION 1 — PROJECT PIPELINE
   ============================================================ */

function dealCategory(d) {
  return d.dealStructure === 'Redevelopment' ? 'Redevelopment' : 'Greenfield/JD';
}

function renderPipelineSection(dupIds) {
  const cats = ['Greenfield/JD', 'Redevelopment'];
  const counts = cats.map(c => STATE.deals.filter(d => dealCategory(d) === c).length);
  const tabs = cats.map((c, i) =>
    `<button class="cat-tab ${c === PIPELINE_CATEGORY ? 'active' : ''}" data-cat="${c}">${c} (${counts[i]})</button>`
  ).join('');

  const base = STATE.deals.filter(d => dealCategory(d) === PIPELINE_CATEGORY);
  const list = applyFilters(base, dupIds);

  const rows = list.length === 0
    ? `<tr><td colspan="6"><div class="empty-state">No parcels match the current filters.</div></td></tr>`
    : list.map(d => `
      <tr>
        <td><b>${escapeHTML(d.parcelName || '—')}</b>${d.surveyNumber ? '<br><span style="color:var(--grey);font-size:11px;">Survey No. ' + escapeHTML(d.surveyNumber) + '</span>' : ''}</td>
        <td>${escapeHTML(d.location || '—')}</td>
        <td>${stageBadge(d.stage)}</td>
        <td>${categoryBadge(d.leadCategory)}</td>
        <td>${dupIds.has(d.id) ? '<span class="badge badge-dup" title="Another parcel shares this name, location, and survey number">⚠ Duplicate?</span>' : ''}</td>
        <td><button class="view-btn" onclick="openPlotModal('${d.id}')">View</button></td>
      </tr>`).join('');

  return `
    <div class="card">
      <div class="cat-tabs">${tabs}</div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Parcel</th><th>Location</th><th>Stage</th><th>Category</th><th></th><th></th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
}

function bindCategoryTabs() {
  document.querySelectorAll('[data-cat]').forEach(btn => {
    btn.addEventListener('click', () => {
      PIPELINE_CATEGORY = btn.dataset.cat;
      render();
    });
  });
}

function openPlotModal(dealId) {
  const d = STATE.deals.find(x => x.id === dealId);
  if (!d) return;
  document.getElementById('plotModalTitle').textContent = d.parcelName || 'Plot Details';

  const gLink = d.googleLocation
    ? `<a href="${escapeHTML(d.googleLocation)}" target="_blank" rel="noopener">Open in Google Maps →</a>`
    : '—';
  const source = `${escapeHTML(d.source || '—')}${d.sourceDetail ? ' — ' + escapeHTML(d.sourceDetail) : ''}${d.sourcePhone ? ' (' + escapeHTML(d.sourcePhone) + ')' : ''}`;
  const owner = `${escapeHTML(d.ownerName || '—')}${d.ownerPhone ? ' — ' + escapeHTML(d.ownerPhone) : ''}`;
  const road = `${d.roadWidth ? d.roadWidth + ' ft' : '—'}${d.roadConnectivity ? ' — ' + escapeHTML(d.roadConnectivity) : ''}`;

  document.getElementById('plotModalBody').innerHTML = `
    <div class="plot-grid">
      <div><span class="pg-label">Area of Plot</span><span class="pg-val">${d.areaAcres ? d.areaAcres + ' acres' : '—'}</span></div>
      <div><span class="pg-label">Location</span><span class="pg-val">${escapeHTML(d.location || '—')}</span></div>
      <div><span class="pg-label">Survey Number</span><span class="pg-val">${escapeHTML(d.surveyNumber || '—')}</span></div>
      <div><span class="pg-label">Google Location</span><span class="pg-val">${gLink}</span></div>
      <div><span class="pg-label">Source</span><span class="pg-val">${source}</span></div>
      <div><span class="pg-label">Owner</span><span class="pg-val">${owner}</span></div>
      <div><span class="pg-label">Road Width &amp; Connectivity</span><span class="pg-val">${road}</span></div>
      <div class="pg-val full"><span class="pg-label">Feasibility of Plot</span><span class="pg-val">${escapeHTML(d.feasibilityNotes || '—')}</span></div>
    </div>`;
  document.getElementById('plotModal').classList.add('active');
}

function closePlotModal() {
  document.getElementById('plotModal').classList.remove('active');
}

/* ============================================================
   SECTION 2 — WORK DONE (per-deal activity counts)
   ============================================================ */

function activityCounts(dealId) {
  const acts = STATE.dealActivity.filter(a => a.dealId === dealId);
  const count = type => acts.filter(a => a.activityType === type).length;
  return {
    visits: count('Site Visit'),
    meetings: count('Meeting'),
    calls: count('Call')
  };
}

function renderWorkDoneSection() {
  const base = STATE.deals.filter(d => d.stage !== 'Dropped');
  const list = applyFilters(base, null);
  const rows = list.length === 0
    ? `<tr><td colspan="7"><div class="empty-state">No parcels match the current filters.</div></td></tr>`
    : list.map(d => {
      const c = activityCounts(d.id);
      const overdue = d.nextActionDate && new Date(d.nextActionDate) < new Date() && !['Signed', 'Dropped'].includes(d.stage);
      return `<tr>
        <td><b>${escapeHTML(d.parcelName || '—')}</b></td>
        <td>${c.visits}</td>
        <td>${c.meetings}</td>
        <td>${c.calls}</td>
        <td>${categoryBadge(d.leadCategory)}</td>
        <td>${stageBadge(d.stage)}</td>
        <td>
          ${escapeHTML(d.nextAction || '—')}${d.nextActionDate ? '<br><span style="font-size:11px;' + (overdue ? 'color:var(--red-deep);font-weight:700;' : 'color:var(--grey);') + '">' + formatDateShort(d.nextActionDate) + (overdue ? ' (Overdue)' : '') + '</span>' : ''}
          <br><button class="link-btn" onclick="openTimelineModal('${d.id}')">Activity →</button>
        </td>
      </tr>`;
    }).join('');

  return `
    <div class="card">
      <div class="table-wrap">
        <table>
          <thead><tr><th>Parcel</th><th>Visits</th><th>Meetings</th><th>Calls</th><th>Category</th><th>Status</th><th>Next Reminder</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
}

function openTimelineModal(dealId) {
  const deal = STATE.deals.find(d => d.id === dealId);
  if (!deal) return;
  document.getElementById('timelineModalTitle').textContent = (deal.parcelName || '') + ' — Activity Timeline';

  const events = (STATE.dealActivity || [])
    .filter(a => a.dealId === dealId)
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  const body = document.getElementById('timelineModalBody');
  if (events.length === 0) {
    body.innerHTML = `<div class="empty-state"><div class="icon">📅</div>No activity logged yet for this parcel.</div>`;
    document.getElementById('timelineModal').classList.add('active');
    return;
  }

  const typeIcon = {
    'Site Visit': '👣', 'Call': '📞', 'Meeting': '🤝',
    'Proposal': '📄', 'Legal Update': '⚖️', 'Negotiation': '🤝', 'Other': '📌'
  };

  body.innerHTML = `<div class="timeline-list">${events.map(a => `
    <div class="timeline-item">
      <div class="timeline-dot"></div>
      <div class="timeline-date">${formatDateShort(a.date)} &middot; ${escapeHTML(a.activityType)}</div>
      <div style="font-size:13.5px;color:var(--ink);margin-top:3px;">${typeIcon[a.activityType] || '📌'} ${escapeHTML(a.summary || '')}</div>
      ${a.nextFollowupDate ? `<div style="font-size:11.5px;color:var(--grey);margin-top:4px;">📅 Next follow-up: ${formatDateShort(a.nextFollowupDate)}</div>` : ''}
    </div>`).join('')}</div>`;
  document.getElementById('timelineModal').classList.add('active');
}

function closeTimelineModal() {
  document.getElementById('timelineModal').classList.remove('active');
}

/* ============================================================
   SECTION 3 — DEAL CLOSING CHECKLIST
   ============================================================ */

function checklistBadge(status) {
  const done = status === 'Done';
  return `<span class="badge ${done ? 'badge-done' : 'badge-pending'}">${done ? 'Done' : 'Pending'}</span>`;
}

function renderChecklistSection() {
  const base = STATE.deals.filter(d => d.stage !== 'Dropped');
  const list = applyFilters(base, null);
  const rows = list.length === 0
    ? `<tr><td colspan="7"><div class="empty-state">No parcels match the current filters.</div></td></tr>`
    : list.map(d => `
      <tr>
        <td><b>${escapeHTML(d.parcelName || '—')}</b></td>
        <td>${checklistBadge(d.closedStatus)}</td>
        <td>${checklistBadge(d.demarcationStatus)}</td>
        <td>${checklistBadge(d.privateStatus)}</td>
        <td>${checklistBadge(d.mouStatus)}</td>
        <td>${checklistBadge(d.paDaStatus)}</td>
        <td>${checklistBadge(d.compoundWallStatus)}</td>
      </tr>`).join('');

  return `
    <div class="card">
      <div class="table-wrap">
        <table>
          <thead><tr><th>Parcel</th><th>Closed</th><th>Demarcation</th><th>Private</th><th>MOU</th><th>PA/DA</th><th>Compound Wall</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
}

/* ============================================================
   SECTION 4 — P&L
   ============================================================ */

function renderPnLSection() {
  const base = STATE.deals.filter(d => d.stage !== 'Dropped');
  const list = applyFilters(base, null);

  const sum = key => list.reduce((s, d) => s + (Number(d[key]) || 0), 0);
  const hasVal = (d, key) => d[key] !== '' && d[key] !== undefined && d[key] !== null;
  const avg = key => {
    const vals = list.filter(d => hasVal(d, key)).map(d => Number(d[key])).filter(v => !isNaN(v));
    return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
  };

  const totalGDV = sum('expectedGDV');
  const totalInvestment = sum('totalInvestment');
  const totalPBIT = sum('pbitAmount');
  const totalPAT = sum('patAmount');
  const avgROI = avg('roiPct');
  const avgProfitPsf = avg('profitPerSft');
  const avgPBITPct = avg('pbitPct');
  const avgPATPct = avg('patPct');

  const fmtCr = v => v ? '₹' + v.toFixed(2) + ' Cr' : '—';
  const fmtPct = v => v === null ? '—' : v.toFixed(1) + '%';

  const cards = `
    <div class="pl-grid">
      <div class="pl-card"><div class="pl-label">Total GDV</div><div class="pl-value">${fmtCr(totalGDV)}</div></div>
      <div class="pl-card alt"><div class="pl-label">Total Investment</div><div class="pl-value">${fmtCr(totalInvestment)}</div></div>
      <div class="pl-card alt2"><div class="pl-label">PBIT</div><div class="pl-value">${fmtCr(totalPBIT)}</div><div class="pl-sub">avg ${fmtPct(avgPBITPct)} of profit</div></div>
      <div class="pl-card alt2"><div class="pl-label">PAT</div><div class="pl-value">${fmtCr(totalPAT)}</div><div class="pl-sub">avg ${fmtPct(avgPATPct)} of profit</div></div>
      <div class="pl-card alt3"><div class="pl-label">ROI %</div><div class="pl-value">${fmtPct(avgROI)}</div><div class="pl-sub">average across parcels</div></div>
      <div class="pl-card alt3"><div class="pl-label">Profit / sft</div><div class="pl-value">${avgProfitPsf ? '₹' + Math.round(avgProfitPsf) : '—'}</div><div class="pl-sub">average across parcels</div></div>
    </div>`;

  const rows = list.length === 0
    ? `<tr><td colspan="7"><div class="empty-state">No parcels match the current filters.</div></td></tr>`
    : list.map(d => `
      <tr>
        <td><b>${escapeHTML(d.parcelName || '—')}</b></td>
        <td>${d.expectedGDV ? '₹' + d.expectedGDV + ' Cr' : '—'}</td>
        <td>${d.totalInvestment ? '₹' + d.totalInvestment + ' Cr' : '—'}</td>
        <td>${d.pbitAmount ? '₹' + d.pbitAmount + ' Cr' : '—'}${d.pbitPct ? ' (' + d.pbitPct + '%)' : ''}</td>
        <td>${d.patAmount ? '₹' + d.patAmount + ' Cr' : '—'}${d.patPct ? ' (' + d.patPct + '%)' : ''}</td>
        <td>${d.roiPct ? d.roiPct + '%' : '—'}</td>
        <td>${d.profitPerSft ? '₹' + d.profitPerSft : '—'}</td>
      </tr>`).join('');

  return `
    ${cards}
    <div class="card">
      <div class="card-title">Per-Parcel Breakdown</div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Parcel</th><th>GDV</th><th>Investment</th><th>PBIT</th><th>PAT</th><th>ROI %</th><th>Profit/sft</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
}

/* ============================================================
   SHARED HELPERS
   ============================================================ */

function stageBadge(stage) {
  const map = {
    'Lead': 'badge-sourcing', 'Site Visit Done': 'badge-sourcing',
    'Feasibility': 'badge-evaluation', 'Negotiation': 'badge-negotiation',
    'Term Sheet': 'badge-negotiation', 'Due Diligence': 'badge-negotiation',
    'Signed': 'badge-closed-signed', 'Dropped': 'badge-closed-dropped'
  };
  return `<span class="badge ${map[stage] || 'badge-sourcing'}">${escapeHTML(stage || '—')}</span>`;
}

function categoryBadge(category) {
  const map = {
    'Hot': { cls: 'badge-closed-signed', dot: '🟢' },
    'Warm': { cls: 'badge-evaluation', dot: '🟡' },
    'Cold': { cls: 'badge-closed-dropped', dot: '🔴' },
  };
  const c = map[category] || map['Warm'];
  return `<span class="badge ${c.cls}">${c.dot} ${escapeHTML(category || 'Warm')}</span>`;
}

function formatDateShort(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (isNaN(d)) return dateStr;
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' });
}

function escapeHTML(str) {
  if (str === undefined || str === null) return '';
  return String(str).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}
