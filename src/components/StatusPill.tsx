import { MaterialCommunityIcons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';
import { color, radius, space, type } from '../theme';
import type { PlatformPostStatus } from '../types';

const CONFIG: Record<
  PlatformPostStatus,
  { label: string; icon: keyof typeof MaterialCommunityIcons.glyphMap; fg: string; bg: string }
> = {
  draft: { label: 'Draft', icon: 'pencil-outline', fg: color.onSurfaceVariant, bg: color.surfaceVariant },
  approved: { label: 'Approved', icon: 'check-circle-outline', fg: color.info, bg: color.surfaceVariant },
  scheduled: { label: 'Scheduled', icon: 'calendar-clock', fg: color.info, bg: color.surfaceVariant },
  publishing: { label: 'Publishing', icon: 'progress-clock', fg: color.warning, bg: color.warningContainer },
  published: { label: 'Published', icon: 'check-circle', fg: color.success, bg: color.successContainer },
  failed: { label: 'Failed', icon: 'alert-circle', fg: color.error, bg: color.errorContainer },
};

export default function StatusPill({ status }: { status: PlatformPostStatus }) {
  const cfg = CONFIG[status];
  return (
    <View style={[styles.pill, { backgroundColor: cfg.bg }]}>
      <MaterialCommunityIcons name={cfg.icon} size={13} color={cfg.fg} />
      <Text style={[styles.label, { color: cfg.fg }]}>{cfg.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    paddingVertical: 4,
    paddingHorizontal: space.sm,
    borderRadius: radius.pill,
  },
  label: { ...type.labelSmall, textTransform: 'uppercase' },
});
