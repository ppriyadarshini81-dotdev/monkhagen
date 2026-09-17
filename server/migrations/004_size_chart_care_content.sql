-- Populate only unconfigured shared fields. Future administrator edits are preserved.
UPDATE product_page_content
SET size_chart_image_url = CASE WHEN size_chart_image_url = '' THEN
  'https://pub-72df2dffccc643c59aebafe55e835d7b.r2.dev/Size/monk_hagen_size_chart_under_150kb.webp'
  ELSE size_chart_image_url END,
  care_instructions = CASE WHEN care_instructions = '' THEN
  E'Machine wash cold or at 30°C\nWash inside out\nWash with similar colours\nDo not bleach\nDo not soak for prolonged periods\nAvoid direct ironing on the print'
  ELSE care_instructions END,
  updated_at = NOW()
WHERE id = TRUE AND (size_chart_image_url = '' OR care_instructions = '');
