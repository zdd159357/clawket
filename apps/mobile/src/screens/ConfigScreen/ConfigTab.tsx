import React, { useMemo } from 'react';
import { Platform } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useTabBarHeight } from '../../hooks/useTabBarHeight';
import { useAppTheme } from '../../theme';
import { ConfigScreen } from './index';
import { ChatAppearanceScreen } from './ChatAppearanceScreen';
import { HelpCenterScreen } from './HelpCenterScreen';
import { OpenClawReleasesScreen } from './OpenClawReleasesScreen';
import { GatewayConfigViewerScreen } from './GatewayConfigViewerScreen';
import { GatewayConfigBackupsScreen } from './GatewayConfigBackupsScreen';
import { ReleaseNotesHistoryScreen } from './ReleaseNotesHistoryScreen';
import { OpenClawConfigScreen } from './OpenClawConfigScreen';
import { OpenClawDiagnosticsScreen } from './OpenClawDiagnosticsScreen';
import { OpenClawPermissionsScreen } from './OpenClawPermissionsScreen';
import type { RelayDoctorResult } from '../../services/gateway-relay';

export type ConfigStackParamList = {
  ConfigHome: {
    addConnectionRequestAt?: number;
    addConnectionTab?: 'quick' | 'manual';
  } | undefined;
  ChatAppearance: undefined;
  HelpCenter: undefined;
  ReleaseNotesHistory: undefined;
  OpenClawReleases: undefined;
  OpenClawConfig: undefined;
  OpenClawDiagnostics: {
    mode?: 'doctor' | 'fix';
    doctorResult?: RelayDoctorResult;
    doctorError?: string;
    fixResult?: {
      ok: boolean;
      raw?: string;
    };
    fixError?: string;
  };
  OpenClawPermissions: undefined;
  GatewayConfigViewer: undefined;
  GatewayConfigBackups: undefined;
};

const ConfigStack = createNativeStackNavigator<ConfigStackParamList>();

// On iOS the native tab bar overlays content, so screens need paddingBottom.
// On Android the JS tab bar occupies layout space, so no extra padding is needed.
const needsTabBarPadding = Platform.OS === 'ios';

export function ConfigTab(): React.JSX.Element {
  const { theme } = useAppTheme();
  const tabBarHeight = useTabBarHeight();
  const contentStyle = useMemo(
    () => ({
      backgroundColor: theme.colors.background,
      paddingBottom: needsTabBarPadding ? tabBarHeight : 0,
    }),
    [tabBarHeight, theme.colors.background],
  );
  const modalContentStyle = useMemo(
    () => ({
      backgroundColor: theme.colors.background,
    }),
    [theme.colors.background],
  );

  const modalScreenOptions = useMemo(() => {
    if (Platform.OS !== 'ios') {
      return { animation: 'slide_from_right' as const, contentStyle: modalContentStyle, headerShown: true };
    }
    return {
      animation: 'slide_from_bottom' as const,
      presentation: 'modal' as const,
      contentStyle: modalContentStyle,
      gestureEnabled: true,
      headerShown: true,
    };
  }, [modalContentStyle]);

  return (
    <ConfigStack.Navigator
      screenOptions={{
        headerShown: false,
        animation: 'slide_from_right',
        gestureEnabled: true,
        fullScreenGestureEnabled: true,
        contentStyle,
      }}
    >
      <ConfigStack.Screen name="ConfigHome" component={ConfigScreen} />
      <ConfigStack.Screen name="ChatAppearance" component={ChatAppearanceScreen} options={modalScreenOptions} />
      <ConfigStack.Screen name="HelpCenter" component={HelpCenterScreen} options={modalScreenOptions} />
      <ConfigStack.Screen name="ReleaseNotesHistory" component={ReleaseNotesHistoryScreen} options={modalScreenOptions} />
      <ConfigStack.Screen name="OpenClawReleases" component={OpenClawReleasesScreen} />
      <ConfigStack.Screen name="OpenClawConfig" component={OpenClawConfigScreen} options={modalScreenOptions} />
      <ConfigStack.Screen name="OpenClawDiagnostics" component={OpenClawDiagnosticsScreen} options={modalScreenOptions} />
      <ConfigStack.Screen name="OpenClawPermissions" component={OpenClawPermissionsScreen} options={modalScreenOptions} />
      <ConfigStack.Screen name="GatewayConfigViewer" component={GatewayConfigViewerScreen} options={modalScreenOptions} />
      <ConfigStack.Screen name="GatewayConfigBackups" component={GatewayConfigBackupsScreen} options={modalScreenOptions} />
    </ConfigStack.Navigator>
  );
}
