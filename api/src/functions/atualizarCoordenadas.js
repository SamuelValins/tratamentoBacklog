const { app } = require('@azure/functions');
const { TableClient } = require('@azure/data-tables');

app.http('atualizarCoordenadas', {
    methods: ['POST'],
    authLevel: 'anonymous',
    handler: async (request, context) => {
        try {
            // No modelo V4, o corpo da requisição é obtido de forma assíncrona
            const body = await request.json();
            const { contrato, partitionKey, latitude, longitude } = body;

            if (!contrato || latitude === undefined || longitude === undefined) {
                return {
                    status: 400,
                    jsonBody: { error: "Parâmetros 'contrato', 'latitude' e 'longitude' são obrigatórios." }
                };
            }

            // Calcula a partição padrão baseada na data atual caso não venha no corpo
            let pKey = partitionKey;
            if (!pKey) {
                const agora = new Date();
                const y = agora.getFullYear();
                const m = String(agora.getMonth() + 1).padStart(2, '0');
                const d = String(agora.getDate()).padStart(2, '0');
                pKey = `${y}${m}${d}`;
            }

            const rKey = contrato.replace(/[^a-zA-Z0-9]/g, '');
            const tableName = "ContratosRetirada";
            
            // Captura a string de conexão padrão configurada no ambiente do Azure
            const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING || process.env.AzureWebJobsStorage;

            if (!connectionString) {
                return {
                    status: 500,
                    jsonBody: { error: "String de conexão de armazenamento do Azure não encontrada." }
                };
            }

            const client = TableClient.fromConnectionString(connectionString, tableName);

            // Atualiza a entidade de forma parcial utilizando o método "Merge"
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
                jsonBody: { message: `Coordenadas do contrato ${contrato} salvas com sucesso.` }
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
