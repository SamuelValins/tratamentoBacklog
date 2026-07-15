const { app } = require('@azure/functions');
const { TableClient } = require('@azure/data-tables');

app.http('atualizarCoordenadas', {
    methods: ['POST'],
    authLevel: 'anonymous',
    handler: async (request, context) => {
        try {
            const body = await request.json();
            const { contrato, partitionKey, latitude, longitude } = body;

            if (!contrato || latitude === undefined || longitude === undefined) {
                return {
                    status: 400,
                    jsonBody: { error: "Parâmetros 'contrato', 'latitude' e 'longitude' são obrigatórios." }
                };
            }

            const rKey = contrato.replace(/[^a-zA-Z0-9]/g, '');
            const tableName = "ContratosRetirada";
            const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING || process.env.AzureWebJobsStorage;

            if (!connectionString) {
                return {
                    status: 500,
                    jsonBody: { error: "String de conexão de armazenamento do Azure não encontrada." }
                };
            }

            const client = TableClient.fromConnectionString(connectionString, tableName);

            // --- DECOBERTA DINÂMICA DA PARTITIONKEY ---
            let pKey = partitionKey;
            
            // Se a partição não veio ou veio vazia, busca o registro existente no banco pelo RowKey (Contrato)
            if (!pKey) {
                context.log(`Buscando PartitionKey real para o RowKey: ${rKey}`);
                const iterator = client.listEntities({
                    queryOptions: { filter: `RowKey eq '${rKey}'` }
                });
                
                for await (const entity of iterator) {
                    pKey = entity.partitionKey || entity.PartitionKey;
                    break; // Captura a primeira ocorrência correspondente
                }
            }

            // Se mesmo após a busca o contrato não for encontrado no banco de dados
            if (!pKey) {
                return {
                    status: 404,
                    jsonBody: { error: `Contrato ${contrato} não localizado na base de dados para atualização.` }
                };
            }

            // Grava as coordenadas na partição correta identificada dinamicamente
            await client.updateEntity({
                partitionKey: pKey,
                rowKey: rKey,
                latitude: parseFloat(latitude),
                longitude: parseFloat(longitude),
                lat: parseFloat(latitude),
                lon: parseFloat(longitude),
                coordX: String(longitude),
                coordY: String(latitude)
            }, "Merge");

            return {
                status: 200,
                jsonBody: { message: `Coordenadas do contrato ${contrato} salvas com sucesso na partição ${pKey}.` }
            };

        } catch (error) {
            context.error("Erro ao gravar coordenadas no Azure Table:", error);
            return {
                status: 500,
                jsonBody: { error: "Erro interno do servidor: " + error.message }
            };
        }
    }
});
