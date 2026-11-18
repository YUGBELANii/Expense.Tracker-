import React, { useEffect, useState } from 'react';
import { NavLink, Link, useLocation } from 'react-router-dom';

export default function AppLayout({ children }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [sidebarHidden, setSidebarHidden] = useState(false);
  const location = useLocation();
  const isAdmin = location.pathname.startsWith('/admin');

  useEffect(() => {
    if (drawerOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [drawerOpen]);

  const ledgerNav = [
    { to: '/', label: 'Stock Ledger', icon: '📦', end: true },
    { to: '/delivery', label: 'Delivery', icon: '🚚', end: false },
  ];

  const adminNav = [
    { to: '/admin/partners', label: 'Partners', icon: '👥' },
    { to: '/admin/products', label: 'Products', icon: '📋' },
    { to: '/admin/stock', label: 'Stock Management', icon: '📦' },
    { to: '/admin/suppliers', label: 'Suppliers', icon: '🏭' },
    { to: '/admin/purchases', label: 'Purchases', icon: '🧾' },
    { to: '/admin/price-comparison', label: 'Price Comparison', icon: '⚖️' },
    { to: '/admin/restock', label: 'Restock', icon: '🔔' },
    { to: '/admin/brandAssignment', label: 'Manufacturer Assigner', icon: '🏷️' },
    { to: '/admin/shelfLife', label: 'Shelf Life', icon: '⏳' },
    { to: '/admin/manufacturers', label: 'Manufacturers', icon: '🏢' },
    { to: '/admin/salary', label: 'Salary & Rates', icon: '💰' },
    { to: '/admin/payments', label: 'Payments', icon: '💳' },
    { to: '/admin/history', label: 'Records & History', icon: '📜' },
  ];

  const navItems = isAdmin ? adminNav : ledgerNav;

  const closeDrawer = () => setDrawerOpen(false);

  return (
    <div className="app-shell">
      <div className={`app-drawer-backdrop ${drawerOpen ? 'open' : ''}`} onClick={closeDrawer} aria-hidden="true" />
      <aside className={`app-sidebar ${drawerOpen ? 'mobile-open' : ''} ${sidebarHidden ? 'desktop-hidden' : ''}`}>
        <div className="app-sidebar-brand">
          <span>Expense Tracker</span>
          <button
            type="button"
            className="app-sidebar-hide"
            onClick={() => {
              if (window.matchMedia('(max-width: 900px)').matches) closeDrawer();
              else setSidebarHidden(true);
            }}
            aria-label="Hide navigation menu"
            title="Hide navigation menu"
          >
            <span aria-hidden="true">‹</span>
            <span className="hide-label">Hide</span>
          </button>
        </div>
        <div className="app-sidebar-section">Navigation</div>
        <ul className="app-nav">
          {navItems.map(item => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                end={item.end}
                className={({ isActive }) => isActive ? 'active' : ''}
                onClick={closeDrawer}
              >
                <span className="nav-icon" aria-hidden="true">{item.icon}</span>
                {item.label}
              </NavLink>
            </li>
          ))}
        </ul>
        <div className="app-sidebar-section">Quick links</div>
        <ul className="app-nav">
          {!isAdmin && (
            <li>
              <Link to="/admin/partners" className="" onClick={closeDrawer}>
                <span className="nav-icon" aria-hidden="true">⚙️</span>
                Admin Panel
              </Link>
            </li>
          )}
          {isAdmin && (
            <li>
              <Link to="/" className="" onClick={closeDrawer}>
                <span className="nav-icon" aria-hidden="true">🏠</span>
                Back to Ledger
              </Link>
            </li>
          )}
        </ul>
      </aside>
      <div className="app-main">
        {sidebarHidden && (
          <button
            type="button"
            className="app-nav-reopen"
            onClick={() => setSidebarHidden(false)}
            aria-label="Show navigation menu"
            title="Show navigation menu"
          >
            <span aria-hidden="true">☰</span>
            <span>Show menu</span>
          </button>
        )}
        <div className="app-mobile-bar">
          <button type="button" aria-label="Open menu" onClick={() => setDrawerOpen(true)}>☰</button>
          <span className="title">{isAdmin ? 'Admin' : 'Ledger'}</span>
        </div>
        <div className="app-main-inner">
          {children}
        </div>
      </div>
    </div>
  );
}
