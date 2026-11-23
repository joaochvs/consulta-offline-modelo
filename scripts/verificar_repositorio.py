"""Verificação local e CI: impede arquivos locais de entrarem no repositório."""
import re
import subprocess
from pathlib import Path

root = Path(__file__).resolve().parents[1]
tracked = subprocess.run(['git', 'ls-files', '-z'], cwd=root, capture_output=True, check=True).stdout.decode().split('\0')
issues = []
for name in filter(None, tracked):
    parts = Path(name).parts
    local = name == 'projeto.json' or (Path(name).name.startswith('.env') and Path(name).name != '.env.example') or any(p in parts for p in ['node_modules', '.venv', 'output', 'backups', 'auditoria', 'temp'])
    local |= Path(name).suffix.lower() in {'.db', '.sqlite', '.sqlite3', '.xlsx', '.xls', '.parquet', '.pickle', '.apk', '.aab', '.keystore', '.jks'}
    local |= Path(name).name in {'credentials_oauth.json', 'credentials.json', 'token.json'}
    if local:
        issues.append(f'Arquivo local rastreado: {name}')
    path = root/name
    if not path.exists() or path.suffix.lower() in {'.png', '.jpg', '.zip'}:
        continue
    data = path.read_text(encoding='utf-8', errors='replace')
    if re.search(r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----', data):
        issues.append(f'Possível chave privada: {name}')
    if re.search(r'"(?:refresh_token|client_secret)"\s*:\s*"[^"\s]+"', data):
        issues.append(f'Possível segredo OAuth: {name}')
if issues:
    raise SystemExit('\n'.join(issues))
print('Arquivos rastreados verificados. Revise também o diff antes de publicar.')
