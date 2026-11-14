import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import LedgerApp from './LedgerApp';
import AdminApp from './AdminApp';
import './App.css';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LedgerApp />} />
        <Route path="/admin/*" element={<AdminApp />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
