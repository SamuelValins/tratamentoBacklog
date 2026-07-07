const { app } = require('@azure/functions');
const { TableClient } = require('@azure/data-tables');

app.http('validarTecnico', {
    methods: ['POST', 'GET'],
    authLevel: 'anonymous',
    handler: async (request, context) => {
        try {
            // Aceita o login tanto via corpo do POST quanto via query string do GET
            let login = '';
            if (request.method === 'POST') {
                const body = await request.json();
                login = body.login;
            } else {
                login = request.query.get('login');
            }

            if (!login) {
                return { status: 400, jsonBody: { error: "O parâmetro 'login' é obrigatório." } };
            }

            const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING || process.env.AzureWebJobsStorage;
            const tableClient = TableClient.fromConnectionString(connectionString, 'TecnicosAutorizados');

            login = login.trim().toLowerCase();

            try {
                // Busca a credencial na tabela. RowKey é o login, PartitionKey é 'TECNICOS'
                const tecnico = await tableClient.getEntity('TECNICOS', login);

                return {
                    status: 200,
                    jsonBody: {
                        status: tecnico.Status || 'BLOQUEADO',
                        nome: tecnico.Nome || 'Técnico',
                        empresa: tecnico.Empresa || 'N/D',
                        cidadeAtuacao: tecnico.CidadeAtuacao || 'TODAS'
                    }
                };
            } catch (entityError) {
                // Se a entidade não for encontrada no Azure Tables, retorna inexistente
                if (entityError.statusCode === 404) {
                    return {
                        status: 200,
                        jsonBody: { status: 'INEXISTENTE' }
                    };
                }
                throw entityError;
            }

        } catch (error) {
            context.error("[validarTecnico] Erro Crítico:", error);
            return {
                status: 500,
                jsonBody: { error: `Erro ao validar técnico: ${error.message}` }
            };
        }
    }
});
