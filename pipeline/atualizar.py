"""Importação de um retrato completo da base. Não altera o arquivo de origem."""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import os
import re
import shutil
import sqlite3
from contextlib import closing
from datetime import date, datetime, time, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PIPE = ROOT / 'pipeline'
OUTPUT = PIPE / 'output'
DB = OUTPUT / 'base_projeto.db'
MANIFEST = OUTPUT / 'versao.json'
FIELDS = ('codigo_deep_base code_deep numero_visita codigo_unico municipio setor bairro logradouro numero complemento foto_visita foto_estrutura latitude longitude data_registro data_modificacao situacao_backoffice encontrou_pessoa observacoes grupo_sincronizacao').split()


def text(value):
    return '' if value is None else str(value).strip()


def parse_date(value, fmt):
    if isinstance(value, datetime):
        result = value
    elif isinstance(value, date):
        result = datetime.combine(value, time())
    else:
        result = datetime.strptime(text(value), fmt)
    # Compara instantes com timezone; datas sem timezone são horários locais da base.
    if result.tzinfo is not None:
        result = result.astimezone(timezone.utc).replace(tzinfo=None)
    return result


def coordinate(value, limit):
    if not text(value):
        return None
    try:
        result = float(text(value).replace(',', '.'))
    except ValueError:
        return None
    return result if math.isfinite(result) and abs(result) <= limit else None


def snapshot(source, target):
    before = source.stat()
    shutil.copyfile(source, target)
    after = source.stat()
    if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
        raise ValueError('A origem mudou durante a cópia. Aguarde a sincronização e tente novamente.')


def read_rows(path, config):
    if path.suffix.lower() == '.csv':
        with path.open(encoding='utf-8-sig', newline='') as file:
            reader = csv.reader(file, delimiter=config.get('csvDelimiter', ';'))
            headers = [text(v) for v in next(reader)]
            if len(headers) != len(set(headers)):
                raise ValueError('Cabeçalhos duplicados. Renomeie as colunas na origem.')
            for row in reader:
                if not any(text(v) for v in row):
                    continue
                if len(row) != len(headers):
                    raise ValueError('Linha CSV com quantidade de colunas divergente.')
                yield dict(zip(headers, row))
    elif path.suffix.lower() == '.xlsx':
        from openpyxl import load_workbook
        book = load_workbook(path, read_only=True, data_only=True)
        try:
            rows = book[config['sheet']].iter_rows(values_only=True)
            headers = [text(v) for v in next(rows)]
            named = [v for v in headers if v]
            if len(named) != len(set(named)):
                raise ValueError('Cabeçalhos duplicados. Renomeie as colunas na origem.')
            for row in rows:
                if any(v is not None for v in row):
                    yield {k: v for k, v in zip(headers, row) if k}
        finally:
            book.close()
    else:
        raise ValueError('Formato aceito: XLSX ou CSV UTF-8. Não use XLS antigo.')


def consolidate(rows, config):
    mapping = config['columns']
    allowed = set(FIELDS) | {'data_hora', 'hora_registro'}
    if set(mapping) - allowed:
        raise ValueError('Campo de destino desconhecido no mapeamento.')
    required = ['codigo_unico', 'code_deep', 'data_hora', 'municipio']
    if any(not mapping.get(k) for k in required):
        raise ValueError(f'Configure as colunas obrigatórias: {required}')
    if config.get('photoPolicy', 'latest') not in ('latest', 'first'):
        raise ValueError('photoPolicy deve ser latest ou first.')
    groups = {}
    summary = dict(linhasLidas=0, semCodigoUnico=0, codesInvalidos=0)
    for order, row in enumerate(rows, start=2):
        summary['linhasLidas'] += 1
        absent = set(v for v in mapping.values() if v) - set(row)
        if absent:
            raise ValueError(f'Colunas configuradas ausentes: {sorted(absent)}')
        value = lambda k: row.get(mapping.get(k))
        key = text(value('codigo_unico'))
        if not key:
            summary['semCodigoUnico'] += 1
            continue
        code = text(value('code_deep'))
        match = re.fullmatch(r'(.+)-(\d+)', code)
        if not match:
            summary['codesInvalidos'] += 1
            continue
        if not text(value('municipio')):
            raise ValueError(f'Município vazio na linha {order}.')
        raw_date = value('data_hora')
        if mapping.get('hora_registro'):
            raw_date = text(raw_date) + ' ' + text(value('hora_registro'))
        try:
            registered = parse_date(raw_date, config['dateFormat'])
            modified = parse_date(value('data_modificacao'), config.get('modifiedFormat', config['dateFormat'])) if text(value('data_modificacao')) else datetime.min
        except (TypeError, ValueError) as error:
            raise ValueError(f'Data/hora inválida na linha {order}. Confira dateFormat.') from error
        record = {k: text(value(k)) or None for k in FIELDS}
        record.update(codigo_unico=key, code_deep=code, codigo_deep_base=match[1], numero_visita=int(match[2]), municipio=text(value('municipio')).upper(), data_registro=registered.isoformat(sep=' ', timespec='seconds'), data_modificacao=None if modified == datetime.min else modified.isoformat(sep=' ', timespec='seconds'))
        sector = text(value('setor'))
        if sector:
            if not re.fullmatch(r'\d+(?:\.0+)?', sector):
                raise ValueError(f'Setor inválido na linha {order}. Use número inteiro ou deixe vazio.')
            record['setor'] = int(float(sector))
        else:
            record['setor'] = None
        lat, lon = coordinate(value('latitude'), 90), coordinate(value('longitude'), 180)
        record['latitude'], record['longitude'] = (lat, lon) if lat is not None and lon is not None else (None, None)
        for field in ['foto_visita', 'foto_estrutura']:
            if record[field] and not re.fullmatch(r'https://\S+', record[field]):
                raise ValueError(f'{field}: use uma única URL HTTPS por célula (linha {order}).')
        record['grupo_sincronizacao'] = f"{record['municipio']} - " + (f"SETOR {record['setor']}" if record['setor'] is not None else 'SEM SETOR')
        groups.setdefault(key.casefold(), []).append(((registered, modified, int(match[2]), order), record))
    result = []
    for visits in groups.values():
        visits.sort(key=lambda v: v[0])
        latest = visits[-1][1].copy()
        if config.get('photoPolicy', 'latest') == 'first':
            for field in ['foto_visita', 'foto_estrutura']:
                latest[field] = visits[0][1][field]
        result.append(latest)
    summary.update(totalRegistros=len(result), visitasConsolidadas=sum(len(v)-1 for v in groups.values()), coordenadasAusentes=sum(r['latitude'] is None for r in result))
    return result, summary


def check_drop(previous, current, limit):
    if not 0 <= limit <= 100:
        raise ValueError('maxDropPercent deve ficar entre 0 e 100.')
    if current == 0:
        raise ValueError('Base vazia: geração bloqueada.')
    if previous and (previous-current) / previous * 100 > limit:
        raise ValueError(f'Queda anormal: {previous} -> {current}. Origem deve ser COMPLETA; saída anterior preservada.')


def write_db(records, path):
    types = {k: 'TEXT' for k in FIELDS}
    types.update(numero_visita='INTEGER', setor='INTEGER', latitude='REAL', longitude='REAL')
    with closing(sqlite3.connect(path)) as db:
        db.execute('CREATE TABLE imoveis (' + ', '.join(f'{k} {types[k]}' for k in FIELDS) + ')')
        db.executemany('INSERT INTO imoveis VALUES (' + ','.join('?' for _ in FIELDS) + ')', [tuple(r[k] for k in FIELDS) for r in records])
        db.execute('CREATE UNIQUE INDEX idx_imoveis_codigo_unico ON imoveis(codigo_unico COLLATE NOCASE)')
        db.execute('CREATE INDEX idx_imoveis_grupo ON imoveis(grupo_sincronizacao COLLATE NOCASE)')
        db.execute('CREATE INDEX idx_imoveis_code_deep ON imoveis(code_deep COLLATE NOCASE)')
        db.execute('CREATE INDEX idx_imoveis_local ON imoveis(municipio COLLATE NOCASE,bairro COLLATE NOCASE)')
        if db.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
            raise ValueError('Falha de integridade SQLite.')
        db.commit()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('--config', type=Path, default=ROOT/'projeto.json')
    args = parser.parse_args()
    config = json.loads(args.config.read_text(encoding='utf-8'))
    stamp = datetime.now().astimezone().strftime('%Y%m%d_%H%M%S_%f')
    stage = PIPE/'temp'/stamp
    stage.mkdir(parents=True)
    try:
        source = args.source.resolve(strict=True)
        copied = stage/('origem'+source.suffix.lower())
        snapshot(source, copied)
        records, summary = consolidate(read_rows(copied, config), config)
        previous = 0
        if DB.exists():
            with closing(sqlite3.connect(f'{DB.as_uri()}?mode=ro', uri=True)) as db:
                previous = db.execute('SELECT COUNT(*) FROM imoveis').fetchone()[0]
        check_drop(previous, len(records), float(config.get('maxDropPercent', 5)))
        new_db = stage/DB.name
        write_db(records, new_db)
        content = new_db.read_bytes()
        old_manifest = json.loads(MANIFEST.read_text(encoding='utf-8')) if MANIFEST.exists() else {}
        manifest = dict(versao=int(old_manifest.get('versao', 0))+1, schemaVersion=2, publicadoEm=datetime.now().astimezone().isoformat(timespec='seconds'), totalRegistros=len(records), tamanhoBanco=len(content), md5Banco=hashlib.md5(content).hexdigest(), hashBanco=hashlib.sha256(content).hexdigest(), versaoMinimaApp='0.1.0')
        (stage/MANIFEST.name).write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
        backup = PIPE/'backups'/stamp
        backup.mkdir(parents=True)
        for path in (DB, MANIFEST):
            if path.exists():
                shutil.copy2(path, backup/path.name)
        OUTPUT.mkdir(exist_ok=True)
        os.replace(new_db, DB)
        os.replace(stage/MANIFEST.name, MANIFEST)
        audit = {**summary, 'versao':manifest['versao'], 'sha256Origem':hashlib.sha256(copied.read_bytes()).hexdigest(), 'geradoEm':manifest['publicadoEm'], 'publicado':False}
        (PIPE/'auditoria').mkdir(exist_ok=True)
        (PIPE/'auditoria'/f'{stamp}.json').write_text(json.dumps(audit, ensure_ascii=False, indent=2), encoding='utf-8')
        print(json.dumps(audit, ensure_ascii=False, indent=2))
        print('Gerado localmente. Revise antes de executar pipeline/publicar.py.')
    finally:
        # Só remove a pasta temporária criada nesta execução, dentro de pipeline/temp.
        if stage.resolve().parent == (PIPE/'temp').resolve():
            shutil.rmtree(stage)


if __name__ == '__main__':
    main()
