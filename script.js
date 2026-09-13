const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);

// Application State
let currentResult = null;
let currentDepartmentFilter = 'all';
let currentSearchQuery = '';
let progressTimer = null;
let bulkJob = null;
let bulkPoll = null;

const stages = [
  [8, 'Validating target domain & resolving DNS...'],
  [22, 'Scanning robots.txt, sitemaps & priority paths...'],
  [45, 'Identifying corporate entity & verifying owned domains...'],
  [65, 'Analyzing contact pages, footer & public PDFs...'],
  [82, 'Auditing mail infrastructure (MX, SPF, DMARC)...'],
  [95, 'Synthesizing evidence graph & calculating confidence...']
];

const escapeHtml = value => String(value || '').replace(/[&<>'"]/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
}[c]));

function setProgress(percent, text) {
  const bar = $('#progress-bar');
  const num = $('#progress-number');
  const txt = $('#progress-text');
  if (bar) bar.style.width = percent + '%';
  if (num) num.textContent = percent + '%';
  if (txt) txt.textContent = text;
}

function startProgress() {
  let index = 0;
  $('#progress').classList.remove('hidden');
  setProgress(...stages[0]);
  progressTimer = setInterval(() => {
    if (index < stages.length - 1) {
      index++;
      setProgress(...stages[index]);
    }
  }, 750);
}

function stopProgress() {
  clearInterval(progressTimer);
  setProgress(100, 'Intelligence Scan Complete');
  setTimeout(() => $('#progress').classList.add('hidden'), 500);
}

function showError(message) {
  const errEl = $('#error');
  errEl.textContent = message;
  errEl.classList.remove('hidden');
}

/**
 * Defensively parses JSON responses from the server.
 * Intercepts HTML responses (such as GitHub Pages or misconfigured proxies)
 * and displays actionable deployment error messages.
 */
async function parseJsonResponse(response, endpointName = 'API') {
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    const rawText = await response.text().catch(() => '');
    console.error(`[MailScope] ${endpointName} expected JSON but received non-JSON response:`, {
      status: response.status,
      statusText: response.statusText,
      contentType,
      body: rawText.slice(0, 1000)
    });
    if (contentType.includes('text/html') || rawText.trim().startsWith('<')) {
      throw new Error('API routing error: the server returned HTML instead of JSON. Check the Vercel API deployment.');
    }
    throw new Error(`Unexpected server response (${response.status} ${response.statusText}): expected JSON.`);
  }
  return response.json();
}

// Single Extractor Form Submit
$('#extract-form').addEventListener('submit', async e => {
  e.preventDefault();
  $('#error').classList.add('hidden');
  $('#results').classList.add('hidden');
  const submitBtn = $('#submit');
  submitBtn.disabled = true;

  startProgress();

  try {
    const rawUrl = $('#url').value.trim();
    const includeThirdParty = $('#third-party').checked;
    const scanMode = $('#scan-mode').value;
    const bypassCache = $('#bypass-cache').checked;

    const response = await fetch('/api/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: rawUrl,
        includeThirdParty,
        scanMode,
        bypassCache
      })
    });

    const data = await parseJsonResponse(response, 'POST /api/extract');
    if (!response.ok) throw new Error(data.error || 'The scan could not be completed.');

    currentResult = data;
    renderCompanyProfile(data);
    renderResults(data);
    renderDnsPanel(data.dnsIntelligence);
    renderDocumentsPanel(data.documents);
    renderEvidenceGraph(data.evidenceGraph);
    saveHistory(data);
    stopProgress();
  } catch (error) {
    clearInterval(progressTimer);
    $('#progress').classList.add('hidden');
    showError(error.message);
  } finally {
    submitBtn.disabled = false;
  }
});

function renderCompanyProfile(data) {
  $('#company-logo').src = data.logoUrl;
  $('#company-name').textContent = data.company || 'Corporate Entity';
  $('#company-domain-badge').textContent = data.rootDomain;

  // MX badge
  const mxBadge = $('#company-mx-badge');
  if (data.dnsIntelligence && data.dnsIntelligence.emailProvider) {
    mxBadge.textContent = `Mail: ${data.dnsIntelligence.emailProvider}`;
    mxBadge.classList.remove('hidden');
  } else {
    mxBadge.classList.add('hidden');
  }

  // Alternate / Legal names
  const altContainer = $('#company-alt-names');
  altContainer.innerHTML = '';
  if (data.alternateNames && data.alternateNames.length) {
    data.alternateNames.forEach(name => {
      altContainer.innerHTML += `<span class="alt-name-tag">Legal/DBA: ${escapeHtml(name)}</span>`;
    });
  }

  $('#company-desc').textContent = data.description || 'Verified corporate identity scanned via public web and OSINT discovery.';

  // Render Verified Corporate Domains
  const verifiedContainer = $('#verified-domains-chips');
  verifiedContainer.innerHTML = '';
  const verifiedList = data.verifiedDomains || [{ domain: data.rootDomain, type: 'primary', status: 'verified' }];
  
  $('#verified-domains-count').textContent = `${verifiedList.length} domain${verifiedList.length === 1 ? '' : 's'}`;

  verifiedList.forEach(vd => {
    const badgeClass = (vd.type || 'primary').toLowerCase();
    verifiedContainer.innerHTML += `
      <div class="domain-chip" title="${escapeHtml(vd.evidence || 'Verified corporate domain')}">
        <span class="chip-name">🌐 ${escapeHtml(vd.domain)}</span>
        <span class="chip-badge ${escapeHtml(badgeClass)}">${escapeHtml(vd.type || 'verified')}</span>
      </div>
    `;
  });

  // Meta pills
  const pillsContainer = $('#company-meta-pills');
  pillsContainer.innerHTML = '';

  if (data.phones && data.phones.length) {
    data.phones.forEach(phone => {
      pillsContainer.innerHTML += `<span class="meta-pill">📞 ${escapeHtml(phone)}</span>`;
    });
  }

  if (data.contactFormUrl) {
    pillsContainer.innerHTML += `<a href="${escapeHtml(data.contactFormUrl)}" target="_blank" rel="noopener" class="meta-pill" style="text-decoration:none;color:var(--accent)">📝 Direct Contact Form ↗</a>`;
  }
}

function renderResults(data) {
  // Update Tab Badges
  $('#tab-contacts-count').textContent = (data.emails || []).length;
  $('#tab-docs-count').textContent = (data.documents || []).length;

  // Stats Grid
  const stats = [
    ['Verified Domains', data.verifiedDomains ? data.verifiedDomains.length : 1],
    ['Pages Scanned', data.pagesCrawled || 0],
    ['Total Contacts Found', data.totalEmailsFound || 0],
    ['Verified Official', data.officialEmailsFound || 0]
  ];

  $('#stats').innerHTML = stats.map(([label, val]) => `
    <div class="stat-card">
      <b>${escapeHtml(val)}</b>
      <span>${escapeHtml(label)}</span>
    </div>
  `).join('');

  filterAndRenderEmailGrid();
  $('#results').classList.remove('hidden');
  setTimeout(() => $('#results').scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
}

function filterAndRenderEmailGrid() {
  if (!currentResult || !currentResult.emails) return;

  const filtered = currentResult.emails.filter(item => {
    // Dept Filter
    if (currentDepartmentFilter !== 'all' && item.department !== currentDepartmentFilter) {
      return false;
    }
    // Search Query Filter
    if (currentSearchQuery) {
      const q = currentSearchQuery.toLowerCase();
      const matchEmail = item.email.toLowerCase().includes(q);
      const matchDept = (item.department || '').toLowerCase().includes(q);
      const matchDomain = (item.verifiedCompanyDomain || '').toLowerCase().includes(q);
      const matchPerson = (item.personName || '').toLowerCase().includes(q);
      const matchTitle = (item.jobTitle || '').toLowerCase().includes(q);
      if (!matchEmail && !matchDept && !matchDomain && !matchPerson && !matchTitle) return false;
    }
    return true;
  });

  const grid = $('#email-grid');
  const empty = $('#empty');

  if (!filtered.length) {
    grid.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }

  empty.classList.add('hidden');
  grid.innerHTML = filtered.map((item, idx) => {
    const badgeColor = item.badgeColor || (item.confidenceScore >= 90 ? 'green' : item.confidenceScore >= 75 ? 'teal' : 'amber');
    const badgeText = `${item.confidenceScore}% ${item.confidenceBadge || 'Verified'}`;
    const discoveryMethod = item.discoveryMethod || 'Website Discovery';
    const verifiedDomain = item.verifiedCompanyDomain || item.email.split('@')[1];
    const sourceUrl = item.sourceUrl || item.sourcePage || '#';
    const acceptanceReason = item.acceptanceReason || 'Verified company email';

    return `
      <article class="email-card">
        <div>
          <div class="card-top">
            <span class="dept-badge">${escapeHtml(item.department || 'General')}</span>
            <span class="confidence-badge ${badgeColor}">${escapeHtml(badgeText)}</span>
          </div>

          ${item.personName ? `
            <div class="person-tag">
              <span>👤 <strong>${escapeHtml(item.personName)}</strong></span>
              ${item.jobTitle ? `<span class="person-role">(${escapeHtml(item.jobTitle)})</span>` : ''}
            </div>
          ` : ''}

          <h3 style="word-break:break-all;">${escapeHtml(item.email)}</h3>
          
          <div style="margin-top:10px;font-size:12px;line-height:1.6;color:var(--text-muted);display:flex;flex-direction:column;gap:4px;">
            <div>🌐 <strong>Verified Domain:</strong> <span style="color:var(--text-main);font-weight:600">${escapeHtml(verifiedDomain)}</span></div>
            <div>🔍 <strong>Discovery Method:</strong> <span style="color:var(--text-main);font-weight:600">${escapeHtml(discoveryMethod)}</span></div>
            <div>🔗 <strong>Source URL:</strong> <a href="${escapeHtml(sourceUrl)}" target="_blank" rel="noopener" style="color:var(--accent);text-decoration:underline;">${escapeHtml(sourceUrl)}</a></div>
            
            <div style="margin-top:6px;display:flex;align-items:center;justify-content:space-between;">
              <button class="explain-btn" data-email-index="${idx}">
                💡 <span>Why Accepted? (Factor Breakdown)</span>
              </button>
            </div>
          </div>
        </div>
        <div class="card-meta" style="margin-top:14px;">
          <span style="font-size:12px;color:var(--text-muted)">Scope: ${item.official ? 'Official Corporate Domain' : 'Third-Party Included'}</span>
          <button class="copy-btn" data-email="${escapeHtml(item.email)}">Copy Email</button>
        </div>
      </article>
    `;
  }).join('');
}

// Render DNS & Infrastructure Tab
function renderDnsPanel(dns) {
  const container = $('#dns-grid');
  if (!dns) {
    container.innerHTML = '<p style="color:var(--text-muted);">DNS intelligence unavailable.</p>';
    return;
  }

  const mxStatus = dns.hasMx ? 'pass' : 'warn';
  const spfStatus = dns.spf?.hasSpf ? 'pass' : 'warn';
  const dmarcStatus = dns.dmarc?.hasDmarc ? 'pass' : 'warn';

  container.innerHTML = `
    <!-- MX Records -->
    <div class="dns-card">
      <div class="dns-card-title">
        <span>Mail Exchange (MX)</span>
        <span class="dns-status-pill ${mxStatus}">${dns.hasMx ? 'Active MX' : 'No MX'}</span>
      </div>
      <div class="dns-value">${escapeHtml(dns.emailProvider || 'Custom Server')}</div>
      <div class="dns-details">
        ${dns.mx && dns.mx.length ? dns.mx.map(m => `<div>• Priority ${m.priority}: <strong>${escapeHtml(m.exchange)}</strong></div>`).join('') : 'No MX records returned.'}
      </div>
    </div>

    <!-- SPF -->
    <div class="dns-card">
      <div class="dns-card-title">
        <span>SPF Authorization</span>
        <span class="dns-status-pill ${spfStatus}">${dns.spf?.hasSpf ? 'Configured' : 'Missing'}</span>
      </div>
      <div class="dns-value">${dns.spf?.hasSpf ? 'Sender Policy Framework Active' : 'No SPF Record Found'}</div>
      <div class="dns-details">
        ${dns.spf?.record ? `<code>${escapeHtml(dns.spf.record)}</code>` : 'Domain has not published an SPF validation record.'}
      </div>
    </div>

    <!-- DMARC -->
    <div class="dns-card">
      <div class="dns-card-title">
        <span>DMARC Enforcement</span>
        <span class="dns-status-pill ${dmarcStatus}">${dns.dmarc?.hasDmarc ? 'Protected' : 'Missing'}</span>
      </div>
      <div class="dns-value">Policy: ${escapeHtml(dns.dmarc?.policy || 'None')}</div>
      <div class="dns-details">
        ${dns.dmarc?.record ? `<code>${escapeHtml(dns.dmarc.record)}</code>` : 'Domain has not published a DMARC policy.'}
      </div>
    </div>

    <!-- Nameservers & Infrastructure -->
    <div class="dns-card">
      <div class="dns-card-title">
        <span>DNS & Nameservers</span>
        <span class="dns-status-pill pass">Resolved</span>
      </div>
      <div class="dns-value">${dns.cdnIndicators?.length ? dns.cdnIndicators.join(', ') : 'Direct DNS'}</div>
      <div class="dns-details">
        ${dns.ns && dns.ns.length ? dns.ns.map(n => `<div>• NS: <strong>${escapeHtml(n)}</strong></div>`).join('') : 'No nameservers found.'}
      </div>
    </div>
  `;
}

// Render Public Documents Tab
function renderDocumentsPanel(docs) {
  const container = $('#docs-list');
  if (!docs || !docs.length) {
    container.innerHTML = '<p style="color:var(--text-muted);">No public PDF documents or file links were detected on the scanned pages.</p>';
    return;
  }

  container.innerHTML = docs.map(doc => `
    <div class="doc-item">
      <div class="doc-info">
        <b>📄 ${escapeHtml(doc.filename || doc.docTitle || 'Corporate Document')}</b>
        <span><a href="${escapeHtml(doc.url)}" target="_blank" rel="noopener" style="color:var(--accent);">${escapeHtml(doc.url)}</a></span>
        <div class="doc-meta">
          SHA-256: <code>${escapeHtml(doc.sha256Hash || 'N/A')}</code> · Size: ${(doc.fileSize / 1024).toFixed(1)} KB ${doc.isScanned ? '· (Scanned/OCR Processed)' : ''}
        </div>
      </div>
      <div>
        <span class="badge-count">${(doc.emailsFound || []).length} contact${(doc.emailsFound || []).length === 1 ? '' : 's'}</span>
      </div>
    </div>
  `).join('');
}

// Render Audit Evidence Graph Tab
function renderEvidenceGraph(graph) {
  const container = $('#evidence-tree');
  if (!graph || !graph.nodes || !graph.nodes.length) {
    container.innerHTML = '<p style="color:var(--text-muted);">Evidence graph generation completed.</p>';
    return;
  }

  const companies = graph.nodes.filter(n => n.type === 'company');
  const domains = graph.nodes.filter(n => n.type === 'domain');
  const people = graph.nodes.filter(n => n.type === 'person');
  const emails = graph.nodes.filter(n => n.type === 'email');

  container.innerHTML = `
    <div class="evidence-group">
      <div class="evidence-group-title">Corporate Entity & Primary Authority</div>
      ${companies.map(c => `
        <div class="evidence-node-row">
          <span>🏛️</span>
          <b>${escapeHtml(c.label)}</b>
          <span class="rel-badge">ROOT ENTITY</span>
        </div>
      `).join('')}
    </div>

    <div class="evidence-group">
      <div class="evidence-group-title">Authorized Corporate Domains (${domains.length})</div>
      ${domains.map(d => `
        <div class="evidence-node-row">
          <span>🌐</span>
          <b>${escapeHtml(d.label)}</b>
          <span class="rel-badge">${escapeHtml(d.metadata?.type || 'VERIFIED')}</span>
          <span style="font-size:11px;color:var(--text-muted);margin-left:auto;">${escapeHtml(d.metadata?.evidence || '')}</span>
        </div>
      `).join('')}
    </div>

    ${people.length ? `
      <div class="evidence-group">
        <div class="evidence-group-title">Associated Corporate Personnel (${people.length})</div>
        ${people.map(p => `
          <div class="evidence-node-row">
            <span>👤</span>
            <b>${escapeHtml(p.label)}</b>
            <span class="rel-badge">${escapeHtml(p.metadata?.jobTitle || 'Executive/Team')}</span>
          </div>
        `).join('')}
      </div>
    ` : ''}

    <div class="evidence-group">
      <div class="evidence-group-title">Cross-Referenced Public Contacts (${emails.length})</div>
      ${emails.slice(0, 15).map(e => `
        <div class="evidence-node-row">
          <span>✉️</span>
          <b>${escapeHtml(e.label)}</b>
          <span class="rel-badge">${escapeHtml(e.metadata?.department || 'General')}</span>
          <span style="font-size:11px;color:var(--accent);margin-left:auto;">Score: ${e.metadata?.confidenceScore}% (${escapeHtml(e.metadata?.confidenceBadge || '')})</span>
        </div>
      `).join('')}
    </div>
  `;
}

// Explanation Modal Handler
$('#email-grid').addEventListener('click', e => {
  const btn = e.target.closest('.explain-btn');
  if (!btn) return;
  const idx = Number(btn.dataset.emailIndex);
  const emailItem = currentResult?.emails?.[idx];
  if (!emailItem) return;

  $('#modal-title').textContent = `Verification Breakdown: ${emailItem.email}`;
  
  const positiveList = (emailItem.positiveFactors || []).map(f => `
    <div class="factor-item positive">
      <span>✓ ${escapeHtml(f.factor)}</span>
      <span class="factor-points">+${f.points}</span>
    </div>
  `).join('');

  const negativeList = (emailItem.negativeFactors || []).map(f => `
    <div class="factor-item negative">
      <span>✗ ${escapeHtml(f.factor)}</span>
      <span class="factor-points">${f.points}</span>
    </div>
  `).join('');

  $('#modal-body').innerHTML = `
    <div style="margin-bottom:16px;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
        <span style="font-size:14px;color:var(--text-muted);">Confidence Rating:</span>
        <span class="confidence-badge ${emailItem.badgeColor || 'green'}">${emailItem.confidenceScore}% ${emailItem.confidenceBadge}</span>
      </div>
      <div style="padding:10px 14px;background:rgba(255,255,255,0.04);border-radius:8px;font-size:13px;line-height:1.5;color:var(--text);">
        ${escapeHtml(emailItem.acceptanceReason || 'Official company email validated against verified corporate domains.')}
      </div>
    </div>

    <h4 style="font-size:13px;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-muted);margin-bottom:8px;">
      Transparent Scoring Factors
    </h4>
    <div class="modal-factors-list">
      ${positiveList || '<div style="font-size:12px;color:var(--text-muted);">No positive modifiers.</div>'}
      ${negativeList}
    </div>
  `;

  $('#explanation-modal').classList.remove('hidden');
});

$('#close-modal').addEventListener('click', () => {
  $('#explanation-modal').classList.add('hidden');
});

$('#explanation-modal').addEventListener('click', e => {
  if (e.target === $('#explanation-modal')) {
    $('#explanation-modal').classList.add('hidden');
  }
});

// Tab Switching Listener
$('#intel-tabs').addEventListener('click', e => {
  const btn = e.target.closest('.tab-btn');
  if (!btn) return;
  const targetTab = btn.dataset.tab;

  $$('#intel-tabs .tab-btn').forEach(b => b.classList.toggle('active', b === btn));
  $$('.tab-pane').forEach(p => p.classList.add('hidden'));

  const activePane = $(`#tab-pane-${targetTab}`);
  if (activePane) activePane.classList.remove('hidden');
});

// Department Filter Pill Buttons
$('#dept-filters').addEventListener('click', e => {
  const pill = e.target.closest('.pill');
  if (!pill) return;
  $$('#dept-filters .pill').forEach(p => p.classList.remove('active'));
  pill.classList.add('active');
  currentDepartmentFilter = pill.dataset.dept;
  filterAndRenderEmailGrid();
});

// Search input inside filter toolbar
$('#email-search').addEventListener('input', e => {
  currentSearchQuery = e.target.value.trim();
  filterAndRenderEmailGrid();
});

// Email Copy Delegated Event Listener
$('#email-grid').addEventListener('click', async e => {
  const btn = e.target.closest('.copy-btn');
  if (!btn) return;
  const email = btn.dataset.email;
  await copyTextToClipboard(email, btn);
});

async function copyTextToClipboard(text, button) {
  try {
    await navigator.clipboard.writeText(text);
    if (button) {
      const original = button.textContent;
      button.textContent = '✓ Copied!';
      button.style.background = 'var(--accent)';
      button.style.color = '#022c22';
      setTimeout(() => {
        button.textContent = original;
        button.style.background = '';
        button.style.color = '';
      }, 1200);
    }
  } catch {
    // Fallback if clipboard API is constrained
    const tempInput = document.createElement('textarea');
    tempInput.value = text;
    document.body.appendChild(tempInput);
    tempInput.select();
    document.execCommand('copy');
    document.body.removeChild(tempInput);
    if (button) {
      button.textContent = '✓ Copied!';
      setTimeout(() => { button.textContent = 'Copy Email'; }, 1200);
    }
  }
}

// Export Functionality
$('.actions').addEventListener('click', e => {
  const exportType = e.target.dataset.export;
  if (!exportType || !currentResult || !currentResult.emails.length) return;

  const emails = currentResult.emails;

  if (exportType === 'copy') {
    const textList = emails.map(x => x.email).join('\n');
    return copyTextToClipboard(textList, e.target);
  }

  if (exportType === 'json') {
    return downloadFile(JSON.stringify(currentResult, null, 2), `${currentResult.rootDomain}-intelligence.json`, 'application/json');
  }

  const csvRows = [
    'Email,PersonName,JobTitle,Department,VerifiedDomain,Official,ConfidenceScore,ConfidenceBadge,DiscoveryMethod,SourceUrl,AcceptanceReason',
    ...emails.map(x => `"${x.email}","${x.personName || ''}","${x.jobTitle || ''}","${x.department}","${x.verifiedCompanyDomain}","${x.official ? 'Yes' : 'No'}","${x.confidenceScore}%","${x.confidenceBadge}","${x.discoveryMethod}","${x.sourceUrl}","${x.acceptanceReason.replace(/"/g, '""')}"`)
  ].join('\r\n');

  if (exportType === 'csv') {
    return downloadFile('\ufeff' + csvRows, `${currentResult.rootDomain}-contacts.csv`, 'text/csv');
  }

  if (exportType === 'excel') {
    return downloadFile('\ufeff' + csvRows, `${currentResult.rootDomain}-contacts.xls`, 'application/vnd.ms-excel');
  }
});

function downloadFile(content, fileName, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 500);
}

// Local Search History
function saveHistory(data) {
  const history = JSON.parse(localStorage.getItem('mailscope-history') || '[]')
    .filter(item => item.website !== data.website);

  history.unshift({
    company: data.company,
    website: data.website,
    rootDomain: data.rootDomain,
    date: new Date().toISOString(),
    emails: data.emails.length
  });

  localStorage.setItem('mailscope-history', JSON.stringify(history.slice(0, 20)));
  renderHistory();
}

function renderHistory() {
  const history = JSON.parse(localStorage.getItem('mailscope-history') || '[]');
  const list = $('#history-list');

  if (!history.length) {
    list.innerHTML = '<p class="section-subtitle">No recent searches yet.</p>';
    return;
  }

  list.innerHTML = history.map(item => `
    <div class="history-item">
      <div class="history-item-info">
        <b>${escapeHtml(item.company)}</b>
        <span>${escapeHtml(item.website)} · ${new Date(item.date).toLocaleDateString()}</span>
      </div>
      <div style="display:flex;align-items:center;gap:12px">
        <span class="history-count">${item.emails} Contact${item.emails === 1 ? '' : 's'}</span>
        <button class="secondary-btn" onclick="rescanHistoryItem('${escapeHtml(item.website)}')">Re-scan</button>
      </div>
    </div>
  `).join('');
}

window.rescanHistoryItem = (url) => {
  $('#url').value = url;
  $('#single-view').scrollIntoView({ behavior: 'smooth' });
  $('#extract-form').dispatchEvent(new Event('submit'));
};

$('#clear-history').addEventListener('click', () => {
  localStorage.removeItem('mailscope-history');
  renderHistory();
});

// Theme Management
const savedTheme = localStorage.getItem('mailscope-theme') ||
  (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');

document.documentElement.dataset.theme = savedTheme;
$('#theme').textContent = savedTheme === 'dark' ? '☀' : '☾';

$('#theme').addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  localStorage.setItem('mailscope-theme', next);
  $('#theme').textContent = next === 'dark' ? '☀' : '☾';
});

// Navigation Mode Switcher (Single vs Bulk)
$('.mode-nav').addEventListener('click', e => {
  const btn = e.target.closest('[data-mode]');
  if (!btn) return;
  $$('.mode-nav button').forEach(b => b.classList.toggle('active', b === btn));
  const mode = btn.dataset.mode;
  $('#single-view').classList.toggle('hidden', mode !== 'single');
  $('#bulk-view').classList.toggle('hidden', mode !== 'bulk');
});

// Bulk Extractor Handlers
$('#bulk-file').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;

  $('#bulk-error').classList.add('hidden');
  $('#file-card').classList.remove('hidden');
  $('#file-name').textContent = file.name;
  $('#file-meta').textContent = 'Uploading and validating file...';

  const formData = new FormData();
  formData.append('file', file);
  formData.append('scanMode', $('#bulk-scan-mode').value);

  try {
    const res = await fetch('/api/bulk/upload', { method: 'POST', body: formData });
    const data = await parseJsonResponse(res, 'POST /api/bulk/upload');
    if (!res.ok) throw new Error(data.error);

    bulkJob = data;
    $('#file-meta').textContent = `${data.total.toLocaleString()} website URLs extracted (${data.scanMode} mode)`;
    $('#bulk-controls').classList.remove('hidden');
    $('#bulk-dashboard').classList.remove('hidden');
    renderBulkDashboard(data);
  } catch (err) {
    $('#bulk-error').textContent = err.message;
    $('#bulk-error').classList.remove('hidden');
    $('#file-meta').textContent = 'Upload failed';
  }
});

$('#remove-file').addEventListener('click', () => {
  if (bulkJob && !['completed', 'cancelled'].includes(bulkJob.state)) {
    fetch(`/api/bulk/${bulkJob.id}/cancel`, { method: 'POST' });
  }
  bulkJob = null;
  clearInterval(bulkPoll);
  $('#bulk-file').value = '';
  $('#file-card').classList.add('hidden');
  $('#bulk-controls').classList.add('hidden');
  $('#bulk-dashboard').classList.add('hidden');
});

async function triggerBulkAction(action) {
  if (!bulkJob) return;
  try {
    const res = await fetch(`/api/bulk/${bulkJob.id}/${action}`, { method: 'POST' });
    const data = await parseJsonResponse(res, `POST /api/bulk/:id/${action}`);
    if (!res.ok) return showBulkError(data.error || 'Bulk action failed');

    bulkJob = data;
    renderBulkDashboard(data);
    if (['start', 'resume'].includes(action)) startBulkPolling();
  } catch (err) {
    showBulkError(err.message);
  }
}

$('#bulk-start').addEventListener('click', () => triggerBulkAction('start'));
$('#bulk-pause').addEventListener('click', () => triggerBulkAction('pause'));
$('#bulk-resume').addEventListener('click', () => triggerBulkAction('resume'));
$('#bulk-cancel').addEventListener('click', () => triggerBulkAction('cancel'));

function startBulkPolling() {
  clearInterval(bulkPoll);
  bulkPoll = setInterval(async () => {
    if (!bulkJob) return;
    try {
      const res = await fetch(`/api/bulk/${bulkJob.id}/status`);
      bulkJob = await res.json();
      renderBulkDashboard(bulkJob);
      if (['completed', 'cancelled', 'error'].includes(bulkJob.state)) {
        clearInterval(bulkPoll);
      }
    } catch { /* suppress network poll glitch */ }
  }, 1000);
}

function renderBulkDashboard(job) {
  $('#bulk-state').textContent = job.state === 'ready' ? 'Ready to begin' : job.state.toUpperCase();
  $('#bulk-counter').textContent = `Website ${job.processed.toLocaleString()} of ${job.total.toLocaleString()}`;
  $('#bulk-percent').textContent = job.percent + '%';
  $('#bulk-progress-bar').style.width = job.percent + '%';

  const stats = [
    ['Total Websites', job.total],
    ['Processed', job.processed],
    ['Success', job.success],
    ['Emails Extracted', job.emails],
    ['Phones Extracted', job.phones],
    ['Time Remaining', formatTime(job.remainingSeconds)]
  ];

  $('#bulk-stats').innerHTML = stats.map(([l, v]) => `
    <div class="bulk-stat">
      <b>${typeof v === 'number' ? v.toLocaleString() : v}</b>
      <span>${escapeHtml(l)}</span>
    </div>
  `).join('');

  $('#bulk-start').disabled = job.state !== 'ready';
  $('#bulk-pause').disabled = job.state !== 'running';
  $('#bulk-resume').disabled = job.state !== 'paused';

  const downloadBtn = $('#bulk-download');
  const downloadCsv = $('#bulk-download-csv');
  const downloadJson = $('#bulk-download-json');

  downloadBtn.classList.toggle('disabled', !job.outputReady);
  downloadBtn.href = job.outputReady ? `/api/bulk/${job.id}/download` : '#';

  downloadCsv.classList.toggle('disabled', !job.outputReady);
  downloadCsv.href = job.outputReady ? `/api/bulk/${job.id}/download.csv` : '#';

  downloadJson.classList.toggle('disabled', !job.outputReady);
  downloadJson.href = job.outputReady ? `/api/bulk/${job.id}/download.json` : '#';

  if (job.error) showBulkError(job.error);
}

function formatTime(seconds) {
  if (!seconds) return '-';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return h ? `${h}h ${m}m` : m ? `${m}m ${s}s` : `${s}s`;
}

function showBulkError(msg) {
  $('#bulk-error').textContent = msg;
  $('#bulk-error').classList.remove('hidden');
}

// Initial render
renderHistory();
