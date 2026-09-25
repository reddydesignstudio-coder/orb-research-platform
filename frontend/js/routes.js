/**
 * Application sections (PROJECT.md §16).
 *
 * This is the single list of pages. Navigation, routing and page titles all read
 * from here, so adding or renaming a section happens in one place.
 *
 * `status` describes what exists today. `plannedIn` names the TASKS.md entries
 * that will build the page, so the UI never implies a feature exists before it does.
 */

/** @typedef {{ id: string, path: string, title: string, summary: string, status: 'planned' | 'available', plannedIn: string[] }} Route */

/** @type {readonly Route[]} */
export const ROUTES = Object.freeze([
  {
    id: 'dashboard',
    path: '/',
    title: 'Dashboard',
    summary: 'Research overview.',
    status: 'planned',
    plannedIn: ['TASK 020', 'TASK 021'],
  },
  {
    id: 'data',
    path: '/data',
    title: 'Data',
    summary: 'Historical candle coverage and data health.',
    status: 'planned',
    plannedIn: ['TASK 013', 'TASK 014'],
  },
  {
    id: 'admin',
    path: '/admin',
    title: 'Admin',
    summary: 'GET DATA, import progress, provider status and logs.',
    status: 'planned',
    plannedIn: ['TASK 015'],
  },
  {
    id: 'orb-research',
    path: '/orb-research',
    title: 'ORB Research',
    summary: 'Explore ORB levels and breakout events.',
    status: 'planned',
    plannedIn: ['TASK 016', 'TASK 017', 'TASK 018'],
  },
  {
    id: 'backtest',
    path: '/backtest',
    title: 'Backtest',
    summary: 'Historical strategy testing.',
    status: 'planned',
    plannedIn: ['TASK 019', 'TASK 020', 'TASK 021'],
  },
  {
    id: 'relationships',
    path: '/relationships',
    title: 'Relationships',
    summary: 'Historical association between ORB events across symbols.',
    status: 'planned',
    plannedIn: ['TASK 022', 'TASK 023', 'TASK 024'],
  },
  {
    id: 'settings',
    path: '/settings',
    title: 'Settings',
    summary: 'Symbols and research configuration.',
    status: 'planned',
    plannedIn: ['TASK 004'],
  },
]);

export const DEFAULT_ROUTE_ID = 'dashboard';
