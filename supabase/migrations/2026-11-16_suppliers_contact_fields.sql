-- Add optional contact fields to suppliers (additive only).
-- Run once in Supabase SQL editor after the previous suppliers migration.

alter table public.suppliers add column if not exists email text;
alter table public.suppliers add column if not exists gstin text;
