/**
 * Line icons (24×24 viewBox, drawn with stroke="currentColor").
 * Each icon is a list of SVG path strings. Kept in-repo: no icon font, no CDN.
 */
export const ICONS = Object.freeze({
  logo: [
    // an opening-range box with a breakout arrow leaving it
    'M3 11h10v8H3z', 'M6 15h4',
    'M11 13l9-9', 'M14 4h6v6',
  ],
  dashboard: ['M3 3h8v8H3z', 'M13 3h8v5h-8z', 'M13 10h8v11h-8z', 'M3 13h8v8H3z'],
  data: [
    'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3z',
    'M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6',
    'M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
  ],
  admin: ['M12 3v11', 'M7.5 9.5 12 14l4.5-4.5', 'M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4'],
  candles: ['M6 3v18', 'M4 7h4v9H4z', 'M12 3v18', 'M10 5h4v6h-4z', 'M18 3v18', 'M16 10h4v8h-4z'],
  backtest: ['M3 17l5-5 4 4 8-8', 'M14 8h6v6', 'M3 21h18'],
  relationships: [
    'M6 8.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
    'M18 8.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
    'M12 20.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
    'M8.5 6h7', 'M7.3 8.2l3.4 7.6', 'M16.7 8.2l-3.4 7.6',
  ],
  settings: [
    'M4 6h9', 'M17 6h3', 'M4 12h3', 'M11 12h9', 'M4 18h11', 'M19 18h1',
    'M15 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
    'M9 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
    'M17 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  ],
  arrow: ['M5 12h14', 'M13 6l6 6-6 6'],
  check: ['M5 12.5l4.5 4.5L19 7.5'],
});
