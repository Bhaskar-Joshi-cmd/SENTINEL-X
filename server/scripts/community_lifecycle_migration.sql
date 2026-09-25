-- CascadeGuard community report lifecycle migration (locked hierarchy amendment).
-- Run once in Supabase SQL Editor.
-- Vocabulary: submitted, field_confirmed, not_confirmed, corroborated, verified, rejected
-- (legacy 'pending' reads as submitted; legacy 'verified' unchanged).
-- station_id stays nullable: non-river reports (landslide/road-block) carry no station.

-- REQUIRED for the lifecycle to work: the original constraint predates
-- field_confirmed / not_confirmed / corroborated, so the Community Manager
-- field-confirm and Village Authority corroborate steps fail with a raw
-- 23514 check-constraint error until this is applied.
-- Optional audit before applying:
--   SELECT DISTINCT verification_status FROM community_reports;
ALTER TABLE community_reports
DROP CONSTRAINT IF EXISTS community_reports_verification_status_check;

ALTER TABLE community_reports
ADD CONSTRAINT community_reports_verification_status_check
CHECK (
    verification_status IN (
        'pending',        -- legacy alias of submitted
        'submitted',
        'field_confirmed',
        'not_confirmed',
        'corroborated',
        'verified',
        'rejected',
        'incorporated'    -- legacy rows only; never written as a human state
    )
);

ALTER TABLE community_reports
ADD COLUMN IF NOT EXISTS station_id UUID REFERENCES hydro_stations(id) ON DELETE SET NULL;

ALTER TABLE user_profiles
DROP CONSTRAINT IF EXISTS user_profiles_role_check;

ALTER TABLE user_profiles
ADD CONSTRAINT user_profiles_role_check
CHECK (
    role IN (
        'admin',
        'control_room',
        'disaster_authority',
        'village_authority',
        'community_manager',
        'community_member',
        'observer'
    )
);

CREATE INDEX IF NOT EXISTS idx_community_reports_station_time
ON community_reports (station_id, submitted_at DESC);

CREATE INDEX IF NOT EXISTS idx_community_reports_village_time
ON community_reports (village_id, submitted_at DESC);

CREATE INDEX IF NOT EXISTS idx_community_reports_reporter
ON community_reports (reporter_user_id);


CREATE INDEX IF NOT EXISTS idx_community_reports_submitted_at
ON community_reports (submitted_at DESC);
-- Note: alerts need no schema change for the Disaster Authority decision.
-- The alerts_status_check vocabulary already carries the terminal refusal
-- state 'cancelled', which the reject route writes while recording the
-- audit action 'rejected' in alert_approvals.

