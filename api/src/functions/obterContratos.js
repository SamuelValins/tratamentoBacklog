const { app } = require('@azure/functions');
const { TableClient } = require('@azure/data-tables');

app.http('obterContratos', {
    methods: ['GET'],
    authLevel: 'anonymous',
    handler: async (request, context) => {
        const urlParams = new URL(request.url).searchParams;
        const cidade = urlParams.get('cidade');
        const safra = urlParams.get('safra');
        const tipo = urlParams.get('tipo');

        if (!cidade || !safra) {
            return {
                status: 400,
                jsonBody: { error: "Parâmetros 'cidade' e 'safra' são obrigatórios." }
            };
        }

        // Conecta à tabela populada pelo dashboard principal usando a String de Conexão padrão
        const connectionString = process.env.AzureWebJobsStorage;
        const tableClient = TableClient.fromConnectionString(connectionString, 'ContratosRetirada');

        try {
            // Normaliza filtros para busca segura
            const cidadeUpper = cidade.trim().toUpperCase();
            
            // Tratamento preventivo para variações de formato de safra (Ex: "2º mês" ou "2")
            let safraFiltro = safra.trim();
            const matchDigito = safra.match(/\d+/);
            const safraCurta = matchDigito ? matchDigito[0] : safraFiltro;

            // Monta a query OData dinâmica
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
                // Estima quantidade de equipamentos baseado nos MACs salvos
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
                    lat: null, // Será preenchido dinamicamente pelo GPS/Geocodificador do app
                    lon: null
                });
            }

            return { status: 200, jsonBody: contratosFormatados };

        } catch (error) {
            context.error("Erro ao consultar ContratosRetirada:", error);
            return {
                status: 500,
                jsonBody: { error: "Erro interno no servidor ao consultar base de dados." }
            };
        }
    }
});
