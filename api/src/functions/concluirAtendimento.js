const { app } = require('@azure/functions');
const { TableClient } = require('@azure/data-tables');
const { BlobServiceClient } = require('@azure/storage-blob');

// Helper para converter e subir fotos em base64 para o Azure Blob Storage de forma limpa
async function subirFotoBlob(contrato, base64Data, index, connectionString) {
    try {
        const matches = base64Data.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
        let buffer;
        let contentType = "image/jpeg";

        if (matches && matches.length === 3) {
            contentType = matches[1];
            buffer = Buffer.from(matches[2], 'base64');
        } else {
            buffer = Buffer.from(base64Data, 'base64');
        }

        const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
        const containerClient = blobServiceClient.getContainerClient('evidencias');
        await containerClient.createIfNotExists({ publicAccessLevel: 'blob' });

        const nomeArquivo = `${contrato}_${Date.now()}_${index}.jpg`;
        const blockBlobClient = containerClient.getBlockBlobClient(nomeArquivo);

        await blockBlobClient.upload(buffer, buffer.length, {
            blobHTTPHeaders: { blobContentType: contentType }
        });

        return blockBlobClient.url; // Retorna a URL pública da foto
    } catch (e) {
        console.error("Erro ao realizar upload de foto para o Blob:", e);
        return null;
    }
}

app.http('concluirAtendimento', {
    methods: ['POST'],
    authLevel: 'anonymous',
    handler: async (request, context) => {
        try {
            const payload = await request.json();
            const { contrato, tecnico, status, localizacao, codigo_baixa, observacao_conclusao } = payload;

            if (!contrato || !tecnico || !status) {
                return { status: 400, jsonBody: { error: "Campos obrigatórios ausentes." } };
            }

            const connectionString = process.env.AzureWebJobsStorage;
            const rKey = contrato.trim().toUpperCase().replace(/[^a-zA-Z0-9]/g, '');

            // --- PASSO 1: IDENTIFICAR A DATA DE ANALISE ORIGINAL DO CONTRATO ---
            const clientRetirada = TableClient.fromConnectionString(connectionString, 'ContratosRetirada');
            let partitionKeyOriginal = null;
            let enderecoOriginal = "";

            try {
                // Varre a tabela ContratosRetirada para achar a data de partição vinculada
                const result = clientRetirada.listEntities({
                    queryOptions: { filter: `RowKey eq '${rKey}'` }
                });
                for await (const entity of result) {
                    partitionKeyOriginal = entity.PartitionKey; // Ex: 20260703
                    enderecoOriginal = entity.Endereco || "";
                    break;
                }
            } catch (err) {
                context.warn("Contrato de origem não localizado em ContratosRetirada, usando data de hoje.");
            }

            // Fallback de segurança para data atual caso o contrato não seja localizado na fila
            if (!partitionKeyOriginal) {
                partitionKeyOriginal = new Date().toISOString().split('T')[0].replace(/-/g, '');
            }

            // --- PASSO 2: PROCESSAR E ENVIAR AS IMAGENS AO BLOB STORAGE ---
            const urlsFotos = [];
            const imagensParaSubir = status === 'PRODUTIVO' ? (payload.imagens_etiqueta || []) : [payload.imagem_fachada].filter(Boolean);

            for (let i = 0; i < imagensParaSubir.length; i++) {
                const urlResult = await subirFotoBlob(rKey, imagensParaSubir[i], i, connectionString);
                if (urlResult) urlsFotos.push(urlResult);
            }

            // --- PASSO 3: GRAVAR NO PAINEL PRINCIPAL (TratamentoContratos) ---
            const clientTratamento = TableClient.fromConnectionString(connectionString, 'TratamentoContratos');
            
            const statusMesa = status === 'PRODUTIVO' ? 'revertido produtivo' : 'não revertido';
            const obsMesa = status === 'PRODUTIVO' ? 'EQUIPAMENTO RETIRADO COM SUCESSO PELO TÉCNICO.' : (observacao_conclusao || 'Sem observações.');

            const entidadeTratamento = {
                PartitionKey: partitionKeyOriginal,
                RowKey: rKey,
                Status: statusMesa,
                Atendente: tecnico.toUpperCase(),
                EmailOriginal: `${tecnico.toLowerCase()}@claro.com.br`,
                Observacao: obsMesa,
                Categoria: "RETIRADA TÉCNICA",
                DataUpdate: new Date().toISOString()
            };

            await clientTratamento.upsertEntity(entidadeTratamento, "Replace");

            // --- PASSO 4: GRAVAR NA TABELA DE AUDITORIA DE FOTOS (EvidenciasTable) ---
            const clientEvidencias = TableClient.fromConnectionString(connectionString, 'EvidenciasTable');

            const codigoAuditoria = status === 'PRODUTIVO' ? 'FORA TOA' : (codigo_baixa || 'N/D');

            const entidadeEvidencia = {
                PartitionKey: partitionKeyOriginal,
                RowKey: `${rKey}_${Date.now()}`, // Permite múltiplos envios se necessário
                contrato: contrato.trim(),
                latitude: localizacao ? String(localizacao.latitude) : '',
                longitude: localizacao ? String(localizacao.longitude) : '',
                localizacao: localizacao ? JSON.stringify(localizacao) : '',
                dataHora: payload.data_conclusao || new Date().toISOString(),
                codigoBaixa: codigoAuditoria,
                urlsFotos: JSON.stringify(urlsFotos),
                endereco: enderecoOriginal,
                observacao: obsMesa
            };

            await clientEvidencias.upsertEntity(entidadeEvidencia, "Replace");

            return { status: 200, jsonBody: { success: true, message: "Atendimento gravado e sincronizado com sucesso." } };

        } catch (error) {
            context.error("Erro interno ao concluir atendimento:", error);
            return {
                status: 500,
                jsonBody: { error: "Erro crítico no servidor ao registrar atendimento." }
            };
        }
    }
});
