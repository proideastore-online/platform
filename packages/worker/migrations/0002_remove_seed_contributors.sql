DELETE FROM interest_signals
WHERE profile_id IN (
  'profile-diligence-lead',
  'profile-builder-scout',
  'profile-investor-reader'
)
OR profile_id IN (SELECT id FROM profiles WHERE handle IN ('diligence-lead', 'builder-scout', 'investor-reader', 'cloudflare-smoke'));

DELETE FROM diligence_notes
WHERE profile_id IN (
  'profile-diligence-lead',
  'profile-builder-scout',
  'profile-investor-reader'
)
OR profile_id IN (SELECT id FROM profiles WHERE handle IN ('diligence-lead', 'builder-scout', 'investor-reader', 'cloudflare-smoke'));

DELETE FROM profiles
WHERE id IN (
  'profile-diligence-lead',
  'profile-builder-scout',
  'profile-investor-reader'
)
OR handle IN ('diligence-lead', 'builder-scout', 'investor-reader', 'cloudflare-smoke');
