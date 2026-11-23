import Constants from 'expo-constants';

type Extra = {
  databaseUrl?: string;
  manifestUrl?: string;
  revisitDatabaseUrl?: string;
  revisitManifestUrl?: string;
};

const extra = (Constants.expoConfig?.extra ?? {}) as Extra;

export const remoteConfig = {
  databaseUrl: process.env.EXPO_PUBLIC_DATABASE_URL ?? extra.databaseUrl ?? '',
  manifestUrl: process.env.EXPO_PUBLIC_MANIFEST_URL ?? extra.manifestUrl ?? '',
  revisitDatabaseUrl: process.env.EXPO_PUBLIC_REVISIT_DATABASE_URL ?? extra.revisitDatabaseUrl ?? '',
  revisitManifestUrl: process.env.EXPO_PUBLIC_REVISIT_MANIFEST_URL ?? extra.revisitManifestUrl ?? '',
};
