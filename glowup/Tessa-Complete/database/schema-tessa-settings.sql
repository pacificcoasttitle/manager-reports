-- Tessa question history
CREATE TABLE IF NOT EXISTS tessa_questions (
    id SERIAL PRIMARY KEY,
    question TEXT NOT NULL,
    sql_generated TEXT,
    explanation TEXT,
    row_count INT DEFAULT 0,
    success BOOLEAN DEFAULT true,
    duration_ms INT,
    is_saved BOOLEAN DEFAULT false,
    category VARCHAR(20),
    asked_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_tessa_questions_asked_at ON tessa_questions(asked_at);
CREATE INDEX idx_tessa_questions_is_saved ON tessa_questions(is_saved);

-- Email settings
CREATE TABLE IF NOT EXISTS email_settings (
    id SERIAL PRIMARY KEY,
    sendgrid_api_key VARCHAR(255),
    from_email VARCHAR(255) DEFAULT 'reports@pacificcoasttitle.com',
    from_name VARCHAR(100) DEFAULT 'PCT Reports',
    schedule_time VARCHAR(10) DEFAULT '07:00',
    schedule_timezone VARCHAR(50) DEFAULT 'America/Los_Angeles',
    is_active BOOLEAN DEFAULT false,
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Email recipients
CREATE TABLE IF NOT EXISTS email_recipients (
    id SERIAL PRIMARY KEY,
    name VARCHAR(150) NOT NULL,
    email VARCHAR(255) NOT NULL,
    reports JSONB DEFAULT '["daily-revenue","r14-ranking"]',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW()
);

-- App settings
CREATE TABLE IF NOT EXISTS app_settings (
    key VARCHAR(100) PRIMARY KEY,
    value TEXT,
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Insert defaults
INSERT INTO app_settings (key, value) VALUES ('show_kpi_cards', 'true') ON CONFLICT DO NOTHING;
INSERT INTO email_settings (id, is_active) VALUES (1, false) ON CONFLICT DO NOTHING;
