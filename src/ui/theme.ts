/**
 * Design tokens, as plain constants. No theming library.
 *
 * `ink`, `soft` and `paper` are the canonical brand values from the design
 * brief. Everything else was sampled from the artboards, so treat these as
 * measured rather than authored — if a real token file appears, it wins.
 *
 * The design is light-only; there is no dark palette yet.
 */

export const color = {
  // Brand
  ink: '#2F5D50',
  soft: '#8FB3A5',
  paper: '#F7F5F0',

  // Surfaces
  card: '#FFFFFF',
  border: '#E0DFDA',
  track: '#EAE6DB',
  areaFill: '#E7F0EB',

  // Text
  text: '#101310',
  textMuted: '#565855',
  textInverse: '#FFFFFF',

  // Status — warning (offline, pending, retrying)
  warnBg: '#FCF1DD',
  warnText: '#7A5514',

  // Status — danger (failed upload, conflict, gave up)
  dangerBg: '#FDF5F2',
  danger: '#9C3A28',

  // Status — success (synced)
  success: '#1F5442',

  // Source chips
  chipNeutral: '#F0EDE6',
  chipProvider: '#E7F0EB',

  // Snackbar / undo
  snackbar: '#21261F',
} as const;

/** 4pt base scale. */
export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  pill: 999,
} as const;

export const font = {
  /** Large numerals and screen titles are serif in the design. */
  display: { fontSize: 34, fontWeight: '700' },
  title: { fontSize: 22, fontWeight: '700' },
  metric: { fontSize: 30, fontWeight: '700' },
  body: { fontSize: 15, fontWeight: '400' },
  label: { fontSize: 13, fontWeight: '600' },
  caption: { fontSize: 12, fontWeight: '400' },
} as const;

export type Color = keyof typeof color;
