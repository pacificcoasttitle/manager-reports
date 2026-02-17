const dayjs = require('dayjs');

// ============================================
// BRANCH DETECTION
// ============================================
// File numbers: "20006993-OCT", "20011035-GLT", "99100688" (TSG)
// Branch suffix is AFTER the hyphen

const BRANCH_MAP = {
  'GLT': 'Glendale',
  'OCT': 'Orange',
  'ONT': 'Inland Empire',
  'PRV': 'Porterville'
};

function getBranch(fileNumber) {
  if (!fileNumber) return 'Unknown';
  
  // Check for TSG pattern: starts with 99 and no hyphen suffix
  if (fileNumber.startsWith('99') && !fileNumber.includes('-')) {
    return 'TSG';
  }
  
  // Extract suffix after last hyphen
  const parts = fileNumber.split('-');
  if (parts.length >= 2) {
    const suffix = parts[parts.length - 1].toUpperCase();
    if (BRANCH_MAP[suffix]) return BRANCH_MAP[suffix];
  }
  
  return 'Unknown';
}

// ============================================
// ORDER CATEGORIZATION
// ============================================
// OrderType values: "Title only", "Title & Escrow", "Trustee Sale Guarantee"
// TransType values: "Purchase", "Refinance", "Other"

function categorizeOrder(orderType, transType) {
  if (!orderType) return 'Unknown';
  
  const ot = orderType.toLowerCase().trim();
  
  if (ot === 'trustee sale guarantee') return 'TSG';
  if (ot === 'title & escrow') return 'Escrow';
  if (ot === 'title only') {
    const tt = (transType || '').toLowerCase().trim();
    if (tt === 'purchase') return 'Purchase';
    if (tt === 'refinance') return 'Refinance';
    return 'Other';
  }
  
  return 'Unknown';
}

// For Title Officer report: only Purchase and Refinance
function categorizeForTitleOfficer(orderType, transType) {
  const cat = categorizeOrder(orderType, transType);
  if (cat === 'Purchase' || cat === 'Refinance') return cat;
  return null; // Not a title officer order
}

// For Escrow report: only Escrow (Title & Escrow)
function categorizeForEscrow(orderType) {
  if (!orderType) return null;
  if (orderType.toLowerCase().trim() === 'title & escrow') return 'Escrow';
  return null;
}

// ============================================
// BILL CODE FILTERING & REVENUE CLASSIFICATION
// ============================================

const VALID_BILL_CODES = ['TPC', 'TPW', 'ESC', 'TSGW', 'UPRE'];

function isValidBillCode(billCode) {
  return VALID_BILL_CODES.includes((billCode || '').toUpperCase().trim());
}

function classifyRevenue(billCode) {
  const bc = (billCode || '').toUpperCase().trim();
  switch (bc) {
    case 'TPC':
    case 'TPW':
      return 'title';
    case 'ESC':
      return 'escrow';
    case 'TSGW':
      return 'tsg';
    case 'UPRE':
      return 'underwriter';
    default:
      return null;
  }
}

// ============================================
// DATE UTILITIES
// ============================================

function getDateParams(month, year) {
  const selectedMonth = dayjs(`${year}-${String(month).padStart(2, '0')}-01`);
  const today = dayjs();
  const isCurrentMonth = selectedMonth.month() === today.month() && selectedMonth.year() === today.year();
  
  // "Today" means yesterday in the existing system
  const yesterday = today.subtract(1, 'day');
  
  // MTD: 1st of selected month through yesterday (if current month) or end of month
  const mtdStart = selectedMonth.startOf('month');
  const mtdEnd = isCurrentMonth ? yesterday : selectedMonth.endOf('month');
  
  // Prior month
  const priorMonth = selectedMonth.subtract(1, 'month');
  const priorStart = priorMonth.startOf('month');
  const priorEnd = priorMonth.endOf('month');
  
  // Closing ratio window: 3 months back from selected month
  const closingRatioStart = selectedMonth.subtract(3, 'month').startOf('month');
  const closingRatioEnd = mtdEnd;
  
  // Working days calculation
  const workedDays = countWorkingDays(mtdStart, isCurrentMonth ? yesterday : mtdEnd);
  const totalWorkingDays = countWorkingDays(mtdStart, selectedMonth.endOf('month'));
  const remainingWorkingDays = totalWorkingDays - workedDays;
  
  return {
    isCurrentMonth,
    yesterday: yesterday.format('YYYY-MM-DD'),
    mtdStart: mtdStart.format('YYYY-MM-DD'),
    mtdEnd: mtdEnd.format('YYYY-MM-DD'),
    priorStart: priorStart.format('YYYY-MM-DD'),
    priorEnd: priorEnd.format('YYYY-MM-DD'),
    priorMonthLabel: priorMonth.format('MMMM YYYY'),
    closingRatioStart: closingRatioStart.format('YYYY-MM-DD'),
    closingRatioEnd: closingRatioEnd.format('YYYY-MM-DD'),
    workedDays,
    totalWorkingDays,
    remainingWorkingDays,
    selectedMonthLabel: selectedMonth.format('MMMM YYYY')
  };
}

function countWorkingDays(start, end) {
  let count = 0;
  let current = dayjs(start);
  const endDate = dayjs(end);
  
  while (current.isBefore(endDate) || current.isSame(endDate, 'day')) {
    const dow = current.day();
    if (dow !== 0 && dow !== 6) count++; // Skip weekends
    current = current.add(1, 'day');
  }
  return count;
}

// ============================================
// AGGREGATION HELPERS
// ============================================

function aggregateLineItems(lineItems) {
  const orders = {};
  
  for (const item of lineItems) {
    const fileNumber = item.file_number;
    
    if (!orders[fileNumber]) {
      orders[fileNumber] = {
        file_number: fileNumber,
        branch: getBranch(fileNumber),
        order_type: item.order_type,
        trans_type: item.trans_type,
        category: categorizeOrder(item.order_type, item.trans_type),
        sales_rep: item.sales_rep,
        title_officer: item.title_officer,
        escrow_officer: item.escrow_officer,
        title_revenue: 0,
        escrow_revenue: 0,
        tsg_revenue: 0,
        underwriter_revenue: 0,
        total_revenue: 0,
        transaction_date: item.transaction_date,
        received_date: item.received_date,
        disbursement_date: item.disbursement_date,
        escrow_closed_date: item.escrow_closed_date,
        line_item_count: 0
      };
    }
    
    const order = orders[fileNumber];
    const revenueType = classifyRevenue(item.bill_code);
    const amount = parseFloat(item.sum_amount) || 0;
    
    if (revenueType === 'title') order.title_revenue += amount;
    else if (revenueType === 'escrow') order.escrow_revenue += amount;
    else if (revenueType === 'tsg') order.tsg_revenue += amount;
    else if (revenueType === 'underwriter') order.underwriter_revenue += amount;
    
    order.total_revenue = order.title_revenue + order.escrow_revenue + order.tsg_revenue + order.underwriter_revenue;
    order.line_item_count++;
  }
  
  return Object.values(orders);
}

module.exports = {
  getBranch,
  categorizeOrder,
  categorizeForTitleOfficer,
  categorizeForEscrow,
  isValidBillCode,
  classifyRevenue,
  getDateParams,
  countWorkingDays,
  aggregateLineItems,
  VALID_BILL_CODES,
  BRANCH_MAP
};
