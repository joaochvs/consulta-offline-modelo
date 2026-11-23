"""Publica os dois arquivos em uma pasta exclusiva já configurada no Google Drive."""
import argparse
import hashlib
import json
import os
import sqlite3
from contextlib import closing
from datetime import datetime
from pathlib import Path

from atualizar import ROOT, PIPE, DB, MANIFEST, check_drop


def service():
    from google.oauth2.credentials import Credentials
    from google.auth.transport.requests import Request
    from google_auth_oauthlib.flow import InstalledAppFlow
    from googleapiclient.discovery import build
    token = PIPE/'token.json'
    scopes = ['https://www.googleapis.com/auth/drive']
    creds = Credentials.from_authorized_user_file(str(token), scopes) if token.exists() else None
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            creds = InstalledAppFlow.from_client_secrets_file(str(PIPE/'credentials_oauth.json'), scopes).run_local_server(port=0)
        token.write_text(creds.to_json(), encoding='utf-8')
    return build('drive', 'v3', credentials=creds)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', type=Path, default=ROOT/'projeto.json')
    parser.add_argument('--dry-run', action='store_true', help='Confere destinos e versão sem enviar arquivos')
    args = parser.parse_args()
    config = json.loads(args.config.read_text(encoding='utf-8'))
    if not config.get('publicationEnabled'):
        raise ValueError('Publicação desabilitada. Configure projeto.json e autorize publicationEnabled.')
    for key in ['driveFolderId', 'databaseFileId', 'manifestFileId']:
        if not config.get(key):
            raise ValueError(f'Configure {key} em projeto.json.')
    if config['databaseFileId'] == config['manifestFileId']:
        raise ValueError('Banco e manifesto precisam de IDs distintos.')
    manifest = json.loads(MANIFEST.read_text(encoding='utf-8'))
    content = DB.read_bytes()
    if manifest['tamanhoBanco'] != len(content) or manifest['hashBanco'] != hashlib.sha256(content).hexdigest() or manifest['md5Banco'] != hashlib.md5(content).hexdigest():
        raise ValueError('O banco local diverge do manifesto. Gere novamente.')
    with closing(sqlite3.connect(f'{DB.resolve().as_uri()}?mode=ro', uri=True)) as db:
        if db.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
            raise ValueError('SQLite inválido.')
        count = db.execute('SELECT COUNT(*) FROM imoveis').fetchone()[0]
        if count != manifest['totalRegistros']:
            raise ValueError('Total local divergente.')
    drive = service()
    for key, name in [('databaseFileId', DB.name), ('manifestFileId', MANIFEST.name)]:
        meta = drive.files().get(fileId=config[key], fields='id,name,parents', supportsAllDrives=True).execute()
        if meta['name'] != name or config['driveFolderId'] not in meta.get('parents', []):
            raise ValueError(f'Destino diferente do configurado: {key}. Nada foi enviado.')
    remote = json.loads(drive.files().get_media(fileId=config['manifestFileId'], supportsAllDrives=True).execute())
    check_drop(int(remote['totalRegistros']), count, float(config.get('maxDropPercent', 5)))
    manifest['versao'] = max(int(manifest['versao']), int(remote['versao'])+1)
    manifest['publicadoEm'] = datetime.now().astimezone().isoformat(timespec='seconds')
    print(f"Publicar {count} imóveis, versão {manifest['versao']}, pasta {config['driveFolderId']}")
    if args.dry_run:
        print('Simulação concluída: nenhum arquivo remoto foi alterado.')
        return
    from googleapiclient.http import MediaFileUpload
    stage = MANIFEST.with_suffix('.publicando.json')
    stage.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
    # Banco primeiro. Manifesto só anuncia a versão após terminar o envio do banco.
    drive.files().update(fileId=config['databaseFileId'], media_body=MediaFileUpload(str(DB), mimetype='application/octet-stream', resumable=True), supportsAllDrives=True).execute()
    drive.files().update(fileId=config['manifestFileId'], media_body=MediaFileUpload(str(stage), mimetype='application/json', resumable=True), supportsAllDrives=True).execute()
    meta = drive.files().get(fileId=config['databaseFileId'], fields='size,md5Checksum', supportsAllDrives=True).execute()
    actual = json.loads(drive.files().get_media(fileId=config['manifestFileId'], supportsAllDrives=True).execute())
    if int(meta['size']) != len(content) or meta['md5Checksum'] != manifest['md5Banco'] or actual != manifest:
        raise RuntimeError('Verificação remota divergente. Não anuncie sucesso; consulte o guia de recuperação.')
    os.replace(stage, MANIFEST)
    (PIPE/'auditoria').mkdir(exist_ok=True)
    (PIPE/'auditoria'/f"publicacao_{datetime.now():%Y%m%d_%H%M%S_%f}.json").write_text(json.dumps({'publicado':True, 'manifesto':manifest, 'databaseFileId':config['databaseFileId'], 'manifestFileId':config['manifestFileId']}, indent=2), encoding='utf-8')
    print('Publicação verificada. No celular: Ajustes > Verificar atualização.')


if __name__ == '__main__':
    main()
