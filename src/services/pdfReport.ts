import Constants from 'expo-constants';
import * as FileSystem from 'expo-file-system/legacy';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { getMunicipalityReportRows } from './database';

function escapeHtml(value: unknown) {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}

function safeFilename(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').toLowerCase();
}

function reportHtml(municipality: string, rows: Awaited<ReturnType<typeof getMunicipalityReportRows>>) {
  const body = rows.map((row) => {
    const address = [row.logradouro, row.numero].filter(Boolean).join(', ');
    const coordinates = row.latitude == null || row.longitude == null ? 'Coordenadas não informadas' : `${row.latitude}, ${row.longitude}`;
    return `<tr><td class="code">${escapeHtml(row.codigo_unico)}</td><td>${escapeHtml(row.data_registro)}</td><td><span class="status">${escapeHtml(row.situacao_backoffice || 'Pendente')}</span></td><td><strong>${escapeHtml(address || 'Endereço não informado')}</strong><small>${escapeHtml(coordinates)}</small></td></tr>`;
  }).join('');
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"/><style>
    @page{size:A4 portrait;margin:28px 24px}*{box-sizing:border-box}body{font-family:Arial,sans-serif;color:#18243A;font-size:10.5px;margin:0}h1{margin:0 0 5px;color:#17345F;font-size:21px}.meta{color:#66748D;margin-bottom:15px;font-size:10px}table{width:100%;border-collapse:collapse;table-layout:fixed}thead{display:table-header-group}tr{break-inside:avoid}th{background:#17345F;color:white;text-align:left;padding:8px 7px;font-size:10px}td{border-bottom:1px solid #DDE4ED;padding:8px 7px;vertical-align:top;overflow-wrap:anywhere;line-height:1.35}tbody tr:nth-child(even){background:#F3F6FA}.code{font-weight:700;color:#2856A6}.status{font-weight:700}small{display:block;color:#66748D;margin-top:4px;font-size:9px}th:nth-child(1){width:20%}th:nth-child(2){width:17%}th:nth-child(3){width:19%}th:nth-child(4){width:44%}
  </style></head><body><h1>${escapeHtml(Constants.expoConfig?.name ?? 'Consulta de Campo')}</h1><div class="meta"><strong>${escapeHtml(municipality)}</strong> · ${rows.length.toLocaleString('pt-BR')} registros · ${escapeHtml(new Date().toLocaleString('pt-BR'))}</div><table><thead><tr><th>Matrícula</th><th>Último registro</th><th>Situação</th><th>Localização</th></tr></thead><tbody>${body}</tbody></table></body></html>`;
}

export async function generateMunicipalityPdf(municipality: string) {
  const rows = await getMunicipalityReportRows(municipality);
  if (!rows.length) throw new Error('O município selecionado não possui registros.');
  const result = await Print.printToFileAsync({ html: reportHtml(municipality, rows), width: 595, height: 842 });
  if (!result.uri) throw new Error('O sistema não retornou o arquivo PDF.');
  const directory = `${FileSystem.documentDirectory}relatorios/`;
  await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const destination = `${directory}${safeFilename(municipality) || 'municipio'}_${stamp}.pdf`;
  await FileSystem.moveAsync({ from: result.uri, to: destination });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(destination, { mimeType: 'application/pdf', dialogTitle: `Relatório de ${municipality}`, UTI: 'com.adobe.pdf' });
  }
  return { uri: destination, total: rows.length };
}
