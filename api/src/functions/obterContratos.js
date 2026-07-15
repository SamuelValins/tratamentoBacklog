const { app } = require('@azure/functions');
const { TableClient } = require('@azure/data-tables');

app.http('obterContratos', {
    methods: ['GET'],
    authLevel: 'anonymous',
    handler: async (request, context) => {
        try {
            const cidade = request.query.get('cidade');
            const safra = request.query.get('safra'); // Pode conter valores múltiplos como "1º mês,2º mês"
            const tipo = request.query.get('tipo');
            const limit = request.query.get('limit'); 

            context.log(`[obterContratos] Iniciando busca - Cidade: ${cidade}, Safra: ${safra}, Tipo: ${tipo}, Limite: ${limit}`);

            if (!cidade || !safra) {
                return {
                    status: 400,
                    jsonBody: { error: "Parâmetros 'cidade' e 'safra' são obrigatórios." }
                };
            }

            const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING || process.env.AzureWebJobsStorage;
            
            if (!connectionString) {
                return {
                    status: 500,
                    jsonBody: { error: "Configuração ausente: AZURE_STORAGE_CONNECTION_STRING ou AzureWebJobsStorage não definidos no ambiente." }
                };
            }

            const tableClient = TableClient.fromConnectionString(connectionString, 'ContratosRetirada');

            const cidadeUpper = cidade.trim().toUpperCase();
            
            // Filtro da Cidade
            let queryFilter = `Cidade eq '${cidadeUpper}'`;

            // Filtro de Safra (Suporta múltiplos valores separados por vírgula)
            if (safra && safra !== 'TODOS') {
                const safrasArray = safra.split(',');
                
                // Constrói condições OR dinâmicas para cada safra selecionada no lote
                const orConditions = safrasArray.map(s => {
                    const safraFiltro = s.trim();
                    const matchDigito = safraFiltro.match(/\d+/);
                    const safraCurta = matchDigito ? matchDigito[0] : safraFiltro;
                    return `(MesSafra eq '${safraFiltro}' or MesSafra eq '${safraCurta}')`;
                }).join(' or ');

                queryFilter += ` and (${orConditions})`;
            } else {
                // Se for TODOS, filtra e ignora todos os contratos classificados como expurgados no banco
                queryFilter += ` and MesSafra ne 'EXPURGADO' and MesSafra ne 'EXPURGADO SAFRA'`;
            }

            // Filtro de Desconexão Normalizado
            if (tipo && tipo !== 'TODOS') {
                const tipoNormalizado = tipo.trim()
                    .normalize("NFD")
                    .replace(/[\u0300-\u036f]/g, "") 
                    .toUpperCase();

                if (tipoNormalizado.includes('OPCA') || tipoNormalizado.includes('OPCO')) {
                    queryFilter += ` and TipoDesconexao eq 'DESCONECTADO - OPCAO'`;
                } else if (tipoNormalizado.includes('INAD')) {
                    queryFilter += ` and TipoDesconexao eq 'DESCONECTADO - INADIMPLENCIA (TOTAL)'`;
                } else {
                    queryFilter += ` and TipoDesconexao eq '${tipoNormalizado}'`;
                }
            }

            context.log(`[obterContratos] Filtro OData gerado: ${queryFilter}`);

            const entities = tableClient.listEntities({
                queryOptions: { filter: queryFilter }
            });

            let maxCount = limit && limit !== 'ALL' ? parseInt(limit, 10) : null;
            let currentCount = 0;

            const contratosFormatados = [];

            for await (const entity of entities) {
                if (maxCount !== null && currentCount >= maxCount) {
                    break;
                }

                const macString = entity.Mac || '';
                const qtdEquip = macString ? macString.split('/').length : 1;

                // Captura as coordenadas do Azure Table de forma robusta e realiza a conversão numérica
                const latitudeFinal = (entity.latitude !== undefined && entity.latitude !== null) ? parseFloat(entity.latitude) : 
                                     ((entity.lat !== undefined && entity.lat !== null) ? parseFloat(entity.lat) : 
                                     ((entity.coordY !== undefined && entity.coordY !== null) ? parseFloat(entity.coordY) : null));

                const longitudeFinal = (entity.longitude !== undefined && entity.longitude !== null) ? parseFloat(entity.longitude) : 
                                      ((entity.lon !== undefined && entity.lon !== null) ? parseFloat(entity.lon) : 
                                      ((entity.coordX !== undefined && entity.coordX !== null) ? parseFloat(entity.coordX) : null));

                contratosFormatados.push({
                    contrato: entity.Contrato || entity.RowKey,
                    cidade: entity.Cidade,
                    tipo: entity.TipoDesconexao || 'DESCONEXÃO',
                    titular: entity.Titular || 'N/D',
                    endereco: entity.Endereco || 'Endereço não cadastrado',
                    complemento: entity.IdCompl || '',
                    bairro: entity.Bairro || '',
                    tel_res: entity.TelRes || '',
                    tel_cel: entity.TelCel || '',
                    qtd_equip: qtdEquip,
                    modelo_equip: entity.ModeloEquip || entity.FamiliaEquip || 'N/D',
                    mac: entity.Mac || 'MAC não disponível para este equipamento', 
                    obs: entity.Obs || '',
                    lat: latitudeFinal, 
                    lon: longitudeFinal,
                    partitionKey: entity.partitionKey || entity.PartitionKey || '' // Retorna a partição para facilitar futuras gravações
                });

                currentCount++;
            }

            return { status: 200, jsonBody: contratosFormatados };

        } catch (error) {
            context.error("[obterContratos] Erro Crítico no Banco Azure:", error);
            return {
                status: 500,
                jsonBody: { 
                    error: `Erro ao buscar registros na base do Azure: ${error.message}`,
                    details: error.toString()
                }
            };
        }
    }
});
