const { app } = require('@azure/functions');
const { TableClient, AzureSASCredential } = require('@azure/data-tables');

// Configurações manuais para o teste com SAS Token
const accountName = "dashboardclarobrasil";
const tableName = "ContratosRetirada";

// Cole aqui o seu Token SAS que você copiou (começando com ?sv=...)
const sasToken = "?sv=2024-11-04&ss=bfqt&srt=sco&sp=rwdlacupiytfx&se=2049-03-13T00:48:06Z&st=2026-03-12T16:33:06Z&spr=https&sig=%2Be5p6vRDQh2ObBQ74z55EC1sJHEymiTAcg%2BpZqAfdaw%3D"; 

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

            // Instancia o cliente da Tabela com o SAS Token
            const tableServiceUrl = `https://${accountName}.table.core.windows.net`;
            const client = new TableClient(tableServiceUrl, tableName, new AzureSASCredential(sasToken));
            
            await client.createTableIfNotExists();

            // 2. Se a ação for "substituir", apaga todas as linhas existentes primeiro
            if (acao === 'substituir') {
                context.log("Iniciando limpeza total da tabela ContratosRetirada...");
                const entities = client.listEntities();
                for await (const entity of entities) {
                    await client.deleteEntity(entity.partitionKey, entity.rowKey);
                }
                context.log("Tabela limpa com sucesso!");
            }

            // 3. Importar a nova lista para o banco usando Upsert
            context.log(`Iniciando inserção de ${contratos.length} contratos...`);
            for (const item of contratos) {
                const entidade = {
                    partitionKey: item.PartitionKey, 
                    rowKey: item.RowKey,             
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
                    obs: item.obs || ""
                };

                await client.upsertEntity(entidade);
            }

            return { status: 200, json: { message: `Sucesso! Fila atualizada com ${contratos.length} contratos.` } };
        } catch (error) {
            context.log("Erro no servidor de carga: ", error.message);
            return { status: 500, json: { error: `Falha no processamento: ${error.message}` } };
        }
    }
});
