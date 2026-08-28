-- 0026: Add is_essential flag to budget_categories
-- Marks categories as Essential (needs) vs Discretionary (wants) for spending analysis
ALTER TABLE budget_categories ADD COLUMN IF NOT EXISTS is_essential BOOLEAN NOT NULL DEFAULT FALSE;
COMMENT ON COLUMN budget_categories.is_essential IS 'True = essential/needs spend, False = discretionary/wants spend';
