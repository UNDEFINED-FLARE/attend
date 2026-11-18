// The newest database migration this build of the app expects. /api/health reports
// "degraded" when the database is behind it, so a deploy that needs a migration that
// was never run shows up on the uptime monitor. A unit test keeps it equal to the
// newest file in supabase/migrations.
export const EXPECTED_SCHEMA = "20261118000037";
