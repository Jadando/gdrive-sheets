#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  CallToolResult,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  Tool
} from "@modelcontextprotocol/sdk/types.js";
import * as dotenv from 'dotenv';
import fs from "fs";
import { google } from "googleapis";
import path from "path";
import { fileURLToPath } from 'url';

dotenv.config();

const drive = google.drive("v3");

const server = new Server(
  {
    name: "example-servers/gdrive",
    version: "0.1.0",
  },
  {
    capabilities: {
      resources: {},
      tools: {},
    },
  },
);

const TOOLS: Tool[] = [
  {
    name: "search",
    description: "Search for files in Google Drive",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
      },
      required: ["query"],
    },
  },
  {
    name: "read_sheets",
    description: "Reads and returns values ​​from a Google Sheets spreadsheet or a specific range if provided.",
    inputSchema: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "Exact name of the spreadsheet in Google Drive"
        },
        spreadsheetId: {
          type: "string",
          description: "Spreadsheet ID in Google Sheets"
        },
        range: {
          type: "string",
          description: "Optional A1 range (e.g. Sheet1!A1:D10). If not specified, returns (A1:Z20) content of the first tab."
        }
      },
      required: ["title"]
    }
  },
  {
    name: "update_google_sheet_range",
    description: "Updates values ​​from a specific range in a Google Sheets spreadsheet.",
    inputSchema: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "Nome da planilha no Google Drive (alternativa ao ID)"
        },
        spreadsheetId: {
          type: "string",
          description: "ID da planilha (caso não informe o título)"
        },
        range: {
          type: "string",
          description: "Intervalo A1 (ex: Sheet1!A2:D2)"
        },
        values: {
          type: "array",
          items: { type: "string" },
          description: "Valores a serem atualizados (linha única)"
        }
      },
      required: ["range", "values"]
    }
  },
  {
    name: "append_google_sheet_row",
    description: "Adiciona uma nova linha com valores ao final de uma aba em uma planilha do Google Sheets.",
    inputSchema: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "Nome da planilha no Google Drive (opcional se fornecer o ID)"
        },
        spreadsheetId: {
          type: "string",
          description: "ID da planilha (opcional se fornecer o título)"
        },
        range: {
          type: "string",
          description: "Intervalo base (ex: Sheet1!A1). A linha será adicionada automaticamente abaixo."
        },
        values: {
          type: "array",
          items: {
            type: "string"
          },
          description: "Valores da nova linha (um por célula)"
        }
      },
      required: ["range", "values"]
    }
  },
  {
    name: "delete_google_sheet_row",
    description: "Remove uma linha específica de uma aba em uma planilha do Google Sheets com base na posição (linha).",
    inputSchema: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "Nome da planilha no Google Drive (opcional se fornecer o ID)"
        },
        spreadsheetId: {
          type: "string",
          description: "ID da planilha (opcional se fornecer o título)"
        },
        sheetName: {
          type: "string",
          description: "Nome da aba onde está a linha a ser removida (ex: Sheet1)"
        },
        rowIndex: {
          type: "number",
          description: "Índice da linha a ser deletada (começa do 0)"
        }
      },
      required: ["sheetName", "rowIndex"]
    }
  },
  {
    name: "create_google_sheet",
    description: "Cria uma nova planilha do Google Sheets com o nome especificado.",
    inputSchema: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "Nome que será dado à nova planilha"
        }
      },
      required: ["title"]
    }
  }, {
    name: "delete_google_drive_file",
    description: "Deleta um arquivo do Google Drive usando o ID ou o nome exato.",
    inputSchema: {
      type: "object",
      properties: {
        fileId: {
          type: "string",
          description: "ID do arquivo (opcional se nome for fornecido)"
        },
        name: {
          type: "string",
          description: "Nome exato do arquivo a ser deletado (usado se fileId não for informado)"
        }
      },
      required: []
    }
  }




];


server.setRequestHandler(ListResourcesRequestSchema, async (request) => {
  const pageSize = 10;
  const params: any = {
    pageSize,
    fields: "nextPageToken, files(id, name, mimeType)",
  };

  if (request.params?.cursor) {
    params.pageToken = request.params.cursor;
  }

  const res = await drive.files.list(params);
  const files = res.data.files!;

  return {
    resources: files.map((file) => ({
      uri: `gdrive:///${file.id}`,
      mimeType: file.mimeType,
      name: file.name,
    })),
    nextCursor: res.data.nextPageToken,
  };
});

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const fileId = request.params.uri.replace("gdrive:///", "");

  // First get file metadata to check mime type
  const file = await drive.files.get({
    fileId,
    fields: "mimeType",
  });

  // For Google Docs/Sheets/etc we need to export
  if (file.data.mimeType?.startsWith("application/vnd.google-apps")) {
    let exportMimeType: string;
    switch (file.data.mimeType) {
      case "application/vnd.google-apps.document":
        exportMimeType = "text/markdown";
        break;
      case "application/vnd.google-apps.spreadsheet":
        exportMimeType = "text/csv";
        break;
      case "application/vnd.google-apps.presentation":
        exportMimeType = "text/plain";
        break;
      case "application/vnd.google-apps.drawing":
        exportMimeType = "image/png";
        break;
      default:
        exportMimeType = "text/plain";
    }

    const res = await drive.files.export(
      { fileId, mimeType: exportMimeType },
      { responseType: "text" },
    );

    return {
      contents: [
        {
          uri: request.params.uri,
          mimeType: exportMimeType,
          text: res.data,
        },
      ],
    };
  }

  // For regular files download content
  const res = await drive.files.get(
    { fileId, alt: "media" },
    { responseType: "arraybuffer" },
  );
  const mimeType = file.data.mimeType || "application/octet-stream";
  if (mimeType.startsWith("text/") || mimeType === "application/json") {
    return {
      contents: [
        {
          uri: request.params.uri,
          mimeType: mimeType,
          text: Buffer.from(res.data as ArrayBuffer).toString("utf-8"),
        },
      ],
    };
  } else {
    return {
      contents: [
        {
          uri: request.params.uri,
          mimeType: mimeType,
          blob: Buffer.from(res.data as ArrayBuffer).toString("base64"),
        },
      ],
    };
  }
});

async function getSpreadsheetIdByTitle(title: string): Promise<string | null> {
  const res = await drive.files.list({
    q: `name = '${title}' and mimeType = 'application/vnd.google-apps.spreadsheet'`,
    fields: 'files(id, name)',
    pageSize: 1
  });

  const file = res.data.files?.[0] ?? null; // Força null se for undefined
  return file?.id ?? null;
};


async function handleToolCall(name: string, args: any): Promise<CallToolResult> {

  switch (name) {
    case "search": {
      try {
        const userQuery = args.query as string;
        const escapedQuery = userQuery.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
        const formattedQuery = `fullText contains '${escapedQuery}'`;

        const res = await drive.files.list({
          q: formattedQuery,
          pageSize: 10,
          fields: "files(id, name, mimeType, modifiedTime, size)",
        });

        const fileList = res.data.files
          ?.map((file: any) => `${file.name} (${file.mimeType})`)
          .join("\n");

        return {
          content: [{
            type: "text",
            text: `Found ${res.data.files?.length ?? 0} files:\n${fileList}`,
          }],
          isError: false,
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: "Error searching files",
          }],
          isError: true,
        };
      }
    }

    case "append_google_sheet_row": {
      try {
        let { spreadsheetId, title, range, values } = args;

        if (!spreadsheetId && title) {
          spreadsheetId = await getSpreadsheetIdByTitle(title);
          if (!spreadsheetId) {
            return {
              content: [{
                type: "text",
                text: `❌ Nenhuma planilha encontrada com o nome "${title}".`
              }],
              isError: true
            };
          }
        }

        const sheets = google.sheets({ version: "v4" });

        await sheets.spreadsheets.values.append({
          spreadsheetId,
          range,
          valueInputOption: "RAW",
          insertDataOption: "INSERT_ROWS",
          requestBody: {
            values: [values]
          }
        });

        return {
          content: [{
            type: "text",
            text: `✅ Linha adicionada com sucesso à planilha no intervalo "${range}".`
          }],
          isError: false
        };

      } catch (error) {
        return {
          content: [{
            type: "text",
            text: "❌ Erro ao tentar adicionar a linha na planilha do Google Sheets."
          }],
          isError: true
        };
      }
    }

    case "read_sheets": {
      try {
        let { spreadsheetId, title, range } = args;

        if (!spreadsheetId && title) {
          spreadsheetId = await getSpreadsheetIdByTitle(title);
          if (!spreadsheetId) {
            return {
              content: [{
                type: "text",
                text: `❌ Nenhuma planilha encontrada com o nome "${title}".`
              }],
              isError: true
            };
          }
        }

        const sheets = google.sheets({ version: "v4" });

        // Se o range for fornecido, usa ele. Senão, busca as primeira 20 linhas da primeira aba.
        let resolvedRange = range;
        if (!resolvedRange) {
          const metadata = await sheets.spreadsheets.get({ spreadsheetId });
          const firstSheetTitle = metadata.data.sheets?.[0]?.properties?.title;
          resolvedRange = `${firstSheetTitle}!A1:Z20`;
        }

        const response = await sheets.spreadsheets.values.get({
          spreadsheetId,
          range: resolvedRange
        });

        const rows = response.data.values;
        if (!rows || rows.length === 0) {
          return {
            content: [{
              type: "text",
              text: "A planilha está vazia ou o intervalo não retornou dados."
            }],
            isError: false
          };
        }

        const formatted = rows.map((row) => row.join(" | ")).join("\n");

        return {
          content: [{
            type: "text",
            text: `📄 Conteúdo da planilha (${resolvedRange}):\n\n${formatted}`
          }],
          isError: false
        };

      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `❌ Erro ao acessar a planilha do Google Sheets, Erro:${error}`
          }],
          isError: true
        };
      }
    }
    case "update_google_sheet_range": {
      try {
        let { spreadsheetId, title, range, values } = args;

        if (!spreadsheetId && title) {
          spreadsheetId = await getSpreadsheetIdByTitle(title);
          if (!spreadsheetId) {
            return {
              content: [{
                type: "text",
                text: `❌ Nenhuma planilha encontrada com o nome "${title}".`
              }],
              isError: true
            };
          }
        }

        const sheets = google.sheets({ version: "v4" });

        const response = await sheets.spreadsheets.values.update({
          spreadsheetId,
          range,
          valueInputOption: "RAW",
          requestBody: {
            values: [values]
          }
        });

        return {
          content: [{
            type: "text",
            text: `✅ Intervalo "${range}" atualizado com sucesso na planilha.`
          }],
          isError: false
        };

      } catch (error) {
        return {
          content: [{
            type: "text",
            text: "❌ Erro ao tentar atualizar a planilha do Google Sheets."
          }],
          isError: true
        };
      }
    }

    case "delete_google_sheet_row": {
      try {
        let { spreadsheetId, title, sheetName, rowIndex } = args;

        if (!spreadsheetId && title) {
          spreadsheetId = await getSpreadsheetIdByTitle(title);
          if (!spreadsheetId) {
            return {
              content: [{
                type: "text",
                text: `❌ Nenhuma planilha encontrada com o nome "${title}".`
              }],
              isError: true
            };
          }
        }

        const sheetsApi = google.sheets({ version: "v4" });

        // Buscar ID da aba com base no nome
        const spreadsheet = await sheetsApi.spreadsheets.get({ spreadsheetId });
        const sheet = spreadsheet.data.sheets?.find(s => s.properties?.title === sheetName);

        if (!sheet) {
          return {
            content: [{
              type: "text",
              text: `❌ Aba "${sheetName}" não encontrada na planilha.`
            }],
            isError: true
          };
        }

        const sheetId = sheet.properties!.sheetId!;

        await sheetsApi.spreadsheets.batchUpdate({
          spreadsheetId,
          requestBody: {
            requests: [
              {
                deleteDimension: {
                  range: {
                    sheetId,
                    dimension: "ROWS",
                    startIndex: rowIndex,
                    endIndex: rowIndex + 1
                  }
                }
              }
            ]
          }
        });

        return {
          content: [{
            type: "text",
            text: `🗑️ Linha ${rowIndex + 1} removida da aba "${sheetName}".`
          }],
          isError: false
        };

      } catch (error) {
        return {
          content: [{
            type: "text",
            text: "❌ Erro ao tentar deletar linha da planilha."
          }],
          isError: true
        };
      }
    }
    case "create_google_sheet": {
      try {
        const { title } = args;

        const res = await drive.files.create({
          requestBody: {
            name: title,
            mimeType: "application/vnd.google-apps.spreadsheet"
          },
          fields: "id, name"
        });

        return {
          content: [{
            type: "text",
            text: `✅ Planilha "${res.data.name}" criada com sucesso! ID: ${res.data.id}`
          }],
          isError: false
        };

      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `❌ Erro ao tentar criar a planilha do Google Sheets. Erro ${error}`
          }],
          isError: true
        };
      }
    }

    case "delete_google_drive_file": {
      try {
        let { fileId, name } = args;

        if (!fileId && name) {
          const res = await drive.files.list({
            q: `name = '${name}'`,
            fields: "files(id, name)",
            pageSize: 1
          });

          const file = res.data.files?.[0];
          if (!file) {
            return {
              content: [{
                type: "text",
                text: `❌ Arquivo com nome "${name}" não encontrado.`
              }],
              isError: true
            };
          }

          fileId = file.id;
        }

        if (!fileId) {
          return {
            content: [{
              type: "text",
              text: "❌ É necessário fornecer o fileId ou o nome do arquivo."
            }],
            isError: true
          };
        }

        await drive.files.delete({ fileId });

        return {
          content: [{
            type: "text",
            text: `🗑️ Arquivo deletado com sucesso! ID: ${fileId}`
          }],
          isError: false
        };

      } catch (error) {
        return {
          content: [{
            type: "text",
            text: "❌ Erro ao tentar deletar o arquivo do Google Drive."
          }],
          isError: true
        };
      }
    }

    default:
      return {
        content: [{
          type: "text",
          text: `Unknown tool: ${name}`,
        }],
        isError: true,
      };
  }
}

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) =>
  handleToolCall(request.params.name, request.params.arguments ?? {})
);

const credentialsPath = process.env.GDRIVE_CREDENTIALS_PATH || path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "./token.json" // <-- Aqui está o token gerado via navegador
);

const oauthKeysPath = process.env.GDRIVE_OAUTH_PATH || path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "./gcp-oauth.keys.json"
);

// ⚙️ Carrega client_id e client_secret do OAuth
const { client_id, client_secret, redirect_uris } = JSON.parse(
  fs.readFileSync(oauthKeysPath, "utf-8")
).web;

async function loadCredentialsAndRunServer() {
  if (!fs.existsSync(credentialsPath)) {
    console.error("Credentials not found. Faça o login com o primeiro script.");
    process.exit(1);
  }

  // Cria o cliente OAuth2
  const oAuth2Client = new google.auth.OAuth2(
    client_id,
    client_secret,
    redirect_uris[0] // mesmo redirect URI usado na autenticação inicial
  );

  // Carrega os tokens
  const token = JSON.parse(fs.readFileSync(credentialsPath, "utf-8"));
  oAuth2Client.setCredentials(token);

  // Seta o auth global
  google.options({ auth: oAuth2Client });

  console.log("Servidor iniciado");

  const transport = new StdioServerTransport(); // Ajuste conforme seu uso
  await server.connect(transport); // Substitua pela sua função principal
}

loadCredentialsAndRunServer().catch(console.error);
//npx @modelcontextprotocol/inspector dist/index.js  
