-- UniAttend 0017 — remove campus live location sharing (added in 0013).
--
-- PERMANENTLY deletes every stored live position and every location-sharing
-- consent record, and the functions and settings behind them.
-- Kept from 0013: campus boundaries and my_next_classes() for "Find my class",
-- which uses the student's position only on their own phone and stores nothing.

drop function if exists uniattend.campus_live_locations(uuid);
drop function if exists uniattend.report_location(uuid, float8, float8, float8, boolean);
drop function if exists uniattend.stop_location_sharing(uuid);
drop function if exists uniattend.set_location_consent(uuid, boolean);

drop table if exists uniattend.live_locations;
drop table if exists uniattend.location_consents;

alter table uniattend.institution_settings
  drop column if exists location_sharing_enabled,
  drop column if exists location_interval_s;
