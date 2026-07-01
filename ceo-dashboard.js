/* ============================================================
   MANGALAM LANDMARKS — BD TRACKER — CEO DASHBOARD
   Read-only analytics view, EXCEPT setTarget (AOP target editing) which
   is the one deliberate write capability on this dashboard. Do not add
   any other write actions here without an explicit instruction to do so.
   ============================================================ */

// ⚠️ Same deployed Apps Script Web App URL as app.js — must match exactly.
const API_URL = "https://script.google.com/macros/s/AKfycbwnusKhEVckQbtT4BR_Txm15UjH4w1oaUylIuY6uvJK9kYpU0RdHVm6aa7IhMyg0U0_/exec";

// Mirrors DOCUMENT_CHECKLIST in Code.gs — keep both in sync if this changes.
const DOCUMENT_CHECKLIST = {
  'A': { label: 'Property Documents', docs: ['7/12 of Land', 'MOU', 'PA/DA', 'Property Card', 'Ferfar'] },
  'B': { label: 'Technical & Planning Documents', docs: ['Demarcation', 'Plan', 'FSI Statement'] },
  'C': { label: 'Feasibility', docs: ['Feasibility Report'] },
  'D': { label: 'Redevelopment', docs: ['Conveyance Deed', 'Carpet Area', 'Sanction Plan', 'Completion Plan'] }
};

let STATE = { dailyLogs: [], deals: [], targets: [], stageHistory: [], dealActivity: [], documents: [] };
let SELECTED_QUARTER = getCurrentQuarter();
let PIPELINE_SEARCH_TERM = '';
let SEARCH_TYPE_FILTER = 'All';

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('todayBadge').textContent = formatDateLong(new Date());
  setupTimelineModal();
  setupCeoDocumentModal();
  setupSearchPanel();
  loadData();
  setInterval(loadData, 5 * 60 * 1000); // auto-refresh every 5 minutes
});

/* ---------------- API ---------------- */

async function apiCall(action, payload) {
  let url = `${API_URL}?action=${action}`;
  if (payload) url += `&payload=${encodeURIComponent(JSON.stringify(payload))}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Network error: ' + res.status);
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || 'Unknown API error');
  return json;
}

async function loadData() {
  try {
    const res = await apiCall('getCeoSummary');
    STATE = res.data;
    if (!STATE.dealActivity) STATE.dealActivity = [];
    if (!STATE.documents) STATE.documents = [];
    document.getElementById('refreshNote').textContent = 'Updated ' + new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
    render();
  } catch (err) {
    document.getElementById('dashboardRoot').innerHTML = `
      <div class="empty-state">
        <div class="icon">🔌</div>
        <b>Could not load data</b><br>${escapeHTML(err.message)}<br>
        ${API_URL.includes('PASTE_YOUR') ? 'Paste your Apps Script Web App URL into API_URL in ceo-dashboard.js.' : 'Retrying automatically every 5 minutes.'}
      </div>`;
  }
}

/* ---------------- MAIN RENDER ---------------- */

function render() {
  const root = document.getElementById('dashboardRoot');
  root.innerHTML = `
    <div class="section-label">Performance at a Glance<div class="line"></div></div>
    ${renderTopKPITable()}

    <div class="section-label">AOP Red Flags<div class="line"></div></div>
    <div class="card">${renderAOPRedFlags()}</div>

    <div class="section-label">Deal Funnel — Live Snapshot<div class="line"></div></div>
    <div class="card">${renderFunnelHTML()}</div>

    <div class="section-label">AOP Target Progress<div class="line"></div></div>
    <div class="card">
      <div class="quarter-tabs" id="quarterTabs"></div>
      <div id="quarterProgressBody"></div>
    </div>

    <div class="section-label">Lead Conversion — Cumulative to Date<div class="line"></div></div>
    <div class="card">${renderConversionRatios()}</div>

    <div class="section-label">Stalled Deals<div class="line"></div></div>
    <div class="card">${renderStalledDeals()}</div>

    <div class="grid-2">
      <div>
        <div class="section-label">Source-Wise Performance<div class="line"></div></div>
        <div class="card">${renderSourcePerformance()}</div>
      </div>
      <div>
        <div class="section-label">Micro-Market Comparison<div class="line"></div></div>
        <div class="card">${renderMicroMarketComparison()}</div>
      </div>
    </div>

    <div class="section-label">Annual Forecast / Run-Rate<div class="line"></div></div>
    <div class="card">${renderAnnualForecast()}</div>

    <div class="section-label">Full Pipeline<div class="line"></div></div>
    <div class="card">
      <input type="text" id="pipelineSearchInput" placeholder="Search parcel, location, source, owner…"
        style="width:100%;padding:10px 14px;border:1px solid var(--border);border-radius:8px;font-size:13.5px;margin-bottom:16px;">
      <div id="pipelineCardsBody"></div>
    </div>

    <div class="footer-note">Mangalam Landmarks — BD Tracker · CEO Dashboard · Read-only (target editing excepted)</div>
  `;

  renderQuarterTabs();
  renderQuarterProgress();
  renderPipelineCards();

  document.getElementById('pipelineSearchInput').addEventListener('input', (e) => {
    PIPELINE_SEARCH_TERM = e.target.value.trim().toLowerCase();
    renderPipelineCards();
  });
}

/* ---------------- TOP KPI TABLE ----------------
   5 windows (Daily / Monthly / Quarterly / Annual / All-Time) x 4 metrics
   (Leads Sourced, Site Visits, Deals Closed, Broker Meetings). Targets are
   derived from the AOP's quarterly Targets sheet where one exists
   (Leads Sourced, Deals Signed); Site Visits and Broker Meetings have no
   AOP target defined anywhere in the source data, so they show
   achieved-only with target/% as "—". This table always reflects the
   CURRENT quarter/month/day (via getCurrentQuarter()), independent of the
   quarter-toggle used further down in the AOP Target Progress section. */

function renderTopKPITable() {
  const today = new Date();
  const todayISO = toISODate(today);
  const currentQuarter = getCurrentQuarter();
  const [qStart, qEnd] = quarterBoundsCalendar(currentQuarter);
  const monthStart = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`;
  const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  const monthEnd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;

  const sumLogs = (key, startCal, endCal) => STATE.dailyLogs
    .filter(d => { const c = extractDateOnly(d.date); return c && c >= startCal && c <= endCal; })
    .reduce((s, d) => s + (Number(d[key]) || 0), 0);

  const countDealsSigned = (startCal, endCal) => STATE.deals
    .filter(d => {
      if (d.stage !== 'Signed') return false;
      const c = extractDateOnly(d.lastUpdated);
      return c && c >= startCal && c <= endCal;
    }).length;

  // All-time bounds — earliest possible to today
  const ALL_START = '0000-01-01';

  const windows = [
    { label: 'Daily', start: todayISO, end: todayISO },
    { label: 'Monthly', start: monthStart, end: monthEnd },
    { label: 'Quarterly', start: qStart, end: qEnd },
    { label: 'Annual', start: annualBoundsForQuarter(currentQuarter)[0], end: annualBoundsForQuarter(currentQuarter)[1] },
    { label: 'All-Time', start: ALL_START, end: todayISO },
  ];

  // AOP targets: quarterly figures from the Targets sheet, prorated down
  // to monthly/daily, summed up to annual. All-Time has no meaningful
  // target (spans indefinitely), so it's left blank.
  const qTarget = STATE.targets.find(t => t.periodType === 'quarterly' && t.periodLabel === currentQuarter) || {};
  const quarters = ['Q1', 'Q2', 'Q3', 'Q4'].map(q => q + ' ' + currentQuarter.split(' ')[1]);
  const annualLeadsTarget = quarters.reduce((s, q) => {
    const t = STATE.targets.find(x => x.periodType === 'quarterly' && x.periodLabel === q);
    return s + (t ? Number(t.targetLeadsSourced) || 0 : 0);
  }, 0);
  const annualDealsTarget = quarters.reduce((s, q) => {
    const t = STATE.targets.find(x => x.periodType === 'quarterly' && x.periodLabel === q);
    return s + (t ? Number(t.targetDealsSigned) || 0 : 0);
  }, 0);

  const qLeadsTarget = Number(qTarget.targetLeadsSourced) || 0;
  const qDealsTarget = Number(qTarget.targetDealsSigned) || 0;
  const monthlyLeadsTarget = qLeadsTarget / 3;
  const monthlyDealsTarget = qDealsTarget / 3;
  const dailyLeadsTarget = monthlyLeadsTarget / daysInMonth;
  const dailyDealsTarget = monthlyDealsTarget / daysInMonth;

  const targetsByWindow = {
    Daily: { leads: dailyLeadsTarget, deals: dailyDealsTarget },
    Monthly: { leads: monthlyLeadsTarget, deals: monthlyDealsTarget },
    Quarterly: { leads: qLeadsTarget, deals: qDealsTarget },
    Annual: { leads: annualLeadsTarget, deals: annualDealsTarget },
    'All-Time': { leads: null, deals: null },
  };

  const fmtCell = (achieved, target) => {
    if (target === null || target === undefined) {
      return `<div class="dcg-val">${achieved}</div><div class="dcg-label" style="color:var(--grey-soft);">no target</div>`;
    }
    const t = Math.round(target * 10) / 10;
    const pct = t > 0 ? Math.round((achieved / t) * 100) : 0;
    const color = pct >= 100 ? 'var(--green)' : pct >= 60 ? 'var(--amber)' : 'var(--red)';
    return `<div class="dcg-val">${achieved} / ${t}</div><div class="dcg-label" style="color:${color};">${pct}%</div>`;
  };

  const metricRow = (label, key, hasTarget) => {
    const cells = windows.map(w => {
      const achieved = key === 'dealsSigned'
        ? countDealsSigned(w.start, w.end)
        : sumLogs(key, w.start, w.end);
      const target = hasTarget ? (targetsByWindow[w.label][key === 'newLeads' ? 'leads' : 'deals']) : null;
      return `<td>${fmtCell(achieved, target)}</td>`;
    }).join('');
    return `<tr><td><b>${label}</b></td>${cells}</tr>`;
  };

  return `
    <div class="card">
      <div class="card-title">Target vs Achieved — Leads, Site Visits, Deals Closed, Broker Meetings
        <span class="as-of">as of ${formatDateShort(todayISO)} · ${currentQuarter}</span>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Metric</th>${windows.map(w => `<th>${w.label}</th>`).join('')}</tr></thead>
          <tbody>
            ${metricRow('Leads Sourced', 'newLeads', true)}
            ${metricRow('Site Visits', 'siteVisits', false)}
            ${metricRowDeals()}
            ${metricRow('Broker Meetings', 'brokerMeetings', false)}
          </tbody>
        </table>
      </div>
      <p style="font-size:11px;color:var(--grey-soft);margin-top:12px;">
        Targets shown for Leads Sourced and Deals Closed are derived from the AOP's quarterly targets (prorated for Daily/Monthly, summed for Annual).
        Site Visits and Broker Meetings have no AOP target defined, so only achieved counts are shown for those.
      </p>
    </div>`;

  function metricRowDeals() {
    const cells = windows.map(w => {
      const achieved = countDealsSigned(w.start, w.end);
      const target = targetsByWindow[w.label].deals;
      return `<td>${fmtCell(achieved, target)}</td>`;
    }).join('');
    return `<tr><td><b>Deals Closed</b></td>${cells}</tr>`;
  }
}

// Returns [start, end] calendar-date strings for the full FY containing the
// given quarter label (e.g. "Q2 FY26-27" -> FY26-27's Apr 1 to Mar 31).
function annualBoundsForQuarter(qLabel) {
  const m = qLabel.match(/FY(\d\d)-(\d\d)/);
  if (!m) return ['0000-00-00', '9999-99-99'];
  const startYear = 2000 + Number(m[1]);
  const endYear = 2000 + Number(m[2]);
  return [`${startYear}-04-01`, `${endYear}-03-31`];
}

/* ---------------- AOP RED FLAGS ---------------- */

function renderAOPRedFlags() {
  const flags = [];
  const today = new Date();
  const currentQuarter = getCurrentQuarter();
  const [fyStartStr] = annualBoundsForQuarter(currentQuarter);

  // Flag 1: 0 signed by June 15 (AOP Section 07)
  const june15 = new Date(today.getFullYear(), 5, 15);
  const fyStart = new Date(fyStartStr + 'T00:00:00');
  if (today >= new Date(fyStart.getFullYear(), 5, 1) && today <= new Date(fyStart.getFullYear(), 11, 31)) {
    const signedByJune15 = STATE.deals.filter(d => {
      if (d.stage !== 'Signed') return false;
      const upd = extractDateOnly(d.lastUpdated);
      return upd && upd <= toISODate(new Date(fyStart.getFullYear(), 5, 15));
    }).length;
    if (today > new Date(fyStart.getFullYear(), 5, 15) && signedByJune15 === 0) {
      flags.push({ text: '0 deals signed by June 15 — AOP pace target missed for Q1.', severity: 'high' });
    }
  }

  // Flag 2: fewer than 60 active leads
  const activeLeads = STATE.deals.filter(d => !['Signed', 'Dropped'].includes(d.stage)).length;
  if (activeLeads < 60) {
    flags.push({ text: `Only ${activeLeads} active leads in the pipeline (AOP expects ≥60 maintained at all times).`, severity: 'medium' });
  }

  // Flag 3: IRR < 30% past the filter stage (Feasibility onward)
  const pastFilterStages = ['Feasibility', 'Negotiation', 'Term Sheet', 'Due Diligence', 'Signed'];
  STATE.deals.filter(d => pastFilterStages.includes(d.stage)).forEach(d => {
    const irr = Number(d.irrPct);
    if (d.irrPct !== '' && d.irrPct !== undefined && !isNaN(irr) && irr < 30) {
      flags.push({ text: `${d.parcelName}: IRR ${irr}% is below the 30% floor at stage "${d.stage}".`, severity: 'high' });
    }
  });

  // Flag 4: flagged legal issues
  STATE.deals.filter(d => d.legalGateStatus === 'Flagged Issue').forEach(d => {
    flags.push({ text: `${d.parcelName}: legal/title issue flagged — needs Atul's review before proceeding.`, severity: 'high' });
  });

  if (flags.length === 0) {
    return `<div class="empty-state"><div class="icon">✅</div>No AOP red flags right now.</div>`;
  }
  return flags.map(f => `
    <div style="display:flex;align-items:flex-start;gap:10px;padding:10px 0;border-bottom:1px solid var(--border-soft);">
      <span style="font-size:16px;">${f.severity === 'high' ? '🔴' : '🟡'}</span>
      <span style="font-size:13.5px;color:var(--ink);">${escapeHTML(f.text)}</span>
    </div>`).join('');
}

/* ---------------- FUNNEL ---------------- */

function renderFunnelHTML() {
  const counts = { Sourcing: 0, 'Site Visit': 0, Negotiation: 0, Closed: 0 };
  STATE.deals.forEach(d => {
    if (['Lead'].includes(d.stage)) counts.Sourcing++;
    else if (['Site Visit Done'].includes(d.stage)) counts['Site Visit']++;
    else if (['Feasibility', 'Negotiation', 'Term Sheet', 'Due Diligence'].includes(d.stage)) counts.Negotiation++;
    else if (['Signed', 'Dropped'].includes(d.stage)) counts.Closed++;
  });
  return `
    <div class="funnel-wrap">
      <div class="funnel-stage"><div class="fs-count">${counts.Sourcing}</div><div class="fs-label">Sourcing / Leads</div></div>
      <div class="funnel-stage"><div class="fs-count">${counts['Site Visit']}</div><div class="fs-label">Site Visit Done</div></div>
      <div class="funnel-stage"><div class="fs-count">${counts.Negotiation}</div><div class="fs-label">Evaluation / Negotiation</div></div>
      <div class="funnel-stage"><div class="fs-count">${counts.Closed}</div><div class="fs-label">Closed (Signed/Dropped)</div></div>
    </div>`;
}

/* ---------------- QUARTER TABS + AOP TARGET PROGRESS ---------------- */

function renderQuarterTabs() {
  const quarters = ['Q1 FY26-27', 'Q2 FY26-27', 'Q3 FY26-27', 'Q4 FY26-27'];
  document.getElementById('quarterTabs').innerHTML = quarters.map(q =>
    `<button class="quarter-tab ${q === SELECTED_QUARTER ? 'active' : ''}" data-q="${q}">${q}</button>`
  ).join('');
  document.querySelectorAll('.quarter-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      SELECTED_QUARTER = btn.dataset.q;
      renderQuarterTabs();
      renderQuarterProgress();
    });
  });
}

function progressRow(label, actual, target, isDecimal) {
  const pct = target > 0 ? Math.min(100, (actual / target) * 100) : 0;
  const cls = pct >= 100 ? '' : pct >= 50 ? 'gold' : 'amber';
  const a = isDecimal ? Number(actual).toFixed(1) : actual;
  return `
    <div class="progress-row">
      <div class="pr-label"><span class="name">${label}</span><span class="val">${a} / ${target}</span></div>
      <div class="progress-bar-bg"><div class="progress-bar-fill ${cls}" style="width:${pct}%"></div></div>
    </div>`;
}

function renderQuarterProgress() {
  const t = STATE.targets.find(x => x.periodType === 'quarterly' && x.periodLabel === SELECTED_QUARTER) || {};
  const proposalsActual = sumProposalsInQuarter(SELECTED_QUARTER);
  const acresActual = sumAcresSignedInQuarter(SELECTED_QUARTER);
  const dealsActual = countDealsSignedInQuarter(SELECTED_QUARTER);

  document.getElementById('quarterProgressBody').innerHTML = `
    ${progressRow('Proposals Presented', proposalsActual, t.targetProposals || 0)}
    ${progressRow('Acres Signed', acresActual, t.targetAcres || 0, true)}
    ${progressRow('Deals Signed', dealsActual, t.targetDealsSigned || 0)}
    <div class="section-label" style="margin-top:24px;">Lead Conversion Funnel<div class="line"></div></div>
    ${renderFunnelConversionRatios(t)}
    <div class="section-label" style="margin-top:24px;">Set / Adjust Targets for ${SELECTED_QUARTER}<div class="line"></div></div>
    ${renderTargetEditForm(t)}
  `;

  const form = document.getElementById('targetEditForm');
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const payload = {
        periodType: 'quarterly',
        periodLabel: SELECTED_QUARTER,
        targetProposals: document.getElementById('te_targetProposals').value,
        targetAcres: document.getElementById('te_targetAcres').value,
        targetDealsSigned: document.getElementById('te_targetDealsSigned').value,
      };
      try {
        await apiCall('setTarget', payload);
        showToast('Targets updated for ' + SELECTED_QUARTER + '.');
        await loadData();
      } catch (err) {
        showToast('Failed to update targets: ' + err.message, true);
      }
    });
  }
}

// CONVERSION RATIO ONLY — editable target/actual UI was intentionally
// removed here per explicit instruction. The Sourced/Qualified/Prospects
// numbers themselves are edited directly in the Google Sheet's Targets
// tab, not from this dashboard. Do not reintroduce editable inputs for
// these three fields without being explicitly asked to.
function renderFunnelConversionRatios(t) {
  const sourced = Number(t.actualLeadsSourced) || 0;
  const qualified = Number(t.actualLeadsQualified) || 0;
  const prospects = Number(t.actualProspects) || 0;
  const ratio1 = sourced > 0 ? ((qualified / sourced) * 100).toFixed(1) : '—';
  const ratio2 = qualified > 0 ? ((prospects / qualified) * 100).toFixed(1) : '—';
  return `
    <div class="stat-strip">
      <div class="stat">Sourcing → BD Head Filter<br><b>${ratio1}${ratio1 !== '—' ? '%' : ''}</b></div>
      <div class="stat">BD Head Filter → Refinement<br><b>${ratio2}${ratio2 !== '—' ? '%' : ''}</b></div>
      <div class="stat">Sourced<br><b>${sourced}</b></div>
      <div class="stat">Qualified<br><b>${qualified}</b></div>
      <div class="stat">Prospects<br><b>${prospects}</b></div>
    </div>`;
}

function renderTargetEditForm(t) {
  return `
    <form id="targetEditForm" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;align-items:end;">
      <div>
        <label style="display:block;font-size:11px;font-weight:700;color:var(--grey);text-transform:uppercase;margin-bottom:5px;">Target Proposals</label>
        <input type="number" id="te_targetProposals" value="${t.targetProposals || ''}" style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:6px;">
      </div>
      <div>
        <label style="display:block;font-size:11px;font-weight:700;color:var(--grey);text-transform:uppercase;margin-bottom:5px;">Target Acres</label>
        <input type="number" step="0.1" id="te_targetAcres" value="${t.targetAcres || ''}" style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:6px;">
      </div>
      <div>
        <label style="display:block;font-size:11px;font-weight:700;color:var(--grey);text-transform:uppercase;margin-bottom:5px;">Target Deals Signed</label>
        <input type="number" id="te_targetDealsSigned" value="${t.targetDealsSigned || ''}" style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:6px;">
      </div>
      <button type="submit" class="quarter-tab" style="background:var(--red);color:white;border-color:var(--red);cursor:pointer;">Save</button>
    </form>`;
}

/* ---------------- CONVERSION RATIOS (cumulative to date) ---------------- */

function renderConversionRatios() {
  const stageCounts = { 'Site Visit Done': 0, Lead: 0, Negotiation: 0, 'Term Sheet': 0, 'Due Diligence': 0, Signed: 0, Feasibility: 0 };
  STATE.deals.forEach(d => { if (stageCounts.hasOwnProperty(d.stage)) stageCounts[d.stage]++; });

  const totalLeadsEver = STATE.deals.length;
  const siteVisitsEver = STATE.deals.filter(d => !['Lead'].includes(d.stage)).length;
  const negotiationEver = STATE.deals.filter(d => ['Feasibility', 'Negotiation', 'Term Sheet', 'Due Diligence', 'Signed'].includes(d.stage)).length;
  const signedEver = STATE.deals.filter(d => d.stage === 'Signed').length;

  const pct = (num, den) => den > 0 ? ((num / den) * 100).toFixed(1) + '%' : '—';

  return `
    <div class="stat-strip">
      <div class="stat">Site Visits → Leads<br><b>${pct(siteVisitsEver, totalLeadsEver)}</b></div>
      <div class="stat">Leads → Negotiation<br><b>${pct(negotiationEver, totalLeadsEver)}</b></div>
      <div class="stat">Negotiation → Signed<br><b>${pct(signedEver, negotiationEver)}</b></div>
      <div class="stat">Overall Lead → Signed<br><b>${pct(signedEver, totalLeadsEver)}</b></div>
    </div>
    <p style="font-size:11px;color:var(--grey-soft);margin-top:14px;">Cumulative-to-date across all deals ever entered, not limited to the selected quarter.</p>
  `;
}

/* ---------------- STALLED DEALS ---------------- */

function renderStalledDeals() {
  const activeDeals = STATE.deals.filter(d => !['Signed', 'Dropped'].includes(d.stage));
  const stalled = activeDeals.map(d => {
    const lastEvent = getMostRecentStageChangeDate(d.id) || d.dateAdded;
    const daysSince = lastEvent ? Math.floor((new Date() - new Date(lastEvent)) / (1000 * 60 * 60 * 24)) : 0;
    return { deal: d, daysSince };
  }).filter(x => x.daysSince >= 30).sort((a, b) => b.daysSince - a.daysSince);

  if (stalled.length === 0) {
    return `<div class="empty-state"><div class="icon">✅</div>No deals have been stalled for 30+ days.</div>`;
  }

  return `<div class="table-wrap"><table><thead><tr><th>Parcel</th><th>Stage</th><th>Days Since Last Movement</th><th>Severity</th></tr></thead><tbody>
    ${stalled.map(x => {
      const sev = x.daysSince >= 90 ? { label: '90+ days', cls: 'badge-closed-dropped' }
        : x.daysSince >= 60 ? { label: '60+ days', cls: 'badge-negotiation' }
        : { label: '30+ days', cls: 'badge-evaluation' };
      return `<tr>
        <td><b>${escapeHTML(x.deal.parcelName)}</b><br><span style="color:var(--grey);font-size:12px;">${escapeHTML(x.deal.location || '')}</span></td>
        <td>${escapeHTML(x.deal.stage)}</td>
        <td>${x.daysSince} days</td>
        <td><span class="badge ${sev.cls}">${sev.label}</span></td>
      </tr>`;
    }).join('')}
  </tbody></table></div>`;
}

function getMostRecentStageChangeDate(dealId) {
  const events = STATE.stageHistory.filter(h => h.dealId === dealId);
  if (events.length === 0) return null;
  return events.reduce((latest, h) => new Date(h.changedAt) > new Date(latest) ? h.changedAt : latest, events[0].changedAt);
}

/* ---------------- SOURCE-WISE PERFORMANCE ---------------- */

function renderSourcePerformance() {
  const bySource = {};
  STATE.deals.forEach(d => {
    const src = d.source || 'Unknown';
    if (!bySource[src]) bySource[src] = { total: 0, signed: 0 };
    bySource[src].total++;
    if (d.stage === 'Signed') bySource[src].signed++;
  });
  const rows = Object.entries(bySource).sort((a, b) => b[1].total - a[1].total);
  if (rows.length === 0) return `<div class="empty-state"><div class="icon">📊</div>No pipeline data yet.</div>`;
  return `<div class="table-wrap"><table><thead><tr><th>Source</th><th>Total Leads</th><th>Signed</th><th>Conversion</th></tr></thead><tbody>
    ${rows.map(([src, v]) => `<tr><td><b>${escapeHTML(src)}</b></td><td>${v.total}</td><td>${v.signed}</td><td>${v.total > 0 ? ((v.signed / v.total) * 100).toFixed(1) + '%' : '—'}</td></tr>`).join('')}
  </tbody></table></div>`;
}

/* ---------------- MICRO-MARKET COMPARISON ---------------- */

function renderMicroMarketComparison() {
  const byLocation = {};
  STATE.deals.forEach(d => {
    const loc = d.location || 'Unspecified';
    if (!byLocation[loc]) byLocation[loc] = { count: 0, acres: 0, avgGDV: [] };
    byLocation[loc].count++;
    byLocation[loc].acres += Number(d.areaAcres) || 0;
    if (d.expectedGDV) byLocation[loc].avgGDV.push(Number(d.expectedGDV));
  });
  const rows = Object.entries(byLocation).sort((a, b) => b[1].count - a[1].count);
  if (rows.length === 0) return `<div class="empty-state"><div class="icon">🗺️</div>No pipeline data yet.</div>`;
  return `<div class="table-wrap"><table><thead><tr><th>Location</th><th>Deals</th><th>Acres</th><th>Avg Expected GDV</th></tr></thead><tbody>
    ${rows.map(([loc, v]) => {
      const avg = v.avgGDV.length > 0 ? (v.avgGDV.reduce((s, x) => s + x, 0) / v.avgGDV.length).toFixed(1) : '—';
      return `<tr><td><b>${escapeHTML(loc)}</b></td><td>${v.count}</td><td>${v.acres.toFixed(1)}</td><td>${avg !== '—' ? '₹' + avg + ' Cr' : '—'}</td></tr>`;
    }).join('')}
  </tbody></table></div>`;
}

/* ---------------- ANNUAL FORECAST / RUN-RATE ---------------- */

function renderAnnualForecast() {
  const currentQuarter = getCurrentQuarter();
  const [fyStartStr, fyEndStr] = annualBoundsForQuarter(currentQuarter);
  const fyStart = new Date(fyStartStr + 'T00:00:00');
  const fyEnd = new Date(fyEndStr + 'T23:59:59');
  const today = new Date();

  const totalFYDays = Math.round((fyEnd - fyStart) / (1000 * 60 * 60 * 24)) + 1;
  const daysElapsed = Math.max(1, Math.round((today - fyStart) / (1000 * 60 * 60 * 24)));
  const daysRemaining = Math.max(0, totalFYDays - daysElapsed);

  const signedThisFY = STATE.deals.filter(d => {
    if (d.stage !== 'Signed') return false;
    const upd = extractDateOnly(d.lastUpdated);
    return upd && upd >= fyStartStr && upd <= fyEndStr;
  });
  const acresThisFY = signedThisFY.reduce((s, d) => s + (Number(d.areaAcres) || 0), 0);
  const dealsThisFY = signedThisFY.length;

  const runRateDealsPerDay = dealsThisFY / daysElapsed;
  const runRateAcresPerDay = acresThisFY / daysElapsed;
  const projectedDeals = (dealsThisFY + runRateDealsPerDay * daysRemaining).toFixed(1);
  const projectedAcres = (acresThisFY + runRateAcresPerDay * daysRemaining).toFixed(1);

  return `
    <div class="stat-strip">
      <div class="stat">FY Elapsed<br><b>${daysElapsed} / ${totalFYDays} days</b></div>
      <div class="stat">Deals Signed So Far<br><b>${dealsThisFY}</b></div>
      <div class="stat">Acres Signed So Far<br><b>${acresThisFY.toFixed(1)}</b></div>
      <div class="stat">Projected Deals (FY End)<br><b>${projectedDeals} / 7-8 target</b></div>
      <div class="stat">Projected Acres (FY End)<br><b>${projectedAcres} / 20 target</b></div>
    </div>
    <p style="font-size:11px;color:var(--grey-soft);margin-top:14px;">Simple linear run-rate projection based on the current financial year's pace so far — not a formal forecast model.</p>
  `;
}

/* ---------------- PIPELINE — DEAL CARDS ---------------- */

function checkFinancialFloors(deal) {
  const irr = Number(deal.irrPct);
  const pat = Number(deal.patPct);
  const profitSft = Number(deal.profitPerSft);
  const years = Number(deal.completionYears);
  const isRedevelopment = deal.dealStructure === 'Redevelopment';
  const profitFloor = isRedevelopment ? 1000 : 500;

  const floors = {
    irr: { value: irr, floor: 30, pass: deal.irrPct !== '' && !isNaN(irr) && irr >= 30 },
    pat: { value: pat, floor: 10, pass: deal.patPct !== '' && !isNaN(pat) && pat >= 10 },
    profitPerSft: { value: profitSft, floor: profitFloor, pass: deal.profitPerSft !== '' && !isNaN(profitSft) && profitSft >= profitFloor },
    completionYears: { value: years, floor: 3, pass: deal.completionYears !== '' && !isNaN(years) && years > 0 && years <= 3 }
  };
  const allEntered = ['irrPct', 'patPct', 'profitPerSft', 'completionYears'].every(f => deal[f] !== '' && deal[f] !== undefined && deal[f] !== null);
  const allPass = floors.irr.pass && floors.pat.pass && floors.profitPerSft.pass && floors.completionYears.pass;
  const verdict = !allEntered ? 'Pending' : (allPass ? 'Pass' : 'Fail');
  return { floors, verdict, profitFloor };
}

function legalGateBadge(status) {
  const map = {
    'Not Started': 'badge-sourcing',
    'In Progress': 'badge-evaluation',
    'Gate 2 Cleared': 'badge-closed-signed',
    'Flagged Issue': 'badge-closed-dropped'
  };
  const label = status || 'Not Started';
  return `<span class="badge ${map[label] || 'badge-sourcing'}">${escapeHTML(label)}</span>`;
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

function stageBadge(stage) {
  const map = {
    'Lead': 'badge-sourcing', 'Site Visit Done': 'badge-sourcing',
    'Feasibility': 'badge-evaluation', 'Negotiation': 'badge-negotiation',
    'Term Sheet': 'badge-negotiation', 'Due Diligence': 'badge-negotiation',
    'Signed': 'badge-closed-signed', 'Dropped': 'badge-closed-dropped'
  };
  return `<span class="badge ${map[stage] || 'badge-sourcing'}">${escapeHTML(stage)}</span>`;
}

function renderPipelineCards() {
  const container = document.getElementById('pipelineCardsBody');
  if (!container) return;
  let deals = [...STATE.deals];
  if (PIPELINE_SEARCH_TERM) {
    deals = deals.filter(d =>
      (d.parcelName || '').toLowerCase().includes(PIPELINE_SEARCH_TERM) ||
      (d.location || '').toLowerCase().includes(PIPELINE_SEARCH_TERM) ||
      (d.source || '').toLowerCase().includes(PIPELINE_SEARCH_TERM) ||
      (d.sourceDetail || '').toLowerCase().includes(PIPELINE_SEARCH_TERM) ||
      (d.owner || '').toLowerCase().includes(PIPELINE_SEARCH_TERM)
    );
  }
  deals.sort((a, b) => new Date(b.lastUpdated) - new Date(a.lastUpdated));

  if (deals.length === 0) {
    container.innerHTML = `<div class="empty-state"><div class="icon">🔍</div>No deals match your search.</div>`;
    return;
  }

  container.innerHTML = deals.map(d => {
    const floors = checkFinancialFloors(d);
    const verdictBadge = floors.verdict === 'Pass' ? '<span class="badge badge-closed-signed">Floors: Pass</span>'
      : floors.verdict === 'Fail' ? '<span class="badge badge-closed-dropped">Floors: Fail</span>'
      : '<span class="badge badge-sourcing">Floors: Pending Data</span>';
    return `
      <div class="deal-card">
        <div class="deal-card-top">
          <div>
            <div class="deal-card-title">${escapeHTML(d.parcelName)}</div>
            <div class="deal-card-sub">${escapeHTML(d.location || '—')} ${d.surveyNumber ? '· Survey ' + escapeHTML(d.surveyNumber) : ''} · ${d.areaAcres || '—'} acres</div>
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;">
            ${stageBadge(d.stage)} ${categoryBadge(d.leadCategory)} ${legalGateBadge(d.legalGateStatus)} ${verdictBadge}
          </div>
        </div>
        <div class="deal-card-grid">
          <div><span class="dcg-label">Source</span><span class="dcg-val">${escapeHTML(d.source || '—')}${d.sourceDetail ? ' — ' + escapeHTML(d.sourceDetail) : ''}${d.sourcePhone ? ' (' + escapeHTML(d.sourcePhone) + ')' : ''}</span></div>
          <div><span class="dcg-label">Expected GDV</span><span class="dcg-val">${d.expectedGDV ? '₹' + d.expectedGDV + ' Cr' : '—'}</span></div>
          <div><span class="dcg-label">IRR / PAT</span><span class="dcg-val">${d.irrPct || '—'}% / ${d.patPct || '—'}%</span></div>
          <div><span class="dcg-label">Profit/sft (floor ${floors.profitFloor})</span><span class="dcg-val">${d.profitPerSft || '—'}</span></div>
          <div><span class="dcg-label">Completion (yrs)</span><span class="dcg-val">${d.completionYears || '—'}</span></div>
          <div><span class="dcg-label">Next Action</span><span class="dcg-val">${escapeHTML(d.nextAction || '—')}${d.nextActionDate ? ' — ' + formatDateShort(d.nextActionDate) : ''}</span></div>
          <div><span class="dcg-label">Owner</span><span class="dcg-val">${escapeHTML(d.owner || '—')}</span></div>
          <div><span class="dcg-label">Last Updated</span><span class="dcg-val">${formatDateShort(d.lastUpdated)}</span></div>
        </div>
        <button class="timeline-link" onclick="openTimelineModal('${d.id}', ${JSON.stringify(d.parcelName)})">View Full Timeline →</button>
        <button class="doc-status-link" onclick="openCeoDocumentModal('${d.id}', ${JSON.stringify(d.parcelName)})">Documents (${documentBadgeCount(d.id)}) →</button>
      </div>`;
  }).join('');
}

/* ---------------- TIMELINE MODAL (StageHistory + DealActivity, merged) ----------------
   Read-only. Merges two event sources into one chronological list, each
   tagged with a `type` flag ('stage' | 'activity') so they render with
   different dot colors and content: stage transitions show "From → To",
   activity entries show activityType + summary + next follow-up date.
   This is what lets the CEO see real work done on a lead, not just when
   its stage changed. */

function getDealTimeline(dealId) {
  const stageEvents = STATE.stageHistory
    .filter(h => h.dealId === dealId)
    .map(h => ({ type: 'stage', date: h.changedAt, fromStage: h.fromStage, toStage: h.toStage }));

  const activityEvents = STATE.dealActivity
    .filter(a => a.dealId === dealId)
    .map(a => ({ type: 'activity', date: a.date, activityType: a.activityType, summary: a.summary, nextFollowupDate: a.nextFollowupDate }));

  return [...stageEvents, ...activityEvents].sort((a, b) => new Date(a.date) - new Date(b.date));
}

function setupTimelineModal() {
  document.getElementById('timelineModal').addEventListener('click', (e) => {
    if (e.target.id === 'timelineModal') closeTimelineModal();
  });
}

function openTimelineModal(dealId, parcelName) {
  document.getElementById('timelineModalTitle').textContent = 'Timeline — ' + parcelName;
  const events = getDealTimeline(dealId);
  const body = document.getElementById('timelineModalBody');
  if (events.length === 0) {
    body.innerHTML = `<div class="empty-state" style="padding:20px;"><div class="icon">🕓</div>No history recorded yet.</div>`;
  } else {
    body.innerHTML = `<div class="timeline-list">${events.map(ev => {
      if (ev.type === 'stage') {
        return `
          <div class="timeline-item">
            <div class="timeline-dot"></div>
            <div class="timeline-date">${formatDateShort(ev.date)}</div>
            <div class="timeline-transition"><b>${escapeHTML(ev.fromStage)}</b> → <b>${escapeHTML(ev.toStage)}</b></div>
          </div>`;
      }
      return `
        <div class="timeline-item">
          <div class="timeline-dot activity"></div>
          <div class="timeline-date">${formatDateShort(ev.date)} &middot; ${escapeHTML(ev.activityType || 'Other')}</div>
          <div class="timeline-transition">${escapeHTML(ev.summary || '')}</div>
          ${ev.nextFollowupDate ? `<div class="timeline-followup">Next follow-up: ${formatDateShort(ev.nextFollowupDate)}</div>` : ''}
        </div>`;
    }).join('')}</div>`;
  }
  document.getElementById('timelineModal').classList.add('active');
}

function closeTimelineModal() {
  document.getElementById('timelineModal').classList.remove('active');
}

/* ---------------- DOCUMENT STATUS MODAL (read-only) ----------------
   Shows the same 4-category checklist as the entry tool, with Uploaded/
   Pending status and clickable Drive links. No upload capability here —
   the CEO Dashboard stays read-only except for setTarget. */

function getLatestDocument(dealId, docType) {
  const matches = STATE.documents.filter(d => d.dealId === dealId && d.docType === docType);
  if (matches.length === 0) return null;
  return matches.reduce((latest, d) => new Date(d.uploadedAt) > new Date(latest.uploadedAt) ? d : latest, matches[0]);
}

function documentBadgeCount(dealId) {
  let total = 0, uploaded = 0;
  Object.values(DOCUMENT_CHECKLIST).forEach(cat => {
    cat.docs.forEach(docType => {
      total++;
      if (getLatestDocument(dealId, docType)) uploaded++;
    });
  });
  return `${uploaded}/${total}`;
}

function setupCeoDocumentModal() {
  document.getElementById('ceoDocumentModal').addEventListener('click', (e) => {
    if (e.target.id === 'ceoDocumentModal') closeCeoDocumentModal();
  });
}

function openCeoDocumentModal(dealId, parcelName) {
  document.getElementById('ceoDocumentModalTitle').textContent = 'Documents — ' + parcelName;
  const body = document.getElementById('ceoDocumentModalBody');
  body.innerHTML = Object.entries(DOCUMENT_CHECKLIST).map(([catKey, cat]) => {
    const rows = cat.docs.map(docType => {
      const existing = getLatestDocument(dealId, docType);
      return `
        <div class="doc-row-ceo">
          <span>${escapeHTML(docType)}</span>
          ${existing
            ? `<a href="${existing.driveUrl}" target="_blank" rel="noopener" class="badge badge-closed-signed">✓ View</a>`
            : `<span class="badge badge-sourcing">Pending</span>`}
        </div>`;
    }).join('');
    return `<div class="doc-category-ceo"><div class="doc-category-ceo-title">${escapeHTML(cat.label)}</div>${rows}</div>`;
  }).join('');
  document.getElementById('ceoDocumentModal').classList.add('active');
}

function closeCeoDocumentModal() {
  document.getElementById('ceoDocumentModal').classList.remove('active');
}

/* ---------------- CONTACT SEARCH PANEL ----------------
   Searches STATE.directory. NOTE: the Directory sheet is NOT part of
   getCeoSummaryData() by design (see Code.gs) — so this searches whatever
   directory data happens to be present in STATE, which will be empty
   unless a future change explicitly adds Directory to the CEO feed. */

function setupSearchPanel() {
  document.getElementById('openSearchBtn').addEventListener('click', openSearchPanel);
  document.getElementById('searchOverlay').addEventListener('click', (e) => {
    if (e.target.id === 'searchOverlay') closeSearchPanel();
  });
  document.getElementById('searchContactInput').addEventListener('input', renderSearchResults);

  const types = ['All', 'Broker', 'Developer', 'Landowner'];
  document.getElementById('searchTypeFilters').innerHTML = types.map(t =>
    `<button class="search-type-btn ${t === SEARCH_TYPE_FILTER ? 'active' : ''}" data-type="${t}">${t}</button>`
  ).join('');
  document.querySelectorAll('.search-type-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      SEARCH_TYPE_FILTER = btn.dataset.type;
      document.querySelectorAll('.search-type-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderSearchResults();
    });
  });
}

function openSearchPanel() {
  document.getElementById('searchOverlay').classList.add('active');
  document.getElementById('searchContactInput').value = '';
  renderSearchResults();
  setTimeout(() => document.getElementById('searchContactInput').focus(), 50);
}

function closeSearchPanel() {
  document.getElementById('searchOverlay').classList.remove('active');
}

function renderSearchResults() {
  const term = document.getElementById('searchContactInput').value.trim().toLowerCase();
  const directory = STATE.directory || [];
  let rows = directory;
  if (SEARCH_TYPE_FILTER !== 'All') rows = rows.filter(d => d.type === SEARCH_TYPE_FILTER);
  if (term) {
    rows = rows.filter(d =>
      (d.name || '').toLowerCase().includes(term) ||
      (d.phone || '').toLowerCase().includes(term) ||
      (d.notes || '').toLowerCase().includes(term)
    );
  }

  const body = document.getElementById('searchResultsBody');
  if (directory.length === 0) {
    body.innerHTML = `<div class="empty-state" style="padding:24px;"><div class="icon">📇</div>No contact directory data is currently available to the CEO Dashboard.</div>`;
    return;
  }
  if (rows.length === 0) {
    body.innerHTML = `<div class="empty-state" style="padding:24px;"><div class="icon">🔍</div>No contacts match.</div>`;
    return;
  }
  body.innerHTML = rows.map(d => `
    <div class="search-result-card">
      <div class="search-result-name">${escapeHTML(d.name)}</div>
      <div class="search-result-meta">${escapeHTML(d.type || '—')} ${d.phone ? '· ' + escapeHTML(d.phone) : ''}</div>
      ${d.notes ? `<div class="search-result-meta">${escapeHTML(d.notes)}</div>` : ''}
    </div>`).join('');
}

/* ---------------- QUARTER / DATE HELPERS ---------------- */

function getCurrentQuarter() {
  const d = new Date();
  const m = d.getMonth();
  const y = d.getFullYear();
  let fyStartYear, q;
  if (m >= 3 && m <= 5) { q = 1; fyStartYear = y; }
  else if (m >= 6 && m <= 8) { q = 2; fyStartYear = y; }
  else if (m >= 9 && m <= 11) { q = 3; fyStartYear = y; }
  else { q = 4; fyStartYear = y - 1; }
  const fyLabel = `FY${String(fyStartYear).slice(2)}-${String(fyStartYear + 1).slice(2)}`;
  return `Q${q} ${fyLabel}`;
}

function extractDateOnly(dateStr) {
  if (!dateStr) return null;
  const m = String(dateStr).match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

function quarterBoundsCalendar(qLabel) {
  const m = qLabel.match(/Q(\d) FY(\d\d)-(\d\d)/);
  if (!m) return ['0000-00-00', '9999-99-99'];
  const qNum = Number(m[1]);
  const fyStartYear = 2000 + Number(m[2]);
  let year = fyStartYear;
  let startMonth;
  if (qNum === 1) startMonth = 3;
  else if (qNum === 2) startMonth = 6;
  else if (qNum === 3) startMonth = 9;
  else { startMonth = 0; year = fyStartYear + 1; }
  const endMonth = startMonth + 2;
  const endYear = year + Math.floor(endMonth / 12);
  const endMonthNorm = endMonth % 12;
  const lastDay = new Date(endYear, endMonthNorm + 1, 0).getDate();
  const start = `${year}-${String(startMonth + 1).padStart(2, '0')}-01`;
  const end = `${endYear}-${String(endMonthNorm + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  return [start, end];
}

function sumProposalsInQuarter(qLabel) {
  const [start, end] = quarterBoundsCalendar(qLabel);
  return STATE.dailyLogs
    .filter(d => { const c = extractDateOnly(d.date); return c && c >= start && c <= end; })
    .reduce((s, d) => s + (Number(d.proposalsPresented) || 0), 0);
}

function sumAcresSignedInQuarter(qLabel) {
  const [start, end] = quarterBoundsCalendar(qLabel);
  return STATE.deals
    .filter(d => {
      if (d.stage !== 'Signed') return false;
      const c = extractDateOnly(d.lastUpdated);
      return c && c >= start && c <= end;
    })
    .reduce((s, d) => s + (Number(d.areaAcres) || 0), 0);
}

function countDealsSignedInQuarter(qLabel) {
  const [start, end] = quarterBoundsCalendar(qLabel);
  return STATE.deals
    .filter(d => {
      if (d.stage !== 'Signed') return false;
      const c = extractDateOnly(d.lastUpdated);
      return c && c >= start && c <= end;
    }).length;
}

function toISODate(d) {
  return d.toISOString().split('T')[0];
}

function formatDateShort(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (isNaN(d)) return dateStr;
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' });
}

function formatDateLong(d) {
  return d.toLocaleDateString('en-IN', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
}

/* ---------------- UTIL ---------------- */

function escapeHTML(str) {
  if (str === undefined || str === null) return '';
  return String(str).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

function showToast(msg, isError) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show' + (isError ? ' error' : '');
  setTimeout(() => t.classList.remove('show'), 3200);
}
