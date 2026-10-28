BEGIN;

CREATE TABLE IF NOT EXISTS daily_excel_recipients (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(200) NOT NULL UNIQUE,
  role VARCHAR(20) NOT NULL DEFAULT 'to',
  is_active BOOLEAN DEFAULT true
);

INSERT INTO daily_excel_recipients (name, email, role) VALUES
  ('Al', 'Al@pct.com', 'to'),
  ('Rudy', 'Rudy@pct.com', 'to'),
  ('H. Aguilar', 'Haguilar@pct.com', 'to'),
  ('B. Heethuis', 'Bheethuis@pct.com', 'to'),
  ('Jerry', 'ghernandez@pct.com', 'cc')
ON CONFLICT (email) DO NOTHING;

INSERT INTO app_settings (key, value)
VALUES ('daily_excel_enabled', 'false')
ON CONFLICT (key) DO NOTHING;

COMMIT;
