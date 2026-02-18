-- ============================================
-- PCT Management Reports - Database Schema
-- ============================================

-- Raw line items from SoftPro API (one row per bill code per order)
CREATE TABLE IF NOT EXISTS revenue_line_items (
    id SERIAL PRIMARY KEY,
    file_number VARCHAR(50) NOT NULL,          -- [Number] e.g. "20006993-OCT"
    transaction_date DATE,                      -- [TransactionDate]
    bill_code VARCHAR(20) NOT NULL,            -- [BillCode] e.g. TPC, TPW, ESC, TSGW, UPRE
    bill_code_category TEXT,                   -- [BillCodeCategory]
    charge_description TEXT,                   -- [ChargeDescription]
    sum_amount DECIMAL(12,2) NOT NULL DEFAULT 0, -- [SumAmount]
    sales_rep TEXT,                             -- [SalesRep]
    title_officer TEXT,                         -- [TitleOfficerName]
    escrow_officer TEXT,                        -- [EscrowOfficerName]
    order_type TEXT,                            -- [OrderType] "Title only", "Title & Escrow", "Trustee Sale Guarantee"
    trans_type VARCHAR(50),                    -- [TransType] "Purchase", "Refinance", "Other"
    title_office TEXT,                          -- [TitleOffice]
    escrow_office TEXT,                         -- [EscrowOffice]
    property_type TEXT,                         -- [PropertyType]
    county TEXT,                                -- [County]
    city TEXT,                                  -- [City]
    state VARCHAR(10),                         -- [PropState]
    zip VARCHAR(20),                           -- [Zip]
    address TEXT,                               -- [Address1]
    full_address TEXT,                          -- [FullAddress]
    marketing_source TEXT,                      -- [MarketingSource]
    main_contact TEXT,                          -- [MainContact]
    underwriter TEXT,                           -- [Underwriter]
    disbursement_date DATE,                    -- [DisbursementDate]
    escrow_closed_date DATE,                   -- [EscrowClosedDate]
    received_date DATE,                        -- [ReceivedDate]
    fetch_month VARCHAR(7) NOT NULL,           -- YYYY-MM of the API call that fetched this
    created_at TIMESTAMP DEFAULT NOW()
);

-- Aggregated order-level summary (one row per unique file number per month)
CREATE TABLE IF NOT EXISTS order_summary (
    id SERIAL PRIMARY KEY,
    file_number VARCHAR(50) NOT NULL,
    branch VARCHAR(30) NOT NULL,               -- Glendale, Orange, Inland Empire, Porterville, TSG, Unknown
    order_type TEXT,                            -- Title only, Title & Escrow, Trustee Sale Guarantee
    trans_type VARCHAR(50),                    -- Purchase, Refinance, Other
    category VARCHAR(30) NOT NULL,             -- Purchase, Refinance, Escrow, TSG
    sales_rep TEXT,
    title_officer TEXT,
    escrow_officer TEXT,
    
    -- Revenue by bill code type
    title_revenue DECIMAL(12,2) DEFAULT 0,     -- TPC + TPW
    escrow_revenue DECIMAL(12,2) DEFAULT 0,    -- ESC
    tsg_revenue DECIMAL(12,2) DEFAULT 0,       -- TSGW
    underwriter_revenue DECIMAL(12,2) DEFAULT 0, -- UPRE
    total_revenue DECIMAL(12,2) DEFAULT 0,     -- Sum of all above
    
    -- Dates
    transaction_date DATE,                     -- When revenue was recognized
    received_date DATE,                        -- When order was opened/received
    disbursement_date DATE,
    escrow_closed_date DATE,
    
    -- Metadata
    fetch_month VARCHAR(7) NOT NULL,           -- YYYY-MM
    line_item_count INT DEFAULT 0,             -- How many line items made up this order
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    
    UNIQUE(file_number, fetch_month)
);

-- Open orders from SoftPro Excel exports (orders opened but not necessarily closed)
CREATE TABLE IF NOT EXISTS open_orders (
    id SERIAL PRIMARY KEY,
    file_number VARCHAR(50) NOT NULL,
    received_date DATE,
    settlement_date DATE,
    trans_type VARCHAR(50),
    order_type TEXT,
    product_type TEXT,
    profile TEXT,
    branch VARCHAR(30) NOT NULL,
    category VARCHAR(30),
    sales_rep TEXT,
    title_officer TEXT,
    escrow_officer TEXT,
    escrow_assistant TEXT,
    marketing_source TEXT,
    main_contact TEXT,
    open_month VARCHAR(7) NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(file_number, open_month)
);

-- Title officer → home branch mapping (for Title Officer Production report)
CREATE TABLE IF NOT EXISTS title_officer_branches (
    id SERIAL PRIMARY KEY,
    officer_name VARCHAR(150) NOT NULL UNIQUE,
    branch VARCHAR(30) NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW()
);

INSERT INTO title_officer_branches (officer_name, branch) VALUES
  ('Jim Jean', 'Orange'),
  ('Clive Virata', 'Orange'),
  ('Eddie Las Marias', 'Glendale'),
  ('Rachel Barcena', 'Glendale'),
  ('Susan Dana', 'TSG')
ON CONFLICT (officer_name) DO NOTHING;

-- Track which months have been fetched
CREATE TABLE IF NOT EXISTS fetch_log (
    id SERIAL PRIMARY KEY,
    fetch_month VARCHAR(7) NOT NULL,           -- YYYY-MM
    records_fetched INT DEFAULT 0,
    unique_orders INT DEFAULT 0,
    total_revenue DECIMAL(14,2) DEFAULT 0,
    status VARCHAR(20) DEFAULT 'success',      -- success, error, partial
    error_message TEXT,
    fetched_at TIMESTAMP DEFAULT NOW(),
    duration_ms INT
);

-- Indexes for report queries
CREATE INDEX IF NOT EXISTS idx_order_summary_branch ON order_summary(branch);
CREATE INDEX IF NOT EXISTS idx_order_summary_category ON order_summary(category);
CREATE INDEX IF NOT EXISTS idx_order_summary_sales_rep ON order_summary(sales_rep);
CREATE INDEX IF NOT EXISTS idx_order_summary_title_officer ON order_summary(title_officer);
CREATE INDEX IF NOT EXISTS idx_order_summary_fetch_month ON order_summary(fetch_month);
CREATE INDEX IF NOT EXISTS idx_order_summary_transaction_date ON order_summary(transaction_date);
CREATE INDEX IF NOT EXISTS idx_order_summary_received_date ON order_summary(received_date);
CREATE INDEX IF NOT EXISTS idx_revenue_line_items_file_number ON revenue_line_items(file_number);
CREATE INDEX IF NOT EXISTS idx_revenue_line_items_fetch_month ON revenue_line_items(fetch_month);
CREATE INDEX IF NOT EXISTS idx_revenue_line_items_bill_code ON revenue_line_items(bill_code);

-- Open orders indexes
CREATE INDEX IF NOT EXISTS idx_open_orders_branch ON open_orders(branch);
CREATE INDEX IF NOT EXISTS idx_open_orders_sales_rep ON open_orders(sales_rep);
CREATE INDEX IF NOT EXISTS idx_open_orders_title_officer ON open_orders(title_officer);
CREATE INDEX IF NOT EXISTS idx_open_orders_open_month ON open_orders(open_month);
CREATE INDEX IF NOT EXISTS idx_open_orders_received_date ON open_orders(received_date);
CREATE INDEX IF NOT EXISTS idx_open_orders_category ON open_orders(category);
