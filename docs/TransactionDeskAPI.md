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
```

---

## Error Responses

| Status | Meaning |
|--------|---------|
| 401    | Missing or invalid API key |
| 429    | Rate limit exceeded (100 req / 15 min) |
| 500    | Internal server error — check `error` field in response |
