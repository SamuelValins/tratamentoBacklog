const { app } = require('@azure/functions');
const { TableClient } = require('@azure/data-tables');
const { BlobServiceClient } = require('@azure/storage-blob');

const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
const tableContratos = "ContratosRetirada";
const tableHistorico = "HistoricoAtendimentos"; // Tabela de resultados finais
const containerName = "fotos-atendimentos"; // Pasta do Blob Storage para fotos

// Função auxiliar para enviar imagem Base64 ao Azure Blob Storage
async function salvarImagemNoBlob(base64Data, contratoId, tipoFoto, index = 0) {
    if (!base64Data) return null;
    
    const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
    const containerClient = blobServiceClient.getContainerClient(containerName);
    await containerClient.createIfNotExists({ publicAccess: 'blob' });

    // Extrai o tipo mime e dados puros
    const matches = base64Data.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
    if (!matches || matches.length !== 3) return null;
    const buffer = Buffer.from(matches[2], 'base64');

    const blobName = `${contratoId}_${tipoFoto}_${index}_${Date.now()}.jpg`;
    const blockBlobClient = containerClient.getBlockBlobClient(blobName);
    
    await blockBlobClient.upload(buffer, buffer.length, {
        blobHTTPHeaders: { blobContentType: 'image/jpeg' }
    });

    return blockBlobClient.url; // Retorna o link público da foto salva
}

app.http('concluirAtendimento', {
    methods: ['POST'],
    authLevel: 'anonymous',
    handler: async (request, context) => {
        try {
            const body = await request.json();
            const { contrato, tecnico, status, data_conclusao, localizacao, imagens_etiqueta, imagem_fachada, codigo_baixa, observacao_conclusao } = body;

            if (!contrato || !tecnico || !status) {
                return { status: 400, json: { error: "Dados obrigatórios ausentes." } };
            }

            // 1. Processar e salvar as fotos no Azure Blob Storage
            let linksFotos = [];
            if (status === 'PRODUTIVO' && imagens_etiqueta && imagens_etiqueta.length > 0) {
                for (let i = 0; i < imagens_etiqueta.length; i++) {
                    const url = await salvarImagemNoBlob(imagens_etiqueta[i], contrato, 'etiqueta', i);
                    if (url) linksFotos.push(url);
                }
            } else if (status === 'IMPRODUTIVO' && imagem_fachada) {
                const url = await salvarImagemNoBlob(imagem_fachada, contrato, 'fachada', 0);
                if (url) linksFotos.push(url);
            }

            // 2. Registrar no histórico de atendimentos do Azure Table Storage
            const tableClientHistorico = TableClient.fromConnectionString(connectionString, tableHistorico);
            await tableClientHistorico.createTableIfNotExists();

            const registroAtendimento = {
                PartitionKey: status, // Particionado por resultado
                RowKey: `${contrato}_${Date.now()}`,
                tecnico: tecnico,
                dataConclusao: data_conclusao,
                latitude: localizacao ? localizacao.latitude.toString() : "",
                longitude: localizacao ? localizacao.longitude.toString() : "",
                codigoBaixa: codigo_baixa || "",
                observacoes: observacao_conclusao || "",
                urlsFotos: JSON.stringify(linksFotos)
            };

            await tableClientHistorico.createEntity(registroAtendimento);

            // 3. (Opcional) Remover ou marcar como concluído na tabela original de contratos
            const tableClientContratos = TableClient.fromConnectionString(connectionString, tableContratos);
            // Para deletar o contrato da fila do Azure para que não apareça para outros técnicos:
            // await tableClientContratos.deleteEntity(PartitionKeyCidade, contrato);

            return { status: 200, json: { message: "Atendimento gravado com sucesso no Azure!" } };
        } catch (error) {
            context.log("Erro no servidor: ", error.message);
            return { status: 500, json: { error: error.message } };
        }
    }
});