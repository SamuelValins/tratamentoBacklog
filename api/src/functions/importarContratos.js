const { app } = require('@azure/functions');
const { TableClient } = require('@azure/data-tables');

const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
const tableName = "ContratosRetirada";

// Senha mestra de segurança gerencial (Mude aqui para a senha desejada)
const SENHA_GERENCIAL_PADRAO = "ClaroGerente2026";

app.http('importarContratos', {
    methods: ['POST'],
    authLevel: 'anonymous',
    handler: async (request, context) => {
        try {
            const body = await request.json();
            const { senha, acao, contratos } = body;

            // 1. Validar a chave de segurança
            if (senha !== SENHA_GERENCIAL_PADRAO) {
                return { status: 401, json: { error: "Senha de acesso gerencial incorreta." } };
            }

            if (!contratos || !Array.isArray(contratos) || contratos.length === 0) {
                return { status: 400, json: { error: "Fila de contratos vazia ou inválida." } };
            }

            const client = TableClient.fromConnectionString(connectionString, tableName);
            await client.createTableIfNotExists();

            // 2. Se a ação for "substituir", apaga todas as linhas existentes primeiro
            if (acao === 'substituir') {
                context.log("Iniciando limpeza total da tabela ContratosRetirada...");
                const entities = client.listEntities();
                for await (const entity of entities) {
                    await client.deleteEntity(entity.PartitionKey, entity.RowKey);
                }
                context.log("Tabela limpa com sucesso!");
            }

            // 3. Importar a nova lista para o banco usando Upsert (Atualizar ou Inserir)
            context.log(`Iniciando inserção de ${contratos.length} contratos...`);
            for (const item of contratos) {
                const entidade = {
                    PartitionKey: item.PartitionKey, // Cidade
                    RowKey: item.RowKey,             // Contrato
                    titular: item.titular || "",
                    endereco: item.endereco || "",
                    bairro: item.bairro || "",
                    complemento: item.complemento || "",
                    tel_residencial: item.tel_residencial || "",
                    tel_celular: item.tel_celular || "",
                    quantidade_equipamentos: item.quantidade_equipamentos || 1,
                    modelo_equipamento: item.modelo_equipamento || "",
                    tipo_retirada: item.tipo_retirada || "",
                    mes_safra: item.mes_safra || "",
                    latitude: item.latitude ? item.latitude.toString() : "",
                    longitude: item.longitude ? item.longitude.toString() : ""
                };

                // Upsert garante que se houver contratos duplicados na planilha, ele apenas atualize em vez de travar
                await client.upsertEntity(entidade);
            }

            return { status: 200, json: { message: `Sucesso! Fila atualizada com ${contratos.length} contratos.` } };
        } catch (error) {
            context.log("Erro no servidor de carga: ", error.message);
            return { status: 500, json: { error: error.message } };
        }
    }
});