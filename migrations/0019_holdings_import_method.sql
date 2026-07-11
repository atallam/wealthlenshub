-- Add import_method column to distinguish how holdings were imported
-- Values: 'manual_upload' (UI file import), 'gmail_auto' (cron CAS email), null (legacy / manual entry)
ALTER TABLE holdings ADD COLUMN IF NOT EXISTS import_method text;
