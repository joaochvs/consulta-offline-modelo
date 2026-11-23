import Constants from 'expo-constants';
import * as Clipboard from 'expo-clipboard';
import * as Linking from 'expo-linking';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Image, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getDatabaseStats, listMunicipalities, searchByUniqueCode } from '../services/database';
import { readLocalVersion, updateDatabase, type DatabaseUpdateProgress } from '../services/databaseUpdate';
import { generateMunicipalityPdf } from '../services/pdfReport';
import type { Imovel, MunicipioResumo } from '../types';
import { RevisitsView } from '../components/RevisitsView';
import { extractPhotoUrls, getPhotoStorageSummary, localPhotoUris, type PhotoStorageSummary } from '../services/offlinePhotos';

type Tab = 'revisitas' | 'relatorios' | 'ajustes';
const C = { navy: '#2D3580', blue: '#2D3580', orange: '#F5A623', bg: '#F4F6FB', white: '#FFFFFF', text: '#1A1F3C', muted: '#8A93B2', border: '#E8ECF4', green: '#2E9E5B', greenBg: '#E4F4EA', red: '#D0423A', redBg: '#F9E8E7', yellow: '#9A6900', yellowBg: '#FFF3D6' };

export default function Home() {
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<Tab>('revisitas');
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<Imovel | null>(null);
  const [searched, setSearched] = useState(false);
  const [searching, setSearching] = useState(false);
  const [status, setStatus] = useState('Preparando base local...');
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [baseVersion, setBaseVersion] = useState(0);
  const [sectorRefreshKey, setSectorRefreshKey] = useState(0);
  const [photoCacheRevision, setPhotoCacheRevision] = useState(0);
  const [updateProgress, setUpdateProgress] = useState<DatabaseUpdateProgress | null>(null);
  const [photoStats, setPhotoStats] = useState<PhotoStorageSummary | null>(null);
  const [latestRecordDate, setLatestRecordDate] = useState<string | null>(null);
  const [cities, setCities] = useState<MunicipioResumo[]>([]);
  const [city, setCity] = useState<MunicipioResumo | null>(null);
  const [cityModal, setCityModal] = useState(false);
  const [cityFilter, setCityFilter] = useState('');
  const [generating, setGenerating] = useState(false);
  const [pdfStatus, setPdfStatus] = useState('');
  const [headerExpanded, setHeaderExpanded] = useState(true);

  async function loadMetadata() {
    const [stats, municipalities, version] = await Promise.all([getDatabaseStats(), listMunicipalities(), readLocalVersion()]);
    setTotal(stats?.total ?? 0); setLatestRecordDate(stats?.ultimaDataRegistro ?? null); setCities(municipalities); setBaseVersion(version);
  }
  async function synchronize() {
    setLoading(true);
    try { const update = await updateDatabase(setUpdateProgress); setStatus(update.message); await loadMetadata(); setSectorRefreshKey((value) => value + 1); }
    catch (error) { setStatus(`Não foi possível atualizar. A base anterior foi preservada. ${String(error)}`); await loadMetadata(); }
    finally { setLoading(false); }
  }
  useEffect(() => { synchronize(); }, []);
  useEffect(() => { getPhotoStorageSummary().then(setPhotoStats); }, [photoCacheRevision]);
  async function search() {
    if (!query.trim()) return;
    setSearching(true); setSearched(false);
    try { const rows = await searchByUniqueCode(query); setResult(rows[0] ?? null); setSearched(true); }
    finally { setSearching(false); }
  }
  async function copyCoordinates() {
    if (result?.latitude == null || result.longitude == null) return;
    await Clipboard.setStringAsync(`${result.latitude}, ${result.longitude}`);
    Alert.alert('Coordenadas copiadas', 'Latitude e longitude estão na área de transferência.');
  }
  async function openCoordinatesInMaps() {
    if (result?.latitude == null || result.longitude == null) return;
    const label = encodeURIComponent(result.codigo_unico || result.code_deep);
    try { await Linking.openURL(`geo:${result.latitude},${result.longitude}?q=${result.latitude},${result.longitude}(${label})`); }
    catch { Alert.alert('Não foi possível abrir o mapa', 'Copie as coordenadas e utilize no aplicativo de mapas.'); }
  }
  async function createPdf() {
    if (!city) return;
    setGenerating(true); setPdfStatus('Gerando PDF offline...');
    try { const generated = await generateMunicipalityPdf(city.municipio); setPdfStatus(`PDF salvo com ${generated.total.toLocaleString('pt-BR')} registros.`); }
    catch (error) { setPdfStatus(`Não foi possível gerar o PDF: ${String(error)}`); }
    finally { setGenerating(false); }
  }
  function confirmPdf() {
    if (!city) return;
    Alert.alert('Gerar relatório?', `${city.total.toLocaleString('pt-BR')} registros serão incluídos.`, [{ text: 'Cancelar', style: 'cancel' }, { text: 'Gerar PDF', onPress: createPdf }]);
  }
  const filteredCities = useMemo(() => cities.filter((item) => item.municipio.toLocaleLowerCase('pt-BR').includes(cityFilter.trim().toLocaleLowerCase('pt-BR'))), [cities, cityFilter]);

  return <View style={s.screen}>
    <StatusBar style="light" />
    <View style={[s.header, !headerExpanded && s.headerCompact, { paddingTop: insets.top + (headerExpanded ? 12 : 7) }]}>
      <View style={s.headerMainRow}><View style={s.headerIdentity}><Text style={[s.brand, !headerExpanded && s.brandCompact]}>consulta</Text>{!headerExpanded && <Text style={s.compactTitle}>{Constants.expoConfig?.name ?? 'Consulta de Campo'}</Text>}</View><Pressable style={({ pressed }) => [s.headerToggle, pressed && s.headerTogglePressed]} onPress={() => setHeaderExpanded((value) => !value)} accessibilityRole="button" accessibilityLabel={headerExpanded ? 'Recolher cabeçalho' : 'Expandir cabeçalho'}><HeaderChevron expanded={headerExpanded} /></Pressable></View>
      {headerExpanded && <><Text style={s.headerTitle}>{Constants.expoConfig?.name ?? 'Consulta de Campo'}</Text><Text style={s.headerCaption}>Informações de campo, rápidas e seguras.</Text><View style={s.headerStatus}><View style={[s.liveDot, loading && s.liveDotLoading]} /><View style={s.headerStatusText}><Text style={s.headerStatusTitle}>{loading ? 'Sincronizando base' : 'Base disponível offline'}</Text><Text style={s.headerStatusCaption}>{total.toLocaleString('pt-BR')} imóveis no aparelho</Text></View><Pressable style={s.headerRefresh} onPress={synchronize} disabled={loading}>{loading ? <ActivityIndicator size="small" color={C.navy} /> : <Text style={s.headerRefreshText}>↻</Text>}</Pressable></View></>}
    </View>
    <View style={s.body}>
      <View style={{ flex: 1, display: tab === 'revisitas' ? 'flex' : 'none' }}><RevisitsView refreshKey={sectorRefreshKey} onPhotosChanged={() => setPhotoCacheRevision((value) => value + 1)} /></View>
      {tab === 'relatorios' && <ScrollView contentContainerStyle={s.content}><View style={s.card}><Text style={s.sectionKicker}>RELATÓRIOS</Text><Text style={s.title}>PDF por município</Text><Text style={s.help}>Gerado offline usando a base atual do aparelho.</Text><Pressable style={s.selector} onPress={() => setCityModal(true)}><Text style={city ? s.selectorValue : s.selectorPlaceholder}>{city?.municipio ?? 'Selecionar município'}</Text><Text style={s.arrow}>⌄</Text></Pressable>{city && <View style={s.summary}><Text style={s.summaryNumber}>{city.total.toLocaleString('pt-BR')}</Text><Text style={s.summaryLabel}>registros no relatório</Text></View>}<PrimaryButton label="Gerar e compartilhar PDF" loading={generating} disabled={!city} onPress={confirmPdf} />{!!pdfStatus && <Text style={s.pdfStatus}>{pdfStatus}</Text>}</View><View style={s.card}><Text style={s.sectionKicker}>CONTEÚDO</Text><Text style={s.list}>Código único · Último registro · Situação · Endereço · Número · Latitude · Longitude</Text></View></ScrollView>}
      {tab === 'ajustes' && <ScrollView contentContainerStyle={s.content}><View style={s.card}><Text style={s.sectionKicker}>SINCRONIZAÇÃO</Text><Text style={s.title}>Base offline</Text><Text style={s.help}>{status}</Text>{updateProgress && <UpdateProgressCard progress={updateProgress} />}<PrimaryButton label="Verificar atualização" loading={loading} onPress={synchronize} /></View><View style={s.card}><Text style={s.sectionKicker}>DIAGNÓSTICO DA BASE</Text>{latestRecordDate && <View style={s.coverageNotice}><Text style={s.coverageNoticeText}>Último registro de visita disponível na base: {formatDate(latestRecordDate)}.</Text></View>}<InfoRow label="Último registro da base" value={formatDate(latestRecordDate)} /><InfoRow label="Versão da base geral" value={baseVersion > 0 ? String(baseVersion) : 'Não identificada'} /><InfoRow label="Imóveis disponíveis" value={total.toLocaleString('pt-BR')} /><InfoRow label="Armazenamento" value="SQLite local" /></View><View style={s.card}><Text style={s.sectionKicker}>DIAGNÓSTICO DAS FOTOS</Text><InfoRow label="Setores completos" value={String(photoStats?.completeGroups ?? 0)} /><InfoRow label="Setores parciais" value={String(photoStats?.partialGroups ?? 0)} /><InfoRow label="Downloads pausados" value={String(photoStats?.pausedGroups ?? 0)} /><InfoRow label="Fotos salvas" value={(photoStats?.downloadedPhotos ?? 0).toLocaleString('pt-BR')} /><InfoRow label="Fotos com falha" value={(photoStats?.failedPhotos ?? 0).toLocaleString('pt-BR')} /><InfoRow label="Espaço utilizado" value={formatBytes(photoStats?.bytes ?? 0)} /><InfoRow label="Última sincronização" value={photoStats?.lastSync ? new Date(photoStats.lastSync).toLocaleString('pt-BR') : 'Nenhuma'} /></View></ScrollView>}
    </View>
    <View style={[s.tabBar, { paddingBottom: Math.max(insets.bottom, 10) }]}><TabButton active={tab === 'revisitas'} icon="▦" label="Setores" onPress={() => setTab('revisitas')} /><TabButton active={tab === 'relatorios'} icon="▤" label="Relatórios" onPress={() => setTab('relatorios')} /><TabButton active={tab === 'ajustes'} icon="⚙" label="Ajustes" onPress={() => setTab('ajustes')} /></View>
    <Modal visible={cityModal} transparent animationType="fade" onRequestClose={() => setCityModal(false)}><View style={[s.overlay, { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 20 }]}><View style={s.modal}><Text style={s.modalTitle}>Selecionar município</Text><TextInput style={s.modalInput} value={cityFilter} onChangeText={setCityFilter} placeholder="Pesquisar município" placeholderTextColor={C.muted} /><FlatList data={filteredCities} keyExtractor={(item) => item.municipio} keyboardShouldPersistTaps="handled" renderItem={({ item }) => <Pressable style={s.cityRow} onPress={() => { setCity(item); setCityModal(false); setCityFilter(''); setPdfStatus(''); }}><Text style={s.cityName}>{item.municipio}</Text><Text style={s.cityTotal}>{item.total.toLocaleString('pt-BR')}</Text></Pressable>} /><Pressable style={s.close} onPress={() => setCityModal(false)}><Text style={s.closeText}>Fechar</Text></Pressable></View></View></Modal>
  </View>;
}

function PropertyResult({ result, photoCacheRevision, onCopyCoordinates, onOpenMaps }: { result: Imovel; photoCacheRevision: number; onCopyCoordinates: () => void; onOpenMaps: () => void }) {
  const tone = statusTone(result.situacao_backoffice);
  const address = [result.logradouro, result.numero].filter(Boolean).join(', ');
  const place = [result.bairro, result.municipio].filter(Boolean).join(' · ');
  return <><View style={s.propertyCard}><View style={s.propertyTop}><View style={s.propertyIdentity}><Text style={s.sectionKicker}>MATRÍCULA</Text><Text style={s.propertyCode}>{result.codigo_unico}</Text></View><View style={[s.statusBadge, { backgroundColor: tone.background }]}><View style={[s.statusDot, { backgroundColor: tone.color }]} /><Text style={[s.statusBadgeText, { color: tone.color }]}>{tone.label}</Text></View></View><View style={s.visitGrid}><InfoTile label="CODE DEEP" value={result.codigo_deep_base} /><InfoTile label="VISITA" value={`Nº ${result.numero_visita}`} /><InfoTile label="ÚLTIMO REGISTRO" value={formatDate(result.data_registro)} wide /></View></View>
    <View style={s.locationCard}><View style={s.locationHeading}><View><Text style={s.sectionKicker}>LOCALIZAÇÃO</Text><Text style={s.locationTitle}>Endereço do imóvel</Text></View><Text style={s.pin}>●</Text></View><PropertyPhotos group={result.grupo_sincronizacao} code={result.codigo_unico ?? result.code_deep ?? ''} visita={result.foto_visita} estrutura={result.foto_estrutura} cacheRevision={photoCacheRevision} /><View style={s.addressBlock}><Text style={s.address}>{address || 'Endereço não informado'}</Text>{!!result.complemento && <Text style={s.complement}>{result.complemento}</Text>}<Text style={s.place}>{place || 'Município e bairro não informados'}</Text></View><View style={s.coordinateRow}><Coordinate label="LATITUDE" value={result.latitude} /><View style={s.coordinateDivider} /><Coordinate label="LONGITUDE" value={result.longitude} /></View>{result.latitude != null && result.longitude != null && <><Pressable style={s.openMapButton} onPress={onOpenMaps}><Text style={s.openMapButtonText}>Abrir no Maps</Text></Pressable><Pressable style={s.copyButton} onPress={onCopyCoordinates}><Text style={s.copyButtonIcon}>□</Text><Text style={s.copyButtonText}>Copiar coordenadas</Text></Pressable></>}</View></>;
}

function PropertyPhotos({ group, code, visita, estrutura, cacheRevision }: { group: string; code: string; visita: string | null; estrutura: string | null; cacheRevision: number }) {
  const { width } = useWindowDimensions();
  const slideWidth = width - 34;
  const [photos, setPhotos] = useState({ visita, estrutura });
  useEffect(() => { localPhotoUris(group, code, visita, estrutura).then(setPhotos); }, [group, code, visita, estrutura, cacheRevision]);
  return <View><ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false}>{[{ label: 'FOTO DA FACHADA', value: photos.visita }].map((photo) => <View key={photo.label} style={{ width: slideWidth }}><VisitPhoto value={photo.value} label={photo.label} /></View>)}</ScrollView><Text style={{ color: C.muted, fontSize: 10, textAlign: 'center', paddingVertical: 7 }}>Foto da fachada</Text></View>;
}

function VisitPhoto({ value, label }: { value: string | null; label: string }) {
  const urls = useMemo(() => extractPhotoUrls(value), [value]);
  const [urlIndex, setUrlIndex] = useState(0);
  const uri = urls[urlIndex] ?? null;
  const [loading, setLoading] = useState(Boolean(uri));
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => { setUrlIndex(0); setFailed(false); }, [value]);
  if (!uri) return <View style={s.noPhoto}><Text style={s.noPhotoIcon}>▧</Text><Text style={s.noPhotoText}>{label}: não disponível</Text></View>;
  function retry() { setFailed(false); setLoading(true); setAttempt((current) => current + 1); }
  if (failed) return <View style={s.noPhoto}><Text style={s.noPhotoIcon}>▧</Text><Text style={s.noPhotoText}>Não foi possível carregar a foto</Text><View style={s.photoActions}><Pressable style={s.photoAction} onPress={retry}><Text style={s.photoActionText}>Tentar novamente</Text></Pressable><Pressable style={s.photoAction} onPress={() => Linking.openURL(uri)}><Text style={s.photoActionText}>Abrir foto</Text></Pressable></View></View>;
  return <View style={s.photoFrame}>{loading && <View style={s.photoLoading}><ActivityIndicator color={C.blue} /><Text style={s.photoLoadingText}>Carregando foto...</Text></View>}<Image key={`${uri}-${attempt}`} source={{ uri, headers: { Accept: 'image/jpeg,image/*' }, cache: 'reload' }} style={s.propertyPhoto} resizeMode="cover" onLoadStart={() => setLoading(true)} onLoad={() => setLoading(false)} onError={() => { setLoading(false); if (urlIndex + 1 < urls.length) setUrlIndex((current) => current + 1); else setFailed(true); }} /><View style={{ position: 'absolute', left: 12, bottom: 10, backgroundColor: 'rgba(26,31,60,0.78)', borderRadius: 8, paddingHorizontal: 9, paddingVertical: 5 }}><Text style={{ color: C.white, fontSize: 9, fontWeight: '900' }}>{label}</Text></View></View>;
}

function statusTone(status: string | null) { const value = (status ?? '').trim().toLocaleLowerCase('pt-BR'); if (value.includes('aprov')) return { label: status || 'Aprovado', color: C.green, background: C.greenBg }; if (value.includes('reprov')) return { label: status || 'Reprovado', color: C.red, background: C.redBg }; if (value.includes('pendent') || !value) return { label: status || 'Pendente', color: C.yellow, background: C.yellowBg }; return { label: status || 'Sem status', color: C.blue, background: '#EAF0FB' }; }
function formatDate(value: string | null) { if (!value) return 'Não informada'; const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/); return match ? `${match[3]}/${match[2]}/${match[1]}` : value; }
function InfoTile({ label, value, wide }: { label: string; value: unknown; wide?: boolean }) { return <View style={[s.infoTile, wide && s.infoTileWide]}><Text style={s.infoTileLabel}>{label}</Text><Text style={s.infoTileValue} numberOfLines={1}>{value == null || value === '' ? 'Não informado' : String(value)}</Text></View>; }
function Coordinate({ label, value }: { label: string; value: number | null }) { return <View style={s.coordinate}><Text style={s.coordinateLabel}>{label}</Text><Text style={s.coordinateValue} numberOfLines={1}>{value == null ? 'Não informada' : String(value)}</Text></View>; }
function InfoRow({ label, value }: { label: string; value: string }) { return <View style={s.infoRow}><Text style={s.infoRowLabel}>{label}</Text><Text style={s.infoRowValue}>{value}</Text></View>; }
function formatBytes(value: number) { if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`; return `${(value / 1024 / 1024).toFixed(1)} MB`; }
function UpdateProgressCard({ progress }: { progress: DatabaseUpdateProgress }) {
  const labels = { checking: 'Verificando versão disponível', downloading: 'Baixando nova base', validating: 'Validando integridade', installing: 'Instalando com backup seguro', complete: 'Atualização concluída' };
  const versions = progress.targetVersion && progress.targetVersion !== progress.localVersion ? `Versão ${progress.localVersion} → ${progress.targetVersion}` : `Versão ${progress.localVersion}`;
  return <View style={s.updateProgress}><View style={s.updateProgressTop}><Text style={s.updateStage}>{labels[progress.stage]}</Text><Text style={s.updatePercent}>{progress.stage === 'downloading' ? `${progress.percent}%` : versions}</Text></View>{progress.stage === 'downloading' && <><View style={s.updateTrack}><View style={[s.updateFill, { width: `${progress.percent}%` }]} /></View><Text style={s.updateBytes}>{formatBytes(progress.downloadedBytes)} de {formatBytes(progress.totalBytes)} · {versions}</Text></>}</View>;
}
function PrimaryButton({ label, loading, disabled, onPress }: { label: string; loading?: boolean; disabled?: boolean; onPress: () => void }) { return <Pressable style={[s.primary, disabled && s.disabled]} disabled={disabled || loading} onPress={onPress}>{loading ? <ActivityIndicator color={C.white} /> : <Text style={s.buttonText}>{label}</Text>}</Pressable>; }
function HeaderChevron({ expanded }: { expanded: boolean }) { return <View style={[s.chevronIcon, !expanded && s.chevronIconDown]}><View style={[s.chevronLine, s.chevronLineLeft]} /><View style={[s.chevronLine, s.chevronLineRight]} /></View>; }
function TabButton({ active, icon, label, onPress }: { active: boolean; icon: string; label: string; onPress: () => void }) { return <Pressable style={s.tabButton} onPress={onPress}><View style={[s.tabIconWrap, active && s.tabIconWrapActive]}><Text style={[s.tabIcon, active && s.active]}>{icon}</Text></View><Text style={[s.tabText, active && s.active]}>{label}</Text></Pressable>; }

const s = StyleSheet.create({
  updateProgress: { backgroundColor: '#EBECF8', borderRadius: 13, padding: 12, marginTop: 10 }, updateProgressTop: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 }, updateStage: { flex: 1, color: C.blue, fontSize: 11, fontWeight: '900' }, updatePercent: { color: C.blue, fontSize: 10, fontWeight: '900' }, updateTrack: { height: 7, backgroundColor: '#D4D8EE', borderRadius: 999, overflow: 'hidden', marginTop: 10 }, updateFill: { height: 7, backgroundColor: C.orange, borderRadius: 999 }, updateBytes: { color: C.muted, fontSize: 9, fontWeight: '700', marginTop: 6 },
  screen: { flex: 1, backgroundColor: C.bg }, body: { flex: 1 }, header: { backgroundColor: C.navy, paddingHorizontal: 20, paddingBottom: 18, borderBottomLeftRadius: 28, borderBottomRightRadius: 28 }, headerCompact: { paddingBottom: 8, borderBottomLeftRadius: 18, borderBottomRightRadius: 18 }, headerMainRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, headerIdentity: { flexDirection: 'row', alignItems: 'baseline', gap: 10 }, brand: { color: C.white, fontSize: 37, fontWeight: '800', letterSpacing: -1.8 }, brandCompact: { fontSize: 26, letterSpacing: -1.2 }, compactTitle: { color: '#D5DFEC', fontSize: 12, fontWeight: '700' }, headerToggle: { width: 40, height: 34, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)', backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' }, headerTogglePressed: { backgroundColor: 'rgba(255,255,255,0.2)', transform: [{ scale: 0.96 }] }, chevronIcon: { width: 18, height: 10, transform: [{ rotate: '0deg' }] }, chevronIconDown: { transform: [{ rotate: '180deg' }] }, chevronLine: { position: 'absolute', top: 4, width: 11, height: 2.5, borderRadius: 2, backgroundColor: C.white }, chevronLineLeft: { left: 0, transform: [{ rotate: '-40deg' }] }, chevronLineRight: { right: 0, transform: [{ rotate: '40deg' }] }, headerTitle: { color: C.white, fontSize: 21, fontWeight: '800', marginTop: 8 }, headerCaption: { color: '#C6D2E4', fontSize: 12, marginTop: 2 }, headerStatus: { marginTop: 16, backgroundColor: 'rgba(255,255,255,0.1)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)', borderRadius: 15, padding: 12, flexDirection: 'row', alignItems: 'center' }, liveDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: '#65D49A', marginRight: 10 }, liveDotLoading: { backgroundColor: C.orange }, headerStatusText: { flex: 1 }, headerStatusTitle: { color: C.white, fontSize: 12, fontWeight: '800' }, headerStatusCaption: { color: '#C6D2E4', fontSize: 10, marginTop: 2 }, headerRefresh: { width: 34, height: 34, borderRadius: 10, backgroundColor: C.orange, alignItems: 'center', justifyContent: 'center' }, headerRefreshText: { color: C.navy, fontSize: 21, fontWeight: '900' },
  content: { padding: 16, paddingBottom: 28 }, searchCard: { backgroundColor: C.white, borderRadius: 20, padding: 18, marginBottom: 14, borderWidth: 1, borderColor: C.border, shadowColor: '#1B3150', shadowOpacity: 0.06, shadowRadius: 14, shadowOffset: { width: 0, height: 5 }, elevation: 2 }, sectionKicker: { color: C.orange, fontSize: 10, fontWeight: '900', letterSpacing: 1.2, marginBottom: 6 }, title: { color: C.text, fontSize: 21, fontWeight: '800' }, help: { color: C.muted, fontSize: 12, lineHeight: 18, marginTop: 5, marginBottom: 14 }, searchRow: { flexDirection: 'row', gap: 9 }, input: { flex: 1, backgroundColor: C.bg, borderWidth: 1, borderColor: C.border, borderRadius: 13, paddingHorizontal: 14, paddingVertical: 13, fontSize: 15, color: C.text }, searchButton: { width: 51, borderRadius: 13, backgroundColor: C.blue, alignItems: 'center', justifyContent: 'center' }, searchIcon: { color: C.white, fontSize: 25, fontWeight: '700' },
  empty: { backgroundColor: C.white, padding: 28, borderRadius: 20, alignItems: 'center', borderWidth: 1, borderColor: C.border }, emptyIcon: { color: C.blue, fontSize: 30 }, emptyTitle: { color: C.text, fontSize: 16, fontWeight: '800', marginTop: 8 }, emptyText: { color: C.muted, fontSize: 12, marginTop: 4 }, propertyCard: { backgroundColor: C.white, borderRadius: 20, padding: 18, marginBottom: 14, borderWidth: 1, borderColor: C.border }, propertyTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 }, propertyIdentity: { flex: 1 }, propertyCode: { color: C.text, fontSize: 22, fontWeight: '900' }, statusBadge: { flexDirection: 'row', alignItems: 'center', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 7, maxWidth: '44%' }, statusDot: { width: 6, height: 6, borderRadius: 3, marginRight: 6 }, statusBadgeText: { fontSize: 11, fontWeight: '900' }, visitGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 9, marginTop: 16 }, infoTile: { width: '48%', backgroundColor: C.bg, borderRadius: 13, padding: 12 }, infoTileWide: { width: '100%' }, infoTileLabel: { color: C.muted, fontSize: 9, fontWeight: '800', letterSpacing: 0.6 }, infoTileValue: { color: C.text, fontSize: 14, fontWeight: '800', marginTop: 5 },
  locationCard: { backgroundColor: C.white, borderRadius: 20, overflow: 'hidden', marginBottom: 14, borderWidth: 1, borderColor: C.border }, locationHeading: { padding: 18, paddingBottom: 13, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, locationTitle: { color: C.text, fontSize: 18, fontWeight: '800' }, pin: { color: C.orange, fontSize: 20 }, photoFrame: { height: 210, backgroundColor: '#DFE5ED' }, propertyPhoto: { width: '100%', height: 210, backgroundColor: '#DFE5ED' }, photoLoading: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center' }, photoLoadingText: { color: C.muted, fontSize: 11, fontWeight: '700', marginTop: 8 }, noPhoto: { minHeight: 145, backgroundColor: '#EAF0F6', alignItems: 'center', justifyContent: 'center', padding: 18 }, noPhotoIcon: { color: '#A4B1C3', fontSize: 30 }, noPhotoText: { color: C.muted, fontSize: 12, fontWeight: '700', marginTop: 8 }, photoActions: { flexDirection: 'row', gap: 8, marginTop: 12 }, photoAction: { borderWidth: 1, borderColor: C.blue, borderRadius: 9, paddingHorizontal: 11, paddingVertical: 8 }, photoActionText: { color: C.blue, fontSize: 10, fontWeight: '900' }, addressBlock: { paddingHorizontal: 18, paddingTop: 16 }, address: { color: C.text, fontSize: 17, fontWeight: '800', lineHeight: 23 }, complement: { color: C.muted, fontSize: 12, marginTop: 3 }, place: { color: C.blue, fontSize: 12, fontWeight: '700', marginTop: 7 }, coordinateRow: { margin: 18, marginBottom: 10, backgroundColor: C.bg, borderRadius: 13, flexDirection: 'row', padding: 13 }, coordinate: { flex: 1 }, coordinateDivider: { width: 1, backgroundColor: C.border, marginHorizontal: 10 }, coordinateLabel: { color: C.muted, fontSize: 9, fontWeight: '800', letterSpacing: 0.6 }, coordinateValue: { color: C.text, fontSize: 12, fontWeight: '800', marginTop: 5 }, openMapButton: { marginHorizontal: 18, marginBottom: 8, borderRadius: 12, backgroundColor: C.blue, paddingVertical: 12, alignItems: 'center' }, openMapButtonText: { color: C.white, fontSize: 12, fontWeight: '900' }, copyButton: { marginHorizontal: 18, marginBottom: 18, borderRadius: 12, borderWidth: 1.5, borderColor: C.blue, paddingVertical: 12, alignItems: 'center', justifyContent: 'center', flexDirection: 'row' }, copyButtonIcon: { color: C.blue, marginRight: 7 }, copyButtonText: { color: C.blue, fontSize: 12, fontWeight: '900' },
  card: { backgroundColor: C.white, borderRadius: 20, padding: 18, marginBottom: 14, borderWidth: 1, borderColor: C.border }, selector: { borderWidth: 1, borderColor: C.border, backgroundColor: C.bg, borderRadius: 13, paddingHorizontal: 14, paddingVertical: 14, flexDirection: 'row' }, selectorValue: { flex: 1, color: C.text, fontWeight: '800' }, selectorPlaceholder: { flex: 1, color: C.muted }, arrow: { color: C.blue, fontSize: 19 }, summary: { backgroundColor: '#EAF0FB', borderRadius: 13, padding: 15, marginTop: 11, alignItems: 'center' }, summaryNumber: { color: C.blue, fontSize: 26, fontWeight: '900' }, summaryLabel: { color: C.muted, fontSize: 11 }, primary: { backgroundColor: C.blue, borderRadius: 13, paddingVertical: 14, alignItems: 'center', marginTop: 11 }, disabled: { opacity: 0.45 }, buttonText: { color: C.white, fontWeight: '900', fontSize: 13 }, pdfStatus: { color: C.muted, fontSize: 11, lineHeight: 17, marginTop: 11 }, list: { color: C.text, fontSize: 13, lineHeight: 21 }, coverageNotice: { backgroundColor: '#EAF0FB', borderLeftWidth: 4, borderLeftColor: C.blue, borderRadius: 12, padding: 13, marginTop: 10, marginBottom: 10 }, coverageNoticeText: { color: C.navy, fontSize: 12, fontWeight: '700', lineHeight: 18 }, infoRow: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: C.border, paddingVertical: 12 }, infoRowLabel: { flex: 1, color: C.muted, fontSize: 12 }, infoRowValue: { color: C.text, fontSize: 12, fontWeight: '800' },
  tabBar: { backgroundColor: C.white, borderTopWidth: 1, borderTopColor: C.border, flexDirection: 'row', paddingTop: 8, shadowColor: '#0A1A32', shadowOpacity: 0.08, shadowRadius: 12, shadowOffset: { width: 0, height: -4 }, elevation: 12 }, tabButton: { flex: 1, alignItems: 'center' }, tabIconWrap: { minWidth: 42, height: 27, borderRadius: 14, alignItems: 'center', justifyContent: 'center' }, tabIconWrapActive: { backgroundColor: '#EAF0FB' }, tabIcon: { color: C.muted, fontSize: 19 }, tabText: { color: C.muted, fontSize: 10, fontWeight: '800', marginTop: 2 }, active: { color: C.blue }, overlay: { flex: 1, backgroundColor: 'rgba(10,25,48,0.6)', justifyContent: 'center', paddingHorizontal: 18 }, modal: { backgroundColor: C.white, borderRadius: 20, padding: 18, maxHeight: '78%' }, modalTitle: { color: C.text, fontSize: 19, fontWeight: '800', marginBottom: 12 }, modalInput: { backgroundColor: C.bg, borderWidth: 1, borderColor: C.border, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, color: C.text, marginBottom: 5 }, cityRow: { paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: C.border, flexDirection: 'row' }, cityName: { flex: 1, color: C.text, fontWeight: '700' }, cityTotal: { color: C.muted }, close: { paddingVertical: 13, alignItems: 'center' }, closeText: { color: C.blue, fontWeight: '900' },
});
