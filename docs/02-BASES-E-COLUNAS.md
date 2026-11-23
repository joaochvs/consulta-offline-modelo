# 02 · Preparar a base e mapear colunas

## Retrato completo, não apenas novidades

Cada entrada substitui a base publicada inteira. Forneça **todos os imóveis e todas as visitas necessários para a consulta**, não apenas a exportação do dia. Este importador não junta automaticamente a nova entrada a um histórico anterior.

A planilha pode vir de exportação do sistema, BI ou SharePoint sincronizado. Baixe/sincronize primeiro e passe o caminho local. O modelo não tenta contornar login ou permissões do SharePoint, não altera o Excel original e não consulta o SharePoint diretamente do celular.

Use `.xlsx` com cabeçalhos na primeira linha e aba `Registros` (ou configure outro nome), ou CSV UTF-8 com separador `;`. Sem células mescladas, linhas de título extras ou cabeçalhos duplicados. Salve e recalcule fórmulas no Excel antes de exportar: o leitor utiliza os valores salvos, não recalcula fórmulas.

## Mapeamento: destino à esquerda, cabeçalho da origem à direita

Copie `projeto.exemplo.json` para `projeto.json`. No bloco `columns`, troque os valores pelos cabeçalhos exatos da sua planilha. Não renomeie as chaves do lado esquerdo. Retire do mapeamento campos opcionais que não existem; um cabeçalho configurado e ausente bloqueia a geração.

| Destino | Obrigatório | Significado e regra |
| --- | --- | --- |
| `codigo_unico` | Sim | Matrícula estável do imóvel; texto, preservando zeros. Vazio é excluído e contabilizado. |
| `code_deep` | Sim | Identificador técnico da visita `BASE-1`, `BASE-2` etc. Divide pelo último hífen. Formato inválido é excluído e contabilizado. |
| `data_hora` | Sim | Data/hora real da visita; data inválida bloqueia a geração. |
| `municipio` | Sim | Município não vazio; normalizado para maiúsculas, sem correção automática de grafia. |
| `hora_registro` | Não | Campo separado de hora; se mapeado, é concatenado a `data_hora`. |
| `data_modificacao` | Não | Primeiro desempate quando data/hora da visita empata. |
| `setor` | Não | Inteiro não negativo; vazio gera grupo SEM SETOR. Não é extraído automaticamente de nomes. |
| `bairro`, `logradouro`, `numero`, `complemento` | Não | Endereço operacional; o importador não tenta adivinhar componentes faltantes. |
| `latitude`, `longitude` | Não | Par decimal, ponto ou vírgula. Latitude entre -90 e 90, longitude entre -180 e 180. Se um lado for inválido, ambos ficam vazios. |
| `situacao_backoffice` | Não | Status já em texto, por exemplo Pendente ou Aprovado. GUID não é traduzido automaticamente. |
| `foto_visita`, `foto_estrutura` | Não | Uma URL HTTPS por célula; não aceita listas/HTML ou foto embutida no Excel. A tela herdada mostra a foto principal. |
| `encontrou_pessoa`, `observacoes` | Não | Opcionais; só mapear se necessário e aprovado. Texto livre pode conter dados pessoais. |

Não publique CPF, telefone, renda, documentos, assinaturas ou nomes de moradores. Colunas extras da origem não são exportadas. Cuidado ao mapear deliberadamente um campo sensível para uma coluna operacional: o programa não conhece o significado do conteúdo.

## Datas e códigos

O exemplo usa `dateFormat: "%Y-%m-%d %H:%M:%S"`, como `2026-01-03 10:00:00`. Para `03/01/2026 10:00`, use `%d/%m/%Y %H:%M`. `modifiedFormat` faz a mesma coisa para modificação. Datas Excel nativas também são aceitas quando estão em um único campo. Para data e hora em duas colunas, a concatenação deve corresponder a `dateFormat`; confira uma amostra. Não misture formatos na mesma coluna.

Use a mesma referência de fuso para toda a base. Textos sem fuso são tratados como horários da operação; objetos datetime com fuso são convertidos a UTC. Não misture os dois tipos em uma implantação.

No Excel, matrículas devem ser armazenadas como **texto**. Um formato visual `00000` sobre número `123` não preserva os zeros no arquivo lido. Use o valor textual `00123`. Quando o projeto não usa Code Deep, prepare um identificador técnico estável terminado em `-numero_da_visita`; não coloque a matrícula no lugar de um identificador sem conferir a regra.

## Como uma visita vence

Para a mesma matrícula, ignorando maiúsculas/minúsculas e espaços nas pontas, a ordem é: data/hora de registro; data de modificação; número da visita; posição no arquivo como último desempate. A última vence. O app recebe uma linha por imóvel, não todo o histórico. Exemplo: `00001` com visita 1 no dia 2 e visita 2 no dia 3 aparece uma vez, com os dados do dia 3.

`photoPolicy: "latest"` usa a foto da visita vencedora, mesmo que vazia. `"first"` usa a da primeira visita disponível na base completa, também sem procurar uma foto posterior se estiver vazia. Para uma política diferente, altere e teste o importador.

## Executar e revisar

```powershell
.\.venv\Scripts\python.exe pipeline\atualizar.py "C:\Bases\base_completa.xlsx"
```

Ou arraste o arquivo sobre `ATUALIZAR_DADOS_DO_APP.bat`. O BAT gera localmente, sem publicar.

O pipeline cria uma cópia estável temporária, lê apenas os campos mapeados para a saída, valida e escreve o SQLite. Mantém backups locais anteriores e salva auditoria de contagens/hash. O temporário é removido ao final; a origem permanece intacta. Falhas de validação antes da ativação não substituem a saída anterior.

Confira totais, linhas excluídas, coordenadas ausentes, última visita de amostras e fotos. Os totais excluídos podem se sobrepor conceitualmente, mas a rotina conta códigos técnicos inválidos apenas depois de validar matrícula. Se o total cair mais de `maxDropPercent` (padrão 5%), a geração bloqueia. Base vazia sempre bloqueia. A proteção também é aplicada contra a versão remota ao publicar. Investigue a exportação antes de mudar o limite; ela não detecta toda exportação parcial, especialmente em uma primeira carga.

Para inspecionar, abra `pipeline/output/base_projeto.db` em um visualizador SQLite local, tabela `imoveis`. Não envie a base a ferramentas públicas de inspeção.
