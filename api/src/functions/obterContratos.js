const { app } = require('@azure/functions');
const { TableClient } = require('@azure/data-tables');

// Função auxiliar para dispersão estável (Hash modular constante)
function hashCode(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) - hash) + str.charCodeAt(i);
        hash |= 0; 
    }
    return Math.abs(hash);
}

app.http('obterContratos', {
    methods: ['GET'],
    authLevel: 'anonymous',
    handler: async (request, context) => {
        try {
            const numeroContrato = request.query.get('numeroContrato');
            const cidade = request.query.get('cidade');
            const safra = request.query.get('safra');
            const tipo = request.query.get('tipo');
            const limit = request.query.get('limit'); 
            const tecnicoLogin = (request.query.get('tecnicoLogin') || '').toLowerCase().trim();

            const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING || process.env.AzureWebJobsStorage;
            
            if (!connectionString) {
                return {
                    status: 500,
                    jsonBody: { error: "Configuração ausente: AZURE_STORAGE_CONNECTION_STRING não definida no ambiente." }
                };
            }

            const tableContratos = TableClient.fromConnectionString(connectionString, 'ContratosRetirada');

            // 1. FLUXO DE BUSCA DIRETA POR NÚMERO DE CONTRATO (OS)
            if (numeroContrato) {
                const termo = numeroContrato.trim();
                const entities = tableContratos.listEntities({
                    queryOptions: { filter: `RowKey eq '${termo}' or Contrato eq '${termo}'` }
                });

                const resultado = [];
                for await (const entity of entities) {
                    resultado.push(formatarEntidadeContrato(entity));
                }
                return { status: 200, jsonBody: resultado };
            }

            // 2. VALIDAÇÃO DOS PARÂMETROS OBRIGATÓRIOS
            if (!cidade || !safra) {
                return {
                    status: 400,
                    jsonBody: { error: "Parâmetros 'cidade' e 'safra' são obrigatórios." }
                };
            }

            const cidadeUpper = cidade.trim().toUpperCase();
            
            // 3. IDENTIFICAÇÃO E DIVISÃO DE ÁREAS ENTRE EQUIPES NA CIDADE
            let totalEquipes = 1;
            let indiceEquipe = 0;

            if (tecnicoLogin) {
                try {
                    const tableTecnicos = TableClient.fromConnectionString(connectionString, 'Tecnicos');
                    const entitiesTecnicos = tableTecnicos.listEntities({
                        queryOptions: { filter: `Status eq 'ATIVO'` }
                    });

                    const tecnicosNaCidade = [];
                    for await (const t of entitiesTecnicos) {
                        const tCidade = (t.Cidade || t.cidade || '').toUpperCase().trim();
                        if (tCidade === cidadeUpper || tCidade === 'TODAS') {
                            const loginNormalizado = (t.Login || t.login || t.rowKey || t.RowKey || '').toLowerCase().trim();
                            if (loginNormalizado && !tecnicosNaCidade.includes(loginNormalizado)) {
                                tecnicosNaCidade.push(loginNormalizado);
                            }
                        }
                    }

                    tecnicosNaCidade.sort(); // Ordenação alfabética para consistência de setores
                    if (tecnicosNaCidade.length > 1) {
                        totalEquipes = tecnicosNaCidade.length;
                        const idx = tecnicosNaCidade.indexOf(tecnicoLogin);
                        indiceEquipe = idx !== -1 ? idx : 0;
                    }
                    context.log(`[obterContratos] Cidade: ${cidadeUpper} | Total Equipes: ${totalEquipes} | Técnico: '${tecnicoLogin}' -> Setor: ${indiceEquipe + 1}/${totalEquipes}`);
                } catch (e) {
                    context.warn(`Não foi possível consultar lista de técnicos para divisão de áreas: ${e.message}`);
                }
            }

            // 4. FILTRAGEM ODATA NO BANCO DE DADOS
            let queryFilter = `Cidade eq '${cidadeUpper}'`;

            if (safra && safra !== 'TODOS') {
                const safrasArray = safra.split(',');
                const orConditions = safrasArray.map(s => {
                    const safraFiltro = s.trim();
                    const matchDigito = safraFiltro.match(/\d+/);
                    const safraCurta = matchDigito ? matchDigito[0] : safraFiltro;
                    return `(MesSafra eq '${safraFiltro}' or MesSafra eq '${safraCurta}')`;
                }).join(' or ');

                queryFilter += ` and (${orConditions})`;
            } else {
                queryFilter += ` and MesSafra ne 'EXPURGADO' and MesSafra ne 'EXPURGADO SAFRA'`;
            }

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

            const entities = tableContratos.listEntities({
                queryOptions: { filter: queryFilter }
            });

            const todosContratos = [];
            for await (const entity of entities) {
                todosContratos.push(formatarEntidadeContrato(entity));
            }

            // 5. DIVISÃO GEOGRÁFICA / INTERCALAÇÃO ENTRE EQUIPES DA MESMA CIDADE
            let contratosDesignados = todosContratos;

            if (totalEquipes > 1 && todosContratos.length > 0) {
                const contratosComGeo = todosContratos.filter(c => c.lat && c.lon && c.lat !== 1.0);
                
                // Se grande parte dos contratos possui geolocalização, divide em fatias contíguas de setor
                if (contratosComGeo.length >= todosContratos.length * 0.4) {
                    contratosComGeo.sort((a, b) => (a.lat - b.lat) || (a.lon - b.lon));
                    
                    const chunkSize = Math.ceil(contratosComGeo.length / totalEquipes);
                    const inicio = indiceEquipe * chunkSize;
                    const geoDoSetor = contratosComGeo.slice(inicio, inicio + chunkSize);

                    // Contratos pendentes de geolocalização são divididos proporcionalmente por hash modular
                    const semGeo = todosContratos.filter(c => !c.lat || !c.lon || c.lat === 1.0);
                    const semGeoDoSetor = semGeo.filter(c => (hashCode(String(c.contrato || c.bairro)) % totalEquipes) === indiceEquipe);

                    contratosDesignados = [...geoDoSetor, ...semGeoDoSetor];
                } else {
                    // Sem coordenadas suficientes: partição determinística equilibrada por Hash do contrato
                    contratosDesignados = todosContratos.filter(c => (hashCode(String(c.contrato || c.bairro)) % totalEquipes) === indiceEquipe);
                }
            }

            // Aplica limite solicitado de retorno
            let maxCount = limit && limit !== 'ALL' ? parseInt(limit, 10) : null;
            if (maxCount !== null) {
                contratosDesignados = contratosDesignados.slice(0, maxCount);
            }

            return { status: 200, jsonBody: contratosDesignados };

        } catch (error) {
            context.error("[obterContratos] Erro Crítico:", error);
            return {
                status: 500,
                jsonBody: { error: `Erro ao buscar registros na base do Azure: ${error.message}` }
            };
        }
    }
});

function formatarEntidadeContrato(entity) {
    const macString = entity.Mac || '';
    const qtdEquip = macString ? macString.split('/').length : (entity.quantidade_equipamentos || 1);

    const latitudeFinal = (entity.latitude !== undefined && entity.latitude !== null) ? parseFloat(entity.latitude) : 
                         ((entity.lat !== undefined && entity.lat !== null) ? parseFloat(entity.lat) : 
                         ((entity.coordY !== undefined && entity.coordY !== null) ? parseFloat(entity.coordY) : null));

    const longitudeFinal = (entity.longitude !== undefined && entity.longitude !== null) ? parseFloat(entity.longitude) : 
                          ((entity.lon !== undefined && entity.lon !== null) ? parseFloat(entity.lon) : 
                          ((entity.coordX !== undefined && entity.coordX !== null) ? parseFloat(entity.coordX) : null));

    return {
        contrato: entity.Contrato || entity.RowKey || entity.rowKey,
        cidade: entity.Cidade || entity.cidade,
        tipo: entity.TipoDesconexao || entity.tipo_retirada || 'DESCONEXÃO',
        titular: entity.Titular || entity.titular || 'N/D',
        endereco: entity.Endereco || entity.endereco || 'Endereço não cadastrado',
        complemento: entity.IdCompl || entity.complemento || '',
        bairro: entity.Bairro || entity.bairro || '',
        tel_res: entity.TelRes || entity.tel_residencial || '',
        tel_cel: entity.TelCel || entity.tel_celular || '',
        qtd_equip: qtdEquip,
        modelo_equip: entity.ModeloEquip || entity.FamiliaEquip || entity.modelo_equipamento || 'N/D',
        mac: entity.Mac || 'MAC não disponível para este equipamento', 
        obs: entity.Obs || entity.obs || '',
        lat: latitudeFinal, 
        lon: longitudeFinal,
        partitionKey: entity.partitionKey || entity.PartitionKey || ''
    };
}
