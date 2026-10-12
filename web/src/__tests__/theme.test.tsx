import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider } from '../context/ThemeContext';
import { ThemeToggle } from '../components/ui/ThemeToggle';

describe('toggle de tema', () => {
  it('alterna data-theme no <html> e persiste a preferência no localStorage', () => {
    render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>,
    );

    // matchMedia do jsdom stubado com matches: false => "system" resolve para claro.
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');

    fireEvent.click(screen.getByRole('radio', { name: 'Escuro' }));
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(window.localStorage.getItem('ondejoga.theme')).toBe('dark');

    fireEvent.click(screen.getByRole('radio', { name: 'Claro' }));
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(window.localStorage.getItem('ondejoga.theme')).toBe('light');

    fireEvent.click(screen.getByRole('radio', { name: 'Sistema' }));
    expect(window.localStorage.getItem('ondejoga.theme')).toBe('system');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('restaura a preferência salva ao montar', () => {
    window.localStorage.setItem('ondejoga.theme', 'dark');
    render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>,
    );
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(screen.getByRole('radio', { name: 'Escuro' })).toBeChecked();
  });
});
