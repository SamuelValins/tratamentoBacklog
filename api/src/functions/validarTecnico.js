const { app } = require('@azure/functions');
const { TableClient } = require('@azure/data-tables');

app.http('validarTecnico', {
    methods: ['POST'],
    authLevel: 'anonymous',
    handler: async (request, context) => {
        try {
            const data = await request.json();
            const login = data.login;

            if (!login) {
                return { status: 400, jsonBody: { error: "O parâmetro 'login' é obrigatório." } };
            }

            const loginLower = login.trim().toLowerCase();
            const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING || process.env.AzureWebJobsStorage;
            
            if (!connectionString) {
                return { 
                    status: 500, 
                    jsonBody: { error: "A variável de conexão 'AZURE_STORAGE_CONNECTION_STRING' não está definida no painel de configurações (Configuration) do Azure." } 
                };
            }

            const tableClient = TableClient.fromConnectionString(connectionString, 'TecnicosAutorizados');

            try {
                await tableClient.createTable();
            } catch (e) {}

            try {
                const entity = await tableClient.getEntity('TECNICOS', loginLower);

                return { 
                    status: 200, 
                    jsonBody: { 
                        status: entity.Status || 'ATIVO', 
                        cidadeAtuacao: entity.CidadeAtuacao || 'TODAS'
                    } 
                };

            } catch (err) {
                if (err.statusCode === 404) {
                    return { status: 200, jsonBody: { status: 'NAO_CADASTRADO' } };
                }
                throw err;
            }

        } catch (error) {
            context.error("[validarTecnico] Erro:", error);
            return { status: 500, jsonBody: { error: error.message } };
        }
    }
});
