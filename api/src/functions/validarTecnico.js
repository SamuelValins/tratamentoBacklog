const { app } = require('@azure/functions');
const { TableClient } = require('@azure/data-tables');

// =========================================================================
// --- 1. VALIDAR ACESSO DO TÉCNICO (Responsável por liberar o login) ---
// =========================================================================
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
            const tableClient = TableClient.fromConnectionString(connectionString, 'TecnicosAutorizados');

            try {
                // Busca o técnico com a estrutura exata gravada pelo painel administrativo
                const entity = await tableClient.getEntity('TECNICOS', loginLower);

                // Retorna no formato esperado pelo painel de rotas do técnico
                return { 
                    status: 200, 
                    jsonBody: { 
                        status: entity.Status || 'ATIVO', 
                        cidadeAtuacao: entity.CidadeAtuacao || 'TODAS'
                    } 
                };

            } catch (err) {
                if (err.statusCode === 404) {
                    // Retorna como não cadastrado para que o app exiba o aviso correto
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
