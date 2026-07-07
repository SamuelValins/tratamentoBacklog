// --- 3. REVERTER ATENDIMENTO ---
// =========================================================================
app.http('reverterAtendimento', {
    methods: ['POST'],
    authLevel: 'anonymous',
    handler: async (request, context) => {
        try {
            const { contrato, tecnico } = await request.json();

            if (!contrato || !tecnico) {
                return { status: 400, jsonBody: { error: "Parâmetros 'contrato' e 'tecnico' são obrigatórios." } };
            }

            const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING || process.env.AzureWebJobsStorage;
            const historyTable = TableClient.fromConnectionString(connectionString, 'HistoricoAtendimentos');
            const contractsTable = TableClient.fromConnectionString(connectionString, 'ContratosRetirada');

            const loginLower = tecnico.trim().toLowerCase();

            // 1. Busca no histórico para resgatar dados originais antes de apagar
            let cidade = "BAURU";
            let tipo = "DESCONEXÃO";
            try {
                const entity = await historyTable.getEntity(loginLower, contrato);
                // Prevenção para mapear propriedades tanto com iniciais maiúsculas quanto minúsculas
                cidade = entity.Cidade || entity.cidade || "BAURU";
                tipo = entity.TipoDesconexao || entity.tipoDesconexao || "DESCONEXÃO";
                
                // Remove do histórico
                await historyTable.deleteEntity(loginLower, contrato);
            } catch (err) {
                context.warn(`Contrato não localizado no histórico: ${err.message}`);
            }

            // 2. Insere de volta em ContratosRetirada para o técnico refazer
            const contratoEntity = {
                partitionKey: cidade.toUpperCase(),
                rowKey: contrato,
                Cidade: cidade.toUpperCase(),
                TipoDesconexao: tipo,
                Titular: 'REVERTIDO PARA CORREÇÃO',
                Endereco: 'Endereço Revertido para Visita',
                Mac: '',
                ModeloEquip: 'Equipamento a Identificar',
                QtdEquip: 1
            };

            await contractsTable.upsertEntity(contratoEntity, "Replace");

            return { status: 200, jsonBody: { success: true, message: "Baixa revertida com sucesso. Contrato retornou para a fila ativa." } };

        } catch (error) {
            context.error("[reverterAtendimento] Erro:", error);
            return { status: 500, jsonBody: { error: error.message } };
        }
    }
});
