const { app } = require('@azure/functions');
const { TableClient, AzureSASCredential } = require('@azure/data-tables');

// Configurações manuais para o teste com SAS Token
const accountName = "dashboardclarobrasil";
const tableName = "ContratosRetirada";

// Cole aqui o seu Token SAS que você copiou (começando com ?sv=...)
const sasToken = "COLE_AQUI_O_SEU_TOKEN_SAS"; 

app.http('obterContratos', {
    methods: ['GET'],
    authLevel: 'anonymous',
    handler: async (request, context) => {
        try {
            const url = new URL(request.url);
            const cidade = url.searchParams.get('cidade');
            const safra = url.searchParams.get('safra');
            const tipo = url.searchParams.get('tipo');

            if (!cidade || !safra) {
                return { status: 400, json: { error: "Cidade e Safra são obrigatórios." } };
            }

            // Instancia o cliente da Tabela com o SAS Token
            const tableServiceUrl = `https://${accountName}.table.core.windows.net`;
            const client = new TableClient(tableServiceUrl, tableName, new AzureSASCredential(sasToken));
            const contratos = [];

            let filterString = `PartitionKey eq '${cidade}' and mes_safra eq '${safra}'`;
            if (tipo && tipo !== 'TODOS') {
                filterString += ` and tipo_retirada eq '${tipo}'`;
            }

            const entities = client.listEntities({ queryOptions: { filter: filterString } });

            for await (const entity of entities) {
                contratos.push({
                    contrato: entity.rowKey, 
                    titular: entity.titular,
                    endereco: entity.endereco,
                    bairro: entity.bairro,
                    cidade: entity.partitionKey, 
                    complemento: entity.complemento || "",
                    tel_res: entity.tel_residencial || "",
                    tel_cel: entity.tel_celular || "",
                    qtd_equip: entity.quantidade_equipamentos || 0,
                    modelo_equip: entity.modelo_equipamento || "",
                    tipo: entity.tipo_retirada,
                    safra: entity.mes_safra,
                    obs: entity.obs || ""
                });
            }

            return { status: 200, json: contratos };
        } catch (error) {
            context.log("Erro ao buscar contratos: ", error.message);
            return { status: 500, json: { error: error.message } };
        }
    }
});
