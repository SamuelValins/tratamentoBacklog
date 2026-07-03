const { app } = require('@azure/functions');
const { TableClient } = require('@azure/data-tables');

// Conexão com o Azure Table Storage (puxa das variáveis de ambiente do Azure)
const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
const tableName = "ContratosRetirada"; // Nome da tabela no Azure

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

            const client = TableClient.fromConnectionString(connectionString, tableName);
            const contratos = [];

            // Monta o filtro com base nos parâmetros que o técnico enviou no front
            let filterString = `PartitionKey eq '${cidade}' and mes_safra eq '${safra}'`;
            if (tipo && tipo !== 'TODOS') {
                filterString += ` and tipo_retirada eq '${tipo}'`;
            }

            const entities = client.listEntities({ queryOptions: { filter: filterString } });

            for await (const entity of entities) {
                contratos.push({
                    contrato: entity.rowKey, // rowKey retornado em minúsculo pelo SDK
                    titular: entity.titular,
                    endereco: entity.endereco,
                    bairro: entity.bairro,
                    cidade: entity.partitionKey, // Corrigido para partitionKey em minúsculo
                    complemento: entity.complemento || "",
                    tel_res: entity.tel_residencial || "",
                    tel_cel: entity.tel_celular || "",
                    qtd_equip: entity.quantidade_equipamentos || 0,
                    modelo_equip: entity.modelo_equipamento || "",
                    tipo: entity.tipo_retirada,
                    safra: entity.mes_safra,
                    obs: entity.obs || "",
                    lat: parseFloat(entity.latitude),
                    lon: parseFloat(entity.longitude)
                });
            }

            return { status: 200, json: contratos };
        } catch (error) {
            context.log("Erro ao buscar contratos: ", error.message);
            return { status: 500, json: { error: error.message } };
        }
    }
});
