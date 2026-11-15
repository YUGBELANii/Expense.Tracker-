import { render, screen } from '@testing-library/react';
import App from './App';

test('renders the stock ledger home page', () => {
  render(<App />);
  expect(screen.getByRole('heading', { name: /stock ledger/i })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /admin panel/i })).toBeInTheDocument();
});
