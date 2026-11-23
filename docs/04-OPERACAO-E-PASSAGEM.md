# 04 · Rotina e passagem de responsabilidade

## Antes de o responsável anterior sair

Preencha e guarde em local interno, sem senhas neste documento:

| Item | Responsável / localização |
| --- | --- |
| Dono do projeto e aprovação de dados | A preencher |
| Quem exporta a base e com que frequência | A preencher |
| Pasta/aba de origem e definição de matrícula | A preencher |
| Quem confere amostras e aprova cada versão | A preencher |
| Pasta Drive, dois arquivos e conta editora | A preencher |
| Projeto Google Cloud/OAuth e administrador | A preencher |
| Organização/repositório GitHub e mantenedores | A preencher |
| Conta/projeto Expo e assinatura Android | A preencher |
| Local dos backups e política de retenção | A preencher |
| Canal de suporte à equipe de campo | A preencher |

Conceda acessos corporativos ao sucessor, faça uma atualização completa com ele, instale o APK em um telefone de teste e execute o teste offline. A transferência de contas, propriedade, acesso a SharePoint e assinatura Android deve ser feita pelo administrador; copiar esta pasta não transfere esses itens. Após a validação, revogue acessos pessoais que não sejam mais necessários.

## Rotina de cada atualização

1. Obter a base **completa** e aguardar sincronização/salvamento.
2. Executar `pipeline/atualizar.py` ou o BAT.
3. Conferir contagem, exclusões, datas, municípios, setores, coordenadas e algumas fotos. Verificar se matrícula foi preservada como texto.
4. Executar `pipeline/publicar.py --dry-run`; conferir o projeto/destino.
5. Executar `pipeline/publicar.py` e aguardar a confirmação de verificação remota.
6. Atualizar um telefone, confirmar versão e quantidade e testar uma matrícula conhecida.
7. Baixar fotos necessárias e avisar a equipe após o teste.

Nenhum agendamento é incluído. Se a empresa automatizar, use uma estação/serviço corporativo com monitoramento; o simples recebimento de um link não atualiza a base sozinho.

## Onde investigar

- `pipeline/auditoria/`: resumos de geração e confirmação da publicação.
- `pipeline/backups/`: bancos/manifestos anteriores, sem exclusão automática neste modelo.
- Terminal: mensagem de erro de validação, autenticação ou upload.
- App → Ajustes: versão local, quantidade e diagnóstico das fotos.

Auditoria de geração tem `publicado=false`; a publicação gera outro arquivo com `publicado=true`. Não confunda geração local com distribuição concluída. Backups contêm dados operacionais e precisam da mesma proteção da base; o responsável deve definir retenção e fazer cópia protegida fora da estação.

## Problemas frequentes

| Sintoma | Verificar / agir |
| --- | --- |
| Coluna ausente | Conferir cabeçalho exato e `columns` em `projeto.json`. Remover apenas mapeamentos opcionais que não existem. |
| Data inválida | Conferir exemplos reais, formato e data/hora separada. Não converter datas inválidas em data atual. |
| Queda de quantidade | Conferir se a exportação é completa e não há filtros ativos; não elevar o limite apenas para passar. |
| Erro OAuth/login | Conferir conta editora, consentimento, usuário autorizado e configuração corporativa; reautorizar se necessário. |
| HTTP/JSON inválido no app | Link está retornando HTML, exigindo login ou excedendo limites; testar acesso de leitura. |
| MD5/tamanho divergente | Upload incompleto ou banco e manifesto de versões diferentes; terminar/repetir a publicação e tentar de novo. |
| Versão não aumenta | Manifesto remoto é o correto? Celular usa URLs de outro projeto? Versão publicada é maior? |
| Foto online, indisponível offline | Baixar fotos do setor e conferir falhas/armazenamento; sincronização do banco não baixa todas as fotos. |
| Município/setor errado | Corrigir origem/mapeamento. Não há catálogo IBGE ou extração de setor de texto neste modelo. |
| Alterei URL e o APK usa a antiga | Configuração está incorporada ao build; gerar/distribuir novo código/configuração. |

## Recuperar uma base anterior

Prefira restaurar uma base completa de origem conhecida e gerar/publicar uma versão nova. Para restaurar apenas os arquivos de backup: preserve antes os arquivos atuais; copie **o par** `.db` e `versao.json` do mesmo backup para `pipeline/output/`; execute o publicador. Ele confere hashes e atribui versão maior que a remota. A proteção de queda continua ativa; uma redução legítima exige revisão explícita do limite/configuração pelo responsável.

Nunca simplesmente publique um manifesto de versão menor: celulares atualizados não farão downgrade. Nunca envie somente o manifesto apontando para um banco diferente. Não desinstale o app para corrigir sincronização: isso pode apagar base e fotos locais. Faça testes no telefone de homologação antes de orientar a equipe.

## Dados x código

Atualização de dados: exportação → pipeline → banco/manifesto → sincronização. Mantém APK, IDs de arquivos e estrutura da tabela.

Atualização de código: tela, dependências, permissões, estrutura de dados ou URLs incorporadas. Exige testes técnicos e novo APK ou um fluxo OTA configurado e homologado separadamente. Não renomeie colunas SQLite sem adaptar todas as consultas do app.
