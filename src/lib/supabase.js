export const SUPABASE_URL = 'https://jgnqxczcgzqydjkwtrqi.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_AfwTCbECHnCaGRDSI9S8fg_Ek_ioaSG';

export const sb =
  SUPABASE_URL && SUPABASE_KEY && window.supabase
    ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY)
    : null;

export const isAdminUser = (user) => {
  if (!user) return false;
  const role = user.app_metadata?.role || user.user_metadata?.role;
  return role === 'admin' || user.user_metadata?.is_admin === true || user.app_metadata?.is_admin === true;
};
