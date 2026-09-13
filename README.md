# MailScope — Corporate Identity, Multi-Domain Verification & Contact Intelligence Engine

MailScope is an enterprise-grade corporate intelligence and contact discovery engine. Given any company website or domain, MailScope resolves the official corporate entity, discovers all verified domains owned or operated by the organization, analyzes mail infrastructure (MX, SPF, DMARC), and extracts verified public business contacts with transparent, explainable confidence scoring.

---

## 🌐 Key Capabilities & Architecture

### 1. Corporate Identity & Multi-Domain Verification
Modern enterprises frequently operate across multiple domains (e.g. `siddhan.ai` and `siddhanintelligence.com`, regional TLDs like `.co.uk`, `.de`, and product brand domains). MailScope does not make single-domain assumptions:
- **Corporate Entity Resolution**: Discovers legal entity names, trademarks, and DBAs across metadata, titles, copyright declarations, and legal policies.
- **Domain Verification Engine**: Inspects Contact, About, Leadership, Footer, Privacy, Terms, and Document references to classify domains as:
  - `Primary Official Domain`
  - `Secondary Corporate Domain`
  - `Regional / Country TLD`
  - `Product / Brand Domain`
  - `Subsidiary Entity`
- **Domain-Bounded Acceptance**: Accepts public business contacts matching any verified company domain and rejects unrelated third-party domains.

### 2. Multi-Stage OSINT & Discovery Pipeline
1. **Stage 1 — Website & SPA Crawling**:
   - Analyzes `robots.txt` and `sitemap.xml` / `sitemap_index.xml` trees.
   - Crawls priority paths (`/contact`, `/about`, `/team`, `/leadership`, `/careers`, `/support`, `/legal`, `/imprint`, etc.).
   - Employs **Playwright Chromium Fallback** for Single-Page Applications (React, Next.js, Vue, Angular) when static HTML is empty.
   - Resolves obfuscated mailto anchors and text encodings (e.g., `user [at] domain [dot] com`, `&#64;`, `%40`).
2. **Stage 2 — Search Engine OSINT**:
   - Queries public search engine indexes to identify unlinked contact endpoints, press rooms, and publications.
3. **Stage 3 — Public Document & OCR Intelligence**:
   - Downloads and inspects public PDFs and files (`.pdf`, `.docx`, `.xlsx`).
   - Generates cryptographic SHA-256 integrity hashes for document deduplication.
   - Integrates **Tesseract OCR** to extract text and contacts from scanned image-only PDFs.

### 3. DNS & Mail Deliverability Intelligence
- **MX Record Analysis**: Identifies active mail exchange servers and resolves known providers (Google Workspace, Microsoft 365, Proton, Zoho, Mimecast, Proofpoint, etc.).
- **SPF Verification**: Checks for published Sender Policy Framework authorization records.
- **DMARC Enforcement**: Audits DMARC policies (`none`, `quarantine`, `reject`).
- **Infrastructure & CDN**: Discovers nameservers (Cloudflare, Route 53, Google Cloud DNS) and network routing.

### 4. Person & Department Classification
- **14 Department Categories**: Classifies emails into `HR`, `Recruitment`, `Sales`, `Marketing`, `Finance`, `Procurement`, `Merchandising`, `Operations`, `IT / Technical`, `Legal`, `Executive`, `Customer Support`, `Investor Relations`, and `Media / Press`.
- **Person & Role Extraction**: Pairs email addresses with executive and team member names and job titles discovered in surrounding DOM context.

### 5. Transparent Confidence Scoring (0–100%)
Every contact receives an auditable, mathematical score with an explicit factor breakdown:
- **Tiers**:
  - `90–100%`: Verified Official
  - `75–89%`: Highly Likely
  - `50–74%`: Possible
  - `< 50%`: Unverified / Third-Party
- **Explainable Factors**: Positive points (+35 corporate domain match, +30 contact page, +20 mailto link, +15 person association, +10 active MX) and negative deductions (-35 unverified domain, -20 missing MX, -40 placeholder syntax).
- **Interactive Explanation Modal**: Click "Why Accepted?" on any contact card to view the exact scoring logic and chain of custody.

### 6. Auditable Evidence Graph
Establishes a transparent chain of custody:
`Corporate Entity -> Verified Domains -> Crawled Sources -> Public Documents -> People -> Business Contacts`.

### 7. Bulk Processing & Resumable Queue
- Upload Excel (`.xlsx`, `.xls`) or CSV files containing up to 10,000 corporate websites.
- Disk-persisted checkpoints in `data/bulk-jobs/` allow pause, resume, and recovery across server restarts.
- Configurable scan modes (`FAST`, `STANDARD`, `DEEP`).
- Export enriched reports in **Excel (.xlsx)**, **CSV (.csv)**, or **JSON (.json)**.

### 8. Hardened SSRF & Security Protections
- Enforces DNS pre-resolution and strict CIDR checks blocking private networks, loopbacks, link-local addresses, and cloud metadata endpoints (`169.254.169.254`, `127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `::1`, `fc00::/7`, `fe80::/10`).
- Restricts protocols to public HTTP and HTTPS.
- Re-validates every redirect hop to prevent redirect-based SSRF bypasses.

---

## 🛠️ Technology Stack

| Layer | Technologies | Purpose |
| :--- | :--- | :--- |
| **Runtime** | Node.js (v18+) | Core backend execution runtime |
| **Server** | Express.js | REST APIs, routing, and static file delivery |
| **HTTP & Crawling** | Axios, Cheerio | Fast static scraping, XML sitemap parsing |
| **Dynamic Rendering** | Playwright (Chromium) | Headless fallback for client-side JavaScript SPAs |
| **Document Parsing** | pdf-parse, Tesseract.js | PDF text extraction and optical character recognition |
| **DNS Intelligence** | `node:dns/promises` | Native MX, SPF, DMARC, NS, A, AAAA, CAA querying |
| **Spreadsheet Engine** | SheetJS (`xlsx`), Multer | Multi-format bulk uploads and enriched report generation |
| **Frontend** | Vanilla ES6+, Semantic HTML5, Modern CSS | Zero-bloat, responsive, high-density intelligence UI |
| **Persistence** | In-Memory TTL Cache, Disk JSON Checkpoints | Low-latency DNS/pipeline caching and resumable batch jobs |

---

## 🔌 API Reference

### `POST /api/extract`
Runs the primary corporate intelligence pipeline on a target website.
- **Request Body**:
  ```json
  {
    "url": "https://example.com",
    "scanMode": "STANDARD",
    "includeThirdParty": false,
    "bypassCache": false
  }
  ```
- **Response**: Full corporate profile, verified domains list, DNS intelligence, public documents, evidence graph, and verified contacts with confidence scores.

### `POST /api/company/analyze`
Dedicated alias for corporate identity analysis and domain verification.

### `POST /api/domain/verify`
Accepts a domain or URL and returns all discovered and verified company domains with evidence classification.

### `POST /api/dns/analyze`
Accepts a domain name and returns MX records, email provider, SPF record, DMARC policy, nameservers, and CDN indicators.

### `GET /api/health`
Returns system health, uptime, and available subsystems (Playwright, OCR, DNS, Cache).

### Bulk Endpoints
- `GET /api/bulk/sample` — Download sample template spreadsheet.
- `POST /api/bulk/upload` — Upload `.xlsx`, `.xls`, or `.csv` spreadsheet with `scanMode` parameter.
- `POST /api/bulk/:id/start` — Begin or resume batch extraction.
- `POST /api/bulk/:id/pause` — Pause running batch job.
- `POST /api/bulk/:id/resume` — Resume paused job.
- `POST /api/bulk/:id/cancel` — Cancel job execution.
- `GET /api/bulk/:id/status` — Get real-time job progress and stats.
- `GET /api/bulk/:id/download` — Download report as formatted Excel workbook (`.xlsx`).
- `GET /api/bulk/:id/download.csv` — Download report as CSV.
- `GET /api/bulk/:id/download.json` — Download report as JSON.

---

## 🚀 Getting Started

### Prerequisites
- Node.js 18.0.0 or higher
- npm

### Installation & Local Launch

```bash
# Clone the repository
git clone <repo-url>
cd mailscope

# Install dependencies
npm install

# Start the application locally
npm start
```

For development mode:
```bash
npm run dev
```

Navigate to `http://localhost:3000` in your web browser.

---

## ☁️ Vercel Deployment

Deploying MailScope to **Vercel** provides high-availability serverless hosting where the frontend is served as fast static assets and all intelligence pipelines (`/api/*`) execute as serverless Node.js functions.

### Step-by-Step Vercel Setup:
1. **Push to GitHub**: Commit and push the project to your GitHub repository (`git push origin main`).
2. **Private Repository Compatibility**: The repository can remain **PRIVATE** (no need to make it public).
3. **Import to Vercel**: In your Vercel Dashboard, click **Add New** → **Project**, and select your MailScope repository.
4. **Root Directory**: Keep the Root Directory set to `./` (repository root).
5. **Framework Preset**: Vercel automatically detects the project. Do not configure a custom frontend build command (leave Build Command empty or standard).
6. **Deploy**: Click **Deploy**. Vercel will bundle the static files (`index.html`, `style.css`, `script.js`) and wire the Serverless Function at `api/index.js` via `vercel.json`.
7. **Open the Vercel URL**: Access your deployed application at `https://<your-project>.vercel.app`.
8. **GitHub Pages Warning**: **Do NOT use the GitHub Pages URL** (e.g. `https://<user>.github.io/<repo>/`) for the production application. GitHub Pages only hosts static files and lacks the Node.js/Express backend required to execute `/api/extract` and DNS intelligence.

### Vercel Serverless Architecture & Considerations:
- **Backend API Routing**: All requests to `/api/*` (including `POST /api/extract`, `GET /api/health`, `POST /api/company/analyze`, `POST /api/domain/verify`, `POST /api/dns/analyze`, and bulk endpoints) are routed directly to the Express backend via `api/index.js` and `vercel.json`.
- **Fast / Standard Single Extraction**: Single website intelligence scans execute smoothly within Vercel's execution window.
- **Headless Chromium & Tesseract OCR**: When deployed on Vercel Serverless, system-level Chromium binaries may not be installed in the serverless container. The MailScope engine includes automatic defensive fallbacks: if Playwright or Tesseract are unavailable, the crawler immediately falls back to high-performance Cheerio/Axios extraction and native document parsing without failing the scan.
- **Bulk Processing & Ephemeral Storage**: On Vercel, files are stored temporarily in `/tmp`. For long-running batch jobs involving thousands of URLs or background queues, running in a persistent container (such as Cloud Run, VPS, or Docker) or a local Node instance is recommended if jobs need to persist across function spin-downs.

---

## ⚙️ Environment Variables

| Variable | Description | Default |
| :--- | :--- | :--- |
| `PORT` | Web server listening port | `3000` |
| `BULK_CONCURRENCY` | Concurrent workers for bulk extraction jobs | `4` (Range: 1–10) |
| `ENABLE_PLAYWRIGHT` | Enable headless Chromium rendering fallback | `true` |
| `ENABLE_OCR` | Enable Tesseract OCR fallback for scanned PDFs | `true` |

---

## 📄 Responsible Use

MailScope is designed for legitimate business research, talent acquisition, partner discovery, and public Open-Source Intelligence (OSINT). Only query public endpoints and records you are authorized or permitted to access.
