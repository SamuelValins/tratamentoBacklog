const { app } = require('@azure/functions');
const { TableClient } = require('@azure/data-tables');

app.http('gerenciarTecnicos', {
    methods: ['GET', 'POST', 'DELETE'],
    authLevel: 'anonymous',
    handler: async (request, context) => {
        try {
            const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING || process.env.AzureWebJobsStorage;
            
            if (!connectionString) {
                return { 
                    status: 500, 
                    jsonBody: { error: "A variável de conexão 'AZURE_STORAGE_CONNECTION_STRING' não está definida no painel de configurações (Configuration) do Azure." } 
                };
            }

            const tableClient = TableClient.fromConnectionString(connectionString, 'TecnicosAutorizados');
            
            // Força a auto-criação da tabela se ela não existir
            try {
                await tableClient.createTable();
            } catch (tableErr) {
                // Silencia se for conflito de tabela já existente (409)
            }

            // --- CASO GET: Listar todos os técnicos cadastrados ---
            if (request.method === 'GET') {
                const entities = tableClient.listEntities({
                    queryOptions: { filter: "PartitionKey eq 'TECNICOS'" }
                });

                const lista = [];
                for await (const entity of entities) {
                    lista.push({
                        nome: entity.Nome || 'N/D',
                        login: entity.rowKey, 
                        empresa: entity.Empresa || 'N/D',
                        cidade: entity.CidadeAtuacao || 'TODAS',
                        status: entity.Status || 'ATIVO'
                    });
                }
                return { status: 200, jsonBody: lista };
            }

            // --- CASO POST: Criar ou atualizar técnico ---
            if (request.method === 'POST') {
                const data = await request.json();
                
                if (!data.login || !data.nome || !data.empresa || !data.cidade) {
                    return { status: 400, jsonBody: { error: "Dados incompletos para cadastro do técnico." } };
                }

                const loginLower = data.login.trim().toLowerCase();

                const entidadeTecnico = {
                    partitionKey: 'TECNICOS', 
                    rowKey: loginLower,       
                    Nome: data.nome.trim().toUpperCase(),
                    Empresa: data.empresa.trim().toUpperCase(),
                    CidadeAtuacao: data.cidade.trim().toUpperCase(),
                    Status: data.status || 'ATIVO'
                };

                await tableClient.upsertEntity(entidadeTecnico, "Replace");

                return { status: 200, jsonBody: { success: true, message: "Técnico salvo com sucesso." } };
            }

            // --- CASO DELETE: Apagar técnico permanentemente ---
            if (request.method === 'DELETE') {
                const login = request.query.get('login');
                if (!login) {
                    return { status: 400, jsonBody: { error: "O parâmetro 'login' é obrigatório para exclusão." } };
                }

                const loginLower = login.trim().toLowerCase();
                await tableClient.deleteEntity('TECNICOS', loginLower);

                return { status: 200, jsonBody: { success: true, message: "Acesso removido com sucesso." } };
            }

        } catch (error) {
            context.error("[gerenciarTecnicos] Erro:", error);
            return {
                status: 500,
                jsonBody: { error: `Falha na operação de gerenciamento: ${error.message}` }
            };
        }
    }
});
