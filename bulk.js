const multer = require('multer');
const XLSX = require('xlsx');
const axios = require('axios');
const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const { validatePublicUrl, rootDomain } = require('./src/validator');
const { runEmailExtractionPipeline } = require('./src/pipeline');

const isServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
const baseDir = isServerless ? '/tmp' : __dirname;
const DATA_DIR = path.join(baseDir, 'data', 'bulk-jobs');
const UPLOAD_DIR = path.join(baseDir, 'data', 'uploads');
const MAX_URLS = 10000;
const CONCURRENCY = Math.max(1, Math.min(10, Number(process.env.BULK_CONCURRENCY) || 4));
const jobs = new Map();

try {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  fs.mkdirSync(DATA_DIR, { recursive: true });
} catch (err) {
  console.warn('Could not initialize bulk data directories:', err.message);
}

const upload = multer({
  dest: UPLOAD_DIR,
  limits: { fileSize: 15 * 1024 * 1024, files: 1 },
  fileFilter: (_, file, cb) => cb(null, /\.(xlsx|xls|csv)$/i.test(file.originalname))
});

function cleanText(value, max = 500) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

async function crawlWebsite(raw, scanMode = 'FAST') {
  try {
    const result = await runEmailExtractionPipeline(raw, {
      includeThirdParty: true,
      scanMode
    });

    if (result) {
      const officialEmails = result.emails.filter(e => e.official).map(e => e.email);
      const otherEmails = result.emails.filter(e => !e.official).map(e => e.email);
      const topEmail = result.emails[0];
      const verifiedDomainsStr = result.verifiedDomains ? result.verifiedDomains.map(d => `${d.domain} (${d.type})`).join(', ') : result.rootDomain;

      return {
        'Company Name': result.company || raw,
        'Website': result.website,
        'Root Domain': result.rootDomain,
        'Verified Domains': verifiedDomainsStr,
        'Top Official Email': officialEmails[0] || result.emails[0]?.email || '',
        'Associated Person': topEmail?.personName || '',
        'Job Title': topEmail?.jobTitle || '',
        'Department': topEmail?.department || '',
        'Confidence Score': topEmail ? `${topEmail.confidenceScore}%` : '',
        'Confidence Tier': topEmail ? topEmail.confidenceBadge : '',
        'Acceptance Reason': topEmail ? topEmail.acceptanceReason : '',
        'Email Provider (MX)': result.dnsIntelligence?.emailProvider || 'Unknown',
        'SPF Configured': result.dnsIntelligence?.spf?.hasSpf ? 'Yes' : 'No',
        'DMARC Policy': result.dnsIntelligence?.dmarc?.hasDmarc ? (result.dnsIntelligence.dmarc.policy || 'Configured') : 'None',
        'All Official Emails': officialEmails.join(', '),
        'Other Emails': otherEmails.join(', '),
        'Total Emails Found': result.totalEmailsFound,
        'Phone Numbers': result.phones.slice(0, 3).join(', '),
        'Pages Scanned': result.pagesCrawled,
        'Status': result.emails.length ? 'Success' : 'No Emails Found',
        _emails: result.emails.length,
        _phones: result.phones.length
      };
    }
  } catch (err) {
    // Fallback on error
  }

  return {
    'Company Name': raw,
    'Website': raw,
    'Root Domain': '',
    'Verified Domains': '',
    'Top Official Email': '',
    'Associated Person': '',
    'Job Title': '',
    'Department': '',
    'Confidence Score': '',
    'Confidence Tier': 'Failed',
    'Acceptance Reason': '',
    'Email Provider (MX)': '',
    'SPF Configured': '',
    'DMARC Policy': '',
    'All Official Emails': '',
    'Other Emails': '',
    'Total Emails Found': 0,
    'Phone Numbers': '',
    'Pages Scanned': 0,
    'Status': 'Inaccessible / Failed',
    _emails: 0,
    _phones: 0
  };
}

async function retryCrawl(url, scanMode) {
  for (let i = 0; i < 2; i++) {
    try {
      return await crawlWebsite(url, scanMode);
    } catch {
      if (i < 1) await new Promise(r => setTimeout(r, 400));
    }
  }
  return await crawlWebsite(url, scanMode);
}

function publicJob(job) {
  const elapsed = job.startedAt ? (Date.now() - job.startedAt) / 1000 : 0;
  const rate = job.processed ? elapsed / job.processed : 0;
  return {
    id: job.id,
    state: job.state,
    scanMode: job.scanMode || 'FAST',
    total: job.urls.length,
    processed: job.processed,
    success: job.success,
    failed: job.failed,
    emails: job.emails,
    phones: job.phones,
    percent: job.urls.length ? Math.round((job.processed / job.urls.length) * 100) : 0,
    remainingSeconds: Math.max(0, Math.round(rate * (job.urls.length - job.processed))),
    error: job.error || null,
    outputReady: job.state === 'completed'
  };
}

async function persist(job) {
  try {
    await fsp.mkdir(DATA_DIR, { recursive: true });
    const copy = { ...job };
    delete copy.running;
    await fsp.writeFile(path.join(DATA_DIR, `${job.id}.json`), JSON.stringify(copy));
  } catch (err) {
    console.warn('Could not persist bulk job to disk:', err.message);
  }
}

async function worker(job) {
  while (job.state === 'running') {
    const index = job.nextIndex++;
    if (index >= job.urls.length) break;
    const result = await retryCrawl(job.urls[index], job.scanMode);
    job.results[index] = result;
    job.processed++;
    job.success += result.Status === 'Inaccessible / Failed' ? 0 : 1;
    job.failed += result.Status === 'Inaccessible / Failed' ? 1 : 0;
    job.emails += result._emails;
    job.phones += result._phones;
    if (job.processed % 5 === 0) await persist(job);
  }
}

async function run(job) {
  if (job.running || ['completed', 'cancelled'].includes(job.state)) return;
  job.running = true;
  job.state = 'running';
  job.startedAt ||= Date.now();
  await persist(job);

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker(job)));
  job.running = false;

  if (job.processed >= job.urls.length) {
    job.state = 'completed';
    job.completedAt = Date.now();
  }
  await persist(job);
  if (job.state === 'running' && job.processed < job.urls.length) setTimeout(() => run(job), 50);
}

function workbookBuffer(rows) {
  const clean = rows.filter(Boolean).map(({ _emails, _phones, ...r }) => r);
  const ws = XLSX.utils.json_to_sheet(clean);
  ws['!autofilter'] = { ref: ws['!ref'] };
  ws['!freeze'] = { xSplit: 0, ySplit: 1 };
  ws['!cols'] = Object.keys(clean[0] || { Website: '' }).map(k => ({ wch: Math.min(50, Math.max(13, k.length + 2)) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Corporate Contact Leads');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

function csvBuffer(rows) {
  const clean = rows.filter(Boolean).map(({ _emails, _phones, ...r }) => r);
  const ws = XLSX.utils.json_to_sheet(clean);
  return XLSX.utils.sheet_to_csv(ws);
}

module.exports = function registerBulk(app) {
  fsp.mkdir(UPLOAD_DIR, { recursive: true }).catch(() => {});
  fsp.mkdir(DATA_DIR, { recursive: true }).then(async () => {
    for (const file of await fsp.readdir(DATA_DIR)) {
      if (!file.endsWith('.json')) continue;
      try {
        const job = JSON.parse(await fsp.readFile(path.join(DATA_DIR, file)));
        if (job.state === 'running') job.state = 'paused';
        jobs.set(job.id, job);
      } catch {}
    }
  });

  app.get('/api/bulk/sample', (_, res) => {
    const ws = XLSX.utils.aoa_to_sheet([['Website URL'], ['https://stripe.com'], ['https://openai.com'], ['https://github.com']]);
    ws['!cols'] = [{ wch: 42 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Websites');
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="mailscope-input-template.xlsx"'
    }).send(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
  });

  app.post('/api/bulk/upload', upload.single('file'), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'Choose a valid .xlsx, .xls, or .csv file.' });
      const scanMode = String(req.body.scanMode || 'FAST').toUpperCase();
      const wb = XLSX.readFile(req.file.path);
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false });
      const urls = [...new Set(rows.slice(1).map(r => cleanText(r[0], 2048)).filter(Boolean))];
      await fsp.unlink(req.file.path).catch(() => {});

      if (!urls.length) return res.status(400).json({ error: 'No website URLs were found in the first column.' });
      if (urls.length > MAX_URLS) return res.status(400).json({ error: `A maximum of ${MAX_URLS.toLocaleString()} websites is supported per file.` });

      const id = crypto.randomUUID();
      const job = {
        id,
        state: 'ready',
        scanMode,
        urls,
        results: Array(urls.length),
        nextIndex: 0,
        processed: 0,
        success: 0,
        failed: 0,
        emails: 0,
        phones: 0,
        createdAt: Date.now()
      };
      jobs.set(id, job);
      await persist(job);
      res.json(publicJob(job));
    } catch {
      if (req.file) await fsp.unlink(req.file.path).catch(() => {});
      res.status(400).json({ error: 'The spreadsheet could not be read. Check its format and first-column header.' });
    }
  });

  app.post('/api/bulk/:id/start', (req, res) => {
    const job = jobs.get(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found.' });
    if (job.state === 'paused' || job.state === 'ready') {
      job.state = 'running';
      run(job).catch(e => {
        job.state = 'error';
        job.error = e.message;
        persist(job);
      });
    }
    res.json(publicJob(job));
  });

  app.post('/api/bulk/:id/pause', async (req, res) => {
    const job = jobs.get(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found.' });
    if (job.state === 'running') job.state = 'paused';
    await persist(job);
    res.json(publicJob(job));
  });

  app.post('/api/bulk/:id/resume', (req, res) => {
    const job = jobs.get(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found.' });
    if (job.state === 'paused') {
      job.state = 'running';
      setTimeout(() => run(job), 50);
    }
    res.json(publicJob(job));
  });

  app.post('/api/bulk/:id/cancel', async (req, res) => {
    const job = jobs.get(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found.' });
    job.state = 'cancelled';
    await persist(job);
    res.json(publicJob(job));
  });

  app.get('/api/bulk/:id/status', (req, res) => {
    const job = jobs.get(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found.' });
    res.json(publicJob(job));
  });

  // XLSX Download
  app.get('/api/bulk/:id/download', (req, res) => {
    const job = jobs.get(req.params.id);
    if (!job || job.state !== 'completed') return res.status(409).json({ error: 'The report is not ready yet.' });
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="mailscope-bulk-report-${job.id.slice(0, 8)}.xlsx"`
    }).send(workbookBuffer(job.results));
  });

  // CSV Download
  app.get('/api/bulk/:id/download.csv', (req, res) => {
    const job = jobs.get(req.params.id);
    if (!job || job.state !== 'completed') return res.status(409).json({ error: 'The report is not ready yet.' });
    res.set({
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="mailscope-bulk-report-${job.id.slice(0, 8)}.csv"`
    }).send(csvBuffer(job.results));
  });

  // JSON Download
  app.get('/api/bulk/:id/download.json', (req, res) => {
    const job = jobs.get(req.params.id);
    if (!job || job.state !== 'completed') return res.status(409).json({ error: 'The report is not ready yet.' });
    const clean = job.results.filter(Boolean).map(({ _emails, _phones, ...r }) => r);
    res.set({
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="mailscope-bulk-report-${job.id.slice(0, 8)}.json"`
    }).json(clean);
  });
};
