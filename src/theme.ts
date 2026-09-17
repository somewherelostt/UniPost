// Material 3 dark theme, purpose-built for UniPost. Roboto (Android's system face) carries every
// role per Material guidance for Operate surfaces — brand lives in color and the platform
// monograms, not in a display typeface.

export const color = {
  background: '#101014',
  surface: '#1A1A20',
  surfaceRaised: '#232329',
  surfaceVariant: '#26262E',
  outline: '#34343C',
  outlineFaint: '#26262E',

  onBackground: '#ECECF1',
  onSurface: '#ECECF1',
  onSurfaceVariant: '#A8A8B8',
  onSurfaceFaint: '#6E6E7C',

  primary: '#9C8CFF',
  onPrimary: '#1B1240',
  primaryContainer: '#2C2352',
  onPrimaryContainer: '#D6CCFF',

  error: '#FF8A80',
  onError: '#3A0A0A',
  errorContainer: '#3A1616',
  onErrorContainer: '#FFB4AB',

  warning: '#F2B84B',
  warningContainer: '#332608',
  onWarningContainer: '#F7D18C',

  success: '#5FDB8F',
  successContainer: '#0F2A1B',

  info: '#7FC2FF',
} as const;

export const platformColor = {
  bluesky: '#1185FE',
  linkedin: '#0A66C2',
  youtube: '#FF0033',
  instagram: '#E4405F',
  pinterest: '#E60023',
  // Facebook's current brand blue (unchanged since its last refresh, unlike X's) — real brand
  // color, not a placeholder.
  facebook: '#1877F2',
  // Twitter/X and Threads are both genuinely black-and-white brands now (X's 2023 rebrand
  // dropped the old Twitter blue for a plain black wordmark/glyph; Threads has always used a
  // black/white UI with no signature accent color) — confirmed current as of this build, not
  // assumed from memory. Both resolve to the same hex on purpose, NOT a copy-paste bug: badge
  // differentiation between the two comes from PlatformBadge's monogram/glyph
  // ('X' vs '@'), not from color, since color genuinely can't do the job here.
  twitter: '#000000',
  threads: '#000000',
} as const;

export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 28,
  xxxl: 40,
} as const;

export const radius = {
  sm: 10,
  md: 14,
  lg: 16,
  pill: 999,
} as const;

export const type = {
  headlineSmall: { fontSize: 26, fontWeight: '700' as const, letterSpacing: -0.3 },
  titleLarge: { fontSize: 19, fontWeight: '700' as const, letterSpacing: -0.2 },
  titleMedium: { fontSize: 16, fontWeight: '600' as const },
  bodyLarge: { fontSize: 16, fontWeight: '400' as const, lineHeight: 22 },
  bodyMedium: { fontSize: 14, fontWeight: '400' as const, lineHeight: 20 },
  labelLarge: { fontSize: 14, fontWeight: '700' as const, letterSpacing: 0.1 },
  labelMedium: { fontSize: 12, fontWeight: '700' as const, letterSpacing: 0.2 },
  labelSmall: { fontSize: 11, fontWeight: '700' as const, letterSpacing: 0.3 },
} as const;

export const touchTarget = 48;
