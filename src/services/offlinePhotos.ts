import * as FileSystem from 'expo-file-system/legacy';
import { listSectorPhotos } from './database';
import { readLocalVersion } from './databaseUpdate';

const ROOT = `${FileSystem.documentDirectory}setor_fotos/`;
const INDEX_PATH = `${ROOT}sincronizacao.json`;
const DEFAULT_PHOTO_BYTES = 165_000;
type SyncMarker = { version: number; expected: number; completed?: number; downloaded: number; failed?: number; bytes: number; syncedAt: string; cancelled?: boolean };
type SyncIndex = Record<string, SyncMarker>;
type PhotoKind = 'visita' | 'estrutura';
type PhotoTask = { group: string; code: string; kind: PhotoKind; urls: string[] };
export type PhotoProgress = { completed: number; total: number; downloaded: number; failed: number; bytes: number; bytesPerSecond: number; estimatedRemainingSeconds: number | null };
export type PhotoSyncDetails = { status: 'none' | 'paused' | 'partial' | 'complete'; expected: number; completed: number; downloaded: number; failed: number; bytes: number };
export type PhotoStorageSummary = { completeGroups: number; partialGroups: number; pausedGroups: number; downloadedPhotos: number; failedPhotos: number; bytes: number; lastSync: string | null };

function hash(value: string) { let result = 2166136261; for (let index = 0; index < value.length; index += 1) result = Math.imul(result ^ value.charCodeAt(index), 16777619); return (result >>> 0).toString(16); }
export function extractPhotoUrls(...values: Array<string | null | undefined>) { const urls = values.flatMap((value) => value?.match(/https?:\/\/[^\s"'<>]+/gi) ?? []); return [...new Set(urls.map((url) => url.replace(/[),;\]]+$/, '')).filter(Boolean))]; }
function groupDirectory(group: string) { return `${ROOT}${hash(group)}/`; }
function photoPath(group: string, code: string, kind: PhotoKind) { return `${groupDirectory(group)}${hash(code)}-${kind}.jpg`; }
async function ensureRoot() { await FileSystem.makeDirectoryAsync(ROOT, { intermediates: true }); }
async function readIndex(): Promise<SyncIndex> { try { return JSON.parse(await FileSystem.readAsStringAsync(INDEX_PATH)); } catch { return {}; } }
async function writeIndex(index: SyncIndex) { await ensureRoot(); await FileSystem.writeAsStringAsync(INDEX_PATH, JSON.stringify(index)); }

function recordsToTasks(records: Awaited<ReturnType<typeof listSectorPhotos>>): PhotoTask[] {
  return records.flatMap((photo) => {
    const tasks: PhotoTask[] = [];
    const visita = extractPhotoUrls(photo.foto_visita);
    const estrutura = extractPhotoUrls(photo.foto_estrutura);
    if (visita.length) tasks.push({ group: photo.grupo_sincronizacao, code: photo.codigo_unico, kind: 'visita', urls: visita });
    if (estrutura.length) tasks.push({ group: photo.grupo_sincronizacao, code: photo.codigo_unico, kind: 'estrutura', urls: estrutura });
    return tasks;
  });
}

function markerDetails(marker: SyncMarker | undefined, expected: number): PhotoSyncDetails {
  if (!marker) return { status: 'none', expected, completed: 0, downloaded: 0, failed: 0, bytes: 0 };
  const downloaded = Math.min(marker.downloaded ?? 0, expected);
  const failed = marker.failed ?? Math.max(0, expected - downloaded);
  const completed = marker.completed ?? (failed > 0 ? expected : downloaded);
  const status = downloaded >= expected ? 'complete' : completed >= expected ? 'partial' : downloaded > 0 || completed > 0 ? 'paused' : 'none';
  return { status, expected, completed, downloaded, failed, bytes: marker.bytes ?? 0 };
}
export async function getPhotoSyncDetails(group: string, expected: number) { return markerDetails((await readIndex())[group], expected); }
export async function getPhotoSyncStatus(group: string, expected: number) { return (await getPhotoSyncDetails(group, expected)).status === 'complete'; }
export async function listPhotoGroupStatuses(expectedByGroup: Record<string, number>) { const index = await readIndex(); return Object.fromEntries(Object.entries(expectedByGroup).map(([group, expected]) => [group, markerDetails(index[group], expected)])); }
export async function listSyncedPhotoGroups(expectedByGroup: Record<string, number>) { const statuses = await listPhotoGroupStatuses(expectedByGroup); return Object.entries(statuses).filter(([, details]) => details.status === 'complete').map(([group]) => group); }
export async function getPhotoStorageSummary(): Promise<PhotoStorageSummary> {
  const markers = Object.values(await readIndex());
  const details = markers.map((marker) => markerDetails(marker, marker.expected));
  return {
    completeGroups: details.filter((item) => item.status === 'complete').length,
    partialGroups: details.filter((item) => item.status === 'partial').length,
    pausedGroups: details.filter((item) => item.status === 'paused').length,
    downloadedPhotos: details.reduce((total, item) => total + item.downloaded, 0),
    failedPhotos: details.reduce((total, item) => total + item.failed, 0),
    bytes: details.reduce((total, item) => total + item.bytes, 0),
    lastSync: markers.map((marker) => marker.syncedAt).filter(Boolean).sort().at(-1) ?? null,
  };
}

export async function getSectorDownloadEstimate(group: string) {
  const tasks = recordsToTasks(await listSectorPhotos(group));
  let cached = 0; let cachedBytes = 0;
  for (const task of tasks) { const info = await FileSystem.getInfoAsync(photoPath(task.group, task.code, task.kind)); if (info.exists) { cached += 1; cachedBytes += info.size; } }
  const average = cached ? cachedBytes / cached : DEFAULT_PHOTO_BYTES;
  return { total: tasks.length, cached, pending: tasks.length - cached, estimatedBytes: Math.round((tasks.length - cached) * average) };
}

export async function localPhotoUris(group: string, code: string, visita: string | null, estrutura: string | null) {
  async function resolve(kind: PhotoKind, remote: string | null) { const path = photoPath(group, code, kind); if ((await FileSystem.getInfoAsync(path)).exists) return path; return extractPhotoUrls(remote)[0] ?? null; }
  return { visita: await resolve('visita', visita), estrutura: await resolve('estrutura', estrutura) };
}

export async function synchronizeGroupPhotos(group: string, onProgress?: (progress: PhotoProgress) => void, shouldCancel?: () => boolean) {
  const tasks = recordsToTasks(await listSectorPhotos(group));
  const startedAt = Date.now(); let completed = 0; let downloaded = 0; let failed = 0; let bytes = 0;
  const report = () => { const seconds = Math.max((Date.now() - startedAt) / 1000, 0.1); const speed = bytes / seconds; const averageBytes = downloaded ? bytes / downloaded : DEFAULT_PHOTO_BYTES; const remainingBytes = (tasks.length - completed) * averageBytes; onProgress?.({ completed, total: tasks.length, downloaded, failed, bytes, bytesPerSecond: speed, estimatedRemainingSeconds: speed > 0 ? Math.ceil(remainingBytes / speed) : null }); };
  const saveMarker = async (cancelled: boolean) => { const index = await readIndex(); index[group] = { version: await readLocalVersion(), expected: tasks.length, completed, downloaded, failed, bytes, syncedAt: new Date().toISOString(), cancelled }; await writeIndex(index); };
  for (let start = 0; start < tasks.length; start += 3) {
    if (shouldCancel?.()) { await saveMarker(true); return { downloaded, failed, total: tasks.length, bytes, completed, cancelled: true }; }
    await Promise.all(tasks.slice(start, start + 3).map(async (task) => {
      if (shouldCancel?.()) return;
      await FileSystem.makeDirectoryAsync(groupDirectory(task.group), { intermediates: true });
      const destination = photoPath(task.group, task.code, task.kind);
      let info = await FileSystem.getInfoAsync(destination);
      let success = info.exists && info.size > 0;
      if (!success) for (const url of task.urls) { try { await FileSystem.deleteAsync(destination, { idempotent: true }); const response = await FileSystem.downloadAsync(url, destination); info = await FileSystem.getInfoAsync(destination); if (response.status >= 200 && response.status < 300 && info.exists && info.size > 0) { success = true; break; } } catch { /* próximo link */ } }
      if (success) { downloaded += 1; if (info.exists) bytes += info.size; } else failed += 1;
      completed += 1; report();
    }));
  }
  await saveMarker(false);
  return { downloaded, failed, total: tasks.length, bytes, completed, cancelled: false };
}

export async function clearGroupPhotos(group: string) { await FileSystem.deleteAsync(groupDirectory(group), { idempotent: true }); const index = await readIndex(); delete index[group]; await writeIndex(index); }
export async function clearAllRevisitPhotos() { await FileSystem.deleteAsync(ROOT, { idempotent: true }); }
