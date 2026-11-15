
import { sb } from './lib/supabase';

export async function fetchProducts(query) {
  const search = (query || '').trim();

  if (!search) return [];

  const { data, error } = await sb
    .from('products')
    .select('id, name, product_name, category, brand_id, brands(name)')
    .ilike('name', `${search}%`);

  if (error) {
    console.error('Product search failed:', error);
    throw error;
  }

  return data ?? [];
}
