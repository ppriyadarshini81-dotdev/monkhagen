ALTER TABLE product_images
  ADD COLUMN IF NOT EXISTS zoom_image_url TEXT;
