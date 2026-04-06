# Transaction Desk API — Integration Guide

Base URL: `https://manager-reports.onrender.com`

All endpoints require authentication via API key header.

---

## Authentication

Every request must include the API key:

```
Headers: { "x-api-key": "<your-key>" }
```

Or alternatively: `Authorization: Bearer <your-key>`

Rate limit: 100 requests per 15-minute window.

---

## Endpoints

### `GET /api/td/ping`
Test connectivity and authentication.

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2026-03-09T18:00:00.000Z",
  "service": "PCT Management Reports"
}
```

---

### `GET /api/td/rep/:repName`
Full metrics for a single sales rep.

**Parameters:**
| Param     | Type   | Required | Description                            |
|-----------|--------|----------|----------------------------------------|
| repName   | path   | Yes      | URL-encoded sales rep name             |
| month     | query  | No       | `YYYY-MM` format. Default: current month (Pacific time) |

**Example:**
```
GET /api/td/rep/Kevin%20Green?month=2026-02
```

**Response:**
```json
{
  "rep": "Kevin Green",
  "month": "2026-02",
  "yesterday": {
    "date": "2026-02-27",
    "closed": 2,
    "revenue": 1250.00,
    "opens": 3
  },
  "mtd": {
    "closed": 45,
    "revenue": 82500.00,
    "opens": 62,
    "purchase": { "count": 30, "revenue": 65000.00 },
    "refinance": { "count": 8, "revenue": 12000.00 },
    "escrow": { "count": 5, "revenue": 4500.00 },
    "tsg": { "count": 2, "revenue": 1000.00 }
  },
  "prior": {
    "month": "2026-01",
    "closed": 38,
    "revenue": 71000.00
  },
  "projected": 95000.00,
  "closingRatio": {
    "created": 200,
    "closed": 160,
    "ratio": 80.0,
    "window": "2025-10 to 2026-02"
  },
  "ranking": {
    "position": 3,
    "totalReps": 22
  },
  "workingDays": {
    "worked": 18,
    "total": 20,
    "remaining": 2
  }
}
```

---

### `GET /api/td/leaderboard`
All reps ranked by MTD revenue.

**Parameters:**
| Param  | Type   | Required | Description                            |
|--------|--------|----------|----------------------------------------|
| month  | query  | No       | `YYYY-MM` format. Default: current month |
| limit  | query  | No       | Max reps to return (1-50, default: 20)  |

**Example:**
```
GET /api/td/leaderboard?month=2026-02&limit=10
```

**Response:**
```json
{
  "month": "2026-02",
  "priorMonth": "2026-01",
  "totalReps": 10,
  "leaderboard": [
    {
      "rank": 1,
      "salesRep": "Kevin Green",
      "mtdClosed": 45,
      "mtdRevenue": 82500.00,
      "mtdOpens": 62,
      "priorRevenue": 71000.00,
      "purchaseCount": 30,
      "refiCount": 8,
      "escrowCount": 5,
      "tsgCount": 2
    }
  ]
}
```

---

### `GET /api/td/trends`
Monthly openings, closings, and revenue for current year + prior year.

**Parameters:**
| Param    | Type   | Required | Description                            |
|----------|--------|----------|----------------------------------------|
| repName  | query  | No       | Sales rep name. Omit for company-wide totals |

**Example:**
```
GET /api/td/trends?repName=Kevin%20Green
```

**Response:**
```json
{
  "currentYear": {
    "year": 2026,
    "months": [
      { "month": 1, "monthName": "January", "openings": 85, "closings": 62, "revenue": 98500.00 },
      { "month": 2, "monthName": "February", "openings": 90, "closings": 68, "revenue": 112000.00 }
    ]
  },
  "priorYear": {
    "year": 2025,
    "months": [
      { "month": 1, "monthName": "January", "openings": 78, "closings": 55, "revenue": 85000.00 }
    ]
  }
}
```

---

### `GET /api/td/production-history`
Monthly production with closing ratios for a specific year.

**Parameters:**
| Param    | Type   | Required | Description                            |
|----------|--------|----------|----------------------------------------|
| year     | query  | Yes      | 4-digit year (e.g. 2026)               |
| repName  | query  | No       | Sales rep name. Omit for company-wide  |

**Example:**
```
GET /api/td/production-history?year=2026&repName=Kevin%20Green
```

**Response:**
```json
{
  "year": 2026,
  "repName": "Kevin Green",
  "months": [
    { "month": 1, "monthName": "January", "openings": 12, "closings": 9, "revenue": 15000.00, "closingRatio": 75 },
    { "month": 2, "monthName": "February", "openings": 15, "closings": 11, "revenue": 18500.00, "closingRatio": 73 }
  ]
}
```

---

### `GET /api/td/closings`
Individual closed orders with file number, address, date, and revenue.

**Parameters:**
| Param    | Type   | Required | Description                            |
|----------|--------|----------|----------------------------------------|
| month    | query  | No       | Month number (1-12). Default: current month |
| year     | query  | No       | 4-digit year. Default: current year     |
| repName  | query  | No       | Sales rep name. Omit for all reps       |

**Example:**
```
GET /api/td/closings?month=2&year=2026&repName=Team%20Meza
```

**Response:**
```json
{
  "month": 2,
  "year": 2026,
  "repName": "Team Meza",
  "totalClosings": 45,
  "totalRevenue": 82500.00,
  "closings": [
    {
      "fileNumber": "20013657-GLT",
      "address": "123 Main St, Glendale CA 91201",
      "closedDate": "2026-02-28",
      "revenue": 609.00,
      "category": "Purchase",
      "salesRep": "Team Meza",
      "titleOfficer": "Eddie LasM..."
    }
  ]
}
```

---

### `GET /api/td/client-summary`
Client/company-level deal aggregation for a year, with repeat/new detection and monthly sparkline data.

**Parameters:**
| Param    | Type   | Required | Description                            |
|----------|--------|----------|----------------------------------------|
| year     | query  | Yes      | 4-digit year (e.g. 2026)               |
| repName  | query  | No       | Sales rep name. Omit for company-wide  |

**Example:**
```
GET /api/td/client-summary?year=2026&repName=Team%20Meza
```

**Response:**
```json
{
  "year": 2026,
  "repName": "Team Meza",
  "totals": {
    "totalClients": 85,
    "repeatClients": 32,
    "newClients": 53,
    "topClientRevenue": 18500.00,
    "avgDealsPerClient": 2.3,
    "totalRevenue": 425000.00,
    "totalDeals": 196
  },
  "clients": [
    {
      "clientName": "Paul Sepulveda",
      "companyName": "The Escrow Forum",
      "deals": 20,
      "revenue": 18500.00,
      "lastCloseDate": "2026-02-25",
      "firstDealDate": "2025-03-12",
      "isNewThisYear": false,
      "isRepeat": true,
      "monthlyDeals": [8, 12, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
    }
  ]
}
```

**Notes:**
- Clients are grouped by `main_contact` (ordering person) + `marketing_source` (company).
- `isNewThisYear` = first-ever deal with PCT started in the requested year.
- `isRepeat` = client also had deals in the prior year.
- `monthlyDeals` is a 12-element array (Jan–Dec) for sparkline charts.
- Sorted by revenue descending.

---

## Data Notes

- All monetary values are in USD, rounded to 2 decimal places.
- Default month is current month in **Pacific time**.
- "Yesterday" is always yesterday in Pacific time.
- Closing ratio uses a 4-month lookback window.
- Projected revenue = `(MTD revenue / worked days) × total working days in month`.
- Ranking position is 1-indexed (1 = top earner).

---

## Example Integration (Node.js)

```js
const API_BASE = 'https://manager-reports.onrender.com';
const API_KEY = process.env.PCT_API_KEY;

// Single rep
const res = await fetch(`${API_BASE}/api/td/rep/Kevin%20Green?month=2026-02`, {
  headers: { 'x-api-key': API_KEY }
});
const data = await res.json();

// Leaderboard
const board = await fetch(`${API_BASE}/api/td/leaderboard?month=2026-02`, {
  headers: { 'x-api-key': API_KEY }
});
const rankings = await board.json();

// Trends (company-wide)
const trends = await fetch(`${API_BASE}/api/td/trends`, {
  headers: { 'x-api-key': API_KEY }
});

// Production history for a rep
const prod = await fetch(`${API_BASE}/api/td/production-history?year=2026&repName=Kevin%20Green`, {
  headers: { 'x-api-key': API_KEY }
});

// Closings for a rep in a specific month
const closings = await fetch(`${API_BASE}/api/td/closings?month=2&year=2026&repName=Team%20Meza`, {
  headers: { 'x-api-key': API_KEY }
});

// Client summary — repeat/new clients with deal history
const clients = await fetch(`${API_BASE}/api/td/client-summary?year=2026&repName=Team%20Meza`, {
  headers: { 'x-api-key': API_KEY }
});
```

---

## Error Responses

| Status | Meaning |
|--------|---------|
| 401    | Missing or invalid API key |
| 429    | Rate limit exceeded (100 req / 15 min) |
| 500    | Internal server error — check `error` field in response |
