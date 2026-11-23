import * as FileSystem from 'expo-file-system/legacy';
import * as SQLite from 'expo-sqlite';
import { remoteConfig } from '../config';
import type { ManifestoBanco } from '../types';
import { closeRevisitDatabase, openRevisitDatabase, REVISIT_DB_DIRECTORY, REVISIT_DB_NAME } from './revisitDatabase';

const NEW_NAME = 'base_revisitas_projeto.nova.db';
const BACKUP_NAME = 'base_revisitas_projeto.backup.db';
const DOCUMENT_URI = FileSystem.documentDirectory;
if (!DOCUMENT_URI) throw new Error('Diretório de documentos indisponível.');
const DOCUMENT_PATH = decodeURIComponent(DOCUMENT_URI.replace(/^file:\/\//, '')).replace(/\/$/, '');
const NEW_PATH = `${DOCUMENT_URI.replace(/\/$/, '')}/${NEW_NAME}`;
const VERSION_PATH = `${DOCUMENT_URI}consulta-revisitas-versao.json`;

const noCache = (url: string) => `${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}`;

async function withTimeout<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('A operação excedeu o tempo limite.')), milliseconds)),
  ]);
}

export async function readRevisitVersion() {
  const info = await FileSystem.getInfoAsync(VERSION_PATH);
  if (!info.exists) return 0;
  try { return Number(JSON.parse(await FileSystem.readAsStringAsync(VERSION_PATH)).versao) || 0; }
  catch { return 0; }
}

async function validate(db: SQLite.SQLiteDatabase, manifest: ManifestoBanco) {
  const integrity = await db.getFirstAsync<{ integrity_check: string }>('PRAGMA integrity_check');
  if (integrity?.integrity_check !== 'ok') throw new Error('Banco de revisitas corrompido.');
  const table = await db.getFirstAsync<{ total: number }>(
    "SELECT COUNT(*) AS total FROM sqlite_master WHERE type='table' AND name='revisitas'",
  );
  if (!table?.total) throw new Error('Tabela revisitas ausente.');
  const rows = await db.getFirstAsync<{ total: number }>('SELECT COUNT(*) AS total FROM revisitas');
  if (rows?.total !== manifest.totalRegistros) throw new Error('Quantidade de revisitas divergente.');
}

async function activate(manifest: ManifestoBanco) {
  await closeRevisitDatabase();
  const current = await SQLite.openDatabaseAsync(REVISIT_DB_NAME, { useNewConnection: true }, REVISIT_DB_DIRECTORY);
  const backup = await SQLite.openDatabaseAsync(BACKUP_NAME, { useNewConnection: true }, REVISIT_DB_DIRECTORY);
  const downloaded = await SQLite.openDatabaseAsync(NEW_NAME, { useNewConnection: true }, DOCUMENT_PATH);
  let backupReady = false;
  try {
    await SQLite.backupDatabaseAsync({ sourceDatabase: current, destDatabase: backup });
    backupReady = true;
    await SQLite.backupDatabaseAsync({ sourceDatabase: downloaded, destDatabase: current });
    await validate(current, manifest);
  } catch (error) {
    if (backupReady) await SQLite.backupDatabaseAsync({ sourceDatabase: backup, destDatabase: current });
    throw error;
  } finally {
    await downloaded.closeAsync(); await backup.closeAsync(); await current.closeAsync();
    await openRevisitDatabase();
  }
}

export async function updateRevisitDatabase() {
  await openRevisitDatabase();
  if (!remoteConfig.revisitDatabaseUrl || !remoteConfig.revisitManifestUrl) {
    return { updated: false, message: 'Distribuição de revisitas ainda não configurada.' };
  }
  const response = await withTimeout(fetch(noCache(remoteConfig.revisitManifestUrl)), 10_000);
  if (!response.ok) throw new Error(`Manifesto de revisitas indisponível: HTTP ${response.status}`);
  const manifest = await response.json() as ManifestoBanco;
  const localVersion = await readRevisitVersion();
  if (manifest.versao <= localVersion) {
    return { updated: false, manifest, message: `Revisitas atualizadas · versão ${localVersion}.` };
  }
  await FileSystem.deleteAsync(NEW_PATH, { idempotent: true });
  await withTimeout(FileSystem.downloadAsync(noCache(remoteConfig.revisitDatabaseUrl), NEW_PATH), 180_000);
  const info = await FileSystem.getInfoAsync(NEW_PATH, { md5: true });
  if (!info.exists || info.size !== manifest.tamanhoBanco || info.md5?.toLowerCase() !== manifest.md5Banco.toLowerCase()) {
    throw new Error('O arquivo de revisitas baixado não confere com o manifesto.');
  }
  const downloaded = await SQLite.openDatabaseAsync(NEW_NAME, undefined, DOCUMENT_PATH);
  try { await validate(downloaded, manifest); } finally { await downloaded.closeAsync(); }
  await activate(manifest);
  await FileSystem.writeAsStringAsync(VERSION_PATH, JSON.stringify(manifest));
  try { await FileSystem.deleteAsync(NEW_PATH, { idempotent: true }); } catch {}
  return { updated: true, manifest, message: `Revisitas atualizadas · versão ${manifest.versao}.` };
}
