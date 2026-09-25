/**
 * Application sections (PROJECT.md §16).
 *
 * This is the single list of pages. Navigation, routing, page headers and the
 * Dashboard module grid all read from here, so adding or renaming a section
 * happens in one place.
 *
 * `status` describes what exists today. `plannedIn` names the TASKS.md entries
 * that will build the page, so the UI never implies a feature exists before it does.
 * `highlights` restate what the specification says the section will provide.
 * `tone` selects the section colour (css/app.css `.tone-*`); `icon` names an
 * entry in icons.js. Green and red are deliberately NOT section tones — they are
 * reserved for bullish / bearish results.
 */

/**
 * @typedef {{
 *   id: string, path: string, title: string, summary: string,
 *   status: 'planned' | 'available', plannedIn: string[],
 *   tone: string, icon: string, highlights: string[]
 * }} Route
 */

/** @type {readonly Route[]} */
export const ROUTES = Object.freeze([
  {
    id: 'dashboard',
    path: '/',
    title: 'Dashboard',
    summary: 'Research overview.',
    status: 'planned',
    plannedIn: ['TASK 020', 'TASK 021'],
    tone: 'indigo',
    icon: 'dashboard',
    highlights: [
      'Performance overview and equity curve',
      'Results by symbol, weekday and ORB period',
      'Data coverage at a glance',
    ],
  },
  {
    id: 'data',
    path: '/data',
    title: 'Data',
    summary: 'Historical candle coverage and data health.',
    status: 'planned',
    plannedIn: ['TASK 013', 'TASK 014'],
    tone: 'cyan',
    icon: 'data',
    highlights: [
      'Expected vs actual candles per session (90 for 09:30–10:59 ET)',
      'Missing and duplicate candles, OHLC and timestamp checks',
      'Weekends and market holidays never counted as missing',
    ],
  },
  {
    id: 'admin',
    path: '/admin',
    title: 'Admin',
    summary: 'GET DATA, import progress, provider status and logs.',
    status: 'planned',
    plannedIn: ['TASK 015'],
    tone: 'amber',
    icon: 'admin',
    highlights: [
      'GET DATA: resumable, rate-limited historical import',
      'Last timestamp per symbol and the common dataset',
      'Provider status, quotas, errors and logs',
    ],
  },
  {
    id: 'orb-research',
    path: '/orb-research',
    title: 'ORB Research',
    summary: 'Explore ORB levels and breakout events.',
    status: 'planned',
    plannedIn: ['TASK 016', 'TASK 017', 'TASK 018'],
    tone: 'violet',
    icon: 'candles',
    highlights: [
      'ORB High / Low for 1, 3, 5, 10 and 15-minute ranges',
      'First valid bullish or bearish breakout per session',
      'Derived only from stored 1-minute candles',
    ],
  },
  {
    id: 'backtest',
    path: '/backtest',
    title: 'Backtest',
    summary: 'Historical strategy testing.',
    status: 'planned',
    plannedIn: ['TASK 019', 'TASK 020', 'TASK 021'],
    tone: 'blue',
    icon: 'backtest',
    highlights: [
      '1 trade per symbol/session, stop at the opposite side of the ORB, 2R default',
      'Win %, net R, profit factor, maximum drawdown, time to TP / SL',
      'Filter by symbol, market, weekday, ORB period, direction and dates',
    ],
  },
  {
    id: 'relationships',
    path: '/relationships',
    title: 'Relationships',
    summary: 'Historical association between ORB events across symbols.',
    status: 'planned',
    plannedIn: ['TASK 022', 'TASK 023', 'TASK 024'],
    tone: 'pink',
    icon: 'relationships',
    highlights: [
      'Same- and opposite-direction frequency between symbols',
      'Lead/lag windows from 0 to 15 minutes, average and median delay',
      'Historical association only — never presented as causation',
    ],
  },
  {
    id: 'settings',
    path: '/settings',
    title: 'Settings',
    summary: 'Symbols and research configuration.',
    status: 'planned',
    plannedIn: ['TASK 004'],
    tone: 'slate',
    icon: 'settings',
    highlights: [
      'The 15-symbol universe: 8 US stocks, 4 forex, 2 crypto, gold',
      'Enable or disable symbols without code changes',
      'Session timezone and hours per market',
    ],
  },
]);

export const DEFAULT_ROUTE_ID = 'dashboard';
