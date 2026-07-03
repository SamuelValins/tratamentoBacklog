const { app } = require('@azure/functions');
const { TableClient } = require('@azure/data-tables');
const { BlobServiceClient } = require('@azure/storage-blob');

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

        return blockBlobClient.url;
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

            const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING || process.env.AzureWebJobsStorage;
            
            if (!connectionString) {
                return { status: 500, jsonBody: { error: "Connection String de armazenamento não configurada no ambiente." } };
            }

            const rKey = contrato.trim().toUpperCase().replace(/[^a-zA-Z0-9]/g, '');

            const clientRetirada = TableClient.fromConnectionString(connectionString, 'ContratosRetirada');
            let partitionKeyOriginal = null;
            let enderecoOriginal = "";

            try {
                const result = clientRetirada.listEntities({
                    queryOptions: { filter: `RowKey eq '${rKey}'` }
                });
                for await (const entity of result) {
                    partitionKeyOriginal = entity.PartitionKey;
                    enderecoOriginal = entity.Endereco || "";
                    break;
                }
            } catch (err) {
                context.warn("Contrato de origem não localizado em ContratosRetirada.");
            }

            if (!partitionKeyOriginal) {
                partitionKeyOriginal = new Date().toISOString().split('T')[0].replace(/-/g, '');
            }

            const urlsFotos = [];
            const imagensParaSubir = status === 'PRODUTIVO' ? (payload.imagens_etiqueta || []) : [payload.imagem_fachada].filter(Boolean);

            for (let i = 0; i < imagensParaSubir.length; i++) {
                const urlResult = await subirFotoBlob(rKey, imagensParaSubir[i], i, connectionString);
                if (urlResult) urlsFotos.push(urlResult);
            }

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

            const clientEvidencias = TableClient.fromConnectionString(connectionString, 'EvidenciasTable');
            const codigoAuditoria = status === 'PRODUTIVO' ? 'FORA TOA' : (codigo_baixa || 'N/D');

            const entidadeEvidencia = {
                PartitionKey: partitionKeyOriginal,
                RowKey: `${rKey}_${Date.now()}`,
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

            return { status: 200, jsonBody: { success: true } };

        } catch (error) {
            context.error("Erro interno ao concluir atendimento:", error);
            return {
                status: 500,
                jsonBody: { error: error.message || "Erro crítico ao registrar atendimento." }
            };
        }
    }
});
