const { app } = require('@azure/functions');
const { TableClient } = require('@azure/data-tables');

app.http('obterContratos', {
    methods: ['GET'],
    authLevel: 'anonymous',
    handler: async (request, context) => {
        try {
            // Em Azure Functions v4, request.query é um objeto URLSearchParams nativo.
            // O uso de .get() é blindado e imune a falhas de parsing de URL.
            const cidade = request.query.get('cidade');
            const safra = request.query.get('safra');
            const tipo = request.query.get('tipo');

            context.log(`[obterContratos] Iniciando busca - Cidade: ${cidade}, Safra: ${safra}, Tipo: ${tipo}`);

            if (!cidade || !safra) {
                return {
                    status: 400,
                    jsonBody: { error: "Parâmetros 'cidade' e 'safra' são obrigatórios." }
                };
            }

            // Suporte duplo para conexão: tenta customizado primeiro, depois a conexão de sistema padrão
            const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING || process.env.AzureWebJobsStorage;
            
            if (!connectionString) {
                context.error("[obterContratos] Erro: Nenhuma Connection String configurada!");
                return {
                    status: 500,
                    jsonBody: { error: "Configuração ausente: AZURE_STORAGE_CONNECTION_STRING ou AzureWebJobsStorage não definidos no ambiente." }
                };
            }

            const tableClient = TableClient.fromConnectionString(connectionString, 'ContratosRetirada');

            const cidadeUpper = cidade.trim().toUpperCase();
            let safraFiltro = safra.trim();
            const matchDigito = safra.match(/\d+/);
            const safraCurta = matchDigito ? matchDigito[0] : safraFiltro;

            // Filtro flexível para aceitar variações de escrita (ex: "2º mês" ou "2")
            let queryFilter = `Cidade eq '${cidadeUpper}' and (MesSafra eq '${safraFiltro}' or MesSafra eq '${safraCurta}')`;

            if (tipo && tipo !== 'TODOS') {
                const tipoUpper = tipo.trim().toUpperCase();
                queryFilter += ` and TipoDesconexao eq '${tipoUpper}'`;
            }

            const entities = tableClient.listEntities({
                queryOptions: { filter: queryFilter }
            });

            const contratosFormatados = [];

            for await (const entity of entities) {
                const macString = entity.Mac || '';
                const qtdEquip = macString ? macString.split('/').length : 1;

                contratosFormatados.push({
                    contrato: entity.Contrato || entity.RowKey,
                    cidade: entity.Cidade,
                    tipo: entity.TipoDesconexao || 'DESCONEXÃO',
                    titular: entity.Titular || 'N/D',
                    endereco: entity.Endereco || 'Endereço não cadastrado',
                    complemento: entity.IdCompl ? `${entity.IdCompl} ${entity.ComplDescr || ''}`.trim() : (entity.ComplDescr || ''),
                    bairro: entity.Bairro || '',
                    tel_res: entity.TelRes || '',
                    tel_cel: entity.TelCel || '',
                    qtd_equip: qtdEquip,
                    modelo_equip: entity.ModeloEquip || entity.FamiliaEquip || 'N/D',
                    obs: entity.Obs || '',
                    lat: null, 
                    lon: null
                });
            }

            return { status: 200, jsonBody: contratosFormatados };

        } catch (error) {
            context.error("[obterContratos] Erro Crítico:", error);
            return {
                status: 500,
                jsonBody: { error: error.message || "Erro interno ao listar os contratos." }
            };
        }
    }
});
