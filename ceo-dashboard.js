/* ============================================================
   MANGALAM LANDMARKS — BD CEO DASHBOARD (READ-ONLY)
   Pulls sanitized summary data only via the `getCeoSummary` action.
   No forms, no edit/delete — this file intentionally contains
   no write calls to the API.
   ============================================================ */

// ⚠️ Use the SAME Apps Script Web App URL as the BD entry tool.
const API_URL = "PASTE_YOUR_APPS_SCRIPT_WEB_APP_URL_HERE";

const AUTO_REFRESH_MINUTES = 10;

let STATE = { dailyLogs: [], deals: [], targets: [] };
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
      <div class="kpi-card teal">
        <div class="kpi-label">Broker + Landowner Meetings</div>
        <div class="kpi-value">${mtd.brokerMeetings + mtd.ownerMeetings}</div>
        <div class="kpi-sub">${mtd.brokerMeetings} broker · ${mtd.ownerMeetings} landowner</div>
      </div>
      <div class="kpi-card navy">
        <div class="kpi-label">New Leads Sourced</div>
        <div class="kpi-value">${mtd.newLeads}</div>
        <div class="kpi-sub">${mtd.proposalsPresented} proposals presented to management</div>
      </div>
      <div class="kpi-card" style="border-left-color:var(--teal)">
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

    <div class="section-label"><span>AOP Target Progress</span><div class="line"></div></div>
    <div class="card">
      <div class="quarter-tabs" id="quarterTabs"></div>
      ${progressRow('Proposals Presented', qProposalsActual, qTarget.targetProposals || 2)}
      ${progressRow('Acres Signed', qAcresActual, qTarget.targetAcres || 5, true)}
      ${progressRow('Deals Signed', qDealsSignedActual, qTarget.targetDealsSigned || 1)}
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

function quarterBounds(qLabel) {
  const m = qLabel.match(/Q(\d) FY(\d\d)-(\d\d)/);
  if (!m) return [new Date(0), new Date()];
  const qNum = Number(m[1]);
  const fyStartYear = 2000 + Number(m[2]);
  let year = fyStartYear;
  let startMonth;
  if (qNum === 1) startMonth = 3;
  else if (qNum === 2) startMonth = 6;
  else if (qNum === 3) startMonth = 9;
  else { startMonth = 0; year = fyStartYear + 1; }
  const start = new Date(year, startMonth, 1);
  const end = new Date(year, startMonth + 3, 0, 23, 59, 59);
  return [start, end];
}

function sumProposalsInQuarter(qLabel) {
  const [start, end] = quarterBounds(qLabel);
  return STATE.dailyLogs
    .filter(d => d.date && new Date(d.date) >= start && new Date(d.date) <= end)
    .reduce((s, d) => s + (Number(d.proposalsPresented) || 0), 0);
}

function sumAcresSignedInQuarter(qLabel) {
  const [start, end] = quarterBounds(qLabel);
  return STATE.deals
    .filter(d => d.stage === 'Signed' && d.lastUpdated && new Date(d.lastUpdated) >= start && new Date(d.lastUpdated) <= end)
    .reduce((s, d) => s + (Number(d.areaAcres) || 0), 0);
}

function countDealsSignedInQuarter(qLabel) {
  const [start, end] = quarterBounds(qLabel);
  return STATE.deals
    .filter(d => d.stage === 'Signed' && d.lastUpdated && new Date(d.lastUpdated) >= start && new Date(d.lastUpdated) <= end)
    .length;
}

function isSameMonth(dateStr, ref) {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  return d.getMonth() === ref.getMonth() && d.getFullYear() === ref.getFullYear();
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
