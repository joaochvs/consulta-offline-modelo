import * as SQLite from 'expo-sqlite';
import type { GrupoRevisita, Revisita } from '../types';

export const REVISIT_DB_NAME = 'base_revisitas_projeto.db';
export const REVISIT_DB_DIRECTORY = SQLite.defaultDatabaseDirectory;

let connection: SQLite.SQLiteDatabase | null = null;

const EMPTY_SCHEMA = `
  CREATE TABLE IF NOT EXISTS revisitas (
    codigo_unico TEXT PRIMARY KEY NOT NULL,
    codigo_deep_base TEXT, code_deep TEXT, numero_visita INTEGER, total_visitas INTEGER,
    municipio TEXT, setor INTEGER, bairro TEXT, logradouro TEXT, numero TEXT, complemento TEXT,
    foto_visita TEXT, foto_estrutura TEXT, latitude REAL, longitude REAL, data_registro TEXT, data_modificacao TEXT,
    situacao_backoffice TEXT, encontrou_pessoa TEXT, motivo_nao_contato TEXT,
    motivo_revisita TEXT, grupo_sincronizacao TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_revisitas_grupo ON revisitas(grupo_sincronizacao COLLATE NOCASE);
`;

export async function openRevisitDatabase() {
  if (connection) return connection;
  connection = await SQLite.openDatabaseAsync(
    REVISIT_DB_NAME,
    { useNewConnection: true },
    REVISIT_DB_DIRECTORY,
  );
  await connection.execAsync(EMPTY_SCHEMA);
  const columns = await connection.getAllAsync<{ name: string }>('PRAGMA table_info(revisitas)');
  if (!columns.some((column) => column.name === 'foto_estrutura')) {
    await connection.execAsync('ALTER TABLE revisitas ADD COLUMN foto_estrutura TEXT');
  }
  return connection;
}

export async function closeRevisitDatabase() {
  const current = connection;
  connection = null;
  if (current) await current.closeAsync();
}

export async function getRevisitStats() {
  const db = await openRevisitDatabase();
  return db.getFirstAsync<{ total: number }>('SELECT COUNT(*) AS total FROM revisitas');
}

export async function listRevisitGroups(): Promise<GrupoRevisita[]> {
  const db = await openRevisitDatabase();
  return db.getAllAsync<GrupoRevisita>(
    `SELECT COALESCE(grupo_sincronizacao, 'SEM MUNICÍPIO - SEM SETOR') AS grupo,
            COALESCE(municipio, 'SEM MUNICÍPIO') AS municipio, setor, COUNT(*) AS total,
            SUM(CASE WHEN (foto_visita IS NOT NULL AND TRIM(foto_visita) <> '')
                       OR (foto_estrutura IS NOT NULL AND TRIM(foto_estrutura) <> '') THEN 1 ELSE 0 END) AS fotos
       FROM revisitas
      GROUP BY COALESCE(grupo_sincronizacao, 'SEM MUNICÍPIO - SEM SETOR')
      ORDER BY CASE WHEN municipio IS NULL OR TRIM(municipio) = '' THEN 1 ELSE 0 END,
               TRIM(municipio) COLLATE NOCASE,
               CASE WHEN setor IS NULL THEN 1 ELSE 0 END,
               setor ASC,
               grupo_sincronizacao COLLATE NOCASE`,
  );
}

export async function listRevisits(group: string, search = ''): Promise<Revisita[]> {
  const db = await openRevisitDatabase();
  const term = `%${search.trim()}%`;
  return db.getAllAsync<Revisita>(
    `SELECT * FROM revisitas WHERE grupo_sincronizacao = ? COLLATE NOCASE
       AND (? = '%%' OR codigo_unico LIKE ? OR code_deep LIKE ? OR logradouro LIKE ?)
       ORDER BY logradouro COLLATE NOCASE, numero COLLATE NOCASE, codigo_unico COLLATE NOCASE`,
    group, term, term, term, term,
  );
}

export async function searchRevisitsEverywhere(search: string): Promise<Revisita[]> {
  const db = await openRevisitDatabase();
  const clean = search.trim();
  if (!clean) return [];
  const term = `%${clean}%`;
  return db.getAllAsync<Revisita>(
    `SELECT * FROM revisitas
      WHERE codigo_unico LIKE ? COLLATE NOCASE
         OR code_deep LIKE ? COLLATE NOCASE
         OR codigo_deep_base LIKE ? COLLATE NOCASE
      ORDER BY CASE WHEN codigo_unico = ? COLLATE NOCASE THEN 0 ELSE 1 END,
               codigo_unico COLLATE NOCASE
      LIMIT 30`,
    term, term, term, clean,
  );
}

export async function listRevisitPhotos(group: string) {
  const db = await openRevisitDatabase();
  return db.getAllAsync<{ codigo_unico: string; foto_visita: string | null; foto_estrutura: string | null }>(
    `SELECT codigo_unico, foto_visita, foto_estrutura FROM revisitas
      WHERE grupo_sincronizacao = ? COLLATE NOCASE
        AND ((foto_visita IS NOT NULL AND TRIM(foto_visita) <> '')
          OR (foto_estrutura IS NOT NULL AND TRIM(foto_estrutura) <> ''))`,
    group,
  );
}

export async function listMunicipalityRevisitPhotos(municipality: string) {
  const db = await openRevisitDatabase();
  return db.getAllAsync<{
    codigo_unico: string;
    grupo_sincronizacao: string;
    foto_visita: string | null;
    foto_estrutura: string | null;
  }>(
    `SELECT codigo_unico, grupo_sincronizacao, foto_visita, foto_estrutura FROM revisitas
      WHERE municipio = ? COLLATE NOCASE
        AND ((foto_visita IS NOT NULL AND TRIM(foto_visita) <> '')
          OR (foto_estrutura IS NOT NULL AND TRIM(foto_estrutura) <> ''))`,
    municipality,
  );
}
