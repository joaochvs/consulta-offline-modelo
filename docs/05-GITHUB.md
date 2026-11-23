# 05 · Preparar para o GitHub

O pacote entregue é uma pasta independente, sem histórico Git do Censo ou da USIS. Use o GitHub da organização e confirme com a empresa a licença, os direitos sobre o código e a visibilidade. Este modelo não atribui uma licença em nome da empresa.

## Criar o repositório

Crie um repositório vazio no GitHub (sem README gerado) e, na pasta extraída do modelo:

```powershell
git init
git branch -M main
git add .
python scripts/verificar_repositorio.py
git diff --cached --stat
git status --short
```

Revise os arquivos adicionados. Depois:

```powershell
git commit -m "Adiciona modelo de consulta offline e guias de operacao"
git remote add origin https://github.com/SUA-ORGANIZACAO/SEU-REPOSITORIO.git
git push -u origin main
```

Substitua a URL pelo destino criado. Não coloque token na URL; use a autenticação normal do Git. Não use `git add -f`. Se o scanner apontar um arquivo local, remova-o do índice com `git rm --cached -- caminho-do-arquivo` e investigue o `.gitignore` antes de continuar. Não remova a cópia local necessária à operação.

## O que pode e o que não pode entrar

Pode: código, lockfile, configuração de exemplo, tutoriais, imagem, CSV fictício e testes. Fica local: `.env`, `projeto.json`, bases reais, snapshots, bancos SQLite, logs/auditorias, backups, OAuth, tokens, APKs e chaves de assinatura. O `.gitignore` cobre essas classes, e o scanner verifica arquivos rastreados; ele não substitui uma revisão humana de conteúdo ou do histórico.

O workflow `validar.yml` executa testes Python, verificação de arquivos e typecheck. **Não publica base, não gera APK e não tem secrets.** Configure branch protection/revisões conforme a prática da organização.

Para disponibilizar como modelo, marque **Template repository** nas configurações do GitHub se essa opção estiver disponível. O próximo responsável pode criar uma cópia para cada novo projeto. Mantenha alterações genéricas no modelo e dados/configurações específicos apenas nas implantações.

## Se um segredo já foi enviado

Adicionar ao `.gitignore` depois não retira o arquivo do histórico. Revogue/rotacione primeiro a credencial exposta, comunique o administrador e trate a remoção do histórico com a equipe. Se um arquivo de dados foi exposto, a organização precisa avaliar o incidente; apagar um commit não garante que cópias não existam.
