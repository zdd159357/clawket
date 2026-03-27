import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  Archive,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Eye,
  RotateCcw,
  Stethoscope,
  TriangleAlert,
} from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { createCardContentStyle, ModalSheet } from '../../components/ui';
import { useAppContext } from '../../contexts/AppContext';
import { useProPaywall } from '../../contexts/ProPaywallContext';
import { useNativeStackModalHeader } from '../../hooks/useNativeStackModalHeader';
import { analyticsEvents } from '../../services/analytics/events';
import type { RelayDoctorCheckResult, RelayDoctorResult } from '../../services/gateway-relay';
import { StorageService } from '../../services/storage';
import { useAppTheme } from '../../theme';
import { FontSize, FontWeight, Radius, Space } from '../../theme/tokens';
import type { ConfigStackParamList } from './ConfigTab';
import { useGatewayRuntimeSettings } from './hooks/useGatewayRuntimeSettings';

type Navigation = NativeStackNavigationProp<ConfigStackParamList, 'OpenClawConfig'>;

type ActionRowProps = {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  onPress: () => void;
  disabled?: boolean;
  styles: ReturnType<typeof createStyles>;
  chevronColor: string;
};

function ActionRow({
  title,
  subtitle,
  icon,
  onPress,
  disabled = false,
  styles,
  chevronColor,
}: ActionRowProps): React.JSX.Element {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        pressed && !disabled && styles.rowPressed,
        disabled && styles.rowDisabled,
      ]}
      disabled={disabled}
    >
      <View style={styles.rowLead}>
        {icon}
        <View style={styles.rowText}>
          <Text style={styles.rowTitle}>{title}</Text>
          <Text style={styles.rowSubtitle}>{subtitle}</Text>
        </View>
      </View>
      <ChevronRight size={16} color={chevronColor} strokeWidth={2} />
    </Pressable>
  );
}

function DoctorCheckRow({
  check,
  styles,
}: {
  check: RelayDoctorCheckResult;
  styles: ReturnType<typeof createStyles>;
}): React.JSX.Element {
  const statusIcon = check.status === 'pass'
    ? <CheckCircle2 size={15} strokeWidth={2.2} color="#22C55E" />
    : check.status === 'warn'
      ? <TriangleAlert size={15} strokeWidth={2.2} color="#F59E0B" />
      : check.status === 'skip'
        ? <CheckCircle2 size={15} strokeWidth={2.2} color="#94A3B8" />
        : <CircleAlert size={15} strokeWidth={2.2} color="#EF4444" />;

  return (
    <View style={styles.doctorCheckRow}>
      {statusIcon}
      <View style={styles.doctorCheckText}>
        <Text style={styles.doctorCheckName}>{check.name}</Text>
        {check.message ? (
          <Text style={styles.doctorCheckMessage}>{check.message}</Text>
        ) : null}
      </View>
    </View>
  );
}

export function OpenClawConfigScreen(): React.JSX.Element {
  const navigation = useNavigation<Navigation>();
  const { t } = useTranslation(['config', 'common']);
  const { theme } = useAppTheme();
  const { gateway, config: activeGatewayConfig, gatewayEpoch } = useAppContext();
  const { requirePro } = useProPaywall();
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors]);
  const [backingUpConfig, setBackingUpConfig] = useState(false);
  const [runningDoctor, setRunningDoctor] = useState(false);
  const [doctorResult, setDoctorResult] = useState<RelayDoctorResult | null>(null);
  const [doctorError, setDoctorError] = useState<string | null>(null);
  const [doctorModalVisible, setDoctorModalVisible] = useState(false);
  const [runningFix, setRunningFix] = useState(false);
  const [fixResult, setFixResult] = useState<{ ok: boolean; raw?: string } | null>(null);
  const [fixError, setFixError] = useState<string | null>(null);
  const runtimeSettings = useGatewayRuntimeSettings({
    gateway,
    gatewayEpoch,
    hasActiveGateway: Boolean(activeGatewayConfig?.url),
  });

  const handleViewConfigPress = useCallback(() => {
    if (!activeGatewayConfig?.url) {
      Alert.alert(t('No Active Gateway'), t('Please add and activate a gateway connection first.'));
      return;
    }
    navigation.navigate('GatewayConfigViewer');
  }, [activeGatewayConfig?.url, navigation, t]);

  const handleBackupConfigPress = useCallback(async () => {
    if (backingUpConfig) return;
    if (!requirePro('configBackups')) return;
    if (!activeGatewayConfig?.url) {
      Alert.alert(t('No Active Gateway'), t('Please add and activate a gateway connection first.'));
      return;
    }

    setBackingUpConfig(true);
    try {
      const result = await gateway.getConfig();
      if (!result.config) {
        Alert.alert(t('Settings Unavailable'), t('No config returned from Gateway.'));
        return;
      }

      await StorageService.saveGatewayConfigBackup(result.config);
      const backups = await StorageService.listGatewayConfigBackups();
      analyticsEvents.gatewayConfigBackupCreated({
        source: 'config_screen',
        backup_count: backups.length,
      });
      Alert.alert(t('Saved'), t('Config backup created.'));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('Failed to create config backup');
      Alert.alert(t('Failed to create config backup'), message);
    } finally {
      setBackingUpConfig(false);
    }
  }, [activeGatewayConfig?.url, backingUpConfig, gateway, requirePro, t]);

  const handleRestoreConfigPress = useCallback(() => {
    if (!requirePro('configBackups')) return;
    navigation.navigate('GatewayConfigBackups');
  }, [navigation, requirePro]);

  const handleRestartGatewayConfirm = useCallback(() => {
    Alert.alert(
      t('Restart Current Gateway?'),
      t('This will temporarily disconnect the app while the Gateway restarts.'),
      [
        { text: t('common:Cancel'), style: 'cancel' as const },
        {
          text: t('Restart'),
          onPress: () => {
            void runtimeSettings.restartGateway();
          },
        },
      ],
    );
  }, [runtimeSettings, t]);

  const handleDoctorPress = useCallback(async () => {
    if (runningDoctor) return;
    setRunningDoctor(true);
    setDoctorResult(null);
    setDoctorError(null);
    setFixResult(null);
    setFixError(null);
    setDoctorModalVisible(true);

    try {
      const result = await gateway.requestDoctor();
      setDoctorResult(result);
    } catch (err: unknown) {
      const raw = err instanceof Error ? err.message : '';
      if (raw === 'NOT_RELAY') {
        setDoctorError(t('Diagnostics require a relay connection. Connect via Clawket Bridge to use this feature.'));
      } else if (raw === 'NOT_CONNECTED') {
        setDoctorError(t('Not connected to gateway.'));
      } else {
        setDoctorError(raw || t('Doctor command failed.'));
      }
    } finally {
      setRunningDoctor(false);
    }
  }, [gateway, runningDoctor, t]);

  const handleDoctorModalClose = useCallback(() => {
    setDoctorModalVisible(false);
    setFixResult(null);
    setFixError(null);
  }, []);

  const handleFixPress = useCallback(async () => {
    if (runningFix) return;
    setRunningFix(true);
    setFixResult(null);
    setFixError(null);

    try {
      const result = await gateway.requestDoctorFix();
      setFixResult(result);
    } catch (err: unknown) {
      const raw = err instanceof Error ? err.message : '';
      setFixError(raw || t('Fix command failed.'));
    } finally {
      setRunningFix(false);
    }
  }, [gateway, runningFix, t]);

  useNativeStackModalHeader({
    navigation,
    title: t('OPENCLAW CONFIG'),
    onClose: () => navigation.goBack(),
  });

  const hasActiveGateway = Boolean(activeGatewayConfig?.url);
  const isRelayRoute = hasActiveGateway && gateway.getConnectionRoute() === 'relay';

  return (
    <ScrollView contentContainerStyle={createCardContentStyle()}>
      <View style={styles.card}>
        <ActionRow
          title={t('View Config')}
          subtitle={t('View the current complete OpenClaw config')}
          onPress={handleViewConfigPress}
          styles={styles}
          chevronColor={theme.colors.textSubtle}
          icon={(
            <View style={[styles.rowIconBadge, { backgroundColor: '#E7F0FF' }]}>
              <Eye size={17} strokeWidth={2.2} color="#2F6BFF" />
            </View>
          )}
        />

        <View style={styles.divider} />

        <ActionRow
          title={backingUpConfig ? t('Creating backup...') : t('Back Up Config')}
          subtitle={t('Back up the current complete OpenClaw config')}
          onPress={() => {
            void handleBackupConfigPress();
          }}
          disabled={backingUpConfig}
          styles={styles}
          chevronColor={theme.colors.textSubtle}
          icon={(
            <View style={[styles.rowIconBadge, { backgroundColor: '#FFF1E5' }]}>
              <Archive size={17} strokeWidth={2.2} color="#D96C1F" fill="#D96C1F" />
            </View>
          )}
        />

        <View style={styles.divider} />

        <ActionRow
          title={t('Restore Backup')}
          subtitle={t('Restore the OpenClaw config from a backup')}
          onPress={handleRestoreConfigPress}
          styles={styles}
          chevronColor={theme.colors.textSubtle}
          icon={(
            <View style={[styles.rowIconBadge, { backgroundColor: '#E9F8EE' }]}>
              <RotateCcw size={17} strokeWidth={2.25} color="#248A4D" />
            </View>
          )}
        />
      </View>

      {activeGatewayConfig?.url ? (
        <View style={styles.secondaryCard}>
          <Pressable
            onPress={handleRestartGatewayConfirm}
            style={({ pressed }) => [
              styles.row,
              pressed && !runtimeSettings.restartingGateway && styles.rowPressed,
              (runtimeSettings.loadingGatewaySettings
                || runtimeSettings.savingGatewaySettings
                || runtimeSettings.restartingGateway)
                && styles.rowDisabled,
            ]}
            disabled={
              runtimeSettings.loadingGatewaySettings
              || runtimeSettings.savingGatewaySettings
              || runtimeSettings.restartingGateway
            }
          >
            <View style={styles.rowLead}>
              <View style={[styles.rowIconBadge, { backgroundColor: '#FFF4D6' }]}>
                <RotateCcw size={17} strokeWidth={2.25} color="#D79A00" />
              </View>
              <View style={styles.rowText}>
                <Text style={styles.rowTitle}>
                  {runtimeSettings.restartingGateway ? t('common:Loading...') : t('Restart Current Gateway')}
                </Text>
              </View>
            </View>
          </Pressable>
        </View>
      ) : null}

      <View style={styles.secondaryCard}>
        <Pressable
          onPress={() => { void handleDoctorPress(); }}
          style={({ pressed }) => [
            styles.row,
            pressed && !runningDoctor && styles.rowPressed,
            (runningDoctor || !hasActiveGateway) && styles.rowDisabled,
          ]}
          disabled={runningDoctor || !hasActiveGateway}
        >
          <View style={styles.rowLead}>
            <View style={[styles.rowIconBadge, { backgroundColor: '#EDE9FE' }]}>
              <Stethoscope size={17} strokeWidth={2.2} color="#7C3AED" />
            </View>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>
                {runningDoctor ? t('Running diagnostics...') : t('Diagnose')}
              </Text>
              <Text style={styles.rowSubtitle}>
                {isRelayRoute
                  ? t('Remotely run diagnostics on your OpenClaw instance')
                  : t('Requires relay connection to bridge')}
              </Text>
            </View>
          </View>
          <ChevronRight size={16} color={theme.colors.textSubtle} strokeWidth={2} />
        </Pressable>
      </View>

      <ModalSheet
        visible={doctorModalVisible}
        onClose={handleDoctorModalClose}
        title={t('Diagnostics')}
      >
        <ScrollView style={styles.doctorScroll} contentContainerStyle={styles.doctorContent}>
          {runningDoctor ? (
            <View style={styles.doctorLoading}>
              <ActivityIndicator size="small" color={theme.colors.primary} />
              <Text style={styles.doctorLoadingText}>{t('Running openclaw doctor...')}</Text>
            </View>
          ) : doctorError ? (
            <View style={styles.doctorErrorContainer}>
              <CircleAlert size={20} strokeWidth={2} color={theme.colors.error} />
              <Text style={styles.doctorErrorText}>{doctorError}</Text>
            </View>
          ) : doctorResult ? (
            <>
              <View style={styles.doctorSummaryRow}>
                {doctorResult.ok
                  ? <CheckCircle2 size={20} strokeWidth={2.2} color="#22C55E" />
                  : <CircleAlert size={20} strokeWidth={2.2} color="#EF4444" />}
                <Text style={[
                  styles.doctorSummaryText,
                  { color: doctorResult.ok ? '#22C55E' : theme.colors.error },
                ]}>
                  {doctorResult.ok ? t('All checks passed') : t('Issues detected')}
                </Text>
              </View>
              {doctorResult.summary ? (
                <Text style={styles.doctorHint}>{doctorResult.summary}</Text>
              ) : null}
              {doctorResult.checks.length > 0 ? (
                <View style={styles.doctorCheckList}>
                  {doctorResult.checks.map((check, index) => (
                    <DoctorCheckRow key={`${check.name}-${index}`} check={check} styles={styles} />
                  ))}
                </View>
              ) : null}
              {doctorResult.raw ? (
                <View style={styles.doctorRawContainer}>
                  <Text style={styles.doctorRawText}>{doctorResult.raw}</Text>
                </View>
              ) : null}
              {fixError ? (
                <View style={styles.doctorErrorContainer}>
                  <CircleAlert size={20} strokeWidth={2} color={theme.colors.error} />
                  <Text style={styles.doctorErrorText}>{fixError}</Text>
                </View>
              ) : null}
              {fixResult ? (
                <>
                  <View style={styles.doctorSummaryRow}>
                    {fixResult.ok
                      ? <CheckCircle2 size={20} strokeWidth={2.2} color="#22C55E" />
                      : <TriangleAlert size={20} strokeWidth={2.2} color="#F59E0B" />}
                    <Text style={[
                      styles.doctorSummaryText,
                      { color: fixResult.ok ? '#22C55E' : '#F59E0B' },
                    ]}>
                      {fixResult.ok ? t('Fix completed successfully') : t('Fix completed with issues')}
                    </Text>
                  </View>
                  {fixResult.raw ? (
                    <View style={styles.doctorRawContainer}>
                      <Text style={styles.doctorRawText}>{fixResult.raw}</Text>
                    </View>
                  ) : null}
                </>
              ) : null}
            </>
          ) : null}
        </ScrollView>
        {doctorResult && !doctorResult.ok && !runningDoctor && !fixResult ? (
          <View style={styles.fixButtonContainer}>
            <Pressable
              style={({ pressed }) => [
                styles.fixButton,
                pressed && styles.fixButtonPressed,
                runningFix && styles.rowDisabled,
              ]}
              onPress={handleFixPress}
              disabled={runningFix}
            >
              {runningFix ? (
                <ActivityIndicator size="small" color={theme.colors.primaryText} />
              ) : null}
              <Text style={styles.fixButtonText}>
                {runningFix ? t('Running fix...') : t('Attempt Fix')}
              </Text>
            </Pressable>
          </View>
        ) : null}
      </ModalSheet>
    </ScrollView>
  );
}

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    card: {
      borderRadius: Radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      overflow: 'hidden',
    },
    secondaryCard: {
      marginTop: Space.lg,
      borderRadius: Radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      overflow: 'hidden',
    },
    row: {
      minHeight: 72,
      paddingHorizontal: Space.lg,
      paddingVertical: Space.md,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: Space.md,
    },
    rowPressed: {
      backgroundColor: colors.surfaceMuted,
    },
    rowDisabled: {
      opacity: 0.55,
    },
    rowLead: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.md,
      minWidth: 0,
    },
    rowIconBadge: {
      width: 32,
      height: 32,
      borderRadius: Radius.md,
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
    },
    rowText: {
      flex: 1,
      minWidth: 0,
    },
    rowTitle: {
      color: colors.text,
      fontSize: FontSize.base,
      fontWeight: FontWeight.medium,
    },
    rowSubtitle: {
      color: colors.textSubtle,
      fontSize: FontSize.sm,
      marginTop: 3,
      lineHeight: 18,
    },
    divider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.borderStrong,
      marginLeft: Space.lg,
    },
    doctorScroll: {
      maxHeight: 400,
    },
    doctorContent: {
      paddingHorizontal: Space.lg,
      paddingBottom: Space.lg,
      gap: Space.md,
    },
    doctorLoading: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.md,
      paddingVertical: Space.lg,
      justifyContent: 'center',
    },
    doctorLoadingText: {
      color: colors.textMuted,
      fontSize: FontSize.base,
    },
    doctorErrorContainer: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: Space.md,
      paddingVertical: Space.sm,
    },
    doctorErrorText: {
      color: colors.error,
      fontSize: FontSize.base,
      flex: 1,
      lineHeight: 22,
    },
    doctorSummaryRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.sm,
    },
    doctorSummaryText: {
      fontSize: FontSize.base,
      fontWeight: FontWeight.semibold,
    },
    doctorHint: {
      color: colors.textSubtle,
      fontSize: FontSize.sm,
      lineHeight: 18,
    },
    doctorCheckList: {
      gap: Space.sm,
    },
    doctorCheckRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: Space.sm,
      paddingVertical: 2,
    },
    doctorCheckText: {
      flex: 1,
    },
    doctorCheckName: {
      color: colors.text,
      fontSize: FontSize.sm,
      fontWeight: FontWeight.medium,
    },
    doctorCheckMessage: {
      color: colors.textSubtle,
      fontSize: FontSize.xs,
      marginTop: 1,
      lineHeight: 16,
    },
    doctorRawContainer: {
      backgroundColor: colors.surfaceMuted,
      borderRadius: Radius.sm,
      padding: Space.md,
    },
    doctorRawText: {
      color: colors.text,
      fontSize: FontSize.xs,
      fontFamily: 'monospace',
      lineHeight: 18,
    },
    fixButtonContainer: {
      paddingHorizontal: Space.lg,
      paddingTop: Space.sm,
      paddingBottom: Space.lg,
    },
    fixButton: {
      backgroundColor: colors.primary,
      borderRadius: Radius.md,
      paddingVertical: 11,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
      flexDirection: 'row' as const,
      gap: Space.sm,
    },
    fixButtonPressed: {
      opacity: 0.88,
    },
    fixButtonText: {
      color: colors.primaryText,
      fontSize: FontSize.base,
      fontWeight: FontWeight.semibold,
    },
  });
}
