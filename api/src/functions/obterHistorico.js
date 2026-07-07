const { app } = require('@azure/functions');
const { TableClient } = require('@azure/data-tables');

app.http('obterHistorico', {
    methods: ['GET'],
    authLevel: 'anonymous',
    handler: async (request, context) => {
        try {
            const tecnicoLogin = request.query.get('tecnicoLogin');
            const dataInicio = request.query.get('dataInicio'); 
            const dataFim = request.query.get('dataFim');       

            const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING || process.env.AzureWebJobsStorage;
            const tableClient = TableClient.fromConnectionString(connectionString, 'HistoricoAtendimentos');

            let queryFilter = "";

            if (tecnicoLogin) {
                queryFilter = `PartitionKey eq '${tecnicoLogin.trim().toLowerCase()}'`;
            }

            if (dataInicio) {
                const fInicio = `DataHora ge '${dataInicio}T00:00:00.000Z'`;
                queryFilter = queryFilter ? `${queryFilter} and ${fInicio}` : fInicio;
            }
            if (dataFim) {
                const fFim = `DataHora le '${dataFim}T23:59:59.999Z'`;
                queryFilter = queryFilter ? `${queryFilter} and ${fFim}` : fFim;
            }

            const entities = tableClient.listEntities({
                queryOptions: queryFilter ? { filter: queryFilter } : {}
            });

            const atendimentos = [];
            for await (const entity of entities) {
                const fotosArray = entity.ImagensUrls ? entity.ImagensUrls.split(',') : [];

                atendimentos.push({
                    tecnicoLogin: entity.partitionKey, // Corrigido para "partitionKey" minúsculo (Padrão SDK)
                    contrato: entity.rowKey,          // Corrigido para "rowKey" minúsculo (Padrão SDK)
                    cidade: entity.Cidade,
                    data: entity.DataHora,
                    mac: entity.Mac || '',
                    tipoDesconexao: entity.TipoDesconexao || 'N/D',
                    status: entity.Status,
                    fotos: fotosArray
                });
            }

            return { status: 200, jsonBody: atendimentos };

        } catch (error) {
            context.error("[obterHistorico] Erro crítico:", error);
            return {
                status: 500,
                jsonBody: { error: `Erro ao obter relatórios: ${error.message}` }
            };
        }
    }
});
