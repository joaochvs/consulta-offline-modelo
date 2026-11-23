import { Stack } from 'expo-router';
import * as Updates from 'expo-updates';
import { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

export default function RootLayout() {
  useEffect(() => {
    async function checkForApplicationUpdate() {
      if (__DEV__ || !Updates.isEnabled) return;
      try {
        const update = await Updates.checkForUpdateAsync();
        if (!update.isAvailable) return;
        await Updates.fetchUpdateAsync();
        await Updates.reloadAsync();
      } catch (error) {
        // Falha de rede não impede o uso offline nem interrompe a abertura do app.
        console.warn('Não foi possível verificar o Expo Update.', error);
      }
    }
    void checkForApplicationUpdate();
  }, []);

  return <SafeAreaProvider><Stack screenOptions={{ headerShown: false }} /></SafeAreaProvider>;
}
