-- Existing tickets retain their legacy workflow until explicitly initialized.
ALTER TABLE tickets ADD COLUMN workflow_json TEXT;
