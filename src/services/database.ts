import * as SQLite from 'expo-sqlite';
import type { GrupoSetor, Imovel, MunicipioResumo, RegistroRelatorio } from '../types';

export const DB_NAME = 'base_projeto.db';
export const DB_DIRECTORY = SQLite.defaultDatabaseDirectory;
export const DB_PATH = `${DB_DIRECTORY.replace(/\/$/, '')}/${DB_NAME}`;

let connection: SQLite.SQLiteDatabase | null = null;

const EMPTY_SCHEMA = `
  CREATE TABLE IF NOT EXISTS imoveis (
    codigo_deep_base TEXT NOT NULL,
    code_deep TEXT NOT NULL,
    numero_visita INTEGER NOT NULL,
    codigo_unico TEXT PRIMARY KEY NOT NULL,
    municipio TEXT,
    setor INTEGER,
    grupo_sincronizacao TEXT,
    bairro TEXT,
    logradouro TEXT,
    numero TEXT,
    complemento TEXT,
    foto_visita TEXT,
    foto_estrutura TEXT,
    latitude REAL,
    longitude REAL,
    data_registro TEXT,
    data_modificacao TEXT,
    situacao_backoffice TEXT,
    encontrou_pessoa TEXT,
    observacoes TEXT
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_imoveis_codigo_unico ON imoveis(codigo_unico COLLATE NOCASE);
  CREATE INDEX IF NOT EXISTS idx_imoveis_codigo_deep_base ON imoveis(codigo_deep_base);
  CREATE INDEX IF NOT EXISTS idx_imoveis_code_deep ON imoveis(code_deep COLLATE NOCASE);
  CREATE INDEX IF NOT EXISTS idx_imoveis_local ON imoveis(municipio COLLATE NOCASE, bairro COLLATE NOCASE);
`;

export async function openDatabase() {
  if (connection) return connection;
  // A troca da base fecha a conexão anterior. No Android, a conexão em cache pode
  // continuar apontando para o handle nativo já fechado e falhar no prepareAsync.
  connection = await SQLite.openDatabaseAsync(DB_NAME, { useNewConnection: true }, DB_DIRECTORY);
  await connection.execAsync(EMPTY_SCHEMA);
  const columns = await connection.getAllAsync<{ name: string }>('PRAGMA table_info(imoveis)');
  if (!columns.some((column) => column.name === 'foto_visita')) {
    await connection.execAsync('ALTER TABLE imoveis ADD COLUMN foto_visita TEXT');
  }
  if (!columns.some((column) => column.name === 'foto_estrutura')) {
    await connection.execAsync('ALTER TABLE imoveis ADD COLUMN foto_estrutura TEXT');
  }
  if (!columns.some((column) => column.name === 'setor')) {
    await connection.execAsync('ALTER TABLE imoveis ADD COLUMN setor INTEGER');
  }
  if (!columns.some((column) => column.name === 'grupo_sincronizacao')) {
    await connection.execAsync('ALTER TABLE imoveis ADD COLUMN grupo_sincronizacao TEXT');
  }
  await connection.execAsync('CREATE INDEX IF NOT EXISTS idx_imoveis_grupo ON imoveis(grupo_sincronizacao COLLATE NOCASE)');
  return connection;
}

export async function listSectorGroups(): Promise<GrupoSetor[]> {
  const db = await openDatabase();
  return db.getAllAsync<GrupoSetor>(
    `SELECT COALESCE(grupo_sincronizacao, 'SEM MUNICÍPIO - SEM SETOR') AS grupo,
            COALESCE(municipio, 'SEM MUNICÍPIO') AS municipio, setor, COUNT(*) AS total,
            SUM(CASE WHEN foto_visita IS NOT NULL AND TRIM(foto_visita) <> '' THEN 1 ELSE 0 END)
          + SUM(CASE WHEN foto_estrutura IS NOT NULL AND TRIM(foto_estrutura) <> '' THEN 1 ELSE 0 END) AS fotos
       FROM imoveis
      GROUP BY COALESCE(grupo_sincronizacao, 'SEM MUNICÍPIO - SEM SETOR')
      ORDER BY CASE WHEN municipio IS NULL OR TRIM(municipio) = '' THEN 1 ELSE 0 END,
               TRIM(municipio) COLLATE NOCASE,
               CASE WHEN setor IS NULL THEN 1 ELSE 0 END,
               setor ASC, grupo COLLATE NOCASE`,
  );
}

export async function listSectorProperties(group: string, search = ''): Promise<Imovel[]> {
  const db = await openDatabase();
  const term = `%${search.trim()}%`;
  const rows = await db.getAllAsync<Imovel>(
    `SELECT * FROM imoveis WHERE grupo_sincronizacao = ? COLLATE NOCASE
       AND (? = '%%' OR codigo_unico LIKE ? OR code_deep LIKE ? OR logradouro LIKE ? OR bairro LIKE ?)
       ORDER BY codigo_unico COLLATE NOCASE`,
    group, term, term, term, term, term,
  );
  return rows.sort((left, right) => (left.codigo_unico ?? left.code_deep ?? '').localeCompare(
    right.codigo_unico ?? right.code_deep ?? '',
    'pt-BR',
    { numeric: true, sensitivity: 'base' },
  ));
}

export async function searchPropertiesEverywhere(search: string): Promise<Imovel[]> {
  const db = await openDatabase();
  const clean = search.trim();
  if (!clean) return [];
  const term = `%${clean}%`;
  return db.getAllAsync<Imovel>(
    `SELECT * FROM imoveis
      WHERE codigo_unico LIKE ? COLLATE NOCASE
         OR code_deep LIKE ? COLLATE NOCASE
         OR codigo_deep_base LIKE ? COLLATE NOCASE
         OR logradouro LIKE ? COLLATE NOCASE
         OR numero LIKE ? COLLATE NOCASE
         OR bairro LIKE ? COLLATE NOCASE
         OR municipio LIKE ? COLLATE NOCASE
      ORDER BY CASE WHEN codigo_unico = ? COLLATE NOCASE THEN 0 ELSE 1 END,
               codigo_unico COLLATE NOCASE LIMIT 30`,
    term, term, term, term, term, term, term, clean,
  );
}

export async function listSectorPhotos(group: string) {
  const db = await openDatabase();
  return db.getAllAsync<{ codigo_unico: string; grupo_sincronizacao: string; foto_visita: string | null; foto_estrutura: string | null }>(
    `SELECT codigo_unico, grupo_sincronizacao, foto_visita, foto_estrutura FROM imoveis
      WHERE grupo_sincronizacao = ? COLLATE NOCASE
        AND ((foto_visita IS NOT NULL AND TRIM(foto_visita) <> '')
          OR (foto_estrutura IS NOT NULL AND TRIM(foto_estrutura) <> ''))`,
    group,
  );
}

export async function closeDatabase() {
  const current = connection;
  connection = null;
  if (current) await current.closeAsync();
}

export async function searchByUniqueCode(value: string): Promise<Imovel[]> {
  const db = await openDatabase();
  const term = value.trim();
  if (!term) return [];
  return db.getAllAsync<Imovel>(
    `SELECT * FROM imoveis
       WHERE codigo_unico = ? COLLATE NOCASE
       ORDER BY data_modificacao DESC
       LIMIT 20`,
    term,
  );
}

export async function getDatabaseStats() {
  const db = await openDatabase();
  return db.getFirstAsync<{ total: number; ultimaDataRegistro: string | null }>(
    `SELECT COUNT(*) AS total,
            (SELECT data_registro
               FROM imoveis
              WHERE data_registro IS NOT NULL AND TRIM(data_registro) <> ''
              ORDER BY CASE
                WHEN data_registro GLOB '??/??/????'
                  THEN SUBSTR(data_registro, 7, 4) || SUBSTR(data_registro, 4, 2) || SUBSTR(data_registro, 1, 2)
                ELSE data_registro
              END DESC
              LIMIT 1) AS ultimaDataRegistro
       FROM imoveis`,
  );
}

export async function listMunicipalities(): Promise<MunicipioResumo[]> {
  const db = await openDatabase();
  return db.getAllAsync<MunicipioResumo>(
    `SELECT TRIM(municipio) AS municipio, COUNT(*) AS total
       FROM imoveis
      WHERE municipio IS NOT NULL AND TRIM(municipio) <> ''
      GROUP BY TRIM(municipio) COLLATE NOCASE
      ORDER BY TRIM(municipio) COLLATE NOCASE`,
  );
}

export async function getMunicipalityReportRows(municipality: string): Promise<RegistroRelatorio[]> {
  const db = await openDatabase();
  return db.getAllAsync<RegistroRelatorio>(
    `SELECT codigo_unico, data_registro, situacao_backoffice,
            logradouro, numero, latitude, longitude
       FROM imoveis
      WHERE TRIM(municipio) = TRIM(?) COLLATE NOCASE
      ORDER BY codigo_unico COLLATE NOCASE`,
    municipality,
  );
}
