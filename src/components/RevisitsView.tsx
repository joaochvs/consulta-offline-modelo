import * as Clipboard from 'expo-clipboard';
import * as Linking from 'expo-linking';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Image, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import type { GrupoSetor, Imovel } from '../types';
import { clearAllRevisitPhotos, clearGroupPhotos, getPhotoSyncDetails, getSectorDownloadEstimate, listPhotoGroupStatuses, localPhotoUris, synchronizeGroupPhotos, type PhotoProgress, type PhotoSyncDetails } from '../services/offlinePhotos';
import { listSectorGroups, listSectorProperties, searchPropertiesEverywhere } from '../services/database';

const C = { blue: '#2D3580', orange: '#F5A623', bg: '#F4F6FB', white: '#FFFFFF', text: '#1A1F3C', muted: '#8A93B2', border: '#E8ECF4', green: '#2E9E5B', red: '#D0423A' };
const EMPTY_SYNC: PhotoSyncDetails = { status: 'none', expected: 0, completed: 0, downloaded: 0, failed: 0, bytes: 0 };

export function RevisitsView({ refreshKey = 0, onPhotosChanged }: { refreshKey?: number; onPhotosChanged?: () => void }) {
  const [groups, setGroups] = useState<GrupoSetor[]>([]);
  const [selected, setSelected] = useState<GrupoSetor | null>(null);
  const [rows, setRows] = useState<Imovel[]>([]);
  const [filter, setFilter] = useState('');
  const [groupFilter, setGroupFilter] = useState('');
  const [modal, setModal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [progress, setProgress] = useState('');
  const [syncDetails, setSyncDetails] = useState<PhotoSyncDetails>(EMPTY_SYNC);
  const [groupStatuses, setGroupStatuses] = useState<Record<string, PhotoSyncDetails>>({});
  const [filterModal, setFilterModal] = useState(false);
  const [statusFilter, setStatusFilter] = useState('todos');
  const [photoFilter, setPhotoFilter] = useState('todos');
  const [coordinateFilter, setCoordinateFilter] = useState('todos');
  const [visitFilter, setVisitFilter] = useState('todos');
  const [detail, setDetail] = useState<Imovel | null>(null);
  const [globalQuery, setGlobalQuery] = useState('');
  const [globalRows, setGlobalRows] = useState<Imovel[]>([]);
  const [globalSearched, setGlobalSearched] = useState(false);
  const [globalSearching, setGlobalSearching] = useState(false);
  const cancelSyncRef = useRef(false);

  async function loadGroups() {
    setLoading(true);
    try {
      const values = await listSectorGroups(); setGroups(values);
      setGroupStatuses(await listPhotoGroupStatuses(Object.fromEntries(values.map((item) => [item.grupo, item.fotos]))));
      if (selected) setSelected(values.find((item) => item.grupo === selected.grupo) ?? null);
    } finally { setLoading(false); }
  }
  useEffect(() => { loadGroups(); }, [refreshKey]);
  useEffect(() => {
    if (!selected) { setRows([]); setSyncDetails(EMPTY_SYNC); return; }
    listSectorProperties(selected.grupo, filter).then(setRows);
    getPhotoSyncDetails(selected.grupo, selected.fotos).then(setSyncDetails);
  }, [selected, filter, refreshKey]);

  const filteredGroups = useMemo(() => {
    const term = groupFilter.trim().toLocaleLowerCase('pt-BR');
    return groups.filter((item) => item.grupo.toLocaleLowerCase('pt-BR').includes(term));
  }, [groups, groupFilter]);
  const visibleRows = useMemo(() => rows.filter((item) => {
    const status = (item.situacao_backoffice ?? '').toLocaleLowerCase('pt-BR');
    if (statusFilter !== 'todos' && !status.includes(statusFilter)) return false;
    const hasPhoto = Boolean(item.foto_visita || item.foto_estrutura);
    if (photoFilter === 'com' && !hasPhoto) return false;
    if (photoFilter === 'sem' && hasPhoto) return false;
    const hasCoordinates = item.latitude != null && item.longitude != null;
    if (coordinateFilter === 'com' && !hasCoordinates) return false;
    if (coordinateFilter === 'sem' && hasCoordinates) return false;
    if (visitFilter === '3mais' && item.numero_visita < 3) return false;
    if (!['todos', '3mais'].includes(visitFilter) && item.numero_visita !== Number(visitFilter)) return false;
    return true;
  }), [rows, statusFilter, photoFilter, coordinateFilter, visitFilter]);
  const activeFilterCount = [statusFilter, photoFilter, coordinateFilter, visitFilter].filter((value) => value !== 'todos').length;
  const synced = syncDetails.status === 'complete';
  async function searchEverywhere() {
    if (!globalQuery.trim()) return;
    setGlobalSearching(true);
    try { setGlobalRows(await searchPropertiesEverywhere(globalQuery)); setGlobalSearched(true); }
    finally { setGlobalSearching(false); }
  }

  function formatBytes(value: number) { if (value < 1024 * 1024) return `${Math.max(0, value / 1024).toFixed(0)} KB`; return `${(value / 1024 / 1024).toFixed(1)} MB`; }
  function formatEta(seconds: number | null) { if (seconds == null) return 'calculando tempo'; if (seconds < 60) return `cerca de ${Math.max(1, seconds)} s`; return `cerca de ${Math.ceil(seconds / 60)} min`; }
  function updateProgress(value: PhotoProgress) { setProgress(`${value.completed} de ${value.total} fotos · ${formatBytes(value.bytes)} · ${formatBytes(value.bytesPerSecond)}/s · ${formatEta(value.estimatedRemainingSeconds)}`); }

  async function syncPhotos() {
    if (!selected) return;
    cancelSyncRef.current = false;
    setSyncing(true); setProgress('Preparando fotos...');
    try {
      const result = await synchronizeGroupPhotos(selected.grupo, updateProgress, () => cancelSyncRef.current);
      const details = await getPhotoSyncDetails(selected.grupo, selected.fotos);
      setSyncDetails(details); setGroupStatuses((current) => ({ ...current, [selected.grupo]: details }));
      if (result.cancelled) { onPhotosChanged?.(); setProgress(`Download pausado. ${result.downloaded} fotos estão salvas e serão reaproveitadas.`); return; }
      onPhotosChanged?.();
      setProgress(result.failed
        ? `${result.downloaded} fotos baixadas · ${result.failed} sem link válido.`
        : `${result.downloaded} fotos disponíveis offline.`);
    } catch (error) { setProgress(`Falha na sincronização: ${String(error)}`); }
    finally { setSyncing(false); }
  }

  async function confirmSectorSync() {
    if (!selected) return;
    setProgress('Calculando tamanho do setor...');
    try {
      const estimate = await getSectorDownloadEstimate(selected.grupo);
      Alert.alert(`Baixar ${selected.grupo}?`, `${estimate.total.toLocaleString('pt-BR')} fotos no total\n${estimate.cached.toLocaleString('pt-BR')} já salvas\n${estimate.pending.toLocaleString('pt-BR')} pendentes\nEstimativa: ${formatBytes(estimate.estimatedBytes)}\n\nO download pode ser cancelado e retomado.`, [{ text: 'Cancelar', style: 'cancel' }, { text: 'Baixar setor', onPress: syncPhotos }]);
      setProgress('');
    } catch (error) { setProgress(`Não foi possível calcular o download: ${String(error)}`); }
  }

  function confirmClearGroup() {
    if (!selected) return;
    Alert.alert('Limpar fotos deste setor?', 'A lista de imóveis continuará offline; somente as fotos serão removidas.', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Limpar fotos', style: 'destructive', onPress: async () => { await clearGroupPhotos(selected.grupo); setSyncDetails({ ...EMPTY_SYNC, expected: selected.fotos }); setGroupStatuses((current) => ({ ...current, [selected.grupo]: { ...EMPTY_SYNC, expected: selected.fotos } })); onPhotosChanged?.(); setProgress('Fotos deste setor removidas.'); } },
    ]);
  }

  function confirmClearAll() {
    Alert.alert('Limpar todas as fotos?', 'O banco e as listas de imóveis serão preservados.', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Limpar tudo', style: 'destructive', onPress: async () => { await clearAllRevisitPhotos(); setSyncDetails(EMPTY_SYNC); setGroupStatuses({}); onPhotosChanged?.(); setProgress('Todas as fotos offline foram removidas.'); } },
    ]);
  }

  return <View style={s.container}>
    <FlatList
      data={loading ? [] : visibleRows}
      keyExtractor={(item, index) => item.codigo_unico ?? item.code_deep ?? String(index)}
      contentContainerStyle={s.pageList}
      keyboardShouldPersistTaps="handled"
      ItemSeparatorComponent={() => <View style={s.rowSeparator} />}
      ListHeaderComponent={<>
        <View style={s.globalCard}>
          <Text style={s.kicker}>LOCALIZAR SEM SABER O SETOR</Text><Text style={s.globalTitle}>Buscar imóvel em toda a base</Text>
          <View style={s.globalSearchRow}><TextInput style={s.globalInput} value={globalQuery} onChangeText={(value) => { setGlobalQuery(value); setGlobalRows([]); setGlobalSearched(false); }} placeholder="Matrícula, Code Deep ou endereço" placeholderTextColor={C.muted} autoCapitalize="characters" returnKeyType="search" onSubmitEditing={searchEverywhere} /><Pressable style={s.globalButton} onPress={searchEverywhere}>{globalSearching ? <ActivityIndicator color={C.white} /> : <Text style={s.globalButtonText}>⌕</Text>}</Pressable></View>
          {globalSearched && !globalRows.length && <Text style={s.globalEmpty}>Nenhum imóvel encontrado.</Text>}
          {globalRows.map((item, index) => <Pressable key={item.codigo_unico ?? item.code_deep ?? index} style={s.globalResult} onPress={() => setDetail(item)}><View style={{ flex: 1 }}><Text style={s.globalRegistration}>{item.codigo_unico ?? item.code_deep}</Text><Text style={s.globalGroup}>{item.grupo_sincronizacao}</Text></View><Text style={s.chevron}>›</Text></Pressable>)}
        </View>
        <View style={s.card}>
          <Text style={s.kicker}>CONSULTA OFFLINE</Text><Text style={s.title}>Município e setor</Text>
          <Text style={s.help}>Escolha o setor de trabalho para consultar todos os imóveis e salvar as fotos no celular.</Text>
          <Pressable style={s.selector} onPress={() => setModal(true)}>
            <View style={s.selectorText}><Text style={selected ? s.selectorValue : s.placeholder}>{selected?.grupo ?? 'Selecionar município / setor'}</Text>{selected && <Text style={s.selectorCount}>{selected.total} imóveis · {selected.fotos} fotos</Text>}</View>
            {selected && <SyncBadge details={syncDetails} />}
          </Pressable>
          {selected && <><Text style={s.syncSummary}>{syncDetails.downloaded.toLocaleString('pt-BR')} de {selected.fotos.toLocaleString('pt-BR')} fotos salvas{syncDetails.failed ? ` · ${syncDetails.failed} falharam` : ''}</Text><View style={s.actions}><Pressable style={s.primary} onPress={syncing ? () => { cancelSyncRef.current = true; setProgress('Pausando após os downloads atuais...'); } : confirmSectorSync}>{syncing ? <Text style={s.primaryText}>Pausar download</Text> : <Text style={s.primaryText}>{synced ? 'Verificar fotos' : syncDetails.status === 'none' ? 'Baixar fotos do setor' : 'Continuar download'}</Text>}</Pressable><Pressable style={s.outline} onPress={confirmClearGroup} disabled={syncing}><Text style={s.outlineText}>Limpar setor</Text></Pressable></View>{!!progress && <Text style={s.progress}>{progress}</Text>}</>}
        </View>
        {selected && <><TextInput style={s.search} value={filter} onChangeText={setFilter} placeholder="Pesquisar matrícula, Code Deep, bairro ou endereço" placeholderTextColor={C.muted} /><Pressable style={[s.filterButton, activeFilterCount > 0 && s.filterButtonActive]} onPress={() => setFilterModal(true)}><Text style={[s.filterButtonText, activeFilterCount > 0 && s.filterButtonTextActive]}>Filtros{activeFilterCount ? ` · ${activeFilterCount} ativos` : ''}</Text><Text style={[s.filterButtonText, activeFilterCount > 0 && s.filterButtonTextActive]}>⌄</Text></Pressable><Text style={s.resultCount}>{visibleRows.length.toLocaleString('pt-BR')} de {rows.length.toLocaleString('pt-BR')} imóveis</Text></>}
        {loading && <ActivityIndicator color={C.blue} style={s.listLoading} />}
      </>}
      ListEmptyComponent={!loading && selected ? <Text style={s.emptyList}>Nenhuma matrícula encontrada.</Text> : null}
      ListFooterComponent={<Pressable style={s.clearAll} onPress={confirmClearAll}><Text style={s.clearAllText}>Limpar todas as fotos offline</Text></Pressable>}
      renderItem={({ item }) => <PropertyCard item={item} synced={synced} photoRefreshKey={syncDetails.downloaded} onPress={() => setDetail(item)} />}
    />
    <Modal visible={modal} transparent animationType="fade" onRequestClose={() => setModal(false)}><View style={s.overlay}><View style={s.modal}><Text style={s.modalTitle}>Município / setor</Text><TextInput style={s.search} value={groupFilter} onChangeText={setGroupFilter} placeholder="Pesquisar município ou setor" placeholderTextColor={C.muted} /><FlatList data={filteredGroups} keyExtractor={(item) => item.grupo} renderItem={({ item }) => <Pressable style={s.groupRow} onPress={() => { setSelected(item); setFilter(''); setProgress(''); setModal(false); }}><View style={{ flex: 1 }}><Text style={s.groupName}>{item.grupo}</Text><Text style={s.groupMeta}>{item.total} imóveis · {item.fotos} fotos</Text></View><SyncBadge details={groupStatuses[item.grupo] ?? { ...EMPTY_SYNC, expected: item.fotos }} compact /><Text style={s.chevron}>›</Text></Pressable>} /><Pressable style={s.modalClose} onPress={() => setModal(false)}><Text style={s.modalCloseText}>Fechar</Text></Pressable></View></View></Modal>
    <Modal visible={filterModal} transparent animationType="fade" onRequestClose={() => setFilterModal(false)}><View style={s.overlay}><View style={s.modal}><Text style={s.modalTitle}>Filtrar imóveis</Text><FilterSection title="Status do backoffice" value={statusFilter} onChange={setStatusFilter} options={[["todos", "Todos"], ["aprov", "Aprovados"], ["reprov", "Reprovados"], ["pendent", "Pendentes"]]} /><FilterSection title="Fotos" value={photoFilter} onChange={setPhotoFilter} options={[["todos", "Todas"], ["com", "Com foto"], ["sem", "Sem foto"]]} /><FilterSection title="Coordenadas" value={coordinateFilter} onChange={setCoordinateFilter} options={[["todos", "Todas"], ["com", "Com coordenada"], ["sem", "Sem coordenada"]]} /><FilterSection title="Visita" value={visitFilter} onChange={setVisitFilter} options={[["todos", "Todas"], ["1", "Visita 1"], ["2", "Visita 2"], ["3mais", "Visita 3+"]]} /><View style={s.filterActions}><Pressable style={s.clearFilters} onPress={() => { setStatusFilter('todos'); setPhotoFilter('todos'); setCoordinateFilter('todos'); setVisitFilter('todos'); }}><Text style={s.clearFiltersText}>Limpar filtros</Text></Pressable><Pressable style={s.applyFilters} onPress={() => setFilterModal(false)}><Text style={s.applyFiltersText}>Ver resultados</Text></Pressable></View></View></View></Modal>
      <PropertyDetail item={detail} synced={synced} onClose={() => setDetail(null)} />
  </View>;
}

function SyncBadge({ details, compact = false }: { details: PhotoSyncDetails; compact?: boolean }) {
  const content = details.status === 'complete' ? { label: '✓ Completo', style: s.syncComplete, text: s.syncCompleteText }
    : details.status === 'partial' ? { label: compact ? 'Parcial' : '⚠ Parcial', style: s.syncPartial, text: s.syncPartialText }
      : details.status === 'paused' ? { label: compact ? 'Pausado' : 'Ⅱ Pausado', style: s.syncPaused, text: s.syncPausedText }
        : { label: 'Não baixado', style: s.syncNone, text: s.syncNoneText };
  return <View style={[s.syncBadge, content.style, compact && s.syncBadgeCompact]}><Text style={[s.syncBadgeText, content.text]}>{content.label}</Text></View>;
}

function FilterSection({ title, value, onChange, options }: { title: string; value: string; onChange: (value: string) => void; options: string[][] }) {
  return <View style={s.filterSection}><Text style={s.filterTitle}>{title}</Text><View style={s.filterOptions}>{options.map(([option, label]) => <Pressable key={option} style={[s.filterChip, value === option && s.filterChipActive]} onPress={() => onChange(option)}><Text style={[s.filterChipText, value === option && s.filterChipTextActive]}>{label}</Text></Pressable>)}</View></View>;
}

function PropertyCard({ item, synced, photoRefreshKey, onPress }: { item: Imovel; synced: boolean; photoRefreshKey: number; onPress: () => void }) {
  const [uri, setUri] = useState<string | null>(item.foto_visita || item.foto_estrutura);
  useEffect(() => { localPhotoUris(item.grupo_sincronizacao, item.codigo_unico ?? item.code_deep ?? '', item.foto_visita, item.foto_estrutura).then((photos) => setUri(photos.visita || photos.estrutura)); }, [item, synced, photoRefreshKey]);
  const hasPhoto = Boolean(item.foto_visita || item.foto_estrutura);
  const offlinePhoto = Boolean(uri?.startsWith('file:'));
  const hasCoordinates = item.latitude != null && item.longitude != null;
  return <Pressable style={s.rowCard} onPress={onPress}>{uri && <Image source={{ uri }} style={s.photo} resizeMode="cover" />}<View style={s.rowBody}><View style={s.rowTop}><Text style={s.registration}>{item.codigo_unico}</Text><Text style={s.visit}>VISITA {item.numero_visita}</Text></View><Text style={s.reason}>{item.situacao_backoffice || 'Sem status do backoffice'}</Text><View style={s.indicators}><View style={[s.indicator, offlinePhoto ? s.indicatorGood : hasPhoto ? s.indicatorOnline : s.indicatorMissing]}><Text style={[s.indicatorText, offlinePhoto ? s.indicatorGoodText : hasPhoto ? s.indicatorOnlineText : s.indicatorMissingText]}>{offlinePhoto ? 'Foto offline' : hasPhoto ? 'Foto online' : 'Sem foto'}</Text></View><View style={[s.indicator, hasCoordinates ? s.indicatorGood : s.indicatorMissing]}><Text style={[s.indicatorText, hasCoordinates ? s.indicatorGoodText : s.indicatorMissingText]}>{hasCoordinates ? 'Com coordenada' : 'Sem coordenada'}</Text></View></View><View style={s.addressRow}><Text style={s.address}>{item.logradouro || 'Logradouro não informado'}</Text><View style={[s.numberBadge, !item.numero && s.numberBadgeEmpty]}><Text style={[s.numberText, !item.numero && s.numberTextEmpty]}>Nº {item.numero || 'não informado'}</Text></View></View><View style={s.rowFooter}><Text style={s.code}>{item.code_deep}</Text><Text style={s.openHint}>Ver detalhes ›</Text></View></View></Pressable>;
}

function PropertyDetail({ item, synced, onClose }: { item: Imovel | null; synced: boolean; onClose: () => void }) {
  const [photos, setPhotos] = useState<{ visita: string | null; estrutura: string | null }>({ visita: null, estrutura: null });
  useEffect(() => {
    if (!item) { setPhotos({ visita: null, estrutura: null }); return; }
    localPhotoUris(item.grupo_sincronizacao, item.codigo_unico ?? item.code_deep ?? '', item.foto_visita, item.foto_estrutura).then(setPhotos);
  }, [item, synced]);
  if (!item) return null;
  const latitude = item.latitude;
  const longitude = item.longitude;
  const registration = item.codigo_unico ?? item.code_deep ?? 'Imóvel';
  const hasCoordinates = latitude != null && longitude != null;
  const coordinates = hasCoordinates ? `${latitude}, ${longitude}` : '';
  const address = [item.logradouro, item.numero, item.complemento, item.bairro, item.municipio].filter(Boolean).join(', ');
  async function copyInformation(label: string, value: string) {
    if (!value) return;
    await Clipboard.setStringAsync(value);
    Alert.alert(`${label} copiado`, value);
  }
  async function copyCoordinates() {
    if (!coordinates) return;
    await Clipboard.setStringAsync(coordinates);
    Alert.alert('Coordenadas copiadas', `${coordinates}\n\nDisponíveis para colar mesmo offline.`);
  }
  async function openMaps() {
    if (!hasCoordinates) return;
    const label = encodeURIComponent(registration);
    try { await Linking.openURL(`geo:${latitude},${longitude}?q=${latitude},${longitude}(${label})`); }
    catch { Alert.alert('Não foi possível abrir o mapa', 'Copie as coordenadas e utilize no aplicativo de mapas.'); }
  }
  return <Modal visible transparent animationType="slide" onRequestClose={onClose}><View style={s.overlay}><View style={s.detailModal}><ScrollView contentContainerStyle={s.detailContent} showsVerticalScrollIndicator={false}>
    <View style={s.detailHeader}><View style={{ flex: 1 }}><Text style={s.kicker}>DETALHES DO IMÓVEL</Text><Text style={s.detailRegistration}>{item.codigo_unico}</Text></View><Pressable style={s.detailClose} onPress={onClose}><Text style={s.detailCloseText}>×</Text></Pressable></View>
    <PhotoCarousel visita={photos.visita} estrutura={photos.estrutura} />
    <View style={s.detailGrid}><DetailItem label="CODE DEEP" value={item.code_deep} /><DetailItem label="VISITA" value={String(item.numero_visita)} /><DetailItem label="STATUS BACKOFFICE" value={item.situacao_backoffice || 'Sem status'} wide /><DetailItem label="MUNICÍPIO / SETOR" value={item.grupo_sincronizacao} wide /><DetailItem label="ENDEREÇO" value={[item.logradouro, item.numero].filter(Boolean).join(', ') || 'Não informado'} wide /><DetailItem label="BAIRRO" value={item.bairro || 'Não informado'} wide /></View>
    <View style={s.copyGrid}><Pressable style={s.copyInfoButton} onPress={() => copyInformation('Matrícula', registration)}><Text style={s.copyInfoText}>Copiar matrícula</Text></Pressable><Pressable style={s.copyInfoButton} onPress={() => copyInformation('Code Deep', item.code_deep)}><Text style={s.copyInfoText}>Copiar Code Deep</Text></Pressable><Pressable style={[s.copyInfoButton, s.copyInfoWide]} disabled={!address} onPress={() => copyInformation('Endereço', address)}><Text style={s.copyInfoText}>Copiar endereço completo</Text></Pressable></View>
    <View style={s.coordinatesBox}><Text style={s.coordinateTitle}>COORDENADAS</Text><Text style={s.coordinateText}>{coordinates || 'Latitude e longitude não informadas'}</Text></View>
    <Pressable style={[s.mapButton, !hasCoordinates && s.disabledButton]} disabled={!hasCoordinates} onPress={openMaps}><Text style={s.mapButtonText}>Abrir no Maps</Text></Pressable>
    <Pressable style={[s.copyButton, !hasCoordinates && s.disabledButton]} disabled={!hasCoordinates} onPress={copyCoordinates}><Text style={s.copyButtonText}>Copiar latitude e longitude</Text></Pressable>
    <Text style={s.offlineHelp}>Para uso sem internet, copie as coordenadas. Se o mapa da região estiver baixado no celular, o Maps também poderá abri-las offline.</Text>
  </ScrollView></View></View></Modal>;
}

function PhotoCarousel({ visita, estrutura }: { visita: string | null; estrutura: string | null }) {
  const { width } = useWindowDimensions();
  const slideWidth = Math.min(width - 70, 500);
  const items = [{ label: 'FOTO DA FACHADA', uri: visita }];
  return <View style={{ marginTop: 2 }}><ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false}>{items.map((photo) => <View key={photo.label} style={{ width: slideWidth }}>{photo.uri ? <Image source={{ uri: photo.uri }} style={s.detailPhoto} resizeMode="cover" /> : <View style={[s.detailNoPhoto, { height: 210 }]}><Text style={s.detailNoPhotoText}>Foto não disponível</Text></View>}<View style={{ position: 'absolute', left: 9, bottom: 9, backgroundColor: 'rgba(26,31,60,0.78)', borderRadius: 8, paddingHorizontal: 9, paddingVertical: 5 }}><Text style={{ color: C.white, fontSize: 9, fontWeight: '900' }}>{photo.label}</Text></View></View>)}</ScrollView><Text style={{ color: C.muted, fontSize: 9, textAlign: 'center', marginTop: 6 }}>Foto da fachada</Text></View>;
}

function DetailItem({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return <View style={[s.detailItem, wide && s.detailItemWide]}><Text style={s.detailLabel}>{label}</Text><Text style={s.detailValue}>{value}</Text></View>;
}

const s = StyleSheet.create({
  syncBadge: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 5, marginLeft: 6 },
  syncBadgeCompact: { marginRight: 3, marginLeft: 3, paddingHorizontal: 7, paddingVertical: 4 },
  syncBadgeText: { fontSize: 9, fontWeight: '900' },
  syncComplete: { backgroundColor: '#E4F4EA' }, syncCompleteText: { color: C.green },
  syncPartial: { backgroundColor: '#FFF3D6' }, syncPartialText: { color: '#946400' },
  syncPaused: { backgroundColor: '#E8EAF7' }, syncPausedText: { color: C.blue },
  syncNone: { backgroundColor: C.border }, syncNoneText: { color: C.muted },
  syncSummary: { color: C.muted, fontSize: 10, fontWeight: '700', marginTop: 8 },
  filterButton: { marginTop: -4, backgroundColor: C.white, borderWidth: 1, borderColor: C.border, borderRadius: 12, paddingHorizontal: 13, paddingVertical: 10, flexDirection: 'row', justifyContent: 'space-between' },
  filterButtonActive: { backgroundColor: '#EBECF8', borderColor: C.blue },
  filterButtonText: { color: C.muted, fontSize: 11, fontWeight: '900' }, filterButtonTextActive: { color: C.blue },
  resultCount: { color: C.muted, fontSize: 9, textAlign: 'right', marginTop: 6, marginBottom: 9 },
  filterSection: { marginTop: 17 }, filterTitle: { color: C.text, fontSize: 11, fontWeight: '900', marginBottom: 8 },
  filterOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  filterChip: { borderRadius: 999, backgroundColor: C.bg, borderWidth: 1, borderColor: C.border, paddingHorizontal: 10, paddingVertical: 8 },
  filterChipActive: { backgroundColor: '#EBECF8', borderColor: C.blue }, filterChipText: { color: C.muted, fontSize: 10, fontWeight: '800' }, filterChipTextActive: { color: C.blue },
  filterActions: { flexDirection: 'row', gap: 8, marginTop: 20 }, clearFilters: { flex: 1, borderWidth: 1, borderColor: C.border, borderRadius: 12, paddingVertical: 12, alignItems: 'center' }, clearFiltersText: { color: C.muted, fontWeight: '900', fontSize: 11 }, applyFilters: { flex: 1, backgroundColor: C.blue, borderRadius: 12, paddingVertical: 12, alignItems: 'center' }, applyFiltersText: { color: C.white, fontWeight: '900', fontSize: 11 },
  indicators: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 6 }, indicator: { borderRadius: 999, paddingHorizontal: 7, paddingVertical: 4 }, indicatorText: { fontSize: 8, fontWeight: '900' }, indicatorGood: { backgroundColor: '#E4F4EA' }, indicatorGoodText: { color: C.green }, indicatorOnline: { backgroundColor: '#EBECF8' }, indicatorOnlineText: { color: C.blue }, indicatorMissing: { backgroundColor: '#F9E8E7' }, indicatorMissingText: { color: C.red },
  copyGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 11 }, copyInfoButton: { width: '48%', borderRadius: 10, backgroundColor: '#EBECF8', paddingVertical: 10, alignItems: 'center' }, copyInfoWide: { width: '100%' }, copyInfoText: { color: C.blue, fontSize: 10, fontWeight: '900' },
  groupOfflineBadge: { backgroundColor: '#E4F4EA', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 5, marginRight: 4 },
  groupOfflineText: { color: C.green, fontSize: 9, fontWeight: '900' },
  container: { flex: 1 }, pageList: { padding: 16, paddingBottom: 8 }, card: { backgroundColor: C.white, borderRadius: 20, padding: 17, borderWidth: 1, borderColor: C.border }, kicker: { color: C.orange, fontSize: 10, fontWeight: '900', letterSpacing: 1.1 }, title: { color: C.text, fontSize: 21, fontWeight: '900', marginTop: 5 }, help: { color: C.muted, fontSize: 12, lineHeight: 18, marginTop: 5, marginBottom: 13 }, selector: { backgroundColor: C.bg, borderWidth: 1, borderColor: C.border, borderRadius: 13, padding: 12, flexDirection: 'row', alignItems: 'center' }, selectorText: { flex: 1 }, selectorValue: { color: C.text, fontWeight: '800', fontSize: 13 }, placeholder: { color: C.muted }, selectorCount: { color: C.muted, fontSize: 10, marginTop: 3 }, marker: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 5 }, markerOn: { backgroundColor: '#E4F4EA' }, markerOff: { backgroundColor: C.border }, markerText: { color: C.muted, fontSize: 9, fontWeight: '900' }, markerTextOn: { color: C.green }, actions: { flexDirection: 'row', gap: 8, marginTop: 10 }, primary: { flex: 1, minHeight: 43, borderRadius: 12, backgroundColor: C.blue, alignItems: 'center', justifyContent: 'center' }, primaryText: { color: C.white, fontWeight: '900', fontSize: 12 }, outline: { paddingHorizontal: 14, borderRadius: 12, borderWidth: 1, borderColor: C.red, alignItems: 'center', justifyContent: 'center' }, outlineText: { color: C.red, fontWeight: '800', fontSize: 11 }, progress: { color: C.muted, fontSize: 10, marginTop: 8 }, search: { backgroundColor: C.white, borderWidth: 1, borderColor: C.border, borderRadius: 13, paddingHorizontal: 14, paddingVertical: 12, color: C.text, marginTop: 12, marginBottom: 12 }, listLoading: { marginVertical: 24 }, emptyList: { color: C.muted, textAlign: 'center', paddingVertical: 28 }, rowSeparator: { height: 10 }, rowCard: { backgroundColor: C.white, borderRadius: 15, borderWidth: 1, borderColor: C.border, overflow: 'hidden', flexDirection: 'row', minHeight: 112 }, photo: { width: 105, backgroundColor: C.border }, rowBody: { flex: 1, padding: 12 }, rowTop: { flexDirection: 'row', alignItems: 'center', gap: 5 }, registration: { flex: 1, color: C.text, fontWeight: '900', fontSize: 14 }, visit: { color: C.blue, backgroundColor: '#EBECF8', fontSize: 9, fontWeight: '900', paddingHorizontal: 7, paddingVertical: 4, borderRadius: 999 }, reason: { color: C.orange, fontSize: 10, fontWeight: '900', marginTop: 6 }, addressRow: { marginTop: 5, gap: 5, alignItems: 'flex-start' }, address: { color: C.text, fontSize: 11 }, numberBadge: { backgroundColor: '#EBECF8', borderRadius: 7, paddingHorizontal: 7, paddingVertical: 3 }, numberBadgeEmpty: { backgroundColor: C.bg }, numberText: { color: C.blue, fontSize: 9, fontWeight: '900' }, numberTextEmpty: { color: C.muted }, rowFooter: { flexDirection: 'row', alignItems: 'center', marginTop: 5 }, code: { flex: 1, color: C.muted, fontSize: 9 }, openHint: { color: C.blue, fontSize: 9, fontWeight: '900' }, clearAll: { alignItems: 'center', paddingVertical: 12 }, clearAllText: { color: C.red, fontSize: 11, fontWeight: '800' }, overlay: { flex: 1, backgroundColor: 'rgba(10,14,46,0.65)', justifyContent: 'center', padding: 18 }, modal: { backgroundColor: C.white, borderRadius: 20, padding: 17, maxHeight: '80%' }, modalTitle: { color: C.text, fontSize: 19, fontWeight: '900' }, groupRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: C.border }, groupName: { color: C.text, fontWeight: '800', fontSize: 12 }, groupMeta: { color: C.muted, fontSize: 10, marginTop: 3 }, chevron: { color: C.blue, fontSize: 24 }, modalClose: { alignItems: 'center', padding: 13 }, modalCloseText: { color: C.blue, fontWeight: '900' }, detailModal: { backgroundColor: C.white, borderRadius: 22, maxHeight: '90%', overflow: 'hidden' }, detailContent: { padding: 17 }, detailHeader: { flexDirection: 'row', alignItems: 'flex-start' }, detailRegistration: { color: C.text, fontSize: 23, fontWeight: '900', marginTop: 2 }, detailClose: { width: 36, height: 36, borderRadius: 18, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' }, detailCloseText: { color: C.blue, fontSize: 25, lineHeight: 27 }, detailPhoto: { width: '100%', height: 210, borderRadius: 15, backgroundColor: C.border, marginTop: 13 }, detailNoPhoto: { height: 100, borderRadius: 15, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center', marginTop: 13 }, detailNoPhotoText: { color: C.muted, fontWeight: '700', fontSize: 11 }, detailGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 }, detailItem: { width: '48%', backgroundColor: C.bg, borderRadius: 12, padding: 11 }, detailItemWide: { width: '100%' }, detailLabel: { color: C.muted, fontSize: 8, fontWeight: '900', letterSpacing: 0.7 }, detailValue: { color: C.text, fontSize: 12, fontWeight: '800', marginTop: 4, lineHeight: 17 }, coordinatesBox: { backgroundColor: '#EBECF8', borderRadius: 12, padding: 12, marginTop: 11 }, coordinateTitle: { color: C.blue, fontSize: 8, fontWeight: '900', letterSpacing: 0.7 }, coordinateText: { color: C.text, fontSize: 13, fontWeight: '900', marginTop: 4 }, mapButton: { backgroundColor: C.blue, borderRadius: 12, paddingVertical: 13, alignItems: 'center', marginTop: 11 }, mapButtonText: { color: C.white, fontSize: 12, fontWeight: '900' }, copyButton: { borderWidth: 1.5, borderColor: C.blue, borderRadius: 12, paddingVertical: 13, alignItems: 'center', marginTop: 8 }, copyButtonText: { color: C.blue, fontSize: 12, fontWeight: '900' }, disabledButton: { opacity: 0.4 }, offlineHelp: { color: C.muted, fontSize: 9, lineHeight: 14, textAlign: 'center', marginTop: 10 },
  globalCard: { backgroundColor: '#EBECF8', borderRadius: 18, padding: 15, marginBottom: 12, borderWidth: 1, borderColor: '#DADDF2' }, globalTitle: { color: C.text, fontSize: 16, fontWeight: '900', marginTop: 3 }, globalSearchRow: { flexDirection: 'row', gap: 8, marginTop: 11 }, globalInput: { flex: 1, backgroundColor: C.white, borderWidth: 1, borderColor: C.border, borderRadius: 11, paddingHorizontal: 12, paddingVertical: 11, color: C.text }, globalButton: { width: 46, borderRadius: 11, backgroundColor: C.blue, alignItems: 'center', justifyContent: 'center' }, globalButtonText: { color: C.white, fontSize: 22, fontWeight: '900' }, globalEmpty: { color: C.muted, fontSize: 11, textAlign: 'center', paddingTop: 12 }, globalResult: { backgroundColor: C.white, borderRadius: 11, padding: 11, marginTop: 8, flexDirection: 'row', alignItems: 'center' }, globalRegistration: { color: C.text, fontSize: 13, fontWeight: '900' }, globalGroup: { color: C.blue, fontSize: 10, fontWeight: '700', marginTop: 3 }, municipalityButton: { borderWidth: 1.5, borderColor: C.blue, borderRadius: 12, paddingVertical: 11, alignItems: 'center', marginTop: 8, backgroundColor: '#F7F7FC' }, municipalityButtonText: { color: C.blue, fontSize: 11, fontWeight: '900' },
});
