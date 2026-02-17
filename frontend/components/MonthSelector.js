'use client';

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

export default function MonthSelector({ month, year, onChange }) {
  const currentYear = new Date().getFullYear();
  const years = [];
  for (let y = currentYear; y >= currentYear - 3; y--) years.push(y);

  return (
    <div className="month-selector" style={{ display: 'flex', gap: '8px' }}>
      <select value={month} onChange={(e) => onChange(parseInt(e.target.value), year)}>
        {MONTHS.map((name, i) => (
          <option key={i} value={i + 1}>{name}</option>
        ))}
      </select>
      <select value={year} onChange={(e) => onChange(month, parseInt(e.target.value))}>
        {years.map(y => <option key={y} value={y}>{y}</option>)}
      </select>
    </div>
  );
}
