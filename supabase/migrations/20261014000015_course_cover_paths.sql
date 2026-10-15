-- =============================================================================
-- Adrenaline Rush: built-in course covers
--   Course covers may now also point at the images shipped with the site in
--   public/covers (for example /covers/html-css.svg), so a course has a good
--   cover without hosting an image elsewhere. Any other value must still be a
--   full https:// link.
-- =============================================================================

alter table public.courses drop constraint if exists courses_cover_image_url_check;
alter table public.courses add constraint courses_cover_image_url_check check (
  cover_image_url is null
  or cover_image_url ~* '^https://'
  or cover_image_url ~ '^/covers/[A-Za-z0-9_-][A-Za-z0-9._-]*\.(svg|png|jpg|jpeg|webp)$'
);
