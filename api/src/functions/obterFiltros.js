const { app } = require('@azure/functions');
const { TableClient } = require('@azure/data-tables');

app.http('obterFiltros', {
    methods: ['GET'],
    authLevel: 'anonymous',
    handler: async (request, context) => {
        try {
            // Tenta obter a connection string customizada primeiro, depois a padrão
            const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING || process.env.AzureWebJobsStorage;
            
            if (!connectionString) {
                context.error("[obterFiltros] Erro: Chave de conexão de armazenamento não configurada.");
                return {
                    status: 500,
                    jsonBody: { error: "Connection string de armazenamento não configurada no ambiente do Azure." }
                };
            }

            const tableClient = TableClient.fromConnectionString(connectionString, 'ContratosRetirada');
            
            // O uso de 'select' garante que apenas as colunas necessárias sejam transmitidas do banco, reduzindo o uso de banda e custos
            const entities = tableClient.listEntities({
                queryOptions: { select: ['Cidade', 'MesSafra'] }
            });

            const cidadesUnicas = new Set();
            const safrasUnicas = new Set();

            for await (const entity of entities) {
                if (entity.Cidade) {
                    cidadesUnicas.add(entity.Cidade.trim().toUpperCase());
                }
                if (entity.MesSafra) {
                    safrasUnicas.add(entity.MesSafra.trim());
                }
            }

            return {
                status: 200,
                jsonBody: {
                    cidades: Array.from(cidadesUnicas).sort(),
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
