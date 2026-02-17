'use client';

import { formatCurrency } from '../lib/api';

const CATEGORIES = ['Purchase', 'Refinance', 'Escrow', 'TSG'];
const BRANCHES = ['Glendale', 'Orange', 'Inland Empire', 'Porterville', 'TSG'];

export default function DailyRevenueReport({ data }) {
  if (!data || !data.report) return <p className="text-gray-500 p-4">No data available.</p>;

  const { report, grandTotal, dates } = data;

  return (
    <div className="overflow-x-auto">
      <div className="mb-3 text-sm text-gray-600">
        <span className="font-medium">Period:</span> {dates.selectedMonthLabel} &nbsp;|&nbsp;
        <span className="font-medium">Today = </span>{dates.yesterday} &nbsp;|&nbsp;
        <span className="font-medium">Prior:</span> {dates.priorMonthLabel} &nbsp;|&nbsp;
        <span className="font-medium">Working Days:</span> {dates.workedDays} worked / {dates.totalWorkingDays} total / {dates.remainingWorkingDays} remaining
      </div>

      <table className="report-table">
        <thead>
          <tr>
            <th rowSpan={2} className="w-32">Branch / Type</th>
            <th colSpan={3} className="text-center bg-green-700">Open Orders</th>
            <th colSpan={3} className="text-center bg-blue-700">Closed Orders</th>
            <th colSpan={3} className="text-center bg-purple-700">Revenue</th>
          </tr>
          <tr>
            <th className="bg-green-700">Today</th>
            <th className="bg-green-700">MTD</th>
            <th className="bg-green-700">Prior</th>
            <th className="bg-blue-700">Today</th>
            <th className="bg-blue-700">MTD</th>
            <th className="bg-blue-700">Prior</th>
            <th className="bg-purple-700">Today</th>
            <th className="bg-purple-700">MTD</th>
            <th className="bg-purple-700">Prior</th>
          </tr>
        </thead>
        <tbody>
          {BRANCHES.map((branch) => {
            const branchData = report[branch];
            if (!branchData) return null;

            return (
              <BranchSection
                key={branch}
                branch={branch}
                data={branchData}
              />
            );
          })}

          {/* Grand Total */}
          <tr className="grand-total-row">
            <td className="text-left font-bold">GRAND TOTAL</td>
            <td>{grandTotal.today_open}</td>
            <td>{grandTotal.mtd_open}</td>
            <td>{grandTotal.prior_open}</td>
            <td>{grandTotal.today_closed}</td>
            <td>{grandTotal.mtd_closed}</td>
            <td>{grandTotal.prior_closed}</td>
            <td>{formatCurrency(grandTotal.today_rev)}</td>
            <td>{formatCurrency(grandTotal.mtd_rev)}</td>
            <td>{formatCurrency(grandTotal.prior_rev)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function BranchSection({ branch, data }) {
  const totals = data.totals;

  return (
    <>
      <tr>
        <td colSpan={10} className="branch-header">{branch}</td>
      </tr>
      {CATEGORIES.map((cat) => {
        const d = data[cat];
        if (!d) return null;
        const hasData = d.today_open || d.mtd_open || d.prior_open ||
          d.today_closed || d.mtd_closed || d.prior_closed;
        
        return (
          <tr key={`${branch}-${cat}`}>
            <td className="text-left pl-6">{cat}</td>
            <td>{d.today_open || ''}</td>
            <td>{d.mtd_open || ''}</td>
            <td>{d.prior_open || ''}</td>
            <td>{d.today_closed || ''}</td>
            <td>{d.mtd_closed || ''}</td>
            <td>{d.prior_closed || ''}</td>
            <td>{d.today_rev ? formatCurrency(d.today_rev) : ''}</td>
            <td>{d.mtd_rev ? formatCurrency(d.mtd_rev) : ''}</td>
            <td>{d.prior_rev ? formatCurrency(d.prior_rev) : ''}</td>
          </tr>
        );
      })}
      <tr className="subtotal-row">
        <td className="text-left pl-4">{branch} Total</td>
        <td>{totals.today_open || ''}</td>
        <td>{totals.mtd_open || ''}</td>
        <td>{totals.prior_open || ''}</td>
        <td>{totals.today_closed || ''}</td>
        <td>{totals.mtd_closed || ''}</td>
        <td>{totals.prior_closed || ''}</td>
        <td>{totals.today_rev ? formatCurrency(totals.today_rev) : ''}</td>
        <td>{totals.mtd_rev ? formatCurrency(totals.mtd_rev) : ''}</td>
        <td>{totals.prior_rev ? formatCurrency(totals.prior_rev) : ''}</td>
      </tr>
    </>
  );
}
