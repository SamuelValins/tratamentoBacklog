const { app } = require('@azure/functions');
const { TableClient } = require('@azure/data-tables');
const { BlobServiceClient } = require('@azure/storage-blob');

// --- HELPER: Faz o upload da foto em Base64 para o Azure Blob Storage ---
async function uploadBase64ParaBlob(base64Data, contrato, index, connectionString) {
    if (!base64Data || !base64Data.includes('base64,')) return null;

    const parts = base64Data.split(';base64,');
    const contentType = parts[0].split(':')[1];
    const rawBuffer = Buffer.from(parts[1], 'base64');

    const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
    const containerClient = blobServiceClient.getContainerClient('evidencias-retirada');
    
    // Garante que o container existe e é público para visualização das fotos
    await containerClient.createIfNotExists({ publicAccess: 'blob' });

    // Nome único para o arquivo de imagem
    const blobName = `${contrato}_${Date.now()}_${index}.jpg`;
    const blockBlobClient = containerClient.getBlockBlobClient(blobName);

    await blockBlobClient.upload(rawBuffer, rawBuffer.length, {
        blobHTTPHeaders: { blobContentType: contentType }
    });

    return blockBlobClient.url; // Retorna o link web público da foto
}

app.http('concluirAtendimento', {
    methods: ['POST'],
    authLevel: 'anonymous',
    handler: async (request, context) => {
        try {
            const payload = await request.json();
            const { 
                contrato, tecnico, status, data_conclusao, 
                imagens_etiqueta, imagem_fachada, codigo_baixa, observacao_conclusao 
            } = payload;

            if (!contrato || !tecnico || !status) {
                return { status: 400, jsonBody: { error: "Campos obrigatórios ausentes (contrato, tecnico, status)." } };
            }

            const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING || process.env.AzureWebJobsStorage;
            const historyTable = TableClient.fromConnectionString(connectionString, 'HistoricoAtendimentos');
            const contractsTable = TableClient.fromConnectionString(connectionString, 'ContratosRetirada');

            const loginLower = tecnico.trim().toLowerCase();

            // 1. Processa e sobe as imagens para o Blob Storage
            const urlsFotos = [];
            
            if (status === 'PRODUTIVO' && imagens_etiqueta && imagens_etiqueta.length > 0) {
                for (let i = 0; i < imagens_etiqueta.length; i++) {
                    const url = await uploadBase64ParaBlob(imagens_etiqueta[i], contrato, `etiqueta_${i}`, connectionString);
                    if (url) urlsFotos.push(url);
                }
            } else if (status === 'IMPRODUTIVO' && imagem_fachada) {
                const url = await uploadBase64ParaBlob(imagem_fachada, contrato, 'fachada', connectionString);
                if (url) urlsFotos.push(url);
            }

            // 2. Busca informações de apoio do contrato original para enriquecer o histórico (Cidade e Tipo)
            let cidadeContrato = "N/D";
            let tipoDesconexao = "N/D";
            let macOriginal = "";

            try {
                // Como não sabemos a PartitionKey exata do contrato antigo, varremos pelo RowKey (número do contrato)
                const queryContrato = contractsTable.listEntities({
                    queryOptions: { filter: `RowKey eq '${contrato}'` }
                });

                for await (const activeContract of queryContrato) {
                    cidadeContrato = activeContract.Cidade || "N/D";
                    tipoDesconexao = activeContract.TipoDesconexao || "N/D";
                    macOriginal = activeContract.Mac || "";
                    
                    // 3. Remove o contrato resolvido da fila 'ContratosRetirada'
                    await contractsTable.deleteEntity(activeContract.partitionKey, activeContract.rowKey);
                }
            } catch (errContracts) {
                context.warn(`[concluirAtendimento] Falha ao excluir contrato original da fila: ${errContracts.message}`);
            }

            // 4. Salva o registro final na tabela de histórico
            const historicoEntity = {
                partitionKey: loginLower, // PartitionKey = Login do técnico [1]
                rowKey: contrato,         // RowKey = Número do contrato
                Cidade: cidadeContrato,
                DataHora: data_conclusao || new Date().toISOString(),
                Status: status,
                Mac: status === 'PRODUTIVO' ? macOriginal : '',
                TipoDesconexao: tipoDesconexao,
                CodigoBaixa: status === 'IMPRODUTIVO' ? (codigo_baixa || 'N/D') : '',
                Observacao: status === 'IMPRODUTIVO' ? (observacao_conclusao || '') : 'EQUIPAMENTO RETIRADO COM SUCESSO',
                ImagensUrls: urlsFotos.join(',') // Salva as URLs das fotos separadas por vírgula
            };

            await historyTable.upsertEntity(historicoEntity, "Replace");

            return {
                status: 200,
                jsonBody: { success: true, message: "Atendimento concluído e registrado no histórico." }
            };

        } catch (error) {
            context.error("[concluirAtendimento] Erro de processamento:", error);
            return {
                status: 500,
                jsonBody: { error: `Falha crítica ao concluir atendimento: ${error.message}` }
            };
        }
    }
});
