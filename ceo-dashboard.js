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

let STATE = { dailyLogs: [], deals: [], targets: [], stageHistory: [] };
let SELECTED_QUARTER = getCurrentQuarter();

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('todayBadge').textContent = formatDateLong(new Date());
  loadData();
  setInterval(loadData, AUTO_REFRESH_MINUTES * 60 * 1000);
});

async function loadData() {
  try {
    const url = `${API_URL}?action=getCeoSummary`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Network error: ' + res.status);
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || 'Unknown error');
    STATE = json.data;
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
    <div class="section-label"><span>This Month</span><div class="line"></div></div>
    <div class="kpi-grid">
      <div class="kpi-card">
        <div class="kpi-label">Site Visits</div>
        <div class="kpi-value">${mtd.siteVisits}</div>
        <div class="kpi-sub">Month-to-date</div>
      </div>
      <div class="kpi-card alt">
        <div class="kpi-label">Broker + Landowner Meetings</div>
        <div class="kpi-value">${mtd.brokerMeetings + mtd.ownerMeetings}</div>
        <div class="kpi-sub">${mtd.brokerMeetings} broker · ${mtd.ownerMeetings} landowner</div>
      </div>
      <div class="kpi-card alt2">
        <div class="kpi-label">New Leads Sourced</div>
        <div class="kpi-value">${mtd.newLeads}</div>
        <div class="kpi-sub">${mtd.proposalsPresented} proposals presented to management</div>
      </div>
      <div class="kpi-card" style="border-left-color:var(--grey)">
        <div class="kpi-label">Active Pipeline</div>
        <div class="kpi-value">${activeDeals.length}</div>
        <div class="kpi-sub">${totalAcresPipeline.toFixed(1)} acres under evaluation/negotiation</div>
      </div>
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
      ${progressRow('Proposals Presented', qProposalsActual, qTarget.targetProposals || 2)}
      ${progressRow('Acres Signed', qAcresActual, qTarget.targetAcres || 5, true)}
      ${progressRow('Deals Signed', qDealsSignedActual, qTarget.targetDealsSigned || 1)}
    </div>

    <div class="section-label"><span>AOP Lead Conversion Funnel — ${SELECTED_QUARTER}</span><div class="line"></div></div>
    <div class="card">
      <p style="font-size:12px;color:var(--grey-soft);margin-bottom:16px;">
        Per the AOP's funnel model (100 Sourcing \u2192 30 BD Head Filter \u2192 10 BD Head Refinement \u2192 1 Signed). Tracked manually, separately from the Deal Pipeline above \u2014 actuals here are entered by hand, not derived from Pipeline deal-stages.
      </p>
      ${progressRow('Sourcing (Stage 1)', qTarget.actualLeadsSourced || 0, qTarget.targetLeadsSourced || 100)}
      ${progressRow('BD Head Filter (Stage 2)', qTarget.actualLeadsQualified || 0, qTarget.targetLeadsQualified || 30)}
      ${progressRow('BD Head Refinement (Stage 3)', qTarget.actualProspects || 0, qTarget.targetProspects || 10)}
      ${progressRow('SSS Meeting / Signed (Stage 4)', qDealsSignedActual, qTarget.targetDealsSigned || 1)}
    </div>

    <div class="section-label"><span>Set AOP Targets</span><div class="line"></div></div>
    <div class="card">
      <p style="font-size:12.5px;color:var(--grey);margin-bottom:16px;">
        Targets are set here only — the BD entry tool shows these as view-only. Actuals above roll up automatically; only the target numbers are editable.
      </p>
      ${renderTargetEditTable()}
    </div>

    <div class="card">
      <div class="card-title">Set Lead Conversion Funnel</div>
      <p style="font-size:12.5px;color:var(--grey);margin-bottom:16px;">
        Per the AOP's funnel model (Sourcing → BD Head Filter → BD Head Refinement → Signed). Unlike the targets above, actuals for these three stages are entered manually here too — they are not derived from Daily Log or Deal Pipeline data.
      </p>
      ${renderFunnelTargetEditTable()}
    </div>

    <div class="section-label"><span>Land Deal Pipeline</span><div class="line"></div></div>
    <div class="card">
      <div class="card-title">All Parcels<span class="as-of">${STATE.deals.length} total</span></div>
      ${renderPipelineTable()}
    </div>

    <div class="footer-note">Auto-refreshes every ${AUTO_REFRESH_MINUTES} minutes · Summary view — daily notes and contact details are not shown here</div>
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

function getLastChangeForDeal(dealId) {
  const events = STATE.stageHistory.filter(h => h.dealId === dealId);
  if (events.length === 0) return null;
  return events.reduce((latest, e) => new Date(e.changedAt) > new Date(latest.changedAt) ? e : latest, events[0]);
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

function renderAnalyticsSection() {
  if (STATE.deals.length === 0 && STATE.dailyLogs.length === 0) {
    return `<div class="card"><div class="empty-state"><div class="icon">\ud83d\udcca</div>Not enough data yet to compute conversion analytics.</div></div>`;
  }
  return renderConversionAnalytics();
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

function _editInput(q, field, value, width) {
  return `<input type="number" min="0" value="${value || 0}" data-q="${q}" data-field="${field}" class="target-edit-input-funnel" style="width:${width || 64}px;padding:6px 7px;border:1px solid var(--border);border-radius:6px;font-size:12.5px;">`;
}

function renderFunnelTargetEditTable() {
  const quarters = ['Q1 FY26-27', 'Q2 FY26-27', 'Q3 FY26-27', 'Q4 FY26-27'];
  const rows = quarters.map(q => {
    const t = STATE.targets.find(x => x.periodType === 'quarterly' && x.periodLabel === q) || {};
    return `<tr>
      <td><b>${q}</b></td>
      <td>${_editInput(q, 'targetLeadsSourced', t.targetLeadsSourced)}</td>
      <td>${_editInput(q, 'actualLeadsSourced', t.actualLeadsSourced)}</td>
      <td>${_editInput(q, 'targetLeadsQualified', t.targetLeadsQualified)}</td>
      <td>${_editInput(q, 'actualLeadsQualified', t.actualLeadsQualified)}</td>
      <td>${_editInput(q, 'targetProspects', t.targetProspects)}</td>
      <td>${_editInput(q, 'actualProspects', t.actualProspects)}</td>
      <td><button class="quarter-tab" style="background:var(--ink);color:white;border-color:var(--ink);" onclick="saveFunnelTarget('${q}')">Save</button></td>
    </tr>`;
  }).join('');
  return `<div class="table-wrap"><table>
    <thead><tr>
      <th>Quarter</th>
      <th>Target Sourced</th><th>Actual Sourced</th>
      <th>Target Qualified</th><th>Actual Qualified</th>
      <th>Target Prospects</th><th>Actual Prospects</th>
      <th></th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table></div>`;
}

async function saveFunnelTarget(quarterLabel) {
  if (API_URL.includes('PASTE_YOUR')) { showCeoToast('API_URL is not configured yet.', true); return; }
  const inputs = document.querySelectorAll(`.target-edit-input-funnel[data-q="${quarterLabel}"]`);
  const payload = { periodType: 'quarterly', periodLabel: quarterLabel };
  inputs.forEach(inp => payload[inp.dataset.field] = Number(inp.value) || 0);
  try {
    const url = `${API_URL}?action=setTarget&payload=${encodeURIComponent(JSON.stringify(payload))}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Network error: ' + res.status);
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || 'Unknown error');
    showCeoToast(`${quarterLabel} funnel targets saved.`);
    await loadData();
  } catch (err) {
    showCeoToast('Failed to save funnel targets: ' + err.message, true);
  }
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

function renderPipelineTable() {
  const sorted = [...STATE.deals].sort((a, b) => new Date(b.lastUpdated) - new Date(a.lastUpdated));
  if (sorted.length === 0) {
    return `<div class="empty-state"><div class="icon">📋</div>No parcels in pipeline yet.</div>`;
  }
  return `<div class="table-wrap"><table>
    <thead><tr><th>Parcel / Location</th><th>Area (acres)</th><th>Source</th><th>Stage</th><th>Expected GDV</th><th>Next Action</th><th>Next Action Date</th></tr></thead>
    <tbody>
      ${sorted.map(d => `
        <tr>
          <td><b>${escapeHTML(d.parcelName)}</b><br><span style="color:var(--ink-muted);font-size:12px;">${escapeHTML(d.location || '')}</span></td>
          <td>${d.areaAcres || '—'}</td>
          <td>${escapeHTML(d.source || '—')}</td>
          <td>${stageBadge(d.stage)}</td>
          <td>${d.expectedGDV ? '₹' + d.expectedGDV + ' Cr' : '—'}</td>
          <td>${escapeHTML(d.nextAction || '—')}</td>
          <td>${d.nextActionDate ? formatDateShort(d.nextActionDate) : '—'}</td>
        </tr>`).join('')}
    </tbody>
  </table></div>`;
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
