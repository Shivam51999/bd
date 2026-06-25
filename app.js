/* ============================================================
   MANGALAM LANDMARKS — BD TRACKER
   Frontend logic: API calls, rendering, dashboard calculations
   ============================================================ */

// ⚠️ REPLACE with your deployed Apps Script Web App URL after deployment
const API_URL = "https://script.google.com/macros/s/AKfycbwnusKhEVckQbtT4BR_Txm15UjH4w1oaUylIuY6uvJK9kYpU0RdHVm6aa7IhMyg0U0_/exec";

let STATE = { dailyLogs: [], deals: [], targets: [] };
let CURRENT_QUARTER = getCurrentQuarter();

/* ---------------- INIT ---------------- */

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('todayBadge').textContent = formatDateLong(new Date());
  document.getElementById('dl_date').value = toISODate(new Date());

  setupTabs();
  setupDailyLogForm();
  setupDealModal();
  loadAll();
});

function setupTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('view-' + btn.dataset.view).classList.add('active');
    });
  });
}

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

async function loadAll() {
  try {
    const res = await apiCall('getAll');
    STATE = res.data;
    renderDashboard();
    renderDailyLogTable();
    renderPipeline();
    renderTargets();
  } catch (err) {
    showToast('Failed to load data: ' + err.message, true);
    if (API_URL.includes('PASTE_YOUR')) {
      document.getElementById('dashboardContent').innerHTML = `
        <div class="empty-state">
          <div class="icon">🔌</div>
          <b>Not connected yet</b><br>
          Paste your Apps Script Web App URL into <code>API_URL</code> in app.js to connect this tracker to your Google Sheet.
        </div>`;
    }
  }
}

/* ---------------- DASHBOARD ---------------- */

function renderDashboard() {
  const today = toISODate(new Date());
  const last30 = STATE.dailyLogs.filter(d => isWithinDays(d.date, 30));
  const thisMonthLogs = STATE.dailyLogs.filter(d => isSameMonth(d.date, new Date()));

  const sums = (arr, key) => arr.reduce((s, d) => s + (Number(d[key]) || 0), 0);

  const mtd = {
    siteVisits: sums(thisMonthLogs, 'siteVisits'),
    brokerMeetings: sums(thisMonthLogs, 'brokerMeetings'),
    ownerMeetings: sums(thisMonthLogs, 'ownerMeetings'),
    newLeads: sums(thisMonthLogs, 'newLeads'),
    proposalsPresented: sums(thisMonthLogs, 'proposalsPresented'),
  };

  // Pipeline funnel counts
  const phaseOf = stage => {
    if (['Lead'].includes(stage)) return 'Sourcing';
    if (['Site Visit Done'].includes(stage)) return 'Site Visit';
    if (['Feasibility', 'Negotiation', 'Term Sheet', 'Due Diligence'].includes(stage)) return 'Negotiation';
    if (['Signed', 'Dropped'].includes(stage)) return 'Closed';
    return 'Sourcing';
  };
  const activeDeals = STATE.deals.filter(d => d.stage !== 'Dropped');
  const signedDeals = STATE.deals.filter(d => d.stage === 'Signed');
  const totalAcresSigned = sums(signedDeals, 'areaAcres');
  const totalAcresPipeline = sums(activeDeals, 'areaAcres');

  // Current quarter target
  const qTarget = STATE.targets.find(t => t.periodType === 'quarterly' && t.periodLabel === CURRENT_QUARTER) || {};
  const qProposalsActual = sumProposalsInQuarter(CURRENT_QUARTER);
  const qAcresActual = sumAcresSignedInQuarter(CURRENT_QUARTER);
  const qDealsSignedActual = countDealsSignedInQuarter(CURRENT_QUARTER);

  const html = `
    <div class="kpi-grid">
      <div class="kpi-card">
        <div class="kpi-label">Site Visits (MTD)</div>
        <div class="kpi-value">${mtd.siteVisits}</div>
        <div class="kpi-sub">This month so far</div>
      </div>
      <div class="kpi-card teal">
        <div class="kpi-label">Broker + Owner Meetings (MTD)</div>
        <div class="kpi-value">${mtd.brokerMeetings + mtd.ownerMeetings}</div>
        <div class="kpi-sub">${mtd.brokerMeetings} broker · ${mtd.ownerMeetings} owner</div>
      </div>
      <div class="kpi-card navy">
        <div class="kpi-label">New Leads Sourced (MTD)</div>
        <div class="kpi-value">${mtd.newLeads}</div>
        <div class="kpi-sub">${mtd.proposalsPresented} proposals presented to mgmt</div>
      </div>
      <div class="kpi-card" style="border-left-color:var(--teal)">
        <div class="kpi-label">Active Pipeline</div>
        <div class="kpi-value">${activeDeals.length}</div>
        <div class="kpi-sub">${totalAcresPipeline.toFixed(1)} acres under evaluation/negotiation</div>
      </div>
    </div>

    <div class="card">
      <div class="card-title">Deal Funnel — Live Snapshot</div>
      ${renderFunnelHTML()}
    </div>

    <div class="card">
      <div class="card-title">${CURRENT_QUARTER} — AOP Target Progress</div>
      ${progressRow('Proposals Presented', qProposalsActual, qTarget.targetProposals || 2)}
      ${progressRow('Acres Signed', qAcresActual, qTarget.targetAcres || 5, true)}
      ${progressRow('Deals Signed', qDealsSignedActual, qTarget.targetDealsSigned || 1)}
      <div class="stat-strip">
        <div class="stat">FY26-27 Acres Signed Total: <b>${totalAcresSigned.toFixed(1)} / 20</b></div>
        <div class="stat">FY26-27 Deals Signed: <b>${signedDeals.length}</b></div>
      </div>
    </div>

    <div class="card">
      <div class="card-title">Action Needed — Upcoming / Overdue</div>
      ${renderActionNeeded()}
    </div>
  `;
  document.getElementById('dashboardContent').innerHTML = html;
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

function renderActionNeeded() {
  const today = new Date();
  const upcoming = STATE.deals
    .filter(d => d.nextActionDate && !['Signed', 'Dropped'].includes(d.stage))
    .sort((a, b) => new Date(a.nextActionDate) - new Date(b.nextActionDate));

  if (upcoming.length === 0) {
    return `<div class="empty-state"><div class="icon">✅</div>No pending next actions logged on active deals.</div>`;
  }

  return `<div class="table-wrap"><table><thead><tr><th>Parcel</th><th>Next Action</th><th>Date</th><th>Status</th></tr></thead><tbody>
    ${upcoming.map(d => {
      const due = new Date(d.nextActionDate);
      const overdue = due < today;
      return `<tr>
        <td><b>${escapeHTML(d.parcelName)}</b><br><span style="color:var(--ink-muted);font-size:12px;">${escapeHTML(d.location || '')}</span></td>
        <td>${escapeHTML(d.nextAction || '—')}</td>
        <td>${formatDateShort(d.nextActionDate)}</td>
        <td><span class="badge ${overdue ? 'badge-closed-dropped' : 'badge-evaluation'}">${overdue ? 'Overdue' : 'Upcoming'}</span></td>
      </tr>`;
    }).join('')}
  </tbody></table></div>`;
}

/* ---------------- DAILY LOG ---------------- */

function setupDailyLogForm() {
  document.getElementById('dailyLogForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      date: document.getElementById('dl_date').value,
      siteVisits: Number(document.getElementById('dl_siteVisits').value) || 0,
      siteVisitLocations: document.getElementById('dl_siteVisitLocations').value,
      brokerMeetings: Number(document.getElementById('dl_brokerMeetings').value) || 0,
      brokerNames: document.getElementById('dl_brokerNames').value,
      ownerMeetings: Number(document.getElementById('dl_ownerMeetings').value) || 0,
      ownerNames: document.getElementById('dl_ownerNames').value,
      newLeads: Number(document.getElementById('dl_newLeads').value) || 0,
      leadSourceBreakup: document.getElementById('dl_leadSourceBreakup').value,
      callsFollowups: Number(document.getElementById('dl_callsFollowups').value) || 0,
      proposalsPresented: Number(document.getElementById('dl_proposalsPresented').value) || 0,
      notesBlockers: document.getElementById('dl_notesBlockers').value,
    };
    try {
      await apiCall('addDailyLog', payload);
      showToast('Daily entry saved.');
      document.getElementById('dailyLogForm').reset();
      document.getElementById('dl_date').value = toISODate(new Date());
      await loadAll();
    } catch (err) {
      showToast('Failed to save: ' + err.message, true);
    }
  });

  document.getElementById('resetDailyForm').addEventListener('click', () => {
    document.getElementById('dailyLogForm').reset();
    document.getElementById('dl_date').value = toISODate(new Date());
  });

  document.getElementById('exportDailyBtn').addEventListener('click', exportDailyLogCSV);
}

function renderDailyLogTable() {
  const body = document.getElementById('dailyLogTableBody');
  const sorted = [...STATE.dailyLogs].sort((a, b) => new Date(b.date) - new Date(a.date));
  if (sorted.length === 0) {
    body.innerHTML = `<tr><td colspan="9" style="text-align:center;color:var(--ink-muted);">No entries yet. Log your first day above.</td></tr>`;
    return;
  }
  body.innerHTML = sorted.slice(0, 60).map(d => `
    <tr>
      <td><b>${formatDateShort(d.date)}</b></td>
      <td>${d.siteVisits || 0}</td>
      <td>${d.brokerMeetings || 0}</td>
      <td>${d.ownerMeetings || 0}</td>
      <td>${d.newLeads || 0}</td>
      <td>${d.callsFollowups || 0}</td>
      <td>${d.proposalsPresented || 0}</td>
      <td style="max-width:220px;font-size:12px;color:var(--ink-muted);">${escapeHTML(truncate(d.notesBlockers, 60))}</td>
      <td><button class="btn btn-outline btn-sm" onclick="deleteDailyLog('${d.id}')">Delete</button></td>
    </tr>`).join('');
}

async function deleteDailyLog(id) {
  if (!confirm('Delete this daily log entry?')) return;
  try {
    const url = `${API_URL}?action=deleteDailyLog&id=${encodeURIComponent(id)}`;
    const res = await fetch(url);
    const json = await res.json();
    if (!json.ok) throw new Error(json.error);
    showToast('Entry deleted.');
    await loadAll();
  } catch (err) {
    showToast('Failed to delete: ' + err.message, true);
  }
}

function exportDailyLogCSV() {
  const headers = ['Date', 'Site Visits', 'Broker Meetings', 'Owner Meetings', 'New Leads', 'Calls/Followups', 'Proposals Presented', 'Notes'];
  const rows = STATE.dailyLogs.map(d => [d.date, d.siteVisits, d.brokerMeetings, d.ownerMeetings, d.newLeads, d.callsFollowups, d.proposalsPresented, (d.notesBlockers || '').replace(/,/g, ';')]);
  downloadCSV([headers, ...rows], 'BD_Daily_Log.csv');
}

/* ---------------- PIPELINE ---------------- */

function setupDealModal() {
  document.getElementById('addDealBtn').addEventListener('click', () => openDealModal());
  document.getElementById('dealModalClose').addEventListener('click', closeDealModal);
  document.getElementById('dealModal').addEventListener('click', (e) => {
    if (e.target.id === 'dealModal') closeDealModal();
  });

  document.getElementById('dealForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('deal_id').value;
    const stage = document.getElementById('deal_stage').value;
    const phase = stage === 'Lead' ? 'Sourcing'
      : stage === 'Site Visit Done' ? 'Site Visit'
      : ['Signed', 'Dropped'].includes(stage) ? 'Closed'
      : 'Negotiation';

    const payload = {
      parcelName: document.getElementById('deal_parcelName').value,
      location: document.getElementById('deal_location').value,
      areaAcres: Number(document.getElementById('deal_areaAcres').value) || 0,
      source: document.getElementById('deal_source').value,
      sourceDetail: document.getElementById('deal_sourceDetail').value,
      stage, phase,
      expectedGDV: document.getElementById('deal_expectedGDV').value,
      landownerAsk: document.getElementById('deal_landownerAsk').value,
      currentOffer: document.getElementById('deal_currentOffer').value,
      nextAction: document.getElementById('deal_nextAction').value,
      nextActionDate: document.getElementById('deal_nextActionDate').value,
      remarks: document.getElementById('deal_remarks').value,
    };

    try {
      if (id) {
        payload.id = id;
        await apiCall('updateDeal', payload);
        showToast('Deal updated.');
      } else {
        await apiCall('addDeal', payload);
        showToast('New parcel added to pipeline.');
      }
      closeDealModal();
      await loadAll();
    } catch (err) {
      showToast('Failed to save deal: ' + err.message, true);
    }
  });

  document.getElementById('deleteDealBtn').addEventListener('click', async () => {
    const id = document.getElementById('deal_id').value;
    if (!id || !confirm('Delete this deal from the pipeline?')) return;
    try {
      const url = `${API_URL}?action=deleteDeal&id=${encodeURIComponent(id)}`;
      const res = await fetch(url);
      const json = await res.json();
      if (!json.ok) throw new Error(json.error);
      showToast('Deal deleted.');
      closeDealModal();
      await loadAll();
    } catch (err) {
      showToast('Failed to delete: ' + err.message, true);
    }
  });
}

function openDealModal(deal) {
  document.getElementById('dealForm').reset();
  document.getElementById('dealModalTitle').textContent = deal ? 'Edit Parcel' : 'Add New Parcel';
  document.getElementById('deleteDealBtn').style.display = deal ? 'inline-block' : 'none';
  document.getElementById('deal_id').value = deal ? deal.id : '';
  if (deal) {
    document.getElementById('deal_parcelName').value = deal.parcelName || '';
    document.getElementById('deal_location').value = deal.location || '';
    document.getElementById('deal_areaAcres').value = deal.areaAcres || '';
    document.getElementById('deal_source').value = deal.source || 'Broker';
    document.getElementById('deal_sourceDetail').value = deal.sourceDetail || '';
    document.getElementById('deal_stage').value = deal.stage || 'Lead';
    document.getElementById('deal_expectedGDV').value = deal.expectedGDV || '';
    document.getElementById('deal_landownerAsk').value = deal.landownerAsk || '';
    document.getElementById('deal_currentOffer').value = deal.currentOffer || '';
    document.getElementById('deal_nextAction').value = deal.nextAction || '';
    document.getElementById('deal_nextActionDate').value = deal.nextActionDate ? toISODate(new Date(deal.nextActionDate)) : '';
    document.getElementById('deal_remarks').value = deal.remarks || '';
  }
  document.getElementById('dealModal').classList.add('active');
}

function closeDealModal() {
  document.getElementById('dealModal').classList.remove('active');
}

function renderPipeline() {
  document.getElementById('pipelineFunnel').innerHTML = renderFunnelHTML();

  const body = document.getElementById('pipelineTableBody');
  const sorted = [...STATE.deals].sort((a, b) => new Date(b.lastUpdated) - new Date(a.lastUpdated));
  if (sorted.length === 0) {
    body.innerHTML = `<tr><td colspan="8" style="text-align:center;color:var(--ink-muted);">No parcels in pipeline yet. Click "+ Add New Parcel" to start.</td></tr>`;
    return;
  }
  body.innerHTML = sorted.map(d => `
    <tr style="cursor:pointer;" onclick='openDealModal(${JSON.stringify(d).replace(/'/g, "&#39;")})'>
      <td><b>${escapeHTML(d.parcelName)}</b><br><span style="color:var(--ink-muted);font-size:12px;">${escapeHTML(d.location || '')}</span></td>
      <td>${d.areaAcres || '—'}</td>
      <td>${escapeHTML(d.source || '—')}</td>
      <td>${stageBadge(d.stage)}</td>
      <td>${d.expectedGDV ? '₹' + d.expectedGDV + ' Cr' : '—'}</td>
      <td>${escapeHTML(d.nextAction || '—')}</td>
      <td>${d.nextActionDate ? formatDateShort(d.nextActionDate) : '—'}</td>
      <td><button class="btn btn-outline btn-sm" onclick='event.stopPropagation(); openDealModal(${JSON.stringify(d).replace(/'/g, "&#39;")})'>Edit</button></td>
    </tr>`).join('');
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

/* ---------------- TARGETS ---------------- */

function renderTargets() {
  const quarters = ['Q1 FY26-27', 'Q2 FY26-27', 'Q3 FY26-27', 'Q4 FY26-27'];
  const body = document.getElementById('targetsTableBody');
  body.innerHTML = quarters.map(q => {
    const t = STATE.targets.find(x => x.periodType === 'quarterly' && x.periodLabel === q) || {};
    const actualProposals = sumProposalsInQuarter(q);
    const actualAcres = sumAcresSignedInQuarter(q);
    const actualDeals = countDealsSignedInQuarter(q);
    return `<tr>
      <td><b>${q}</b></td>
      <td><input type="number" value="${t.targetProposals || 0}" data-q="${q}" data-field="targetProposals" class="target-input" style="width:70px;padding:5px;border:1px solid var(--border);border-radius:5px;"></td>
      <td>${actualProposals}</td>
      <td><input type="number" value="${t.targetAcres || 0}" data-q="${q}" data-field="targetAcres" class="target-input" style="width:70px;padding:5px;border:1px solid var(--border);border-radius:5px;"></td>
      <td>${actualAcres.toFixed(1)}</td>
      <td><input type="number" value="${t.targetDealsSigned || 0}" data-q="${q}" data-field="targetDealsSigned" class="target-input" style="width:70px;padding:5px;border:1px solid var(--border);border-radius:5px;"></td>
      <td>${actualDeals}</td>
      <td><button class="btn btn-gold btn-sm" onclick="saveTargetRow('${q}')">Save</button></td>
    </tr>`;
  }).join('');
}

async function saveTargetRow(q) {
  const inputs = document.querySelectorAll(`.target-input[data-q="${q}"]`);
  const payload = { periodType: 'quarterly', periodLabel: q };
  inputs.forEach(inp => payload[inp.dataset.field] = Number(inp.value) || 0);
  try {
    await apiCall('setTarget', payload);
    showToast(`${q} targets saved.`);
    await loadAll();
  } catch (err) {
    showToast('Failed to save target: ' + err.message, true);
  }
}

/* ---------------- QUARTER / DATE HELPERS ---------------- */

function getCurrentQuarter() {
  const d = new Date();
  const m = d.getMonth(); // 0=Jan
  const y = d.getFullYear();
  // Indian FY: Apr-Jun=Q1, Jul-Sep=Q2, Oct-Dec=Q3, Jan-Mar=Q4
  let fyStartYear, q;
  if (m >= 3 && m <= 5) { q = 1; fyStartYear = y; }
  else if (m >= 6 && m <= 8) { q = 2; fyStartYear = y; }
  else if (m >= 9 && m <= 11) { q = 3; fyStartYear = y; }
  else { q = 4; fyStartYear = y - 1; }
  const fyLabel = `FY${String(fyStartYear).slice(2)}-${String(fyStartYear + 1).slice(2)}`;
  return `Q${q} ${fyLabel}`;
}

function quarterBounds(qLabel) {
  // qLabel like "Q1 FY26-27" -> returns [startDate, endDate]
  const m = qLabel.match(/Q(\d) FY(\d\d)-(\d\d)/);
  if (!m) return [new Date(0), new Date()];
  const qNum = Number(m[1]);
  const fyStartYear = 2000 + Number(m[2]);
  const starts = { 1: [2, 1], 2: [5, 1], 3: [8, 1], 4: [0, 1] }; // [monthIndex, day], month is 0-based; Q4 is Jan-Mar of fyStartYear+1
  let year = fyStartYear;
  let startMonth;
  if (qNum === 1) startMonth = 3; // Apr
  else if (qNum === 2) startMonth = 6; // Jul
  else if (qNum === 3) startMonth = 9; // Oct
  else { startMonth = 0; year = fyStartYear + 1; } // Jan of next cal year
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

function isWithinDays(dateStr, days) {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  const diff = (new Date() - d) / (1000 * 60 * 60 * 24);
  return diff >= 0 && diff <= days;
}

function isSameMonth(dateStr, ref) {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  return d.getMonth() === ref.getMonth() && d.getFullYear() === ref.getFullYear();
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

function truncate(str, len) {
  if (!str) return '';
  return str.length > len ? str.slice(0, len) + '…' : str;
}

function showToast(msg, isError) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show' + (isError ? ' error' : '');
  setTimeout(() => t.classList.remove('show'), 3200);
}

function downloadCSV(rows, filename) {
  const csv = rows.map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
