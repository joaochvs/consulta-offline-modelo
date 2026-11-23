import * as FileSystem from 'expo-file-system/legacy';
import * as SQLite from 'expo-sqlite';
import { remoteConfig } from '../config';
import type { ManifestoBanco } from '../types';
import { closeDatabase, DB_DIRECTORY, DB_NAME, openDatabase } from './database';

const NEW_DB_NAME = 'base_projeto.nova.db';
const BACKUP_DB_NAME = 'base_projeto.backup.db';
const DOWNLOAD_DIRECTORY_URI = FileSystem.documentDirectory;
if (!DOWNLOAD_DIRECTORY_URI) throw new Error('Diretório de documentos indisponível.');
const DOWNLOAD_DIRECTORY_SQLITE = decodeURIComponent(DOWNLOAD_DIRECTORY_URI.replace(/^file:\/\//, '')).replace(/\/$/, '');
const NEW_DB_PATH = `${DOWNLOAD_DIRECTORY_URI.replace(/\/$/, '')}/${NEW_DB_NAME}`;
const VERSION_PATH = `${FileSystem.documentDirectory}consulta-geral-versao.json`;

function noCache(url: string) {
  return `${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}`;
}

async function withTimeout<T>(operation: Promise<T>, milliseconds: number): Promise<T> {
  return Promise.race([
    operation,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error('A operação excedeu o tempo limite.')), milliseconds),
    ),
  ]);
}

export async function readLocalVersion() {
  const info = await FileSystem.getInfoAsync(VERSION_PATH);
  if (!info.exists) return 0;
  try {
    const data = JSON.parse(await FileSystem.readAsStringAsync(VERSION_PATH));
    return Number(data.versao) || 0;
  } catch {
    return 0;
  }
}

async function deleteDownloadedDatabase() {
  await FileSystem.deleteAsync(NEW_DB_PATH, { idempotent: true });
}

async function validateDatabaseContents(db: SQLite.SQLiteDatabase, manifest: ManifestoBanco) {
  const integrity = await db.getFirstAsync<{ integrity_check: string }>('PRAGMA integrity_check');
  if (integrity?.integrity_check !== 'ok') throw new Error('Banco SQLite corrompido.');
  const table = await db.getFirstAsync<{ total: number }>(
    "SELECT COUNT(*) AS total FROM sqlite_master WHERE type='table' AND name='imoveis'",
  );
  if (!table?.total) throw new Error('Tabela imoveis ausente.');
  const rows = await db.getFirstAsync<{ total: number }>('SELECT COUNT(*) AS total FROM imoveis');
  if (rows?.total !== manifest.totalRegistros) {
    throw new Error(`Quantidade divergente: ${rows?.total ?? 0} de ${manifest.totalRegistros}.`);
  }
}

async function validateDownloadedDatabase(path: string, manifest: ManifestoBanco) {
  const info = await FileSystem.getInfoAsync(path, { md5: true });
  if (!info.exists || !info.size) throw new Error('Banco baixado vazio.');
  if (info.size !== manifest.tamanhoBanco) throw new Error('Tamanho do banco divergente.');
  if (info.md5?.toLowerCase() !== manifest.md5Banco.toLowerCase()) {
    throw new Error('Assinatura MD5 divergente.');
  }

  const db = await SQLite.openDatabaseAsync(NEW_DB_NAME, undefined, DOWNLOAD_DIRECTORY_SQLITE);
  try {
    await validateDatabaseContents(db, manifest);
  } finally {
    await db.closeAsync();
  }
}

async function activateDownloadedDatabase(manifest: ManifestoBanco) {
  await closeDatabase();
  const currentDb = await SQLite.openDatabaseAsync(DB_NAME, { useNewConnection: true }, DB_DIRECTORY);
  const backupDb = await SQLite.openDatabaseAsync(BACKUP_DB_NAME, { useNewConnection: true }, DB_DIRECTORY);
  const downloadedDb = await SQLite.openDatabaseAsync(
    NEW_DB_NAME,
    { useNewConnection: true },
    DOWNLOAD_DIRECTORY_SQLITE,
  );
  let backupReady = false;

  try {
    await SQLite.backupDatabaseAsync({ sourceDatabase: currentDb, destDatabase: backupDb });
    backupReady = true;
    await SQLite.backupDatabaseAsync({ sourceDatabase: downloadedDb, destDatabase: currentDb });
    await validateDatabaseContents(currentDb, manifest);
  } catch (error) {
    if (backupReady) {
      await SQLite.backupDatabaseAsync({ sourceDatabase: backupDb, destDatabase: currentDb });
    }
    throw error;
  } finally {
    await downloadedDb.closeAsync();
    await backupDb.closeAsync();
    await currentDb.closeAsync();
    await openDatabase();
  }
}

export type UpdateResult = {
  updated: boolean;
  manifest?: ManifestoBanco;
  message: string;
};

export type DatabaseUpdateProgress = {
  stage: 'checking' | 'downloading' | 'validating' | 'installing' | 'complete';
  downloadedBytes: number;
  totalBytes: number;
  percent: number;
  localVersion: number;
  targetVersion?: number;
};

export async function updateDatabase(onProgress?: (progress: DatabaseUpdateProgress) => void): Promise<UpdateResult> {
  // Também garante que o diretório padrão do SQLite já exista no primeiro uso.
  await openDatabase();
  const initialVersion = await readLocalVersion();
  onProgress?.({ stage: 'checking', downloadedBytes: 0, totalBytes: 0, percent: 0, localVersion: initialVersion });
  if (!remoteConfig.databaseUrl || !remoteConfig.manifestUrl) {
    return { updated: false, message: 'Distribuição ainda não configurada.' };
  }

  const response = await withTimeout(fetch(noCache(remoteConfig.manifestUrl)), 10_000);
  if (!response.ok) throw new Error(`Manifesto indisponível: HTTP ${response.status}`);
  const manifest = (await response.json()) as ManifestoBanco;
  const localVersion = initialVersion;

  if (manifest.versao <= localVersion) {
    await openDatabase();
    onProgress?.({ stage: 'complete', downloadedBytes: manifest.tamanhoBanco, totalBytes: manifest.tamanhoBanco, percent: 100, localVersion, targetVersion: manifest.versao });
    return { updated: false, manifest, message: `Base já está atualizada · versão ${localVersion}.` };
  }

  // O arquivo temporário fica em Documents, onde o FileSystem possui permissão de limpeza.
  await deleteDownloadedDatabase();
  onProgress?.({ stage: 'downloading', downloadedBytes: 0, totalBytes: manifest.tamanhoBanco, percent: 0, localVersion, targetVersion: manifest.versao });
  const download = FileSystem.createDownloadResumable(noCache(remoteConfig.databaseUrl), NEW_DB_PATH, {}, ({ totalBytesWritten, totalBytesExpectedToWrite }) => {
    const totalBytes = totalBytesExpectedToWrite > 0 ? totalBytesExpectedToWrite : manifest.tamanhoBanco;
    onProgress?.({ stage: 'downloading', downloadedBytes: totalBytesWritten, totalBytes, percent: Math.min(100, Math.round((totalBytesWritten / totalBytes) * 100)), localVersion, targetVersion: manifest.versao });
  });
  await withTimeout(
    download.downloadAsync(),
    900_000,
  );
  onProgress?.({ stage: 'validating', downloadedBytes: manifest.tamanhoBanco, totalBytes: manifest.tamanhoBanco, percent: 100, localVersion, targetVersion: manifest.versao });
  await validateDownloadedDatabase(NEW_DB_PATH, manifest);
  onProgress?.({ stage: 'installing', downloadedBytes: manifest.tamanhoBanco, totalBytes: manifest.tamanhoBanco, percent: 100, localVersion, targetVersion: manifest.versao });
  await activateDownloadedDatabase(manifest);
  await FileSystem.writeAsStringAsync(VERSION_PATH, JSON.stringify(manifest));
  try {
    await deleteDownloadedDatabase();
  } catch {
    // A base já foi ativada e versionada; uma falha de limpeza não invalida a atualização.
  }
  onProgress?.({ stage: 'complete', downloadedBytes: manifest.tamanhoBanco, totalBytes: manifest.tamanhoBanco, percent: 100, localVersion: manifest.versao, targetVersion: manifest.versao });
  return { updated: true, manifest, message: `Base atualizada com sucesso · versão ${manifest.versao}.` };
}
