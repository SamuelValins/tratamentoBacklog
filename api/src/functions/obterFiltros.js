const { app } = require('@azure/functions');
const { TableClient } = require('@azure/data-tables');

app.http('obterFiltros', {
    methods: ['GET'],
    authLevel: 'anonymous',
    handler: async (request, context) => {
        try {
            const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING || process.env.AzureWebJobsStorage;
            
            if (!connectionString) {
                context.error("[obterFiltros] Erro: Chave de conexão de armazenamento não configurada.");
                return {
                    status: 500,
                    jsonBody: { error: "Connection string de armazenamento não configurada no ambiente do Azure." }
                };
            }

            const tableClient = TableClient.fromConnectionString(connectionString, 'ContratosRetirada');
            
            // Projeta apenas as colunas necessárias para reduzir consumo de banda e custos
            const entities = tableClient.listEntities({
                queryOptions: { select: ['MesSafra'] }
            });

            const safrasUnicas = new Set();

            for await (const entity of entities) {
                if (entity.MesSafra) {
                    const mesSafraValue = entity.MesSafra.trim();
                    // Extrai apenas dígitos para identificar o número do mês de safra
                    const matchDigito = mesSafraValue.match(/\d+/);
                    if (matchDigito) {
                        const numeroMes = parseInt(matchDigito[0], 10);
                        // Filtra estritamente safras do 1 ao 4 mês, omitindo anos (ex: 2026) e safra 13+
                        if (numeroMes >= 1 && numeroMes <= 4 && !mesSafraValue.includes('2026')) {
                            safrasUnicas.add(mesSafraValue);
                        }
                    }
                }
            }

            return {
                status: 200,
                jsonBody: {
                    safras: Array.from(safrasUnicas).sort()
                }
            };

        } catch (error) {
            context.error("[obterFiltros] Erro ao listar filtros dinâmicos:", error);
            return {
                status: 500,
                jsonBody: { error: error.message || "Erro ao coletar filtros de busca no banco." }
            };
        }
    }
});
