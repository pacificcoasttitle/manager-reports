'use client';

import { formatCurrency } from '../lib/api';

const CATEGORIES = ['Purchase', 'Refinance', 'Escrow', 'TSG'];
const BRANCHES = ['Glendale', 'Orange', 'Inland Empire', 'Porterville', 'TSG'];

export default function DailyRevenueReport({ data }) {
  if (!data || !data.report) return <p style={{ color: '#868e96', padding: '40px 0', textAlign: 'center' }}>No data available. Fetch this month first in Data Manager.</p>;

  const { report, grandTotal, dates } = data;

  return (
    <div style={{ width: '100%' }}>
      <div className="report-meta">
        <span><span className="label">Period:</span> {dates.selectedMonthLabel}</span>
        <span><span className="label">Today =</span> {dates.yesterday}</span>
        <span><span className="label">Prior:</span> {dates.priorMonthLabel}</span>
      </div>

      <div className="report-table-wrapper" style={{ overflowX: 'auto', width: '100%' }}>
        <table className="report-table" style={{ width: '100%', minWidth: '900px' }}>
          <thead>
            <tr>
              <th rowSpan={2} className="text-left" style={{ minWidth: '120px' }}>Branch / Type</th>
              <th colSpan={3} className="col-open" style={{ textAlign: 'center' }}>Open Orders</th>
              <th colSpan={3} className="col-closed" style={{ textAlign: 'center' }}>Closed Orders</th>
              <th colSpan={3} className="col-revenue" style={{ textAlign: 'center' }}>Revenue</th>
            </tr>
            <tr>
              <th className="col-open">Today</th><th className="col-open">MTD</th><th className="col-open">Prior</th>
              <th className="col-closed">Today</th><th className="col-closed">MTD</th><th className="col-closed">Prior</th>
              <th className="col-revenue">Today</th><th className="col-revenue">MTD</th><th className="col-revenue">Prior</th>
            </tr>
          </thead>
          <tbody>
            {BRANCHES.map(branch => {
              const bd = report[branch];
              if (!bd) return null;
              return <BranchSection key={branch} branch={branch} data={bd} />;
            })}
            <tr className="grand-total-row">
              <td className="text-left">GRAND TOTAL</td>
              <td>{grandTotal.today_open || ''}</td><td>{grandTotal.mtd_open || ''}</td><td>{grandTotal.prior_open || ''}</td>
              <td>{grandTotal.today_closed || ''}</td><td>{grandTotal.mtd_closed || ''}</td><td>{grandTotal.prior_closed || ''}</td>
              <td>{grandTotal.today_rev ? formatCurrency(grandTotal.today_rev) : ''}</td>
              <td>{formatCurrency(grandTotal.mtd_rev)}</td>
              <td>{formatCurrency(grandTotal.prior_rev)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function BranchSection({ branch, data }) {
  const t = data.totals;
  return (
    <>
      <tr className="branch-header"><td colSpan={10}>{branch}</td></tr>
      {CATEGORIES.map(cat => {
        const d = data[cat];
        if (!d) return null;
        return (
          <tr key={`${branch}-${cat}`}>
            <td className="text-left" style={{ paddingLeft: '24px' }}>{cat}</td>
            <td>{d.today_open || ''}</td><td>{d.mtd_open || ''}</td><td>{d.prior_open || ''}</td>
            <td>{d.today_closed || ''}</td><td>{d.mtd_closed || ''}</td><td>{d.prior_closed || ''}</td>
            <td>{d.today_rev ? formatCurrency(d.today_rev) : ''}</td>
            <td>{d.mtd_rev ? formatCurrency(d.mtd_rev) : ''}</td>
            <td>{d.prior_rev ? formatCurrency(d.prior_rev) : ''}</td>
          </tr>
        );
      })}
      <tr className="subtotal-row">
        <td className="text-left" style={{ paddingLeft: '16px' }}>{branch} Total</td>
        <td>{t.today_open || ''}</td><td>{t.mtd_open || ''}</td><td>{t.prior_open || ''}</td>
        <td>{t.today_closed || ''}</td><td>{t.mtd_closed || ''}</td><td>{t.prior_closed || ''}</td>
        <td>{t.today_rev ? formatCurrency(t.today_rev) : ''}</td>
        <td>{t.mtd_rev ? formatCurrency(t.mtd_rev) : ''}</td>
        <td>{t.prior_rev ? formatCurrency(t.prior_rev) : ''}</td>
      </tr>
    </>
  );
}
