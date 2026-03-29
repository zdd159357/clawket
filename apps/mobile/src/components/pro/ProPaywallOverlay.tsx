import React, { useEffect, useMemo, useRef } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Linking,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { FullWindowOverlay } from 'react-native-screens';
import { RefreshCcw, ShieldCheck, X } from 'lucide-react-native';
import { publicAppLinks } from '../../config/public';
import { useProPaywall } from '../../contexts/ProPaywallContext';
import { analyticsEvents } from '../../services/analytics/events';
import { useAppTheme } from '../../theme';
import { FontSize, FontWeight, Radius, Shadow, Space } from '../../theme/tokens';

type Props = {
  visible: boolean;
  onClose: () => void;
};

export function ProPaywallOverlay({ visible, onClose }: Props): React.JSX.Element | null {
  const { t } = useTranslation(['common']);
  const { theme } = useAppTheme();
  const {
    errorCode,
    isConfigured,
    isLoading,
    isPro,
    offeringsLoading,
    paywallPackages,
    previewOnly,
    blockedFeature,
    hidePaywall,
    purchasePending,
    purchasePro,
    restorePending,
    restorePurchases,
    selectPackage,
    selectedPackage,
    selectedPackageId,
    showPaywall,
    showPaywallPreview,
    statusCode,
  } = useProPaywall();
  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.96)).current;
  const styles = useMemo(() => createStyles(theme.colors), [theme]);

  useEffect(() => {
    if (!visible) return;
    opacity.setValue(0);
    scale.setValue(0.96);
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.spring(scale, {
        toValue: 1,
        useNativeDriver: true,
        damping: 18,
        stiffness: 180,
        mass: 0.9,
      }),
    ]).start();
  }, [opacity, scale, visible]);

  useEffect(() => {
    if (!visible) return;
    analyticsEvents.paywallViewed({
      blocked_feature: blockedFeature,
      package_count: paywallPackages.length,
      preview_only: previewOnly,
      selected_package_id: selectedPackageId,
    });
  }, [blockedFeature, paywallPackages.length, previewOnly, selectedPackageId, visible]);

  if (!visible) return null;

  const reopenPaywall = () => {
    if (previewOnly) {
      showPaywallPreview();
      return;
    }
    if (blockedFeature) {
      showPaywall(blockedFeature);
    }
  };

  const dismissThenRun = async <T,>(task: () => Promise<T>): Promise<T> => {
    hidePaywall();
    await new Promise((resolve) => setTimeout(resolve, 0));
    return task();
  };

  const handleClose = () => {
    analyticsEvents.paywallClosed({
      blocked_feature: blockedFeature,
      preview_only: previewOnly,
    });
    onClose();
  };

  const openExternalUrl = async (url: string) => {
    try {
      await Linking.openURL(url);
    } catch {
      Alert.alert(t('Unable to open link'), t('Please try again later.'));
    }
  };

  const features = [
    { emoji: '\uD83D\uDD17', text: t('Connect to multiple OpenClaws') },
    { emoji: '\uD83D\uDDD2\uFE0F', text: t('Back up, diagnose & fix OpenClaw') },
    { emoji: '\uD83D\uDD10', text: t('View and manage OpenClaw permissions') },
    { emoji: '\u270F\uFE0F', text: t('Edit agent personality and memory') },
    { emoji: '\uD83D\uDCCA', text: t('Search chat history & view logs') },
  ];

  const interactionLocked = previewOnly && isPro;
  const purchaseDisabled = interactionLocked || purchasePending || restorePending || offeringsLoading || isLoading || !isConfigured || !selectedPackage;
  const restoreDisabled = interactionLocked || restorePending || purchasePending;
  const feedback = statusCode
    ? {
      tone: 'success' as const,
      text: statusCode === 'restoreSuccess'
        ? t('Your Pro access has been restored.')
        : null,
    }
    : errorCode
      ? {
        tone: 'error' as const,
        text: mapErrorCode(errorCode, t),
      }
      : null;

  const content = (
    <Animated.View
      style={[
        styles.overlay,
        {
          opacity,
        },
      ]}
      pointerEvents="auto"
    >
      <Pressable style={styles.backdropTap} onPress={handleClose} />
      <Animated.View
        style={[
          styles.card,
          Shadow.lg,
          {
            transform: [{ scale }],
          },
        ]}
      >
        <View style={styles.headerRow}>
          <View style={styles.badge}>
            <ShieldCheck size={16} color={theme.colors.primary} strokeWidth={2.2} />
            <Text style={styles.badgeText}>
              {isPro ? t('You are already a Pro subscriber.') : t('Unlock')}
            </Text>
          </View>
          <Pressable
            onPress={handleClose}
            style={({ pressed }) => [styles.closeButton, pressed && styles.closeButtonPressed]}
            hitSlop={10}
          >
            <X size={18} color={theme.colors.textMuted} strokeWidth={2.2} />
          </Pressable>
        </View>

        <Text style={styles.title}>Clawket Pro</Text>

        {paywallPackages.length > 0 ? (
          <View style={styles.planGrid}>
            {paywallPackages.map((item) => {
              const selected = item.packageIdentifier === selectedPackageId;
              return (
                <Pressable
                  key={item.packageIdentifier}
                  onPress={() => {
                    if (interactionLocked) return;
                    analyticsEvents.paywallPackageSelected(item, {
                      blocked_feature: blockedFeature,
                      preview_only: previewOnly,
                    });
                    selectPackage(item.packageIdentifier);
                  }}
                  disabled={interactionLocked}
                  style={({ pressed }) => [
                    styles.planCard,
                    selected && styles.planCardSelected,
                    interactionLocked && styles.planCardDisabled,
                    pressed && !interactionLocked && styles.planCardPressed,
                  ]}
                >
                  <View style={styles.planHeaderRow}>
                    <Text style={styles.planTitle}>{formatPackageLabel(item.packageType, t)}</Text>
                    <Text style={styles.planPrice}>{item.priceString}</Text>
                  </View>
                  {item.pricePerMonthString && item.packageType === 'ANNUAL' ? (
                    <Text style={styles.planMeta}>
                      {t('{{price}} per month, billed yearly', { price: item.pricePerMonthString })}
                    </Text>
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        ) : null}

        <View style={styles.featureList}>
          {features.map((feature) => (
            <View key={feature.text} style={styles.featureRow}>
              <Text style={styles.featureEmoji}>{feature.emoji}</Text>
              <Text style={styles.featureText}>{feature.text}</Text>
            </View>
          ))}
        </View>

        {feedback?.text ? (
          <View style={feedback.tone === 'success' ? styles.successBanner : styles.errorBanner}>
            <Text style={feedback.tone === 'success' ? styles.successBannerText : styles.errorBannerText}>
              {feedback.text}
            </Text>
          </View>
        ) : null}

        {(isLoading || offeringsLoading) && paywallPackages.length === 0 ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator size="small" color={theme.colors.primary} />
            <Text style={styles.loadingText}>{t('Subscription options are loading...')}</Text>
          </View>
        ) : null}

        <Pressable
          onPress={() => {
            void (async () => {
              analyticsEvents.paywallSubscribeTapped(selectedPackage, {
                blocked_feature: blockedFeature,
                preview_only: previewOnly,
              });
              const success = await dismissThenRun(purchasePro);
              if (!success) {
                analyticsEvents.paywallPurchaseFailed(selectedPackage, {
                  blocked_feature: blockedFeature,
                  preview_only: previewOnly,
                });
                reopenPaywall();
                return;
              }
              analyticsEvents.paywallPurchaseSucceeded(selectedPackage, {
                blocked_feature: blockedFeature,
                preview_only: previewOnly,
              });
              Alert.alert(t('Subscription successful'), t('Your Pro subscription is now active.'));
            })();
          }}
          disabled={purchaseDisabled}
          style={({ pressed }) => [
            styles.primaryCta,
            purchaseDisabled && styles.primaryCtaDisabled,
            pressed && !purchaseDisabled && styles.primaryCtaPressed,
          ]}
        >
          {purchasePending ? (
            <ActivityIndicator size="small" color={theme.colors.primaryText} />
          ) : (
            <Text style={styles.primaryCtaText}>
              {selectedPackage?.priceString
                ? t('Subscribe Now — {{price}}', { price: selectedPackage.priceString })
                : t('Subscribe Now')}
            </Text>
          )}
        </Pressable>

        <Pressable
          onPress={() => {
            void (async () => {
              analyticsEvents.paywallRestoreTapped({
                blocked_feature: blockedFeature,
                preview_only: previewOnly,
              });
              const restored = await dismissThenRun(restorePurchases);
              if (restored) {
                analyticsEvents.paywallRestoreSucceeded({
                  blocked_feature: blockedFeature,
                  preview_only: previewOnly,
                });
                Alert.alert(t('Restore Purchases'), t('Your Pro access has been restored.'));
                return;
              }
              analyticsEvents.paywallRestoreFailed({
                blocked_feature: blockedFeature,
                preview_only: previewOnly,
              });
              reopenPaywall();
            })();
          }}
          disabled={restoreDisabled}
          style={({ pressed }) => [
            styles.restoreLink,
            restoreDisabled && styles.restoreLinkDisabled,
            pressed && !restoreDisabled && styles.restoreLinkPressed,
          ]}
          hitSlop={8}
        >
          {restorePending ? (
            <ActivityIndicator size="small" color={theme.colors.textMuted} />
          ) : (
            <>
              <RefreshCcw size={13} color={theme.colors.textMuted} strokeWidth={2} />
              <Text style={styles.restoreLinkText}>{t('Restore Purchases')}</Text>
            </>
          )}
        </Pressable>

        <View style={styles.legalSection}>
          <Text style={styles.legalNote}>
            {t('Subscriptions renew automatically and can be cancelled anytime in App Store Settings.')}
          </Text>
          {publicAppLinks.privacyPolicyUrl || publicAppLinks.termsOfUseUrl ? (
            <View style={styles.legalLinksRow}>
              {publicAppLinks.privacyPolicyUrl ? (
                <Pressable
                  onPress={() => {
                    void openExternalUrl(publicAppLinks.privacyPolicyUrl as string);
                  }}
                  style={({ pressed }) => [styles.legalLinkButton, pressed && styles.legalLinkButtonPressed]}
                  hitSlop={8}
                >
                  <Text style={styles.legalLinkText}>{t('Privacy Policy')}</Text>
                </Pressable>
              ) : null}
              {publicAppLinks.termsOfUseUrl ? (
                <Pressable
                  onPress={() => {
                    void openExternalUrl(publicAppLinks.termsOfUseUrl as string);
                  }}
                  style={({ pressed }) => [styles.legalLinkButton, pressed && styles.legalLinkButtonPressed]}
                  hitSlop={8}
                >
                  <Text style={styles.legalLinkText}>{t('Terms of Use')}</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}
        </View>
      </Animated.View>
    </Animated.View>
  );

  if (Platform.OS === 'ios') {
    return <FullWindowOverlay>{content}</FullWindowOverlay>;
  }

  return (
    <Modal transparent visible statusBarTranslucent animationType="none" onRequestClose={onClose}>
      {content}
    </Modal>
  );
}

function mapErrorCode(
  errorCode: NonNullable<ReturnType<typeof useProPaywall>['errorCode']>,
  t: (key: string) => string,
): string {
  switch (errorCode) {
    case 'notConfigured':
      return t('Purchases are unavailable right now.');
    case 'purchaseUnavailable':
      return t('Unable to load subscription options right now.');
    case 'purchaseCancelled':
      return t('Purchase was cancelled.');
    case 'purchasePending':
      return t('Your purchase is pending approval.');
    case 'restoreNotFound':
      return t('No active Pro subscription was found to restore.');
    case 'restoreFailed':
      return t('Unable to restore your purchases right now.');
    case 'offeringsUnavailable':
      return t('Unable to load subscription options right now.');
    case 'purchaseFailed':
    default:
      return t('Unable to complete your purchase right now.');
  }
}

function formatPackageLabel(packageType: string, t: (key: string, options?: Record<string, unknown>) => string): string {
  if (packageType === 'MONTHLY') return t('Monthly');
  if (packageType === 'ANNUAL') return t('Yearly');
  return packageType;
}

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    overlay: {
      ...StyleSheet.absoluteFillObject,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.overlay,
      padding: Space.xl,
    },
    backdropTap: {
      ...StyleSheet.absoluteFillObject,
    },
    card: {
      width: '100%',
      maxWidth: 460,
      borderRadius: Radius.lg,
      backgroundColor: colors.surfaceElevated,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: Space.xl,
      paddingVertical: Space.xl,
      gap: Space.lg,
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    badge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.xs,
      paddingHorizontal: Space.sm,
      paddingVertical: Space.xs,
      borderRadius: Radius.full,
      backgroundColor: colors.primarySoft,
    },
    badgeText: {
      fontSize: FontSize.sm,
      fontWeight: FontWeight.semibold,
      color: colors.primary,
    },
    closeButton: {
      width: 36,
      height: 36,
      borderRadius: Radius.full,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surfaceMuted,
    },
    closeButtonPressed: {
      opacity: 0.82,
    },
    title: {
      fontSize: 28,
      lineHeight: 32,
      fontWeight: FontWeight.bold,
      color: colors.text,
    },
    planGrid: {
      gap: Space.sm,
    },
    planCard: {
      gap: Space.xs,
      borderRadius: Radius.md,
      padding: Space.md,
      backgroundColor: colors.surfaceMuted,
      borderWidth: 1,
      borderColor: colors.border,
    },
    planCardSelected: {
      borderColor: colors.primary,
      backgroundColor: colors.primarySoft,
    },
    planCardPressed: {
      opacity: 0.92,
    },
    planCardDisabled: {
      opacity: 0.7,
    },
    planHeaderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: Space.md,
    },
    planTitle: {
      fontSize: FontSize.base,
      fontWeight: FontWeight.semibold,
      color: colors.text,
    },
    planPrice: {
      fontSize: FontSize.base,
      fontWeight: FontWeight.semibold,
      color: colors.primary,
    },
    planMeta: {
      fontSize: FontSize.md,
      color: colors.textMuted,
    },
    featureList: {
      gap: Space.xs,
    },
    featureRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.md,
      paddingVertical: Space.sm,
    },
    featureEmoji: {
      fontSize: 20,
      width: 28,
      textAlign: 'center',
    },
    featureText: {
      flex: 1,
      fontSize: FontSize.base,
      color: colors.text,
      fontWeight: FontWeight.medium,
    },
    errorBanner: {
      borderRadius: Radius.md,
      paddingHorizontal: Space.md,
      paddingVertical: Space.sm,
      backgroundColor: colors.surfaceMuted,
      borderWidth: 1,
      borderColor: colors.error,
    },
    errorBannerText: {
      fontSize: FontSize.md,
      color: colors.error,
      fontWeight: FontWeight.medium,
    },
    successBanner: {
      borderRadius: Radius.md,
      paddingHorizontal: Space.md,
      paddingVertical: Space.sm,
      backgroundColor: colors.primarySoft,
      borderWidth: 1,
      borderColor: colors.primary,
    },
    successBannerText: {
      fontSize: FontSize.md,
      color: colors.primary,
      fontWeight: FontWeight.medium,
    },
    loadingRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.sm,
    },
    loadingText: {
      fontSize: FontSize.md,
      color: colors.textMuted,
    },
    primaryCta: {
      borderRadius: Radius.md,
      paddingVertical: 11,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.primary,
      minHeight: 48,
    },
    primaryCtaDisabled: {
      opacity: 0.6,
    },
    primaryCtaPressed: {
      opacity: 0.88,
    },
    primaryCtaText: {
      fontSize: FontSize.base,
      fontWeight: FontWeight.semibold,
      color: colors.primaryText,
    },
    restoreLink: {
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'center',
      gap: Space.xs,
      paddingVertical: Space.xs,
    },
    restoreLinkDisabled: {
      opacity: 0.5,
    },
    restoreLinkPressed: {
      opacity: 0.6,
    },
    restoreLinkText: {
      fontSize: FontSize.md,
      color: colors.textMuted,
    },
    legalSection: {
      alignItems: 'center',
      gap: Space.xs,
      marginTop: -Space.sm,
    },
    legalNote: {
      fontSize: FontSize.xs,
      lineHeight: 15,
      textAlign: 'center',
      color: colors.textSubtle,
    },
    legalLinksRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: Space.md,
      flexWrap: 'wrap',
    },
    legalLinkButton: {
      paddingHorizontal: Space.xs,
      paddingVertical: 2,
      borderRadius: Radius.sm,
    },
    legalLinkButtonPressed: {
      opacity: 0.7,
    },
    legalLinkText: {
      fontSize: FontSize.xs,
      lineHeight: 15,
      color: colors.textMuted,
    },
  });
}
