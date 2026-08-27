-- 0023_email_imports_matched_members.sql
-- Adds the matched_members column that routes/gmail.js stores on every
-- successful CAS email import (JSON array of {memberId, memberName, pan,
-- matchedBy, count}). Without this column the upsert in autoImportCASForUser
-- fails silently, emails never get status='success', and the cron re-processes
-- every email on every run (infinite re-import loop).

ALTER TABLE email_imports
  ADD COLUMN IF NOT EXISTS matched_members text;   -- JSON: [{memberId, memberName, pan, matchedBy, count}]

-- Back-fill processed_at for any rows that already exist (upsert default
-- only fires on INSERT; rows stuck as 'pending' get the correct time now).
UPDATE email_imports
  SET processed_at = now()
  WHERE processed_at IS NULL;
