const { app } = require('@azure/functions');
const { TableClient } = require('@azure/data-tables');

const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
const tableName = "ContratosRetirada"; 

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

            if (!connectionString) {
                return { 
                    status: 500, 
                    json: { error: "Erro de Configuração no Azure SWA: Variável AZURE_STORAGE_CONNECTION_STRING ausente." } 
                };
            }

            const client = TableClient.fromConnectionString(connectionString, tableName);
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
                    // Coordenadas (lat/lon) removidas para não travar quando ausentes
                });
            }

            return { status: 200, json: contratos };
        } catch (error) {
            context.log("Erro ao buscar contratos: ", error.message);
            return { status: 500, json: { error: error.message } };
        }
    }
});
