import React, { useEffect, useState } from 'react';
import { sb } from '../lib/supabase';
import { fetchProducts } from '../hooks/useProductSearch';

const BrandBasedSearch = () => {
  const [searchQuery, setSearchQuery] = useState('');
  const [brandFilter, setBrandFilter] = useState('');
  const [brandList, setBrandList] = useState([]);
  const [filteredProducts, setFilteredProducts] = useState([]);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const { data: brands, error: brandError } = await sb
          .from('brands')
          .select('id, name')
          .order('name');
        if (brandError) {
          console.error('Error fetching brands:', brandError);
          setBrandList([]);
        } else {
          setBrandList(brands || []);
        }
      } catch (err) {
        console.error('Error fetching brands:', err);
        setBrandList([]);
      }
    };
    fetchData();
  }, []);

  useEffect(() => {
    const run = async () => {
      if (!searchQuery.trim()) {
        setFilteredProducts([]);
        return;
      }
      try {
        const products = await fetchProducts(searchQuery);
        const normalized = (products || []).map((product) => {
          const brandName = product.brands?.name || 'Unbranded';
          const pname = product.name || product.product_name || '';
          return { ...product, _brandName: brandName, _displayName: `${brandName} — ${pname}` };
        });
        const shown = brandFilter
          ? normalized.filter(p => p._brandName === brandFilter)
          : normalized;
        setFilteredProducts(shown);
      } catch (err) {
        console.error('Error fetching products:', err);
        setFilteredProducts([]);
      }
    };
    run();
  }, [searchQuery, brandFilter]);

  return (
    <div style={{ padding: 16 }}>
      <h2>Advanced Brand-Based Search</h2>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <input
          type="search"
          placeholder="Search products…"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          style={{ flex: '1 1 200px', padding: 8 }}
        />
        <select value={brandFilter} onChange={e => setBrandFilter(e.target.value)} style={{ padding: 8 }}>
          <option value="">All brands</option>
          {brandList.map(b => <option key={b.id} value={b.name}>{b.name}</option>)}
        </select>
      </div>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {filteredProducts.map(p => (
          <li key={p.id} style={{ padding: '6px 0', borderBottom: '1px solid #eee' }}>{p._displayName}</li>
        ))}
      </ul>
      {searchQuery.trim() && filteredProducts.length === 0 && <p style={{ color: '#666' }}>No products found.</p>}
    </div>
  );
};

export default BrandBasedSearch;