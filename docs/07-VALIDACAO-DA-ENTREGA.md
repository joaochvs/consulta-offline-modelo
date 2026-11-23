# 07 · Validação desta entrega

Verificado em 23/11/2026:

- Cinco testes Python passaram: última visita e campos permitidos; desempate por hora/chave sem distinção de caixa; bloqueio de base vazia/parcial/datas inválidas; par de coordenadas/política de foto; contrato e integridade SQLite.
- O importador foi executado com o CSV fictício: quatro linhas de entrada, duas matrículas publicáveis, uma linha sem matrícula e uma visita anterior consolidada. Saída: dois imóveis, sem coordenadas ausentes.
- TypeScript passou com `tsc --noEmit --skipLibCheck --incremental false`, usando as dependências já instaladas no ambiente de trabalho. A instalação isolada por `npm ci` será executada pelo workflow do repositório; não foi repetida nesta entrega.
- Scanner de arquivos rastreados passou. Configuração de exemplo está sem IDs/URLs de implantações anteriores, sem conta Expo e sem OTA habilitado.
- Links locais dos guias e referência à imagem foram conferidos. O infográfico foi inspecionado visualmente.

Não houve upload de bases, mudança de permissões remotas, geração/distribuição de APK ou teste em Android real para este modelo. A publicação OAuth precisa ser homologada na conta e pasta do novo projeto. A rotina de homologação do Android está no guia 01.

Arquivos de banco, auditoria e temporários produzidos na verificação não fazem parte do ZIP. Os dados do CSV de demonstração são fictícios. O histórico Git dos aplicativos originais não é distribuído.
