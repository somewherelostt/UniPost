import { StyleSheet, Text, View } from 'react-native';
import { FontAwesome6, MaterialCommunityIcons } from '@expo/vector-icons';
import { platformColor } from '../theme';
import type { Platform } from '../types';

// Real brand glyphs from MaterialCommunityIcons where one exists (verified against the installed
// icon set's glyph map — not every platform has one). TikTok and Threads have no MDI brand icon
// yet (checked, not assumed), so those fall back to a plain monogram rather than a wrong or
// approximate icon standing in for the real logo. Twitter/X is deliberately excluded too, even
// though the glyph map does have a `twitter` entry: inspecting the installed glyph map confirms
// it is MDI's legacy bird-logo icon, not X's current wordmark/glyph since its 2023 rebrand — using
// it would be exactly the "wrong or approximate icon" this comment already warns against, so
// Twitter/X falls back to the monogram too. Bluesky has no MDI glyph either, but see FA6_ICON
// below — it does have a real glyph in a different icon family that @expo/vector-icons bundles.
const ICON: Partial<Record<Platform, keyof typeof MaterialCommunityIcons.glyphMap>> = {
  linkedin: 'linkedin',
  youtube: 'youtube',
  instagram: 'instagram',
  pinterest: 'pinterest',
  facebook: 'facebook',
};

// Bluesky's real butterfly logo isn't in MaterialCommunityIcons, but it IS a real brand glyph in
// FontAwesome6's "brands" style — confirmed present in the installed
// FontAwesome6Free_meta.json's "brands" list, name "bluesky" — so it gets its own icon family
// here instead of falling back to the monogram like Twitter/X/Threads/TikTok do.
const FA6_ICON: Partial<Record<Platform, string>> = {
  bluesky: 'bluesky',
};

const INITIAL: Record<Platform, string> = {
  // Unused now that FA6_ICON.bluesky renders the real glyph below; kept only so this
  // Record<Platform, string> stays exhaustive, matching facebook's same fallback-if-ever-missing
  // pattern below.
  bluesky: 'B',
  linkedin: 'in',
  youtube: '▶',
  instagram: 'IG',
  pinterest: 'P',
  // Real wordmark-style single-letter Meta convention (lowercase "f", matching Facebook's own
  // "f Logo"). Only used as a fallback if `ICON.facebook` above is ever unavailable — the real
  // MaterialCommunityIcons "facebook" glyph (confirmed present in the installed icon set) takes
  // priority the same way it does for LinkedIn/YouTube/Instagram/Pinterest.
  facebook: 'f',
  // Twitter and Threads are both solid-black badges (see theme.ts's platformColor) with no
  // distinguishing MDI icon available for either, so the monogram is the ONLY thing telling them
  // apart — 'X' matches X's current wordmark; '@' matches Threads' own app-icon glyph (a
  // stylized at sign), which also keeps it visually distinct from every other badge here.
  twitter: 'X',
  threads: '@',
};

export default function PlatformBadge({ platform, size = 28 }: { platform: Platform; size?: number }) {
  const icon = ICON[platform];
  const fa6Icon = FA6_ICON[platform];
  return (
    <View
      style={[
        styles.badge,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: platformColor[platform] },
      ]}
    >
      {icon ? (
        <MaterialCommunityIcons name={icon} size={size * 0.58} color="#fff" />
      ) : fa6Icon ? (
        <FontAwesome6 name={fa6Icon} brand size={size * 0.58} color="#fff" />
      ) : (
        <Text style={[styles.letter, { fontSize: size * 0.42 }]}>{INITIAL[platform]}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { alignItems: 'center', justifyContent: 'center' },
  letter: { color: '#fff', fontWeight: '800' },
});
