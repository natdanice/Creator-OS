-- The bundle's description hardcoded "save 8,000", which went stale as soon as a component price changed.
-- Only the untouched seed text is replaced: a description the creator edited is left alone.
UPDATE rate_card
SET description = 'TikTok + IG Reel + YouTube Integration (ราคาแพ็กเกจพิเศษ)'
WHERE code = 'BUNDLE_3P' AND description = 'TikTok + IG Reel + YouTube Integration (ประหยัดกว่าแยก 8,000)';
