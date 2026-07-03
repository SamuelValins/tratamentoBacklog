const { app } = require('@azure/functions');
const { TableClient } = require('@azure/data-tables');

app.http('obterContratos', {
    methods: ['GET'],
    authLevel: 'anonymous',
    handler: async (request, context) => {
        try {
            const cidade = request.query.get('cidade');
            const safra = request.query.get('safra');
            const tipo = request.query.get('tipo');
            const limit = request.query.get('limit'); // Novo parâmetro de limite

            context.log(`[obterContratos] Buscando - Cidade: ${cidade}, Safra: ${safra}, Tipo: ${tipo}, Limite: ${limit}`);

            if (!cidade || !safra) {
                return {
                    status: 400,
                    jsonBody: { error: "Parâmetros 'cidade' e 'safra' são obrigatórios." }
                };
            }

            const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING || process.env.AzureWebJobsStorage;
            
            if (!connectionString) {
                return {
                    status: 500,
                    jsonBody: { error: "Configuração ausente: AZURE_STORAGE_CONNECTION_STRING ou AzureWebJobsStorage não definidos no ambiente." }
                };
            }

            const tableClient = TableClient.fromConnectionString(connectionString, 'ContratosRetirada');

            const cidadeUpper = cidade.trim().toUpperCase();
            
            // Filtro da Cidade
            let queryFilter = `Cidade eq '${cidadeUpper}'`;

            // Filtro de Safra (Ignora se for "TODOS")
            if (safra && safra !== 'TODOS') {
                let safraFiltro = safra.trim();
                const matchDigito = safra.match(/\d+/);
                const safraCurta = matchDigito ? matchDigito[0] : safraFiltro;
                queryFilter += ` and (MesSafra eq '${safraFiltro}' or MesSafra eq '${safraCurta}')`;
            }

            // Filtro de Desconexão com mapeamento exato do Banco Azure (Sem acentos e formatos específicos)
            if (tipo && tipo !== 'TODOS') {
                const tipoUpper = tipo.trim().toUpperCase();
                if (tipoUpper.includes('OPC')) {
                    queryFilter += ` and TipoDesconexao eq 'DESCONECTADO - OPCAO'`;
                } else if (tipoUpper.includes('INAD')) {
                    queryFilter += ` and TipoDesconexao eq 'DESCONECTADO - INADIMPLENCIA (TOTAL)'`;
                } else {
                    queryFilter += ` and TipoDesconexao eq '${tipoUpper}'`;
                }
            }

            const entities = tableClient.listEntities({
                queryOptions: { filter: queryFilter }
            });

            // Aplica a limitação diretamente no loop de leitura para otimizar desempenho e custo do banco
            let maxCount = limit && limit !== 'ALL' ? parseInt(limit, 10) : null;
            let currentCount = 0;

            const contratosFormatados = [];

            for await (const entity of entities) {
                if (maxCount !== null && currentCount >= maxCount) {
                    break;
                }

                const macString = entity.Mac || '';
                const qtdEquip = macString ? macString.split('/').length : 1;

                contratosFormatados.push({
                    contrato: entity.Contrato || entity.RowKey,
                    cidade: entity.Cidade,
                    tipo: entity.TipoDesconexao || 'DESCONEXÃO',
                    titular: entity.Titular || 'N/D',
                    endereco: entity.Endereco || 'Endereço não cadastrado',
                    complemento: entity.IdCompl || '',
                    bairro: entity.Bairro || '',
                    tel_res: entity.TelRes || '',
                    tel_cel: entity.TelCel || '',
                    qtd_equip: qtdEquip,
                    modelo_equip: entity.ModeloEquip || entity.FamiliaEquip || 'N/D',
                    mac: entity.Mac || 'MAC não disponível para este equipamento', // Captura o MAC para exibição via clique
                    obs: entity.Obs || '',
                    lat: null, 
                    lon: null
                });

                currentCount++;
            }

            return { status: 200, jsonBody: contratosFormatados };

        } catch (error) {
            context.error("[obterContratos] Erro Crítico:", error);
            return {
                status: 500,
                jsonBody: { error: error.message || "Erro interno ao buscar contratos." }
            };
        }
    }
});
