/* ============================================================
   MANGALAM LANDMARKS — BD CEO DASHBOARD
   Pulls sanitized summary data via the `getCeoSummary` action.
   This file is read-only EXCEPT for one deliberate capability:
   setting/editing quarterly AOP targets (the setTarget action).
   That is the ONLY write call in this file. Do not add edit/delete
   for deals, daily logs, or directory entries here — those remain
   exclusively the BD entry tool's responsibility.
   ============================================================ */

// ⚠️ Use the SAME Apps Script Web App URL as the BD entry tool.
const API_URL = "https://script.google.com/macros/s/AKfycbwnusKhEVckQbtT4BR_Txm15UjH4w1oaUylIuY6uvJK9kYpU0RdHVm6aa7IhMyg0U0_/exec";

const AUTO_REFRESH_MINUTES = 10;

// Mirrors DOCUMENT_CHECKLIST in Code.gs — keep both in sync if this changes.
const DOCUMENT_CHECKLIST = {
  'A': { label: 'Property Documents', docs: ['7/12 of Land', 'MOU', 'PA/DA', 'Property Card', 'Ferfar'] },
  'B': { label: 'Technical & Planning Documents', docs: ['Demarcation', 'Plan', 'FSI Statement'] },
  'C': { label: 'Feasibility', docs: ['Feasibility Report'] },
  'D': { label: 'Redevelopment', docs: ['Conveyance Deed', 'Carpet Area', 'Sanction Plan', 'Completion Plan'] }
};

let STATE = { dailyLogs: [], deals: [], targets: [], stageHistory: [], dealActivity: [], directory: [], documents: [] };
let SELECTED_QUARTER = getCurrentQuarter();
let PIPELINE_FILTER = { search: '', category: 'All', status: 'All' };

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('todayBadge').textContent = formatDateLong(new Date());
  loadData();
  setInterval(loadData, AUTO_REFRESH_MINUTES * 60 * 1000);

  const timelineModal = document.getElementById('timelineModal');
  if (timelineModal) timelineModal.addEventListener('click', e => { if (e.target.id === 'timelineModal') closeTimelineModal(); });

  const searchPanel = document.getElementById('searchPanel');
  if (searchPanel) searchPanel.addEventListener('click', e => { if (e.target.id === 'searchPanel') closeSearchPanel(); });

  const ceoDocModal = document.getElementById('ceoDocumentModal');
  if (ceoDocModal) ceoDocModal.addEventListener('click', e => { if (e.target.id === 'ceoDocumentModal') closeCeoDocumentModal(); });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closeTimelineModal(); closeSearchPanel(); closeCeoDocumentModal(); }
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
    if (!STATE.documents) STATE.documents = [];
    if (!STATE.directory) STATE.directory = [];
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
    } else if (STATE.deals.length === 0 && STATE.dailyLogs.length === 0) {
      document.getElementById('dashboardRoot').innerHTML = `
        <div class="empty-state"><div class="icon">⚠️</div>Could not load data: ${escapeHTML(err.message)}</div>`;
    }
  }
}

function render() {
  const sums = (arr, key) => arr.reduce((s, d) => s + (Number(d[key]) || 0), 0);
  const thisMonthLogs = STATE.dailyLogs.filter(d => isSameMonth(d.date, new Date()));

  const mtd = {
    siteVisits: sums(thisMonthLogs, 'siteVisits'),
    brokerMeetings: sums(thisMonthLogs, 'brokerMeetings'),
    ownerMeetings: sums(thisMonthLogs, 'ownerMeetings'),
    newLeads: sums(thisMonthLogs, 'newLeads'),
    proposalsPresented: sums(thisMonthLogs, 'proposalsPresented'),
  };

  const activeDeals = STATE.deals.filter(d => d.stage !== 'Dropped');
  const signedDeals = STATE.deals.filter(d => d.stage === 'Signed');
  const totalAcresSigned = sums(signedDeals, 'areaAcres');
  const totalAcresPipeline = sums(activeDeals, 'areaAcres');

  const qTarget = STATE.targets.find(t => t.periodType === 'quarterly' && t.periodLabel === SELECTED_QUARTER) || {};
  const qProposalsActual = sumProposalsInQuarter(SELECTED_QUARTER);
  const qAcresActual = sumAcresSignedInQuarter(SELECTED_QUARTER);
  const qDealsSignedActual = countDealsSignedInQuarter(SELECTED_QUARTER);

  const html = `
    <div class="section-label"><span>Performance Dashboard</span><div class="line"></div></div>
    ${renderPerformanceDashboard(thisMonthLogs, qTarget, SELECTED_QUARTER)}

    ${renderAOPRedFlags(activeDeals, signedDeals, qTarget)}

    <div class="card">
      <div class="card-title">Daily Activity Summary <span class="as-of">${thisMonthLogs.length} day${thisMonthLogs.length === 1 ? '' : 's'} logged this month</span></div>
      <p style="font-size:12px;color:var(--grey-soft);margin-bottom:16px;">
        Day-by-day activity counts for the current month. Broker/landowner names and notes stay in the BD entry tool — only counts are shown here.
      </p>
      ${renderDailyLogSummaryTable(thisMonthLogs)}
    </div>

    <div class="section-label"><span>Deal Funnel</span><div class="line"></div></div>
    <div class="card">
      ${renderFunnelHTML()}
      <div class="stat-strip">
        <div class="stat"><b>${totalAcresSigned.toFixed(1)} / 20</b>FY26-27 acres signed</div>
        <div class="stat"><b>${signedDeals.length}</b>FY26-27 deals signed</div>
        <div class="stat"><b>${STATE.deals.length}</b>Total parcels tracked (all time)</div>
      </div>
    </div>

    <div class="section-label"><span>Is BD Activity Converting? \u2014 Performance Analytics</span><div class="line"></div></div>
    ${renderAnalyticsSection()}

    <div class="section-label"><span>AOP Target Progress</span><div class="line"></div></div>
    <div class="card">
      <div class="quarter-tabs" id="quarterTabs"></div>
      ${progressRowWithStatus('Proposals Presented', qProposalsActual, qTarget.targetProposals || 2, false, SELECTED_QUARTER)}
      ${progressRowWithStatus('Acres Signed', qAcresActual, qTarget.targetAcres || 5, true, SELECTED_QUARTER)}
      ${progressRowWithStatus('Deals Signed', qDealsSignedActual, qTarget.targetDealsSigned || 1, false, SELECTED_QUARTER)}
    </div>

    <div class="section-label"><span>AOP Lead Conversion Funnel — ${SELECTED_QUARTER}</span><div class="line"></div></div>
    <div class="card">
      <p style="font-size:12px;color:var(--grey-soft);margin-bottom:16px;">
        Per the AOP's funnel model (Sourcing \u2192 BD Head Filter \u2192 BD Head Refinement \u2192 Signed). Shows the CONVERSION RATIO between stages \u2014 not targets \u2014 for the selected quarter. By design, the underlying Sourced/Qualified/Prospects numbers are updated directly in the Google Sheet's Targets tab, not through either app \u2014 this is intentional, not a missing feature.
      </p>
      ${renderFunnelConversionRatios(qTarget, qDealsSignedActual)}
    </div>

    <div class="section-label"><span>Set AOP Targets</span><div class="line"></div></div>
    <div class="card">
      <p style="font-size:12.5px;color:var(--grey);margin-bottom:16px;">
        Targets are set here only — the BD entry tool shows these as view-only. Actuals above roll up automatically; only the target numbers are editable.
      </p>
      ${renderTargetEditTable()}
    </div>

    <div class="section-label"><span>Land Deal Pipeline</span><div class="line"></div></div>
    ${renderMicroMarketComparison()}
    <div class="card">
      <div class="card-title">All Parcels<span class="as-of">${STATE.deals.length} total</span></div>
      ${renderPipelineFilterBar()}
      <div id="pipelineCardsContainer">${renderPipelineTable()}</div>
    </div>

    <div class="section-label"><span>Source-Wise Performance</span><div class="line"></div></div>
    <div class="card">
      <p style="font-size:12px;color:var(--grey-soft);margin-bottom:16px;">
        How each lead source (Broker, Reference, Landowner Direct, Cold Outreach, Other) is actually converting \u2014 not just how many leads it brings in.
      </p>
      ${renderSourcePerformanceTable()}
    </div>

    <div class="section-label"><span>FY26-27 Forecast \u2014 Run-Rate Projection</span><div class="line"></div></div>
    <div class="card">
      <p style="font-size:12px;color:var(--grey-soft);margin-bottom:16px;">
        At the current pace, where will we land by FY year-end (March 2027) against the AOP's annual targets? This projects forward from what's been achieved so far \u2014 it's a planning signal, not a guarantee.
      </p>
      ${renderAnnualForecast()}
    </div>

    <div class="footer-note">Auto-refreshes every ${AUTO_REFRESH_MINUTES} minutes · Daily notes and free-text remarks stay in the BD entry tool \u2014 everything else shown here is the full record</div>
  `;
  document.getElementById('dashboardRoot').innerHTML = html;
  renderQuarterTabs();
}

function renderQuarterTabs() {
  const quarters = ['Q1 FY26-27', 'Q2 FY26-27', 'Q3 FY26-27', 'Q4 FY26-27'];
  const wrap = document.getElementById('quarterTabs');
  if (!wrap) return;
  wrap.innerHTML = quarters.map(q =>
    `<button class="quarter-tab ${q === SELECTED_QUARTER ? 'active' : ''}" data-q="${q}">${q.split(' ')[0]}</button>`
  ).join('');
  wrap.querySelectorAll('.quarter-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      SELECTED_QUARTER = btn.dataset.q;
      render();
    });
  });
}

// Day-by-day Daily Log summary for the CURRENT MONTH only — counts only,
// no names/notes (those never leave the BD entry tool, sanitized at the
// backend in getCeoSummaryData). Sorted most-recent-day-first.
function renderPerformanceDashboard(thisMonthLogs, qTarget, qLabel) {
  const sums = (arr, key) => arr.reduce((s, d) => s + (Number(d[key]) || 0), 0);
  const allQuarters = ['Q1 FY26-27', 'Q2 FY26-27', 'Q3 FY26-27', 'Q4 FY26-27'];

  // --- ACTUALS ---
  const mtdLeads     = sums(thisMonthLogs, 'newLeads');
  const mtdVisits    = sums(thisMonthLogs, 'siteVisits');
  const mtdMeetings  = sums(thisMonthLogs, 'brokerMeetings') + sums(thisMonthLogs, 'ownerMeetings');
  const mtdClosed    = 0; // deals closed this calendar month — no date-scoped closed field yet; show n/a

  const qLogs = STATE.dailyLogs.filter(d => {
    const [s, e] = quarterBoundsCalendar(qLabel);
    const cal = extractDateOnly(d.date);
    return cal && cal >= s && cal <= e;
  });
  const qLeads    = sums(qLogs, 'newLeads');
  const qVisits   = sums(qLogs, 'siteVisits');
  const qMeetings = sums(qLogs, 'brokerMeetings') + sums(qLogs, 'ownerMeetings');
  const qClosed   = countDealsSignedInQuarter(qLabel);

  const annLeads    = allQuarters.reduce((s, q) => {
    const [qs, qe] = quarterBoundsCalendar(q);
    const logs = STATE.dailyLogs.filter(d => { const c = extractDateOnly(d.date); return c && c >= qs && c <= qe; });
    return s + sums(logs, 'newLeads');
  }, 0);
  const annVisits   = allQuarters.reduce((s, q) => {
    const [qs, qe] = quarterBoundsCalendar(q);
    const logs = STATE.dailyLogs.filter(d => { const c = extractDateOnly(d.date); return c && c >= qs && c <= qe; });
    return s + sums(logs, 'siteVisits');
  }, 0);
  const annMeetings = allQuarters.reduce((s, q) => {
    const [qs, qe] = quarterBoundsCalendar(q);
    const logs = STATE.dailyLogs.filter(d => { const c = extractDateOnly(d.date); return c && c >= qs && c <= qe; });
    return s + sums(logs, 'brokerMeetings') + sums(logs, 'ownerMeetings');
  }, 0);
  const annClosed = STATE.deals.filter(d => d.stage === 'Signed').length;

  const allLeads    = sums(STATE.dailyLogs, 'newLeads');
  const allVisits   = sums(STATE.dailyLogs, 'siteVisits');
  const allMeetings = sums(STATE.dailyLogs, 'brokerMeetings') + sums(STATE.dailyLogs, 'ownerMeetings');
  const allClosed   = STATE.deals.filter(d => d.stage === 'Signed').length;

  // --- TARGETS ---
  // MTD target: quarterly target × (days elapsed in current month / days in current quarter).
  // Simple pro-rata, honest approximation since the AOP doesn't break
  // targets down to monthly granularity.
  const today = new Date();
  const [qStart, qEnd] = quarterBoundsCalendar(qLabel);
  const qTotalDays = Math.round((new Date(qEnd + 'T00:00:00') - new Date(qStart + 'T00:00:00')) / (86400000)) + 1;
  const qElapsedDays = Math.max(1, Math.round((today - new Date(qStart + 'T00:00:00')) / 86400000));
  const mtdFrac = Math.min(1, qElapsedDays / qTotalDays);

  const tLeadsQ  = Number(qTarget.targetLeadsSourced) || 0;
  const tVisitsQ = 0; // no site-visit target in AOP — shown as n/a
  const tMtgQ    = 0; // no meeting target in AOP — shown as n/a
  const tClosedQ = Number(qTarget.targetDealsSigned) || 0;

  const ANN_LEADS_TARGET  = 700; // AOP: 700-800 raw leads for 7-8 signed deals
  const ANN_CLOSED_TARGET = 7.5; // AOP: 7-8 signed deals

  const kpiCell = (actual, target, label) => {
    const hasTarget = target > 0;
    const pct = hasTarget ? Math.round((actual / target) * 100) : null;
    const cls = pct === null ? '' : pct >= 100 ? 'color:var(--green);' : pct >= 60 ? 'color:var(--amber);' : 'color:var(--red-deep);';
    return `<div class="perf-cell">
      <div class="perf-actual">${actual}</div>
      ${hasTarget ? `<div class="perf-target">/ ${target}</div>` : '<div class="perf-target">—</div>'}
      ${pct !== null ? `<div class="perf-pct" style="${cls}">${pct}%</div>` : '<div class="perf-pct" style="color:var(--grey-soft);">n/a</div>'}
    </div>`;
  };

  const rows = [
    { label: 'Leads Sourced',   mtdA: mtdLeads,   mtdT: Math.round(tLeadsQ * mtdFrac),  qA: qLeads,   qT: tLeadsQ,  annA: annLeads,   annT: ANN_LEADS_TARGET, allA: allLeads   },
    { label: 'Site Visits',     mtdA: mtdVisits,   mtdT: 0,   qA: qVisits,   qT: 0,         annA: annVisits,   annT: 0,                    allA: allVisits  },
    { label: 'Deals Closed',    mtdA: mtdClosed,   mtdT: 0,   qA: qClosed,   qT: tClosedQ,  annA: annClosed,   annT: ANN_CLOSED_TARGET,    allA: allClosed  },
    { label: 'Meetings (B+O)',  mtdA: mtdMeetings, mtdT: 0,   qA: qMeetings, qT: 0,         annA: annMeetings, annT: 0,                    allA: allMeetings},
  ];

  const tableRows = rows.map(r => `
    <tr>
      <td class="perf-metric">${r.label}</td>
      <td>${kpiCell(r.mtdA, r.mtdT, 'MTD')}</td>
      <td>${kpiCell(r.qA, r.qT, 'Q')}</td>
      <td>${kpiCell(r.annA, r.annT, 'Annual')}</td>
      <td>${kpiCell(r.allA, 0, 'All')}</td>
    </tr>`).join('');

  return `<div class="card">
    <div class="table-wrap">
      <table class="perf-table">
        <thead><tr>
          <th>Metric</th>
          <th>Month-to-Date<br><span style="font-weight:400;font-size:10px;color:var(--grey-soft);">Actual / Target / %</span></th>
          <th>${qLabel}<br><span style="font-weight:400;font-size:10px;color:var(--grey-soft);">Actual / Target / %</span></th>
          <th>FY26-27 Annual<br><span style="font-weight:400;font-size:10px;color:var(--grey-soft);">Actual / Target / %</span></th>
          <th>All-Time Total<br><span style="font-weight:400;font-size:10px;color:var(--grey-soft);">Running count</span></th>
        </tr></thead>
        <tbody>${tableRows}</tbody>
      </table>
    </div>
    <p style="font-size:11px;color:var(--grey-soft);margin-top:10px;">
      MTD target = quarterly target \u00d7 % of quarter elapsed (pro-rata). Site visits and meetings have no AOP target \u2014 shown as n/a. Deals Closed MTD not separately tracked (counted at quarter level).
    </p>
  </div>`;
}

function renderDailyLogSummaryTable(monthLogs) {
  if (!monthLogs || monthLogs.length === 0) {
    return `<div class="empty-state" style="padding:24px;"><div class="icon">\ud83d\udcc5</div>No daily entries logged yet this month.</div>`;
  }
  const sorted = [...monthLogs].sort((a, b) => {
    const da = extractDateOnly(a.date) || '';
    const db = extractDateOnly(b.date) || '';
    return db.localeCompare(da);
  });
  const rows = sorted.map(d => `
    <tr>
      <td><b>${formatDateShort(d.date)}</b></td>
      <td>${d.siteVisits || 0}</td>
      <td>${d.brokerMeetings || 0}</td>
      <td>${d.ownerMeetings || 0}</td>
      <td>${d.newLeads || 0}</td>
      <td>${d.callsFollowups || 0}</td>
      <td>${d.proposalsPresented || 0}</td>
    </tr>`).join('');
  return `<div class="table-wrap"><table>
    <thead><tr>
      <th>Date</th><th>Site Visits</th><th>Broker Mtgs</th><th>Owner Mtgs</th><th>New Leads</th><th>Calls</th><th>Proposals</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table></div>`;
}

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

/* ============================================================
   ANALYTICS MODULE
   Answers: "is BD activity actually converting, or just busywork?"
   Three parts:
   1. Stalled deal detection (deals stuck in same stage too long)
   2. Stage-by-stage conversion rates (where deals die in the funnel)
   3. Quarter-over-quarter trend of those conversion rates
   NOTE: there is no reliable published industry benchmark for
   "land lead to signed development deal" conversion (verified search,
   Jun 2026) — residential agent lead-conversion stats are a different
   business entirely. So this section deliberately compares BD's own
   performance against ITS OWN history, not an invented external number.
   ============================================================ */

const NEGOTIATION_STAGES = ['Feasibility', 'Negotiation', 'Term Sheet', 'Due Diligence'];

/**
 * AOP NAMED RED FLAGS — Section 07 of the Mangalam Land Acquisition
 * Strategy FY2026-27. These are the EXACT thresholds from that document,
 * not generic heuristics. Four of the five rules are checkable from data;
 * one ("MOU signed without SSS authority") is a process/governance rule
 * that has no corresponding field to check automatically — it's listed
 * as a standing reminder, not an auto-detected flag.
 *
 * Hardcoded dates (June 15, 2026 etc.) are specific to FY2026-27 as named
 * in the AOP. If a future fiscal year's AOP names different dates, this
 * function needs updating — it is deliberately NOT a generic "30 days
 * after fiscal year start" calculation, because the source document
 * names a literal calendar date, not a relative one.
 */
function renderAOPRedFlags(activeDeals, signedDeals, currentQuarterTarget) {
  const today = new Date();
  const flags = [];

  // Flag 1: "0 proposals signed by June 15 -> SSS+RP emergency review within 48 hours"
  const june15FY27 = new Date('2026-06-15T23:59:59');
  if (today > june15FY27 && signedDeals.length === 0) {
    flags.push({
      severity: 'critical',
      title: '0 proposals signed by June 15',
      detail: 'Per AOP: SSS + RP emergency BD review required within 48 hours.'
    });
  }

  // Flag 2: "Pipeline drops below 60 active leads -> GM-BD activates additional
  // broker channels that week." The AOP's unit here is raw SOURCED LEADS
  // (Stage 1 of the funnel, tracked as actualLeadsSourced), NOT Pipeline
  // deal/parcel count — those are different and much smaller numbers.
  // Falls back to "no data" framing if the current quarter has no
  // actualLeadsSourced entered yet, rather than false-alarming on 0.
  const leadsSourced = Number(currentQuarterTarget && currentQuarterTarget.actualLeadsSourced) || 0;
  const hasLeadsData = currentQuarterTarget && currentQuarterTarget.actualLeadsSourced !== '' && currentQuarterTarget.actualLeadsSourced !== undefined;
  if (hasLeadsData && leadsSourced < 60) {
    flags.push({
      severity: leadsSourced < 30 ? 'critical' : 'warning',
      title: `Active sourced leads at ${leadsSourced} this quarter — below the 60-lead floor`,
      detail: 'Per AOP: GM-BD/BD Manager should activate additional broker channels this week.'
    });
  }

  // Flag 3: "Any deal below 30% IRR reaches SSS -> BD Head failed filter"
  const negotiationOrLater = ['Feasibility', 'Negotiation', 'Term Sheet', 'Due Diligence', 'Signed'];
  const irrFailuresPastFilter = activeDeals.filter(d => {
    if (!negotiationOrLater.includes(d.stage)) return false;
    const irr = Number(d.irrPct);
    return d.irrPct !== '' && d.irrPct !== undefined && !isNaN(irr) && irr < 30;
  });
  if (irrFailuresPastFilter.length > 0) {
    flags.push({
      severity: 'critical',
      title: `${irrFailuresPastFilter.length} deal(s) past BD filter with IRR below 30%`,
      detail: 'Per AOP: any deal below the 30% IRR floor reaching this stage means the filter step was skipped. Deals: ' +
        irrFailuresPastFilter.map(d => escapeHTML(d.parcelName)).join(', ')
    });
  }

  // Flag 4: "Any title issue found post-Gate 2 -> Deal paused, Atul briefs SSS within 48 hours"
  const titleIssues = activeDeals.filter(d => d.legalGateStatus === 'Flagged Issue');
  if (titleIssues.length > 0) {
    flags.push({
      severity: 'critical',
      title: `${titleIssues.length} deal(s) with a flagged title/legal issue`,
      detail: 'Per AOP: deal should be paused; Legal should brief SSS within 48 hours. Deals: ' +
        titleIssues.map(d => escapeHTML(d.parcelName)).join(', ')
    });
  }

  // Flag 5 (process reminder, not auto-detected): "MOU signed without SSS
  // authority -> non-negotiable breach." No field captures signing
  // authority, so this can't be auto-flagged from data.
  const governanceReminder = signedDeals.length > 0;

  if (flags.length === 0 && !governanceReminder) {
    return `<div class="card" style="border-left:4px solid var(--green);">
      <div class="empty-state" style="padding:12px 0;"><div class="icon">\u2705</div>No AOP red flags triggered right now.</div>
    </div>`;
  }

  const sevStyle = { critical: { bg: '#FAE3E2', border: 'var(--red-deep)', icon: '\ud83d\udd34' }, warning: { bg: '#FBF1DD', border: '#8A6D1F', icon: '\ud83d\udfe1' } };
  const flagCards = flags.map(f => {
    const s = sevStyle[f.severity];
    return `<div style="background:${s.bg};border-left:4px solid ${s.border};border-radius:8px;padding:14px 16px;margin-bottom:10px;">
      <div style="font-weight:700;font-size:13.5px;color:var(--ink);">${s.icon} ${f.title}</div>
      <div style="font-size:12px;color:var(--grey);margin-top:4px;">${f.detail}</div>
    </div>`;
  }).join('');

  const reminderCard = governanceReminder ? `<div style="background:#EFEFEF;border-left:4px solid var(--grey);border-radius:8px;padding:14px 16px;">
      <div style="font-weight:700;font-size:13.5px;color:var(--ink);">\u2139\ufe0f Governance reminder</div>
      <div style="font-size:12px;color:var(--grey);margin-top:4px;">Per AOP: MOUs signed without SSS authority are a non-negotiable breach, reviewed by RP within 24 hours. This isn't auto-checkable from system data — confirm signing authority was followed for all ${signedDeals.length} signed deal(s).</div>
    </div>` : '';

  return `
    <div class="section-label"><span>\u26a0\ufe0f AOP Red Flags</span><div class="line"></div></div>
    <div class="card">
      ${flagCards}${reminderCard}
    </div>
  `;
}

// Per-TARGET on-track/at-risk status (distinct from per-DEAL status above).
// Compares how much of the quarter has elapsed against how much of the
// target has been achieved. A deal can be individually "on track" while
// the quarter's overall target is still "at risk" if too few deals exist,
// and vice versa — these are two different questions.
function getTargetPaceStatus(qLabel, achievedPct) {
  const [startCal, endCal] = quarterBoundsCalendar(qLabel);
  const start = new Date(startCal + 'T00:00:00');
  // Exclusive end boundary (midnight of the day AFTER endCal) avoids the
  // same off-by-one that affected renderAnnualForecast — see that
  // function's comment for why end-of-day + "+1" double-counts.
  const endExclusive = new Date(new Date(endCal + 'T00:00:00').getTime() + 24 * 60 * 60 * 1000);
  const today = new Date();
  const totalDays = Math.max(1, Math.round((endExclusive - start) / (1000 * 60 * 60 * 24)));
  let elapsedDays = Math.round((today - start) / (1000 * 60 * 60 * 24));
  elapsedDays = Math.max(0, Math.min(totalDays, elapsedDays));
  const elapsedPct = (elapsedDays / totalDays) * 100;

  const gap = elapsedPct - achievedPct;
  if (gap <= 15) return { label: 'On Track', cls: 'badge-closed-signed' };
  if (gap <= 30) return { label: 'At Risk', cls: 'badge-evaluation' };
  return { label: 'Critical', cls: 'badge-closed-dropped' };
}

function getLastChangeForDeal(dealId) {
  const events = STATE.stageHistory.filter(h => h.dealId === dealId);
  if (events.length === 0) return null;
  return events.reduce((latest, e) => new Date(e.changedAt) > new Date(latest.changedAt) ? e : latest, events[0]);
}

// General per-deal on-track/at-risk status, for EVERY active deal (not just
// stalled ones). Reuses the same 30/60/90-day thresholds as stalled-deal
// detection, just relabeled into a status any row can show:
//   < 30 days since last stage movement -> On Track
//   30-59 days                          -> At Risk
//   60-89 days                          -> Stalled
//   90+ days                            -> Critical
// Closed deals (Signed/Dropped) always read as Closed, not a risk status.
function getDealStatus(deal) {
  if (deal.stage === 'Signed') return { label: 'Signed', cls: 'badge-closed-signed', daysInStage: null };
  if (deal.stage === 'Dropped') return { label: 'Dropped', cls: 'badge-closed-dropped', daysInStage: null };
  const lastChange = getLastChangeForDeal(deal.id);
  const sinceDate = lastChange ? new Date(lastChange.changedAt) : (deal.dateAdded ? new Date(deal.dateAdded) : null);
  if (!sinceDate || isNaN(sinceDate)) return { label: 'Unknown', cls: 'badge-sourcing', daysInStage: null };
  const daysInStage = Math.floor((new Date() - sinceDate) / (1000 * 60 * 60 * 24));
  if (daysInStage >= 90) return { label: 'Critical', cls: 'badge-closed-dropped', daysInStage };
  if (daysInStage >= 60) return { label: 'Stalled', cls: 'badge-negotiation', daysInStage };
  if (daysInStage >= 30) return { label: 'At Risk', cls: 'badge-evaluation', daysInStage };
  return { label: 'On Track', cls: 'badge-closed-signed', daysInStage };
}

function getStalledDeals() {
  const today = new Date();
  const activeDeals = STATE.deals.filter(d => d.stage !== 'Signed' && d.stage !== 'Dropped');
  return activeDeals.map(d => {
    const lastChange = getLastChangeForDeal(d.id);
    const sinceDate = lastChange ? new Date(lastChange.changedAt) : (d.dateAdded ? new Date(d.dateAdded) : null);
    if (!sinceDate || isNaN(sinceDate)) return null;
    const daysInStage = Math.floor((today - sinceDate) / (1000 * 60 * 60 * 24));
    let severity = null;
    if (daysInStage >= 90) severity = 'critical';
    else if (daysInStage >= 60) severity = 'stalled';
    else if (daysInStage >= 30) severity = 'watch';
    if (!severity) return null;
    return { parcelName: d.parcelName, location: d.location, stage: d.stage, daysInStage, severity };
  }).filter(Boolean).sort((a, b) => b.daysInStage - a.daysInStage);
}

function renderStalledDealsHTML() {
  const stalled = getStalledDeals();
  if (stalled.length === 0) {
    return `<div class="empty-state" style="padding:24px;"><div class="icon">\u2713</div>No deals stalled beyond 30 days in their current stage.</div>`;
  }
  const severityLabel = { critical: 'Critical \u2014 90+ days', stalled: 'Stalled \u2014 60-89 days', watch: 'Watch \u2014 30-59 days' };
  const severityBadge = { critical: 'badge-closed-dropped', stalled: 'badge-negotiation', watch: 'badge-evaluation' };
  return `<div class="table-wrap"><table>
    <thead><tr><th>Parcel</th><th>Current Stage</th><th>Days With No Stage Movement</th><th>Flag</th></tr></thead>
    <tbody>
      ${stalled.map(s => `
        <tr>
          <td><b>${escapeHTML(s.parcelName)}</b><br><span style="color:var(--grey);font-size:12px;">${escapeHTML(s.location || '')}</span></td>
          <td>${stageBadge(s.stage)}</td>
          <td><b>${s.daysInStage} days</b></td>
          <td><span class="badge ${severityBadge[s.severity]}">${severityLabel[s.severity]}</span></td>
        </tr>`).join('')}
    </tbody>
  </table></div>`;
}

/**
 * Stage-by-stage conversion, evaluated AS OF the end of a given window.
 *
 * Methodology note: rates use a CUMULATIVE cohort (all deals that have
 * EVER reached a milestone by the window's end date), not "entered AND
 * exited within this exact quarter." Land deals routinely span multiple
 * quarters between stages, so a same-quarter-only count would wrongly
 * show "no conversion" for a deal that entered negotiation in Q4 and
 * signed in Q1. The cumulative approach answers the real question a CEO
 * is asking: "of everything sourced/negotiated so far, how much has
 * actually converted?" — and the QUARTER-OVER-QUARTER TREND of that
 * cumulative rate still shows clearly whether conversion is improving.
 *
 * Activity counts (visits/leads) ARE still scoped to the quarter itself,
 * since those are naturally period-bound (visits done that quarter).
 */
function computeConversionRates(startCal, endCal) {
  const logsInRange = STATE.dailyLogs.filter(d => {
    const cal = extractDateOnly(d.date);
    return cal && cal >= startCal && cal <= endCal;
  });
  const visits = logsInRange.reduce((s, d) => s + (Number(d.siteVisits) || 0), 0);
  const leads = logsInRange.reduce((s, d) => s + (Number(d.newLeads) || 0), 0);

  // Cumulative as-of-end-of-window: every stage transition that happened by `endCal`
  const historyToDate = STATE.stageHistory.filter(h => {
    const cal = extractDateOnly(h.changedAt);
    return cal && cal <= endCal;
  });

  const enteredFunnel = new Set(
    historyToDate.filter(h => h.fromStage === 'None').map(h => h.dealId)
  );
  const enteredNegotiation = new Set(
    historyToDate.filter(h => NEGOTIATION_STAGES.includes(h.toStage) && !NEGOTIATION_STAGES.includes(h.fromStage)).map(h => h.dealId)
  );
  const signed = new Set(
    historyToDate.filter(h => h.toStage === 'Signed').map(h => h.dealId)
  );

  return {
    visits, leads,
    visitsToLeads: visits > 0 ? (leads / visits) * 100 : null,
    dealsEnteredFunnel: enteredFunnel.size,
    dealsEnteredNegotiation: enteredNegotiation.size,
    dealsSigned: signed.size,
    leadsToNegotiation: enteredFunnel.size > 0 ? (enteredNegotiation.size / enteredFunnel.size) * 100 : null,
    negotiationToSigned: enteredNegotiation.size > 0 ? (signed.size / enteredNegotiation.size) * 100 : null,
  };
}

function getLastNQuarters(n) {
  // Build a list of the last n quarter labels ending at the current quarter, oldest first
  const current = getCurrentQuarter();
  const m = current.match(/Q(\d) FY(\d\d)-(\d\d)/);
  let qNum = Number(m[1]);
  let fyStart = 2000 + Number(m[2]);
  const list = [current];
  for (let i = 1; i < n; i++) {
    qNum -= 1;
    if (qNum < 1) { qNum = 4; fyStart -= 1; }
    list.unshift(`Q${qNum} FY${String(fyStart).slice(2)}-${String(fyStart + 1).slice(2)}`);
  }
  return list;
}

function renderConversionAnalytics() {
  const quarters = getLastNQuarters(4);
  const rates = quarters.map(q => {
    const [start, end] = quarterBoundsCalendar(q);
    return { quarter: q, ...computeConversionRates(start, end) };
  });
  const latest = rates[rates.length - 1];

  const fmtPct = v => v === null ? '\u2014' : v.toFixed(0) + '%';
  const trendArrow = (curr, prev) => {
    if (curr === null || prev === null) return '';
    if (curr > prev + 2) return '<span style="color:var(--green);font-weight:700;">\u2191</span>';
    if (curr < prev - 2) return '<span style="color:var(--red-deep);font-weight:700;">\u2193</span>';
    return '<span style="color:var(--grey-soft);">\u2192</span>';
  };
  const prev = rates.length > 1 ? rates[rates.length - 2] : null;

  const rows = [
    { label: 'Site Visits \u2192 New Leads', key: 'visitsToLeads', note: `${latest.leads} leads from ${latest.visits} visits in ${latest.quarter}` },
    { label: 'Leads \u2192 Negotiation', key: 'leadsToNegotiation', note: `${latest.dealsEnteredNegotiation} of ${latest.dealsEnteredFunnel} sourced deals have reached negotiation (cumulative, all time to date)` },
    { label: 'Negotiation \u2192 Signed', key: 'negotiationToSigned', note: `${latest.dealsSigned} of ${latest.dealsEnteredNegotiation} negotiated deals have signed (cumulative, all time to date)` },
  ];

  const tableRows = rows.map(r => {
    const curr = latest[r.key];
    const prevVal = prev ? prev[r.key] : null;
    return `<tr>
      <td><b>${r.label}</b><br><span style="color:var(--grey);font-size:12px;">${r.note}</span></td>
      <td style="font-size:20px;font-weight:700;font-family:Georgia,serif;">${fmtPct(curr)}</td>
      <td>${trendArrow(curr, prevVal)} <span style="color:var(--grey);font-size:12px;">vs ${prev ? fmtPct(prevVal) : '\u2014'} last qtr</span></td>
    </tr>`;
  }).join('');

  // Simple trend strip across last 4 quarters for negotiation->signed (the most outcome-relevant rate)
  const trendStrip = rates.map(r => {
    const v = r.negotiationToSigned;
    const height = v === null ? 4 : Math.max(4, Math.min(60, v * 0.6));
    return `<div style="display:flex;flex-direction:column;align-items:center;gap:6px;flex:1;">
      <div style="font-size:11px;color:var(--grey);">${v === null ? '\u2014' : v.toFixed(0) + '%'}</div>
      <div style="width:28px;height:${height}px;background:var(--ink);border-radius:3px 3px 0 0;"></div>
      <div style="font-size:10px;color:var(--grey-soft);text-transform:uppercase;">${r.quarter.split(' ')[0]}</div>
    </div>`;
  }).join('');

  return `
    <div class="card">
      <div class="card-title">Conversion Funnel \u2014 As of End of ${latest.quarter}</div>
      <div class="table-wrap"><table>
        <thead><tr><th>Stage Transition</th><th>Rate</th><th>Trend</th></tr></thead>
        <tbody>${tableRows}</tbody>
      </table></div>
      <p style="font-size:11.5px;color:var(--grey-soft);margin-top:14px;line-height:1.5;">
        Negotiation/signing rates are cumulative (all deals to date), since land deals often span multiple
        quarters between stages \u2014 a same-quarter-only count would understate real conversion. Visit-to-lead
        rate IS quarter-specific, since that activity is naturally period-bound. These are compared against
        BD's OWN performance over time, not an external benchmark \u2014 there is no reliable published industry
        benchmark for land-acquisition lead-to-signed conversion (residential buyer/seller lead stats are a
        different business and don't transfer here). Use the trend, not a fixed target, to judge direction.
      </p>
    </div>

    <div class="card">
      <div class="card-title">Negotiation \u2192 Signed Rate (Cumulative), Last 4 Quarters</div>
      <div style="display:flex;align-items:flex-end;gap:10px;height:90px;padding:0 8px;">${trendStrip}</div>
    </div>

    <div class="card">
      <div class="card-title">Stalled Deals <span class="as-of">flagged at 30 / 60 / 90+ days with no stage movement</span></div>
      ${renderStalledDealsHTML()}
    </div>
  `;
}

// Groups all Pipeline deals by SOURCE TYPE (Broker/Reference/Landowner
// Direct/Cold Outreach/Other) and computes how each source actually
// performs: total leads brought in, how many converted to Signed, the
// resulting conversion rate, and acres signed — so volume isn't mistaken
// for quality (a source with many leads but few signings should look
// worse here than one with fewer leads but a higher hit rate).
function renderSourcePerformanceTable() {
  if (STATE.deals.length === 0) {
    return `<div class="empty-state" style="padding:24px;"><div class="icon">\ud83d\udcca</div>No deals in pipeline yet to analyze.</div>`;
  }
  const bySource = {};
  STATE.deals.forEach(d => {
    const key = d.source || 'Unspecified';
    if (!bySource[key]) bySource[key] = { total: 0, signed: 0, dropped: 0, acresSigned: 0 };
    bySource[key].total++;
    if (d.stage === 'Signed') {
      bySource[key].signed++;
      bySource[key].acresSigned += Number(d.areaAcres) || 0;
    }
    if (d.stage === 'Dropped') bySource[key].dropped++;
  });

  const rows = Object.entries(bySource)
    .sort((a, b) => b[1].total - a[1].total)
    .map(([source, s]) => {
      const conversionPct = s.total > 0 ? Math.round((s.signed / s.total) * 100) : 0;
      return `<tr>
        <td><b>${escapeHTML(source)}</b></td>
        <td>${s.total}</td>
        <td>${s.signed}</td>
        <td>${s.dropped}</td>
        <td style="font-weight:700;">${conversionPct}%</td>
        <td>${s.acresSigned.toFixed(1)}</td>
      </tr>`;
    }).join('');

  return `<div class="table-wrap"><table>
    <thead><tr><th>Source</th><th>Total Leads</th><th>Signed</th><th>Dropped</th><th>Conversion Rate</th><th>Acres Signed</th></tr></thead>
    <tbody>${rows}</tbody>
  </table></div>`;
}

// Simple linear run-rate forecast: projects full FY26-27 (Apr 2026-Mar
// 2027) outcomes from whatever has been achieved so far, scaled by how
// much of the fiscal year has elapsed. This is a planning signal, not a
// statistical model — it doesn't know about seasonality (e.g. monsoon
// months typically slow site visits) or pipeline composition, just pace.
function renderAnnualForecast() {
  const fyStart = new Date('2026-04-01T00:00:00');
  const fyEndExclusive = new Date('2027-04-01T00:00:00'); // exclusive boundary avoids off-by-one from inclusive end-of-day arithmetic
  const today = new Date();
  const totalFYDays = Math.round((fyEndExclusive - fyStart) / (1000 * 60 * 60 * 24));
  let elapsedFYDays = Math.round((today - fyStart) / (1000 * 60 * 60 * 24));
  elapsedFYDays = Math.max(1, Math.min(totalFYDays, elapsedFYDays));
  const elapsedPct = elapsedFYDays / totalFYDays;

  const allQuarters = ['Q1 FY26-27', 'Q2 FY26-27', 'Q3 FY26-27', 'Q4 FY26-27'];
  const dealsSignedSoFar = STATE.deals.filter(d => d.stage === 'Signed');
  const acresSignedSoFar = dealsSignedSoFar.reduce((s, d) => s + (Number(d.areaAcres) || 0), 0);
  const proposalsSoFar = allQuarters.reduce((s, q) => s + sumProposalsInQuarter(q), 0);

  const annualTargets = { proposals: 7.5, acres: 20, dealsSigned: 7.5 }; // AOP: 7-8 proposals/deals, midpoint 7.5

  const project = achieved => elapsedPct > 0 ? achieved / elapsedPct : 0;
  const projectedProposals = project(proposalsSoFar);
  const projectedAcres = project(acresSignedSoFar);
  const projectedDealsSigned = project(dealsSignedSoFar.length);

  const forecastRow = (label, achieved, projected, target, isDecimal) => {
    const a = isDecimal ? achieved.toFixed(1) : achieved;
    const p = isDecimal ? projected.toFixed(1) : Math.round(projected);
    const onTrack = projected >= target * 0.9; // within 10% of annual target counts as on-track
    const cls = onTrack ? 'badge-closed-signed' : (projected >= target * 0.7 ? 'badge-evaluation' : 'badge-closed-dropped');
    const label2 = onTrack ? 'On Track' : (projected >= target * 0.7 ? 'At Risk' : 'Critical');
    return `<tr>
      <td><b>${label}</b></td>
      <td>${a}</td>
      <td style="font-weight:700;">${p}</td>
      <td>${target}</td>
      <td><span class="badge ${cls}">${label2}</span></td>
    </tr>`;
  };

  return `
    <div class="table-wrap"><table>
      <thead><tr><th>Metric</th><th>Achieved So Far</th><th>Projected Year-End</th><th>AOP Annual Target</th><th>Forecast</th></tr></thead>
      <tbody>
        ${forecastRow('Proposals Presented', proposalsSoFar, projectedProposals, annualTargets.proposals)}
        ${forecastRow('Acres Signed', acresSignedSoFar, projectedAcres, annualTargets.acres, true)}
        ${forecastRow('Deals Signed', dealsSignedSoFar.length, projectedDealsSigned, annualTargets.dealsSigned)}
      </tbody>
    </table></div>
    <p style="font-size:11px;color:var(--grey-soft);margin-top:12px;">
      ${Math.round(elapsedPct * 100)}% of FY26-27 elapsed (${elapsedFYDays} of ${totalFYDays} days). Projection = achieved-so-far \u00f7 % of year elapsed \u2014 a straight-line extrapolation, not a forecast model.
    </p>
  `;
}

function renderAnalyticsSection() {
  if (STATE.deals.length === 0 && STATE.dailyLogs.length === 0) {
    return `<div class="card"><div class="empty-state"><div class="icon">\ud83d\udcca</div>Not enough data yet to compute conversion analytics.</div></div>`;
  }
  return renderConversionAnalytics();
}

// Pure conversion-ratio view of the AOP funnel — no targets, no editing.
// Computes stage-to-stage percentages from whatever actuals exist for the
// selected quarter (actuals for stages 1-3 are still entered/stored the
// same way as before; only the editable UI for them was removed here).
function renderFunnelConversionRatios(qTarget, signedActual) {
  const sourced = Number(qTarget.actualLeadsSourced) || 0;
  const qualified = Number(qTarget.actualLeadsQualified) || 0;
  const prospects = Number(qTarget.actualProspects) || 0;
  const signed = Number(signedActual) || 0;

  const ratio = (num, den) => den > 0 ? Math.round((num / den) * 100) : null;
  const r1 = ratio(qualified, sourced);   // Sourcing -> Filter
  const r2 = ratio(prospects, qualified); // Filter -> Refinement
  const r3 = ratio(signed, prospects);    // Refinement -> Signed

  const fmtRatio = r => r === null ? '\u2014' : r + '%';

  const stages = [
    { count: sourced, label: 'Sourced' },
    { count: qualified, label: 'BD Head Filter' },
    { count: prospects, label: 'BD Head Refinement' },
    { count: signed, label: 'Signed' },
  ];
  const stageBlocks = stages.map(s => `
    <div style="text-align:center;flex:1;">
      <div style="font-size:24px;font-weight:700;font-family:Georgia,serif;color:var(--ink);">${s.count}</div>
      <div style="font-size:10.5px;color:var(--grey);text-transform:uppercase;letter-spacing:0.4px;margin-top:2px;">${s.label}</div>
    </div>`).join('<div style="display:flex;align-items:center;color:var(--grey-soft);font-size:13px;font-weight:700;padding:0 6px;">\u2192</div>');

  return `
    <div style="display:flex;align-items:center;margin-bottom:20px;">${stageBlocks}</div>
    <div class="table-wrap"><table>
      <thead><tr><th>Stage Transition</th><th>Conversion Ratio</th></tr></thead>
      <tbody>
        <tr><td>Sourced \u2192 BD Head Filter</td><td style="font-size:16px;font-weight:700;">${fmtRatio(r1)}</td></tr>
        <tr><td>BD Head Filter \u2192 BD Head Refinement</td><td style="font-size:16px;font-weight:700;">${fmtRatio(r2)}</td></tr>
        <tr><td>BD Head Refinement \u2192 Signed</td><td style="font-size:16px;font-weight:700;">${fmtRatio(r3)}</td></tr>
      </tbody>
    </table></div>
    <p style="font-size:11px;color:var(--grey-soft);margin-top:12px;">Ratios are null (\u2014) when the prior stage has zero recorded leads for this quarter.</p>
  `;
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

// Same as progressRow, plus an On Track / At Risk / Critical badge based on
// whether progress toward TARGET is keeping pace with how much of the
// QUARTER has elapsed so far. See getTargetPaceStatus for the methodology.
function progressRowWithStatus(label, actual, target, isDecimal, qLabel) {
  const achievedPct = target > 0 ? Math.min(100, (actual / target) * 100) : 0;
  const status = getTargetPaceStatus(qLabel, achievedPct);
  const a = isDecimal ? Number(actual).toFixed(1) : actual;
  const pct = achievedPct;
  const cls = pct >= 100 ? '' : pct >= 50 ? 'gold' : 'amber';
  return `
    <div class="progress-row">
      <div class="pr-label">
        <span class="name">${label}</span>
        <span style="display:flex;align-items:center;gap:8px;">
          <span class="val">${a} / ${target}</span>
          <span class="badge ${status.cls}">${status.label}</span>
        </span>
      </div>
      <div class="progress-bar-bg"><div class="progress-bar-fill ${cls}" style="width:${pct}%"></div></div>
    </div>`;
}

/* ---------------- TARGET EDITING (the one deliberate write capability) ----------------
   This dashboard is read-only everywhere else. setTarget is the single
   exception, intentionally placed here per product decision: target-
   setting moved from the BD entry tool to CEO-only control. Do not add
   any other write action (deals/logs/directory) to this file. */

function renderTargetEditTable() {
  const quarters = ['Q1 FY26-27', 'Q2 FY26-27', 'Q3 FY26-27', 'Q4 FY26-27'];
  const rows = quarters.map(q => {
    const t = STATE.targets.find(x => x.periodType === 'quarterly' && x.periodLabel === q) || {};
    return `<tr>
      <td><b>${q}</b></td>
      <td><input type="number" min="0" value="${t.targetProposals || 0}" data-q="${q}" data-field="targetProposals" class="target-edit-input" style="width:72px;padding:6px 8px;border:1px solid var(--border);border-radius:6px;font-size:13px;"></td>
      <td><input type="number" min="0" step="0.1" value="${t.targetAcres || 0}" data-q="${q}" data-field="targetAcres" class="target-edit-input" style="width:72px;padding:6px 8px;border:1px solid var(--border);border-radius:6px;font-size:13px;"></td>
      <td><input type="number" min="0" value="${t.targetDealsSigned || 0}" data-q="${q}" data-field="targetDealsSigned" class="target-edit-input" style="width:72px;padding:6px 8px;border:1px solid var(--border);border-radius:6px;font-size:13px;"></td>
      <td><button class="quarter-tab" style="background:var(--ink);color:white;border-color:var(--ink);" onclick="saveTarget('${q}')">Save</button></td>
    </tr>`;
  }).join('');
  return `<div class="table-wrap"><table>
    <thead><tr><th>Quarter</th><th>Target Proposals</th><th>Target Acres</th><th>Target Deals Signed</th><th></th></tr></thead>
    <tbody>${rows}</tbody>
  </table></div>`;
}

async function saveTarget(quarterLabel) {
  if (API_URL.includes('PASTE_YOUR')) { showCeoToast('API_URL is not configured yet.', true); return; }
  const inputs = document.querySelectorAll(`.target-edit-input[data-q="${quarterLabel}"]`);
  const payload = { periodType: 'quarterly', periodLabel: quarterLabel };
  inputs.forEach(inp => payload[inp.dataset.field] = Number(inp.value) || 0);
  try {
    const url = `${API_URL}?action=setTarget&payload=${encodeURIComponent(JSON.stringify(payload))}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Network error: ' + res.status);
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || 'Unknown error');
    showCeoToast(`${quarterLabel} targets saved.`);
    await loadData(); // refresh everything so progress bars reflect the new target immediately
  } catch (err) {
    showCeoToast('Failed to save target: ' + err.message, true);
  }
}

function showCeoToast(msg, isError) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.className = 'toast show' + (isError ? ' error' : '');
  setTimeout(() => t.classList.remove('show'), 3200);
}

// Mirrors checkFinancialFloors() in Code.gs exactly — kept in sync
// manually since this runs in the browser, not Apps Script. If you
// change the AOP thresholds in one place, change them in both.
function checkFinancialFloors(deal) {
  const irr = Number(deal.irrPct);
  const pat = Number(deal.patPct);
  const profitSft = Number(deal.profitPerSft);
  const years = Number(deal.completionYears);
  const isRedevelopment = deal.dealStructure === 'Redevelopment';
  const profitFloor = isRedevelopment ? 1000 : 500;

  const notEmpty = v => v !== '' && v !== undefined && v !== null;

  const floors = {
    irr: { value: irr, floor: 30, pass: notEmpty(deal.irrPct) && !isNaN(irr) && irr >= 30 },
    pat: { value: pat, floor: 10, pass: notEmpty(deal.patPct) && !isNaN(pat) && pat >= 10 },
    profitPerSft: { value: profitSft, floor: profitFloor, pass: notEmpty(deal.profitPerSft) && !isNaN(profitSft) && profitSft >= profitFloor },
    completionYears: { value: years, floor: 3, pass: notEmpty(deal.completionYears) && !isNaN(years) && years > 0 && years <= 3 }
  };

  const allEntered = ['irrPct', 'patPct', 'profitPerSft', 'completionYears'].every(f => notEmpty(deal[f]));
  const allPass = floors.irr.pass && floors.pat.pass && floors.profitPerSft.pass && floors.completionYears.pass;
  const verdict = !allEntered ? 'Pending' : (allPass ? 'Pass' : 'Fail');
  return { floors, verdict, profitFloor };
}

function floorVerdictBadge(verdict) {
  const map = { Pass: 'badge-closed-signed', Fail: 'badge-closed-dropped', Pending: 'badge-sourcing' };
  return `<span class="badge ${map[verdict] || 'badge-sourcing'}">Floors: ${verdict}</span>`;
}

function legalGateBadge(status) {
  const map = {
    'Not Started': 'badge-sourcing',
    'In Progress': 'badge-evaluation',
    'Gate 2 Cleared': 'badge-closed-signed',
    'Flagged Issue': 'badge-closed-dropped'
  };
  const label = status || 'Not Started';
  return `<span class="badge ${map[label] || 'badge-sourcing'}">Legal: ${escapeHTML(label)}</span>`;
}

// Groups ACTIVE deals (not Signed/Dropped) by location/micro-market and
// shows a side-by-side comparison wherever 2+ deals compete for the same
// micro-market — answering "of the parcels we're chasing in this area,
// which is actually the better bet?" Skipped entirely if no micro-market
// has more than one active deal (nothing to compare).
function renderMicroMarketComparison() {
  const active = STATE.deals.filter(d => d.stage !== 'Signed' && d.stage !== 'Dropped');
  const byLocation = {};
  active.forEach(d => {
    const key = (d.location || 'Unspecified').trim();
    if (!byLocation[key]) byLocation[key] = [];
    byLocation[key].push(d);
  });
  const competing = Object.entries(byLocation).filter(([, deals]) => deals.length >= 2);
  if (competing.length === 0) return '';

  const sections = competing.map(([location, deals]) => {
    const floorRows = deals.map(d => checkFinancialFloors(d));
    const rows = deals.map((d, i) => {
      const floors = floorRows[i];
      const status = getDealStatus(d);
      return `<tr>
        <td><b>${escapeHTML(d.parcelName)}</b>${d.surveyNumber ? '<br><span style="color:var(--grey);font-size:11px;">Survey No. ' + escapeHTML(d.surveyNumber) + '</span>' : ''}</td>
        <td>${stageBadge(d.stage)}</td>
        <td>${categoryBadge(d.leadCategory)}</td>
        <td>${d.areaAcres || '\u2014'}</td>
        <td>${d.expectedGDV ? '\u20b9' + d.expectedGDV + ' Cr' : '\u2014'}</td>
        <td>${d.irrPct !== '' && d.irrPct !== undefined ? d.irrPct + '%' : '\u2014'}</td>
        <td>${floorVerdictBadge(floors.verdict)}</td>
        <td><span class="badge ${status.cls}">${status.label}</span></td>
      </tr>`;
    }).join('');
    return `
      <div style="margin-bottom:24px;">
        <div style="font-weight:700;font-size:13.5px;color:var(--ink);margin-bottom:10px;">${escapeHTML(location)} \u2014 ${deals.length} competing parcels</div>
        <div class="table-wrap"><table>
          <thead><tr><th>Parcel</th><th>Stage</th><th>Category</th><th>Acres</th><th>Expected GDV</th><th>IRR</th><th>Floors</th><th>Status</th></tr></thead>
          <tbody>${rows}</tbody>
        </table></div>
      </div>`;
  }).join('');

  return `
    <div class="card">
      <div class="card-title">Micro-Market Comparison<span class="as-of">${competing.length} market${competing.length === 1 ? '' : 's'} with multiple active parcels</span></div>
      <p style="font-size:12px;color:var(--grey-soft);margin-bottom:16px;">
        Where 2+ active parcels compete for the same location \u2014 compared side by side on economics and status.
      </p>
      ${sections}
    </div>`;
}

function renderPipelineFilterBar() {
  const categories = ['All', 'Hot', 'Warm', 'Cold'];
  const statuses = ['All', 'On Track', 'At Risk', 'Stalled', 'Critical', 'Signed', 'Dropped'];
  return `
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px;">
      <input type="text" id="pipelineSearchInput" placeholder="Search parcel, location, survey no...\u2026"
        value="${escapeHTML(PIPELINE_FILTER.search)}"
        style="flex:1;min-width:180px;padding:8px 12px;border:1px solid var(--border);border-radius:6px;font-size:13px;"
        oninput="updatePipelineFilter('search', this.value)">
      <select id="pipelineCategoryFilter" style="padding:8px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;"
        onchange="updatePipelineFilter('category', this.value)">
        ${categories.map(c => `<option value="${c}" ${PIPELINE_FILTER.category === c ? 'selected' : ''}>${c === 'All' ? 'All Categories' : c}</option>`).join('')}
      </select>
      <select id="pipelineStatusFilter" style="padding:8px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;"
        onchange="updatePipelineFilter('status', this.value)">
        ${statuses.map(s => `<option value="${s}" ${PIPELINE_FILTER.status === s ? 'selected' : ''}>${s === 'All' ? 'All Statuses' : s}</option>`).join('')}
      </select>
    </div>`;
}

// Re-renders ONLY the pipeline cards container, not the whole dashboard —
// keeps filtering responsive without losing scroll position or re-fetching.
function updatePipelineFilter(field, value) {
  PIPELINE_FILTER[field] = value;
  const container = document.getElementById('pipelineCardsContainer');
  if (container) container.innerHTML = renderPipelineTable();
}

function renderPipelineTable() {
  let filtered = [...STATE.deals];
  const term = PIPELINE_FILTER.search.trim().toLowerCase();
  if (term) {
    filtered = filtered.filter(d =>
      (d.parcelName || '').toLowerCase().includes(term) ||
      (d.location || '').toLowerCase().includes(term) ||
      (d.surveyNumber || '').toLowerCase().includes(term)
    );
  }
  if (PIPELINE_FILTER.category !== 'All') {
    filtered = filtered.filter(d => (d.leadCategory || 'Warm') === PIPELINE_FILTER.category);
  }
  if (PIPELINE_FILTER.status !== 'All') {
    filtered = filtered.filter(d => getDealStatus(d).label === PIPELINE_FILTER.status);
  }
  const sorted = filtered.sort((a, b) => new Date(b.lastUpdated) - new Date(a.lastUpdated));
  if (sorted.length === 0) {
    const msg = STATE.deals.length === 0 ? 'No parcels in pipeline yet.' : 'No parcels match the current filter.';
    return `<div class="empty-state"><div class="icon">📋</div>${msg}</div>`;
  }
  return sorted.map(d => {
    const status = getDealStatus(d);
    const floors = checkFinancialFloors(d);
    const nextActionOverdue = d.nextActionDate && new Date(d.nextActionDate) < new Date() && !['Signed', 'Dropped'].includes(d.stage);
    const floorDetailRows = ['irr', 'pat', 'profitPerSft', 'completionYears'].map(key => {
      const f = floors.floors[key];
      const labels = { irr: 'IRR', pat: 'PAT', profitPerSft: 'Profit/sft', completionYears: 'Completion (yrs)' };
      const comparator = key === 'completionYears' ? '\u2264' : '\u2265';
      const valDisplay = (f.value === undefined || isNaN(f.value)) ? '\u2014' : f.value;
      const icon = f.pass ? '\u2705' : (valDisplay === '\u2014' ? '\u2796' : '\u274c');
      return `<span style="margin-right:14px;font-size:11.5px;color:var(--grey);">${icon} ${labels[key]}: ${valDisplay} (${comparator}${f.floor})</span>`;
    }).join('');
    return `
    <div class="deal-card">
      <div class="deal-card-top">
        <div>
          <div class="deal-card-title">${escapeHTML(d.parcelName)}</div>
          <div class="deal-card-sub">${escapeHTML(d.location || '\u2014')}${d.surveyNumber ? ' &middot; Survey No. ' + escapeHTML(d.surveyNumber) : ''}${d.dealStructure ? ' &middot; ' + escapeHTML(d.dealStructure) : ''}${d.owner ? ' &middot; Owner: ' + escapeHTML(d.owner) : ''}</div>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;">
          ${categoryBadge(d.leadCategory)}
          ${stageBadge(d.stage)}
          <span class="badge ${status.cls}">${status.label}${status.daysInStage !== null ? ' &middot; ' + status.daysInStage + 'd' : ''}</span>
        </div>
      </div>
      <div class="deal-card-grid">
        <div><span class="dcg-label">Source</span><span class="dcg-val">${escapeHTML(d.source || '\u2014')}${d.sourceDetail ? ' \u2014 ' + escapeHTML(d.sourceDetail) : ''}</span></div>
        <div><span class="dcg-label">Source Phone</span><span class="dcg-val">${escapeHTML(d.sourcePhone || '\u2014')}</span></div>
        <div><span class="dcg-label">Area</span><span class="dcg-val">${d.areaAcres || '\u2014'} acres</span></div>
        <div><span class="dcg-label">Expected GDV</span><span class="dcg-val">${d.expectedGDV ? '\u20b9' + d.expectedGDV + ' Cr' : '\u2014'}</span></div>
        <div><span class="dcg-label">Next Action</span><span class="dcg-val">${escapeHTML(d.nextAction || '\u2014')}</span></div>
        <div><span class="dcg-label">Next Action Date</span><span class="dcg-val" style="${nextActionOverdue ? 'color:var(--red-deep);font-weight:700;' : ''}">${d.nextActionDate ? formatDateShort(d.nextActionDate) : '\u2014'}${nextActionOverdue ? ' (Overdue)' : ''}</span></div>
      </div>
      <div style="margin-top:14px;padding-top:12px;border-top:1px solid var(--border-soft);display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">
        <div>${floorDetailRows}</div>
        <div style="display:flex;gap:6px;">${floorVerdictBadge(floors.verdict)}${legalGateBadge(d.legalGateStatus)}</div>
      </div>
      <button class="timeline-link" onclick='openTimelineModal("${d.id}")'>View Activity Timeline \u2192</button>
        <button class="timeline-link" style="margin-left:16px;color:var(--ink);" onclick='openCeoDocumentModal("${d.id}","${escapeHTML(d.parcelName)}")'>Documents (${ceoDocumentBadgeCount(d.id)}) \u2192</button>
    </div>`;
  }).join('');
}

// Per-deal activity timeline, built from StageHistory — answers "what's
// happened on this lead since it was first sourced." Read-only.
function getDealTimeline(dealId) {
  return STATE.stageHistory
    .filter(h => h.dealId === dealId)
    .sort((a, b) => new Date(a.changedAt) - new Date(b.changedAt));
}

function openTimelineModal(dealId) {
  const deal = STATE.deals.find(d => d.id === dealId);
  if (!deal) return;
  const modal = document.getElementById('timelineModal');
  const body = document.getElementById('timelineModalBody');
  const title = document.getElementById('timelineModalTitle');
  if (!modal || !body || !title) return;

  title.textContent = deal.parcelName + ' \u2014 Full Activity Timeline';

  // Merge StageHistory events and DealActivity log entries into one
  // sorted chronological list — stage transitions and work entries
  // are different types but both belong in the same timeline view.
  const stageEvents = (STATE.stageHistory || [])
    .filter(h => h.dealId === dealId)
    .map(h => ({ type: 'stage', date: h.changedAt, data: h }));

  const activityEvents = (STATE.dealActivity || [])
    .filter(a => a.dealId === dealId)
    .map(a => ({ type: 'activity', date: a.date, data: a }));

  const allEvents = [...stageEvents, ...activityEvents]
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  if (allEvents.length === 0) {
    body.innerHTML = `<div class="empty-state" style="padding:24px;"><div class="icon">\ud83d\udcc5</div>No timeline events recorded yet. Use the "+ Activity" button in the BD entry tool to log work done on this deal.</div>`;
  } else {
    body.innerHTML = `<div class="timeline-list">${allEvents.map(e => {
      if (e.type === 'stage') {
        const h = e.data;
        return `<div class="timeline-item timeline-item-stage">
          <div class="timeline-dot" style="background:var(--ink);"></div>
          <div class="timeline-content">
            <div class="timeline-date">${formatDateShort(h.changedAt)}</div>
            <div class="timeline-transition"><b>\ud83d\udd04 Stage:</b> ${h.fromStage === 'None' ? 'Sourced into pipeline as' : escapeHTML(h.fromStage) + ' \u2192'} <b>${escapeHTML(h.toStage)}</b></div>
          </div>
        </div>`;
      } else {
        const a = e.data;
        const typeIcon = {
          'Site Visit': '\ud83d\udc63', 'Call': '\ud83d\udcde', 'Meeting': '\ud83e\udd1d',
          'Proposal': '\ud83d\udcc4', 'Legal Update': '\u2696\ufe0f', 'Negotiation': '\ud83e\udd1d', 'Other': '\ud83d\udccc'
        }[a.activityType] || '\ud83d\udccc';
        return `<div class="timeline-item timeline-item-activity">
          <div class="timeline-dot" style="background:var(--red);"></div>
          <div class="timeline-content">
            <div class="timeline-date">${formatDateShort(a.date)} &middot; <span style="font-weight:700;color:var(--red);">${escapeHTML(a.activityType)}</span></div>
            <div style="font-size:13.5px;color:var(--ink);margin-top:3px;">${typeIcon} ${escapeHTML(a.summary)}</div>
            ${a.nextFollowupDate ? `<div style="font-size:11.5px;color:var(--grey);margin-top:4px;">\ud83d\udcc5 Next follow-up: ${formatDateShort(a.nextFollowupDate)}</div>` : ''}
            <div style="font-size:11px;color:var(--grey-soft);margin-top:2px;">${escapeHTML(a.loggedBy || 'BD Manager')}</div>
          </div>
        </div>`;
      }
    }).join('')}</div>`;
  }
  modal.classList.add('active');
}

function closeTimelineModal() {
  const modal = document.getElementById('timelineModal');
  if (modal) modal.classList.remove('active');
}

/* ---------------- CEO DOCUMENT MODAL (read-only view/download) ----------------
   Shows the 4-category document checklist for a deal with uploaded/pending
   status and clickable Drive view links. No upload capability here — the
   CEO Dashboard is read-only except for setTarget. Uploads happen in the
   BD entry tool only. */

// Returns the most recent uploaded document for a given deal + docType.
function getLatestDocument(dealId, docType) {
  if (!STATE.documents) return null;
  const matches = (STATE.documents || []).filter(d => d.dealId === dealId && d.docType === docType);
  if (matches.length === 0) return null;
  return matches.reduce((latest, d) =>
    new Date(d.uploadedAt) > new Date(latest.uploadedAt) ? d : latest, matches[0]);
}

// "X/13" count shown on the Documents button in each deal card.
function ceoDocumentBadgeCount(dealId) {
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
  // Wired in DOMContentLoaded above — nothing more needed here.
}

function openCeoDocumentModal(dealId, parcelName) {
  const modal = document.getElementById('ceoDocumentModal');
  const body = document.getElementById('ceoDocumentModalBody');
  const title = document.getElementById('ceoDocumentModalTitle');
  if (!modal || !body || !title) return;

  title.textContent = 'Documents — ' + parcelName;

  const sections = Object.entries(DOCUMENT_CHECKLIST).map(([catKey, cat]) => {
    const rows = cat.docs.map(docType => {
      const existing = getLatestDocument(dealId, docType);
      return `<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 0;border-bottom:1px solid var(--border-soft);">
        <span style="font-size:13px;color:var(--ink);flex:1;">${escapeHTML(docType)}</span>
        <span>
          ${existing
            ? `<a href="${escapeHTML(existing.driveUrl)}" target="_blank" rel="noopener"
                class="badge badge-closed-signed"
                style="text-decoration:none;">✓ View</a>`
            : `<span class="badge badge-sourcing">Pending</span>`}
        </span>
      </div>`;
    }).join('');
    return `<div style="margin-bottom:20px;">
      <div style="font-size:11px;font-weight:700;color:var(--ink);text-transform:uppercase;
           letter-spacing:0.5px;margin-bottom:8px;padding-bottom:6px;
           border-bottom:2px solid var(--border);">${escapeHTML(cat.label)}</div>
      ${rows}
    </div>`;
  }).join('');

  body.innerHTML = sections;
  modal.classList.add('active');
}

function closeCeoDocumentModal() {
  const modal = document.getElementById('ceoDocumentModal');
  if (modal) modal.classList.remove('active');
}



/* ---------------- CONTACT SEARCH PANEL ----------------
   Searches across the Directory (brokers/landowners/
   developers/others) by name, phone, or notes.
   Includes type filtering. CEO-read-only. */

let SEARCH_FILTER_TYPE = 'All';

function openSearchPanel() {
  const panel = document.getElementById('searchPanel');
  if (!panel) return;
  panel.classList.add('active');
  const input = document.getElementById('searchInput');
  if (input) { input.value = ''; input.focus(); }
  SEARCH_FILTER_TYPE = 'All';
  document.querySelectorAll('.search-filter-btn').forEach(b => b.classList.toggle('active', b.dataset.type === 'All'));
  document.getElementById('searchResults').innerHTML = `<div class="search-empty">Start typing to search contacts\u2026</div>`;
}

function closeSearchPanel() {
  const panel = document.getElementById('searchPanel');
  if (panel) panel.classList.remove('active');
}

function setSearchFilter(type) {
  SEARCH_FILTER_TYPE = type;
  document.querySelectorAll('.search-filter-btn').forEach(b => b.classList.toggle('active', b.dataset.type === type));
  runContactSearch();
}

function runContactSearch() {
  const term = (document.getElementById('searchInput').value || '').trim().toLowerCase();
  const resultsEl = document.getElementById('searchResults');
  if (!resultsEl) return;

  if (!term && SEARCH_FILTER_TYPE === 'All') {
    resultsEl.innerHTML = `<div class="search-empty">Start typing to search contacts\u2026</div>`;
    return;
  }

  const dir = STATE.directory || [];
  const filtered = dir.filter(c => {
    const typeMatch = SEARCH_FILTER_TYPE === 'All' || (c.type || '').toLowerCase() === SEARCH_FILTER_TYPE.toLowerCase();
    if (!typeMatch) return false;
    if (!term) return true;
    return (c.name || '').toLowerCase().includes(term) ||
           (c.phone || '').toLowerCase().includes(term) ||
           (c.notes || '').toLowerCase().includes(term);
  });

  if (filtered.length === 0) {
    resultsEl.innerHTML = `<div class="search-empty">No contacts found for "${escapeHTML(term)}"${SEARCH_FILTER_TYPE !== 'All' ? ' in ' + SEARCH_FILTER_TYPE + 's' : ''}.</div>`;
    return;
  }

  resultsEl.innerHTML = filtered.map(c => `
    <div class="search-result-card">
      <div>
        <div class="src-name">${escapeHTML(c.name || '\u2014')}</div>
        <div class="src-type">${escapeHTML(c.type || 'Contact')}</div>
        ${c.notes ? `<div class="src-notes">${escapeHTML(c.notes)}</div>` : ''}
      </div>
      <div style="text-align:right;flex-shrink:0;">
        ${c.phone ? `<div class="src-phone">${escapeHTML(c.phone)}</div>` : '<div class="src-phone" style="color:var(--grey-soft);">\u2014</div>'}
        <div style="font-size:11px;color:var(--grey-soft);margin-top:3px;">Added ${formatDateShort(c.dateAdded)}</div>
      </div>
    </div>`).join('');
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

// Hot/Warm/Cold lead category, same mapping as the entry tool (app.js).
function categoryBadge(category) {
  const map = {
    'Hot': { cls: 'badge-closed-signed', dot: '🟢' },
    'Warm': { cls: 'badge-evaluation', dot: '🟡' },
    'Cold': { cls: 'badge-closed-dropped', dot: '🔴' },
  };
  const c = map[category] || map['Warm'];
  return `<span class="badge ${c.cls}">${c.dot} ${escapeHTML(category || 'Warm')}</span>`;
}

/* ---------------- QUARTER / DATE HELPERS (same logic as entry tool) ---------------- */

// ---- TIMEZONE-SAFE DATE HANDLING ----
// Dates stored via the entry tool's <input type="date"> round-trip through
// Apps Script/Sheets and come back as full ISO timestamps with a fixed
// "T18:30:00.000Z" time-of-day suffix (an artifact of the Sheet's IST
// timezone setting) — e.g. "2026-04-30T18:30:00.000Z". Critically, the
// DATE PORTION of that string already matches the calendar date the user
// actually picked (confirmed against real production data) — only the
// time-of-day component is a meaningless artifact. The actual bug is
// comparing these as full Date-object INSTANTS (which drags that 18:30
// artifact into the comparison) against quarter boundaries built at local
// midnight — that comparison can misclassify entries near a boundary.
// Fix: extract just the YYYY-MM-DD date portion and compare as strings,
// ignoring time-of-day entirely. Do NOT apply any UTC<->IST shift here —
// the date portion is already correct as stored.
function extractDateOnly(dateStr) {
  if (!dateStr) return null;
  const m = String(dateStr).match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

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

// Returns quarter boundaries as YYYY-MM-DD calendar-date strings (not Date
// objects), for direct string comparison against extractDateOnly() output.
function quarterBoundsCalendar(qLabel) {
  const m = qLabel.match(/Q(\d) FY(\d\d)-(\d\d)/);
  if (!m) return ['0000-00-00', '9999-99-99'];
  const qNum = Number(m[1]);
  const fyStartYear = 2000 + Number(m[2]);
  let year = fyStartYear;
  let startMonth; // 0-indexed
  if (qNum === 1) startMonth = 3;
  else if (qNum === 2) startMonth = 6;
  else if (qNum === 3) startMonth = 9;
  else { startMonth = 0; year = fyStartYear + 1; }
  const endMonth = startMonth + 2; // inclusive, 0-indexed
  const endYear = year + Math.floor(endMonth / 12);
  const endMonthNorm = endMonth % 12;
  const lastDay = new Date(endYear, endMonthNorm + 1, 0).getDate(); // local-time day count is fine here, only used for day-of-month, not as a timestamp
  const start = `${year}-${String(startMonth + 1).padStart(2, '0')}-01`;
  const end = `${endYear}-${String(endMonthNorm + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  return [start, end];
}

// Kept for any external callers expecting Date objects — now derived from
// the calendar-string boundaries so both representations stay consistent.
function quarterBounds(qLabel) {
  const [startStr, endStr] = quarterBoundsCalendar(qLabel);
  return [new Date(startStr + 'T00:00:00'), new Date(endStr + 'T23:59:59')];
}

function sumProposalsInQuarter(qLabel) {
  const [start, end] = quarterBoundsCalendar(qLabel);
  return STATE.dailyLogs
    .filter(d => {
      const cal = extractDateOnly(d.date);
      return cal && cal >= start && cal <= end;
    })
    .reduce((s, d) => s + (Number(d.proposalsPresented) || 0), 0);
}

function sumAcresSignedInQuarter(qLabel) {
  const [start, end] = quarterBoundsCalendar(qLabel);
  return STATE.deals
    .filter(d => {
      if (d.stage !== 'Signed') return false;
      const cal = extractDateOnly(d.lastUpdated);
      return cal && cal >= start && cal <= end;
    })
    .reduce((s, d) => s + (Number(d.areaAcres) || 0), 0);
}

function countDealsSignedInQuarter(qLabel) {
  const [start, end] = quarterBoundsCalendar(qLabel);
  return STATE.deals
    .filter(d => {
      if (d.stage !== 'Signed') return false;
      const cal = extractDateOnly(d.lastUpdated);
      return cal && cal >= start && cal <= end;
    })
    .length;
}

function isSameMonth(dateStr, ref) {
  const cal = extractDateOnly(dateStr);
  if (!cal) return false;
  const refY = ref.getFullYear();
  const refM = String(ref.getMonth() + 1).padStart(2, '0');
  return cal.startsWith(`${refY}-${refM}`);
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

function escapeHTML(str) {
  if (str === undefined || str === null) return '';
  return String(str).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}
