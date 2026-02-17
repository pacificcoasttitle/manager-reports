# PCT Management Reports

Standalone reporting system for Pacific Coast Title management reports. Built to replace the buggy dual-controller system with clean, correct report generation directly from SoftPro API data.

## Architecture

```
SoftPro API → Backend (Node/Express) → PostgreSQL → Report API → React Frontend
```

## Reports

1. **Daily Revenue** — Branch-level open/closed/revenue by order type
2. **R-14 Branches** — Sales rep closed orders & revenue by branch
3. **R-14 Ranking** — Flat ranking of all sales reps by MTD revenue
4. **Title Officer Production** — Title officer closed orders (Purchase & Refi only)
5. **Escrow Production** — Escrow orders by sales rep by branch

## Setup

### 1. Install dependencies
```bash
npm install
```

### 2. Configure environment
```bash
cp .env.example .env
# Edit .env with your Render Postgres connection string
```

### 3. Set up database
```bash
npm run db:setup
```

### 4. Fetch data from SoftPro
```bash
# Single month
npm run fetch -- 2026-02

# Backfill range
npm run fetch:backfill -- 2025-01 2026-02
```

### 5. Start the server
```bash
npm start       # Production
npm run dev     # Development with auto-reload
```

## API Endpoints

### Data Management
- `POST /api/fetch/:yearMonth` — Fetch & store a month from SoftPro
- `GET /api/months` — List available months
- `GET /api/fetch-log` — Fetch history

### Reports
- `GET /api/reports/daily-revenue?month=2&year=2026`
- `GET /api/reports/r14-branches?month=2&year=2026`
- `GET /api/reports/r14-ranking?month=2&year=2026`
- `GET /api/reports/title-officer?month=2&year=2026`
- `GET /api/reports/escrow-production?month=2&year=2026`

### Data Explorer
- `GET /api/orders/:fileNumber` — Raw line items + summary for an order
- `GET /api/stats/:yearMonth` — Summary stats for a month

## Business Logic

### Branch Detection (from file number suffix)
| Pattern | Branch |
|---------|--------|
| `XXXXXXXX-GLT` | Glendale |
| `XXXXXXXX-OCT` | Orange |
| `XXXXXXXX-ONT` | Inland Empire |
| `XXXXXXXX-PRV` | Porterville |
| `99XXXXXX` | TSG |

### Order Categorization
| OrderType | TransType | Category |
|-----------|-----------|----------|
| Title only | Purchase | Purchase |
| Title only | Refinance | Refinance |
| Title & Escrow | Any | Escrow |
| Trustee Sale Guarantee | Any | TSG |

### Bill Code Revenue Classification
| Code | Type | Description |
|------|------|-------------|
| TPC | Title | Title Premium Commonwealth |
| TPW | Title | Title Premium Westcor |
| ESC | Escrow | Escrow Fees |
| TSGW | TSG | Trustee Sale Guarantee Westcor |
| UPRE | Underwriter | UW Title Premiums |
