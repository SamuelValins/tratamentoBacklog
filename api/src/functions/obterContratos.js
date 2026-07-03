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

            context.log(`[obterContratos] Buscando Cidade: ${cidade}, Safra: ${safra}`);

            if (!cidade || !safra) {
                return {
                    status: 400,
                    jsonBody: { error: "Parâmetros 'cidade' e 'safra' são obrigatórios." }
                };
            }

            // Lê as conexões disponíveis no ambiente
            const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING || process.env.AzureWebJobsStorage;
            
            if (!connectionString) {
                return {
                    status: 500,
                    jsonBody: { 
                        error: "Connection string não encontrada no ambiente do Azure.",
                        diagnostico: "Variável AZURE_STORAGE_CONNECTION_STRING não foi propagada ou não existe."
                    }
                };
            }

            const tableClient = TableClient.fromConnectionString(connectionString, 'ContratosRetirada');

            const cidadeUpper = cidade.trim().toUpperCase();
            let safraFiltro = safra.trim();
            const matchDigito = safra.match(/\d+/);
            const safraCurta = matchDigito ? matchDigito[0] : safraFiltro;

            let queryFilter = `Cidade eq '${cidadeUpper}' and (MesSafra eq '${safraFiltro}' or MesSafra eq '${safraCurta}')`;

            if (tipo && tipo !== 'TODOS') {
                const tipoUpper = tipo.trim().toUpperCase();
                queryFilter += ` and TipoDesconexao eq '${tipoUpper}'`;
            }

            const entities = tableClient.listEntities({
                queryOptions: { filter: queryFilter }
            });

            const contratosFormatados = [];

            for await (const entity of entities) {
                const macString = entity.Mac || '';
                const qtdEquip = macString ? macString.split('/').length : 1;

                contratosFormatados.push({
                    contrato: entity.Contrato || entity.RowKey,
                    cidade: entity.Cidade,
                    tipo: entity.TipoDesconexao || 'DESCONEXÃO',
                    titular: entity.Titular || 'N/D',
                    endereco: entity.Endereco || 'Endereço não cadastrado',
                    complemento: entity.IdCompl ? `${entity.IdCompl} ${entity.ComplDescr || ''}`.trim() : (entity.ComplDescr || ''),
                    bairro: entity.Bairro || '',
                    tel_res: entity.TelRes || '',
                    tel_cel: entity.TelCel || '',
                    qtd_equip: qtdEquip,
                    modelo_equip: entity.ModeloEquip || entity.FamiliaEquip || 'N/D',
                    obs: entity.Obs || '',
                    lat: null, 
                    lon: null
                });
            }

            return { status: 200, jsonBody: contratosFormatados };

        } catch (error) {
            context.error("[obterContratos] Erro Crítico:", error);
            
            // Retorna o erro detalhado diretamente ao frontend para podermos ver o erro no console/rede
            return {
                status: 500,
                jsonBody: { 
                    error: `Falha na execução: ${error.message}`,
                    detalhes: error.toString(),
                    stack: error.stack,
                    has_connection_string: !!(process.env.AZURE_STORAGE_CONNECTION_STRING || process.env.AzureWebJobsStorage)
                }
            };
        }
    }
});
