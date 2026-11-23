# 01 · Iniciar um novo projeto

## 1. Separar contas e pastas

Crie uma pasta própria para cada contrato/projeto. Não trabalhe dentro de outra implantação. Defina o responsável técnico, quem prepara as planilhas, quem aprova a publicação e quem atende a equipe de campo.

Use contas da organização para o repositório, Expo/EAS, armazenamento e OAuth. Não dependa da conta pessoal de quem está saindo. Nenhuma conta existente é transferida por este modelo.

## 2. Instalar o ambiente

Instale Git, Python 3.11+ e Node.js LTS compatível com o Expo 56; o workflow usa Node 22. Abra PowerShell na pasta do modelo:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r pipeline\requirements.txt
npm ci
Copy-Item projeto.exemplo.json projeto.json
Copy-Item .env.example .env
```

Os comandos usam o executável do ambiente virtual diretamente: não é necessário alterar a política de execução do Windows. `projeto.json` guarda mapeamentos e destinos locais; não deve ser versionado.

## 3. Testar com os dados fictícios

```powershell
.\.venv\Scripts\python.exe pipeline\atualizar.py exemplos\base_ficticia.csv
.\.venv\Scripts\python.exe -m unittest discover -s pipeline\tests -v
npm run typecheck
```

Confira o resumo: 4 linhas, 1 sem matrícula, 1 visita consolidada e 2 imóveis. Os arquivos são `pipeline/output/base_projeto.db` e `pipeline/output/versao.json`. Nenhum envio é feito por essa rotina.

## 4. Dar identidade ao aplicativo

Edite `app.json`:

| Propriedade | O que definir |
| --- | --- |
| `expo.name` | Nome mostrado na tela e no PDF |
| `expo.slug` | Identificador exclusivo, sem espaços |
| `expo.scheme` | Esquema exclusivo para links |
| `expo.android.package` | Identificador Android exclusivo, por exemplo `com.suaempresa.consultacontrato` |
| `expo.android.versionCode` | Incrementar em novos binários distribuídos |

O modelo não inclui marca nem ícone corporativo. Adicione um ícone autorizado e configure `expo.icon` se necessário. Não reutilize `android.package`, IDs EAS ou chaves de assinatura de projetos anteriores. Após distribuir, preserve o package e a assinatura do seu projeto para permitir atualizações.

Configure a base real conforme o guia 02; depois publique conforme o guia 03.

## 5. Executar e gerar APK

```powershell
npm start
```

Teste em Android com Expo Go compatível com a versão do projeto ou em development build. A execução web não é a homologação da experiência SQLite/arquivos do Android.

Para gerar um APK interno, use a conta Expo da organização:

```powershell
npx eas-cli login
npx eas-cli init
npx eas-cli build --platform android --profile preview
```

`eas init` deve vincular um projeto **novo** e preencher `extra.eas.projectId`. O `eas.json` já tem perfil `preview` para APK. Não compartilhe senhas nem copie sessões pessoais. Configure as URLs em `app.json` → `expo.extra.databaseUrl` e `manifestUrl`, ou no ambiente EAS usado no build. Um `.env` local não deve ser tratado como garantia de configuração do serviço remoto.

As variáveis `EXPO_PUBLIC_*` são incorporadas ao aplicativo e são visíveis; nunca coloque segredos nelas. Se as URLs mudarem após o build, é necessário distribuir uma alteração da configuração/código. Mudanças apenas nos dados, nos mesmos dois arquivos, dispensam novo APK.

## 6. Homologar antes da distribuição

No Android de teste, verifique: primeira sincronização; pesquisa de uma matrícula conhecida; município/setor; última visita/status; foto; copiar coordenadas; Maps; PDF; atualização de uma segunda versão. Baixe as fotos de um setor, ative modo avião e repita consulta, foto e PDF. Force uma falha de rede durante atualização e confirme que a base anterior continua consultável.

A atualização OTA de código está desabilitada no modelo (`updates.enabled=false`). Caso a equipe adote EAS Update, configure e homologue esse fluxo separadamente. Ele é diferente da atualização do SQLite.
