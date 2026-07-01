/* ============================================================
   MANGALAM LANDMARKS — BD TRACKER
   Frontend logic: API calls, rendering, dashboard calculations
   ============================================================ */

// ⚠️ REPLACE with your deployed Apps Script Web App URL after deployment
const API_URL = "https://script.google.com/macros/s/AKfycbwnusKhEVckQbtT4BR_Txm15UjH4w1oaUylIuY6uvJK9kYpU0RdHVm6aa7IhMyg0U0_/exec";

// Mirrors DOCUMENT_CHECKLIST in Code.gs — keep both in sync if this changes.
const DOCUMENT_CHECKLIST = {
  'A': { label: 'Property Documents', docs: ['7/12 of Land', 'MOU', 'PA/DA', 'Property Card', 'Ferfar'] },
  'B': { label: 'Technical & Planning Documents', docs: ['Demarcation', 'Plan', 'FSI Statement'] },
  'C': { label: 'Feasibility', docs: ['Feasibility Report'] },
  'D': { label: 'Redevelopment', docs: ['Conveyance Deed', 'Carpet Area', 'Sanction Plan', 'Completion Plan'] }
};
const MAX_UPLOAD_MB = 10; // client-side cap — base64 inflates size ~33%, keep requests reasonable for Apps Script

let STATE = { dailyLogs: [], deals: [], targets: [], directory: [], dealActivity: [], documents: [] };
let CURRENT_QUARTER = getCurrentQuarter();

/* ---------------- INIT ---------------- */

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('todayBadge').textContent = formatDateLong(new Date());
  document.getElementById('dl_date').value = toISODate(new Date());

  setupTabs();
  setupDailyLogForm();
  setupDealModal();
  setupDirectoryForm();
  setupDirectoryModal();
  setupDealActivityModal();
  setupDocumentModal();
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

// POST variant — used ONLY for document upload, since base64 file data can
// exceed a safe URL length. Content-Type text/plain keeps this a CORS
// "simple request" (no preflight OPTIONS call), same reasoning as the
// GET-only pattern used everywhere else in this file.
async function apiPost(action, payload) {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action, payload })
  });
  if (!res.ok) throw new Error('Network error: ' + res.status);
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || 'Unknown API error');
  return json;
}

async function loadAll() {
  try {
    const res = await apiCall('getAll');
    STATE = res.data;
    if (!STATE.dealActivity) STATE.dealActivity = [];
    if (!STATE.documents) STATE.documents = [];
    renderDashboard();
    renderDailyLogTable();
    renderPipeline();
    renderTargets();
    renderFunnelTargets();
    renderDirectory();
    populateAutocompleteSuggestions();
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
  const thisMonthLogs = STATE.dailyLogs.filter(d => isSameMonth(d.date, new Date()));

  const sums = (arr, key) => arr.reduce((s, d) => s + (Number(d[key]) || 0), 0);

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
      <div class="kpi-card alt">
        <div class="kpi-label">Broker + Owner Meetings (MTD)</div>
        <div class="kpi-value">${mtd.brokerMeetings + mtd.ownerMeetings}</div>
        <div class="kpi-sub">${mtd.brokerMeetings} broker · ${mtd.ownerMeetings} owner</div>
      </div>
      <div class="kpi-card alt2">
        <div class="kpi-label">New Leads Sourced (MTD)</div>
        <div class="kpi-value">${mtd.newLeads}</div>
        <div class="kpi-sub">${mtd.proposalsPresented} proposals presented to mgmt</div>
      </div>
      <div class="kpi-card" style="border-left-color:var(--grey)">
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
    body.innerHTML = `<tr><td colspan="10" style="text-align:center;color:var(--ink-muted);">No entries yet. Log your first day above.</td></tr>`;
    return;
  }
  body.innerHTML = sorted.slice(0, 60).map(d => `
    <tr>
      <td><b>${formatDateShort(d.date)}</b></td>
      <td>${d.siteVisits || 0}</td>
      <td>${d.brokerMeetings || 0}</td>
      <td>${d.ownerMeetings || 0}</td>
      <td>${d.newLeads || 0}</td>
      <td style="max-width:160px;font-size:12px;color:var(--ink-muted);">${escapeHTML(truncate(d.leadSourceBreakup, 50)) || '—'}</td>
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
  const headers = ['Date', 'Site Visits', 'Broker Meetings', 'Owner Meetings', 'New Leads', 'Lead Source Breakup', 'Calls/Followups', 'Proposals Presented', 'Notes'];
  const rows = STATE.dailyLogs.map(d => [d.date, d.siteVisits, d.brokerMeetings, d.ownerMeetings, d.newLeads, (d.leadSourceBreakup || '').replace(/,/g, ';'), d.callsFollowups, d.proposalsPresented, (d.notesBlockers || '').replace(/,/g, ';')]);
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
      surveyNumber: document.getElementById('deal_surveyNumber').value,
      areaAcres: Number(document.getElementById('deal_areaAcres').value) || 0,
      source: document.getElementById('deal_source').value,
      sourceDetail: document.getElementById('deal_sourceDetail').value,
      sourcePhone: document.getElementById('deal_sourcePhone').value,
      stage, phase,
      leadCategory: document.getElementById('deal_leadCategory').value,
      dealStructure: document.getElementById('deal_dealStructure').value,
      expectedGDV: document.getElementById('deal_expectedGDV').value,
      irrPct: document.getElementById('deal_irrPct').value,
      patPct: document.getElementById('deal_patPct').value,
      profitPerSft: document.getElementById('deal_profitPerSft').value,
      completionYears: document.getElementById('deal_completionYears').value,
      legalGateStatus: document.getElementById('deal_legalGateStatus').value,
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
    document.getElementById('deal_surveyNumber').value = deal.surveyNumber || '';
    document.getElementById('deal_areaAcres').value = deal.areaAcres || '';
    document.getElementById('deal_source').value = deal.source || 'Broker';
    document.getElementById('deal_sourceDetail').value = deal.sourceDetail || '';
    document.getElementById('deal_sourcePhone').value = deal.sourcePhone || '';
    document.getElementById('deal_stage').value = deal.stage || 'Lead';
    document.getElementById('deal_leadCategory').value = deal.leadCategory || 'Warm';
    document.getElementById('deal_dealStructure').value = deal.dealStructure || 'Outright Purchase';
    document.getElementById('deal_expectedGDV').value = deal.expectedGDV || '';
    document.getElementById('deal_irrPct').value = deal.irrPct || '';
    document.getElementById('deal_patPct').value = deal.patPct || '';
    document.getElementById('deal_profitPerSft').value = deal.profitPerSft || '';
    document.getElementById('deal_completionYears').value = deal.completionYears || '';
    document.getElementById('deal_legalGateStatus').value = deal.legalGateStatus || 'Not Started';
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
    body.innerHTML = `<tr><td colspan="10" style="text-align:center;color:var(--ink-muted);">No parcels in pipeline yet. Click "+ Add New Parcel" to start.</td></tr>`;
    return;
  }
  body.innerHTML = sorted.map(d => `
    <tr>
      <td style="cursor:pointer;" onclick='openDealModal(${JSON.stringify(d).replace(/'/g, "&#39;")})'>
        <b>${escapeHTML(d.parcelName)}</b><br><span style="color:var(--ink-muted);font-size:12px;">${escapeHTML(d.location || '')}</span>
      </td>
      <td>${d.areaAcres || '—'}</td>
      <td>${escapeHTML(d.source || '—')}</td>
      <td>${stageBadge(d.stage)}</td>
      <td>${categoryBadge(d.leadCategory)}</td>
      <td>${legalGateBadge(d.legalGateStatus)}</td>
      <td>${d.expectedGDV ? '₹' + d.expectedGDV + ' Cr' : '—'}</td>
      <td>${escapeHTML(d.nextAction || '—')}</td>
      <td>${d.nextActionDate ? formatDateShort(d.nextActionDate) : '—'}</td>
      <td style="white-space:nowrap;">
        <button class="btn btn-outline btn-sm" onclick='openDealModal(${JSON.stringify(d).replace(/'/g, "&#39;")})'>Edit</button>
        <button class="btn btn-outline btn-sm" onclick="openDealActivityModal('${d.id}', ${JSON.stringify(d.parcelName)})">+ Activity</button>
        <button class="btn btn-outline btn-sm" onclick="openDocumentModal('${d.id}', ${JSON.stringify(d.parcelName)})">Docs${documentBadgeCount(d.id)}</button>
      </td>
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

// Hot/Warm/Cold lead category — set manually by the BD Head per deal.
// Colors per instruction: Hot=green, Warm=yellow/amber, Cold=red.
function categoryBadge(category) {
  const map = {
    'Hot': { cls: 'badge-closed-signed', dot: '🟢' },   // green
    'Warm': { cls: 'badge-evaluation', dot: '🟡' },     // amber/yellow
    'Cold': { cls: 'badge-closed-dropped', dot: '🔴' },  // red
  };
  const c = map[category] || map['Warm'];
  return `<span class="badge ${c.cls}">${c.dot} ${escapeHTML(category || 'Warm')}</span>`;
}

// Legal/title gate status badge — AOP: "Zero title risk - Atul (Legal)
// clears every deal before MOU." Matches ceo-dashboard.js's version.
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

/* ---------------- DEAL ACTIVITY (follow-up / work-done log) ----------------
   Add-only, per deal. No delete function exists here or on the backend —
   this is a permanent work-done record, same philosophy as StageHistory
   and Directory. Feeds the CEO Dashboard's per-deal activity timeline. */

let ACTIVITY_DEAL_ID = null;
let ACTIVITY_PARCEL_NAME = '';

function setupDealActivityModal() {
  document.getElementById('dealActivityModalClose').addEventListener('click', closeDealActivityModal);
  document.getElementById('dealActivityModal').addEventListener('click', (e) => {
    if (e.target.id === 'dealActivityModal') closeDealActivityModal();
  });
  document.getElementById('act_date').value = toISODate(new Date());

  document.getElementById('dealActivityForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      dealId: ACTIVITY_DEAL_ID,
      parcelName: ACTIVITY_PARCEL_NAME,
      date: document.getElementById('act_date').value,
      activityType: document.getElementById('act_type').value,
      summary: document.getElementById('act_summary').value.trim(),
      nextFollowupDate: document.getElementById('act_nextFollowup').value,
    };
    if (!payload.summary) { showToast('Please describe what was done.', true); return; }
    try {
      await apiCall('addDealActivity', payload);
      showToast('Activity logged.');
      closeDealActivityModal();
      await loadAll();
    } catch (err) {
      showToast('Failed to log activity: ' + err.message, true);
    }
  });
}

function openDealActivityModal(dealId, parcelName) {
  ACTIVITY_DEAL_ID = dealId;
  ACTIVITY_PARCEL_NAME = parcelName;
  document.getElementById('dealActivityForm').reset();
  document.getElementById('act_date').value = toISODate(new Date());
  document.getElementById('dealActivityModalTitle').textContent = 'Log Activity — ' + parcelName;
  renderActivityHistoryForDeal(dealId);
  document.getElementById('dealActivityModal').classList.add('active');
}

function closeDealActivityModal() {
  document.getElementById('dealActivityModal').classList.remove('active');
}

function renderActivityHistoryForDeal(dealId) {
  const list = STATE.dealActivity
    .filter(a => a.dealId === dealId)
    .sort((a, b) => new Date(b.date || b.createdAt) - new Date(a.date || a.createdAt));
  const container = document.getElementById('activityHistoryList');
  if (!container) return;
  if (list.length === 0) {
    container.innerHTML = `<div class="empty-state" style="padding:16px;"><div class="icon">📝</div>No activity logged yet for this parcel.</div>`;
    return;
  }
  container.innerHTML = list.map(a => `
    <div style="padding:10px 0;border-bottom:1px solid var(--border-soft);">
      <div style="font-size:11.5px;color:var(--grey);text-transform:uppercase;letter-spacing:0.4px;">
        ${formatDateShort(a.date)} &middot; ${escapeHTML(a.activityType || 'Other')}
      </div>
      <div style="font-size:13px;color:var(--ink);margin-top:3px;">${escapeHTML(a.summary || '')}</div>
      ${a.nextFollowupDate ? `<div style="font-size:11.5px;color:var(--red);margin-top:3px;">Next follow-up: ${formatDateShort(a.nextFollowupDate)}</div>` : ''}
    </div>`).join('');
}

/* ---------------- DOCUMENTS (file upload per deal) ----------------
   Uploads go via apiPost (POST, base64) since file data can be too large
   for a URL query string. Backend stores in Google Drive and logs a row
   in the Documents sheet per upload — append-only; the checklist UI shows
   only the MOST RECENT upload per (dealId, docType) as "current". */

let DOC_DEAL_ID = null;
let DOC_PARCEL_NAME = '';

function setupDocumentModal() {
  document.getElementById('documentModalClose').addEventListener('click', closeDocumentModal);
  document.getElementById('documentModal').addEventListener('click', (e) => {
    if (e.target.id === 'documentModal') closeDocumentModal();
  });
}

function openDocumentModal(dealId, parcelName) {
  DOC_DEAL_ID = dealId;
  DOC_PARCEL_NAME = parcelName;
  document.getElementById('documentModalTitle').textContent = 'Documents — ' + parcelName;
  renderDocumentChecklist(dealId);
  document.getElementById('documentModal').classList.add('active');
}

function closeDocumentModal() {
  document.getElementById('documentModal').classList.remove('active');
}

// Returns the most recent Documents row for a given deal+docType, or null.
function getLatestDocument(dealId, docType) {
  const matches = STATE.documents.filter(d => d.dealId === dealId && d.docType === docType);
  if (matches.length === 0) return null;
  return matches.reduce((latest, d) => new Date(d.uploadedAt) > new Date(latest.uploadedAt) ? d : latest, matches[0]);
}

// Small "3/5" style count shown next to the "Docs" button in the pipeline
// table, so the BD Manager can see completeness at a glance without opening
// the modal. Counts unique docTypes with at least one upload, across ALL
// categories, out of the total number of defined slots.
function documentBadgeCount(dealId) {
  let total = 0, uploaded = 0;
  Object.values(DOCUMENT_CHECKLIST).forEach(cat => {
    cat.docs.forEach(docType => {
      total++;
      if (getLatestDocument(dealId, docType)) uploaded++;
    });
  });
  return ` <span style="font-size:10.5px;color:var(--grey);">(${uploaded}/${total})</span>`;
}

function renderDocumentChecklist(dealId) {
  const container = document.getElementById('documentChecklistBody');
  if (!container) return;
  const sections = Object.entries(DOCUMENT_CHECKLIST).map(([catKey, cat]) => {
    const rows = cat.docs.map(docType => {
      const existing = getLatestDocument(dealId, docType);
      const safeDocType = docType.replace(/'/g, "\\'");
      return `
      <div class="doc-row">
        <div class="doc-row-name">${escapeHTML(docType)}</div>
        <div class="doc-row-status">
          ${existing
            ? `<a href="${existing.driveUrl}" target="_blank" rel="noopener" class="badge badge-closed-signed">✓ ${escapeHTML(truncate(existing.fileName, 22))}</a>`
            : `<span class="badge badge-sourcing">Not uploaded</span>`}
        </div>
        <div class="doc-row-action">
          <input type="file" id="docfile_${catKey}_${cat.docs.indexOf(docType)}" style="display:none;"
            onchange="handleDocumentFileSelect(this, '${catKey}', '${safeDocType}')">
          <button type="button" class="btn btn-outline btn-sm" onclick="document.getElementById('docfile_${catKey}_${cat.docs.indexOf(docType)}').click()">
            ${existing ? 'Replace' : 'Upload'}
          </button>
        </div>
      </div>`;
    }).join('');
    return `
      <div class="doc-category">
        <div class="doc-category-title">${escapeHTML(cat.label)}</div>
        ${rows}
      </div>`;
  }).join('');
  container.innerHTML = sections;
}

function handleDocumentFileSelect(inputEl, category, docType) {
  const file = inputEl.files && inputEl.files[0];
  if (!file) return;
  if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
    showToast(`File too large — max ${MAX_UPLOAD_MB}MB.`, true);
    inputEl.value = '';
    return;
  }
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      // reader.result looks like "data:<mime>;base64,<data>" — strip the prefix
      const base64Data = reader.result.split(',')[1];
      showToast('Uploading ' + file.name + '…');
      await apiPost('uploadDocument', {
        dealId: DOC_DEAL_ID,
        parcelName: DOC_PARCEL_NAME,
        category, docType,
        fileName: file.name,
        mimeType: file.type || 'application/octet-stream',
        base64Data
      });
      showToast('Document uploaded.');
      await loadAll();
      renderDocumentChecklist(DOC_DEAL_ID);
    } catch (err) {
      showToast('Upload failed: ' + err.message, true);
    }
  };
  reader.onerror = () => showToast('Could not read file.', true);
  reader.readAsDataURL(file);
}

/* ---------------- TARGETS ---------------- */

// READ-ONLY in this tool. Setting/editing AOP targets is a CEO Dashboard
// privilege only — do not reintroduce input fields or a save action here
// without an explicit instruction to do so.
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
      <td>${t.targetProposals || 0}</td>
      <td>${actualProposals}</td>
      <td>${t.targetAcres || 0}</td>
      <td>${actualAcres.toFixed(1)}</td>
      <td>${t.targetDealsSigned || 0}</td>
      <td>${actualDeals}</td>
    </tr>`;
  }).join('');
}

// READ-ONLY. AOP Lead Conversion Funnel actuals (Sourcing/BD Head
// Filter/BD Head Refinement) are entered directly in the Google Sheet's
// Targets tab, by design — see README.
function renderFunnelTargets() {
  const quarters = ['Q1 FY26-27', 'Q2 FY26-27', 'Q3 FY26-27', 'Q4 FY26-27'];
  const body = document.getElementById('funnelTargetsTableBody');
  if (!body) return;
  body.innerHTML = quarters.map(q => {
    const t = STATE.targets.find(x => x.periodType === 'quarterly' && x.periodLabel === q) || {};
    return `<tr>
      <td><b>${q}</b></td>
      <td>${t.targetLeadsSourced || 0}</td>
      <td>${t.actualLeadsSourced || 0}</td>
      <td>${t.targetLeadsQualified || 0}</td>
      <td>${t.actualLeadsQualified || 0}</td>
      <td>${t.targetProspects || 0}</td>
      <td>${t.actualProspects || 0}</td>
    </tr>`;
  }).join('');
}

/* ---------------- DIRECTORY ----------------
   Add and Edit only. There is deliberately NO delete function in this file
   and NO delete action on the backend for Directory entries. */

let DIR_SEARCH_TERM = '';

function setupDirectoryForm() {
  document.getElementById('directoryForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      name: document.getElementById('dir_name').value.trim(),
      phone: document.getElementById('dir_phone').value.trim(),
      type: document.getElementById('dir_type').value,
      notes: document.getElementById('dir_notes').value.trim(),
    };
    if (!payload.name) { showToast('Name is required.', true); return; }
    try {
      await apiCall('addDirectoryEntry', payload);
      showToast('Contact saved to Directory.');
      document.getElementById('directoryForm').reset();
      await loadAll();
    } catch (err) {
      showToast('Failed to save contact: ' + err.message, true);
    }
  });

  document.getElementById('resetDirectoryForm').addEventListener('click', () => {
    document.getElementById('directoryForm').reset();
  });

  const searchInput = document.getElementById('dirSearchInput');
  searchInput.addEventListener('input', () => {
    DIR_SEARCH_TERM = searchInput.value.trim().toLowerCase();
    document.getElementById('dirSearchClear').style.display = DIR_SEARCH_TERM ? 'inline' : 'none';
    renderDirectory();
  });
  document.getElementById('dirSearchClear').addEventListener('click', () => {
    DIR_SEARCH_TERM = '';
    searchInput.value = '';
    document.getElementById('dirSearchClear').style.display = 'none';
    renderDirectory();
  });
}

function renderDirectory() {
  const body = document.getElementById('directoryTableBody');
  if (!body) return;
  let rows = [...STATE.directory];
  if (DIR_SEARCH_TERM) {
    rows = rows.filter(d =>
      (d.name || '').toLowerCase().includes(DIR_SEARCH_TERM) ||
      (d.type || '').toLowerCase().includes(DIR_SEARCH_TERM)
    );
  }
  rows.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  if (rows.length === 0) {
    body.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--grey);">${STATE.directory.length === 0 ? 'No contacts saved yet. Add one above.' : 'No contacts match your search.'}</td></tr>`;
    return;
  }
  body.innerHTML = rows.map(d => `
    <tr style="cursor:pointer;" onclick='openDirectoryModal(${JSON.stringify(d).replace(/'/g, "&#39;")})'>
      <td><b>${escapeHTML(d.name)}</b></td>
      <td>${escapeHTML(d.phone || '—')}</td>
      <td><span class="badge badge-sourcing">${escapeHTML(d.type || '—')}</span></td>
      <td style="color:var(--grey);font-size:12px;">${escapeHTML(d.notes || '—')}</td>
      <td style="color:var(--grey);font-size:12px;">${d.dateAdded ? formatDateShort(d.dateAdded) : '—'}</td>
      <td><button class="btn btn-outline btn-sm" onclick='event.stopPropagation(); openDirectoryModal(${JSON.stringify(d).replace(/'/g, "&#39;")})'>Edit</button></td>
    </tr>`).join('');
}

function setupDirectoryModal() {
  document.getElementById('directoryModalClose').addEventListener('click', closeDirectoryModal);
  document.getElementById('directoryModal').addEventListener('click', (e) => {
    if (e.target.id === 'directoryModal') closeDirectoryModal();
  });
  document.getElementById('directoryEditForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      id: document.getElementById('diredit_id').value,
      name: document.getElementById('diredit_name').value.trim(),
      phone: document.getElementById('diredit_phone').value.trim(),
      type: document.getElementById('diredit_type').value,
      notes: document.getElementById('diredit_notes').value.trim(),
    };
    try {
      await apiCall('updateDirectoryEntry', payload);
      showToast('Contact updated.');
      closeDirectoryModal();
      await loadAll();
    } catch (err) {
      showToast('Failed to update contact: ' + err.message, true);
    }
  });
}

function openDirectoryModal(entry) {
  document.getElementById('diredit_id').value = entry.id;
  document.getElementById('diredit_name').value = entry.name || '';
  document.getElementById('diredit_phone').value = entry.phone || '';
  document.getElementById('diredit_type').value = entry.type || 'Broker';
  document.getElementById('diredit_notes').value = entry.notes || '';
  document.getElementById('directoryModal').classList.add('active');
}

function closeDirectoryModal() {
  document.getElementById('directoryModal').classList.remove('active');
}

function populateAutocompleteSuggestions() {
  const brokers = STATE.directory.filter(d => d.type === 'Broker');
  const owners = STATE.directory.filter(d => d.type === 'Landowner');
  const all = STATE.directory;

  const fill = (listId, entries) => {
    const list = document.getElementById(listId);
    if (!list) return;
    list.innerHTML = entries.map(d => `<option value="${escapeHTML(d.name)}">`).join('');
  };
  fill('brokerSuggestions', brokers);
  fill('ownerSuggestions', owners);
  fill('dealSourceSuggestions', all);
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

function isWithinDays(dateStr, days) {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  const diff = (new Date() - d) / (1000 * 60 * 60 * 24);
  return diff >= 0 && diff <= days;
}

function isSameMonth(dateStr, ref) {
  const cal = extractDateOnly(dateStr);
  if (!cal) return false;
  const refY = ref.getFullYear();
  const refM = String(ref.getMonth() + 1).padStart(2, '0');
  return cal.startsWith(`${refY}-${refM}`);
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
