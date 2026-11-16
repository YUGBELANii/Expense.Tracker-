import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import LedgerApp from './LedgerApp';
import AdminApp from './AdminApp';
import AppLayout from './components/AppLayout';
import './App.css';

export default function App() {
  return (
    <BrowserRouter>
      <AppLayout>
        <Routes>
          <Route path="/" element={<LedgerApp />} />
          <Route path="/delivery" element={<LedgerApp />} />
          <Route path="/admin" element={<Navigate to="/admin/partners" replace />} />
          <Route path="/admin/:section" element={<AdminApp />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AppLayout>
    </BrowserRouter>
  );
}
