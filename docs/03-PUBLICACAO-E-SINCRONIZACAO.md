# 03 · Publicar e sincronizar

## Dois arquivos, funções diferentes

`base_projeto.db` contém a tabela `imoveis`. `versao.json` é o manifesto: número crescente da versão, total de imóveis, tamanho, MD5, SHA-256 e data de publicação. O app consulta o manifesto primeiro; só baixa o banco se a versão for maior que a instalada.

O celular baixa **o banco inteiro**, não apenas diferenças. O nome interno dos campos SQLite faz parte do contrato do app: mudar nomes/estrutura exige adaptar o app, testar compatibilidade e distribuir código. `schemaVersion` e `versaoMinimaApp` existem como metadados, mas o cliente herdado não impõe bloqueio automático por esses campos.

## 1. Criar o destino do novo projeto

Na conta corporativa do Google Drive, crie uma pasta exclusiva do projeto. Gere primeiro uma base de homologação e faça upload manual de `base_projeto.db` e `versao.json`. **Não converta o JSON em Google Docs ou o banco em outro tipo.** Os nomes devem ser exatamente esses.

Copie os IDs da pasta, do banco e do manifesto, extraídos dos links de cada item. Preencha no `projeto.json`:

```json
{
  "publicationEnabled": true,
  "driveFolderId": "ID_DA_PASTA_DO_NOVO_PROJETO",
  "databaseFileId": "ID_DO_BANCO_NESSA_PASTA",
  "manifestFileId": "ID_DO_MANIFESTO_NESSA_PASTA"
}
```

Esse trecho deve ser incorporado ao arquivo completo, mantendo os campos de mapeamento. Não substitua o arquivo inteiro pelo trecho. IDs não são credenciais, mas ficam no arquivo local para evitar reutilizar o destino por acidente. O publicador exige que os arquivos já existam, tenham os nomes esperados e pertençam à pasta configurada; não cria nem altera permissões.

## 2. Definir acesso de leitura para o app

O app não faz login no Drive. A organização precisa aprovar se os dados podem ser distribuídos por links acessíveis a quem os possui. Se aprovar, libere **somente os dois arquivos**, como leitor com link; não torne a pasta nem a planilha original públicas. Quem possui o link pode copiar o banco inteiro. Se isso não for aceitável, interrompa a implantação e implemente um serviço autenticado e armazenamento protegido, com adaptação do cliente.

Para uma distribuição Drive aprovada, as URLs podem seguir estes formatos, substituindo os IDs:

```text
https://drive.usercontent.google.com/download?id=ID_DO_BANCO&export=download&confirm=t
https://drive.google.com/uc?export=download&id=ID_DO_MANIFESTO
```

Teste os links sem estar conectado à sua conta: precisam retornar bytes SQLite e JSON, sem HTML de login/confirmação. Políticas do domínio, limites de download e telas de confirmação podem impedir o uso; teste no Android antes de distribuir. Se necessário, use outro endpoint HTTPS que entregue os mesmos arquivos e adapte o publicador.

Preencha `expo.extra.databaseUrl` e `manifestUrl` no `app.json`, ou use `EXPO_PUBLIC_DATABASE_URL` e `EXPO_PUBLIC_MANIFEST_URL` em ambiente de build. Mantenha os campos de revisitas vazios: este modelo publica a base principal usada pela tela de setores.

## 3. Autorizar a estação que publica

Para usar `pipeline/publicar.py`, o administrador cria um projeto Google Cloud corporativo, habilita Google Drive API e configura OAuth consent conforme as políticas da organização. Crie um cliente OAuth do tipo **aplicativo para computador** e salve o JSON recebido como `pipeline/credentials_oauth.json`. Não renomeie um arquivo de service account para esse nome: são tipos diferentes.

Na primeira execução, o navegador pede login e consentimento da conta com permissão de edição nos dois arquivos. O script usa escopo Drive completo para atualizar arquivos previamente criados; o administrador deve revisar essa autorização. O token fica local em `pipeline/token.json`. A aprovação/tipo de consentimento e eventual expiração dependem da configuração OAuth; usuários de teste podem precisar autorizar novamente. Credenciais e tokens nunca devem ir ao GitHub.

## 4. Revisar e publicar

```powershell
.\.venv\Scripts\python.exe pipeline\publicar.py --dry-run
.\.venv\Scripts\python.exe pipeline\publicar.py
```

A simulação acessa metadados e versão remota, mas não envia banco/manifesto; pode abrir o login e salvar token local. O envio real confere hashes locais, SQLite, nomes/pasta de destino e queda de quantidade contra a base remota. A versão final será ao menos a local e superior à remota. Publica **banco primeiro, manifesto depois**, preservando os IDs/URLs. Ao final, verifica o tamanho e MD5 remoto e lê o manifesto novamente. O número de versão não deve ser editado manualmente para baixo.

Durante o intervalo entre os dois uploads, um celular pode baixar um arquivo diferente do hash do manifesto antigo: ele rejeita a ativação e preserva sua base local. Se apenas o envio do manifesto falhar, não apague o banco remoto nem anuncie sucesso; execute novamente após resolver a conexão. O upload dos dois arquivos não é uma transação atômica no Drive.

## 5. Receber no celular

No app, use **Ajustes → Verificar atualização** ou o botão de atualização no cabeçalho. O fluxo é:

1. Abrir a base local (vazia na primeira instalação).
2. Buscar o manifesto e comparar `versao` com a versão salva.
3. Baixar o SQLite para arquivo temporário.
4. Conferir tamanho, MD5, integridade SQLite, tabela `imoveis` e total.
5. Fechar a conexão durante ativação, copiar a base atual para backup e ativar a nova.
6. Restaurar o backup se a ativação falhar; salvar a versão após sucesso.

Sem rede ou com download inválido, a consulta permanece na última base local disponível. Na primeira instalação, sem sincronização concluída, não existem imóveis para consultar. Sem autenticação/assinatura, quem altera os dois arquivos no servidor pode alterar o conteúdo distribuído; mantenha controle de editores.

## Fotos têm sincronização própria

O SQLite contém URLs, não os arquivos das fotos. Para usar imagens sem conexão, abra o setor e baixe suas fotos enquanto estiver online. O app mantém cache e informa progresso/falhas; uma base atualizada não significa que todas as fotos já estão salvas. Se o link da foto exigir login, expirar ou não retornar uma imagem acessível, o download pode falhar. Teste após uma nova versão e em modo avião. Não presuma que URLs iguais com conteúdo substituído serão atualizadas automaticamente no cache.
