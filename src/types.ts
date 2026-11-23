export type Imovel = {
  codigo_deep_base: string;
  code_deep: string;
  numero_visita: number;
  codigo_unico: string | null;
  municipio: string | null;
  setor: number | null;
  grupo_sincronizacao: string;
  bairro: string | null;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  foto_visita: string | null;
  foto_estrutura: string | null;
  latitude: number | null;
  longitude: number | null;
  data_registro: string | null;
  data_modificacao: string | null;
  situacao_backoffice: string | null;
  encontrou_pessoa: string | null;
  observacoes: string | null;
};

export type ManifestoBanco = {
  versao: number;
  schemaVersion: number;
  publicadoEm: string;
  totalRegistros: number;
  tamanhoBanco: number;
  md5Banco: string;
  hashBanco: string;
  versaoMinimaApp?: string;
};

export type MunicipioResumo = { municipio: string; total: number };

export type GrupoSetor = {
  grupo: string;
  municipio: string | null;
  setor: number | null;
  total: number;
  fotos: number;
};

export type Revisita = {
  codigo_unico: string;
  codigo_deep_base: string;
  code_deep: string;
  numero_visita: number;
  total_visitas: number;
  municipio: string | null;
  setor: number | null;
  grupo_sincronizacao: string;
  bairro: string | null;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  foto_visita: string | null;
  foto_estrutura: string | null;
  latitude: number | null;
  longitude: number | null;
  data_registro: string | null;
  situacao_backoffice: string | null;
  motivo_revisita: string;
};

export type GrupoRevisita = {
  grupo: string;
  municipio: string | null;
  setor: number | null;
  total: number;
  fotos: number;
};

export type RegistroRelatorio = {
  codigo_unico: string;
  data_registro: string | null;
  situacao_backoffice: string | null;
  logradouro: string | null;
  numero: string | null;
  latitude: number | null;
  longitude: number | null;
};
