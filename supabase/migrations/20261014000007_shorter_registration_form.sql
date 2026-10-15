-- =============================================================================
-- Shorter default registration form for new courses.
-- Owners asked to keep the candidate side minimal: new courses start with name,
-- email, phone, current role, experience, "how did you hear about us" and the
-- two consent boxes. The other standard fields are still created but hidden;
-- switch them on in Courses › Registration form. Existing courses are unchanged.
-- Re-running is safe. No new functions, so the grant list is unchanged.
-- =============================================================================

create or replace function public.seed_course_registration_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.course_registration_fields (course_id, key, label, type, maps_to, required, options, position, placeholder, help_text, is_active)
  values
    (new.id, 'full_name', 'Full name', 'text', 'full_name', true, '{}', 10, null, null, true),
    (new.id, 'email', 'Email address', 'email', 'email', true, '{}', 20, 'you@example.com', null, true),
    (new.id, 'phone', 'Phone (with country code)', 'phone', 'phone', true, '{}', 30, '+91 98765 43210', null, true),
    (new.id, 'city', 'City', 'text', 'city', false, '{}', 40, null, null, false),
    (new.id, 'country', 'Country', 'text', 'country', false, '{}', 50, null, null, false),
    (new.id, 'company', 'Current company', 'text', 'company', false, '{}', 60, null, null, false),
    (new.id, 'job_title', 'Current job title', 'text', 'job_title', false, '{}', 70, null, null, true),
    (new.id, 'total_experience_years', 'Total experience (years)', 'number', 'total_experience_years', false, '{}', 80, null, null, true),
    (new.id, 'relevant_experience_years', 'Relevant experience (years)', 'number', 'relevant_experience_years', false, '{}', 90, null, null, false),
    (new.id, 'skills', 'Current skills', 'textarea', 'skills', false, '{}', 100, null, null, false),
    (new.id, 'learning_objectives', 'What do you want to achieve?', 'textarea', 'learning_objectives', false, '{}', 110, null, null, false),
    (new.id, 'preferred_schedule', 'Preferred schedule', 'select', 'preferred_schedule', false, array['Weekdays', 'Weekends', 'Evenings', 'Flexible'], 120, null, null, false),
    (new.id, 'employment_status', 'Employment status', 'select', 'employment_status', false, array['Employed', 'Student', 'Looking for work', 'Freelancer', 'Other'], 130, null, null, false),
    (new.id, 'heard_about', 'How did you hear about us?', 'select', 'heard_about', false, array['LinkedIn', 'WhatsApp', 'Telegram', 'Friend or colleague', 'Search', 'Other'], 140, null, null, true),
    (new.id, 'marketing_consent', 'I agree to receive course updates by email, phone or WhatsApp', 'checkbox', 'marketing_consent', false, '{}', 900, null, 'You can opt out at any time.', true),
    (new.id, 'privacy_consent', 'I agree to the privacy policy', 'consent', 'privacy_consent', true, '{}', 910, null, null, true)
  on conflict (course_id, key) do nothing;
  return new;
end;
$$;
