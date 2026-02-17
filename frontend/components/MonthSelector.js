'use client';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

export default function MonthSelector({ month, year, onChange }) {
  const currentYear = new Date().getFullYear();
  const years = [];
  for (let y = currentYear; y >= currentYear - 3; y--) {
    years.push(y);
  }

  return (
    <div className="flex items-center gap-3">
      <select
        value={month}
        onChange={(e) => onChange(parseInt(e.target.value), year)}
        className="px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        {MONTHS.map((name, i) => (
          <option key={i} value={i + 1}>{name}</option>
        ))}
      </select>

      <select
        value={year}
        onChange={(e) => onChange(month, parseInt(e.target.value))}
        className="px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        {years.map((y) => (
          <option key={y} value={y}>{y}</option>
        ))}
      </select>
    </div>
  );
}
