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
import fs from "fs";
import { google } from "googleapis";
import path from "path";
import { fileURLToPath } from 'url';


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
        },
        columnName: {
          type: "string",
          description: "Optional header name to return values from a specific column (e.g. 'Phone Number')"
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
          description: "Google Drive Spreadsheet Name (Alternative to ID)"
        },
        spreadsheetId: {
          type: "string",
          description: "Spreadsheet ID (if you do not provide the title)"
        },
        range: {
          type: "string",
          description: "Range A1 (ex: Sheet1!A2:D2)"
        },
        values: {
          type: "array",
          items: { type: "string" },
          description: "Values ​​to be updated (single line)"
        }
      },
      required: ["range", "values"]
    }
  },
  {
    name: "append_google_sheet_row",
    description: "Adds a new row with values ​​to the end of a tab in a Google Sheets spreadsheet.",
    inputSchema: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "Name of the spreadsheet in Google Drive (optional if you provide the ID)"
        },
        spreadsheetId: {
          type: "string",
          description: "Sheet ID (optional if providing title)"
        },
        range: {
          type: "string",
          description: "Base range (e.g. Sheet1!A1). The row will be automatically added below."
        },
        values: {
          type: "array",
          items: {
            type: "string"
          },
          description: "One or more lines to add (each line is an array of strings)"
        }
      },
      required: ["range", "values"]
    }
  },
  {
    name: "delete_google_sheet_row",
    description: "Removes a specific row from a tab in a Google Sheets spreadsheet based on position (row).",
    inputSchema: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "Name of the spreadsheet in Google Drive (optional if you provide the ID)"
        },
        spreadsheetId: {
          type: "string",
          description: "Sheet ID (optional if providing title)"
        },
        sheetName: {
          type: "string",
          description: "Name of the tab where the row to be removed is located (e.g. Sheet1)"
        },
        rowIndex: {
          type: "number",
          description: "Index of the line to be deleted (starts from 0)"
        }
      },
      required: ["sheetName", "rowIndex"]
    }
  },
  {
    name: "create_google_sheet",
    description: "Creates a new Google Sheets spreadsheet with the specified name.",
    inputSchema: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "Name that will be given to the new spreadsheet"
        }
      },
      required: ["title"]
    }
  }, {
    name: "delete_google_drive_file",
    description: "Delete a file from Google Drive using the ID or exact name.",
    inputSchema: {
      type: "object",
      properties: {
        fileId: {
          type: "string",
          description: "File ID (optional if name is provided)"
        },
        name: {
          type: "string",
          description: "Exact name of the file to be deleted (used if fileId is not given)"
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
                text: `❌ No spreadsheet found with name "${title}".`
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
            values: values
          }
        });

        return {
          content: [{
            type: "text",
            text: `✅ Row successfully added to worksheet in range "${range}".`
          }],
          isError: false
        };

      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `❌ Error when trying to add row in Google Sheets spreadsheet. Error:${error}`
          }],
          isError: true
        };
      }
    }

    case "read_sheets": {
      try {
        let { spreadsheetId, title, range, columnName } = args;

        if (!spreadsheetId && title) {
          spreadsheetId = await getSpreadsheetIdByTitle(title);
          if (!spreadsheetId) {
            return {
              content: [{
                type: "text",
                text: `❌ No spreadsheet found with name "${title}".`
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
              text: "The worksheet is empty or the range did not return data."
            }],
            isError: false
          };
        }

        let formatted

        if (columnName) {
          const headers = rows[0];
          const index = headers.indexOf(columnName);
          if (index === -1) {
            return {
              content: [{
                type: "text",
                text: `❌ Column "${columnName}" not found in spreadsheet.`
              }],
              isError: true
            };
          }

          const columnValues = rows.slice(1).map((row, i) => `${i + 2}: ${row[index] || ''}`);
          formatted = `Coluna "${columnName}":\n` + columnValues.join('\n');
        } else {
          formatted = rows.map((row, i) => `${i + 1}: ${row.join(' | ')}`).join('\n');
        }

        return {
          content: [{
            type: "text",
            text: `📄 Spreadsheet content (${resolvedRange}):\n\n${formatted}`
          }],
          isError: false
        };

      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `❌ Error accessing Google Sheets spreadsheet`
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
                text: `❌ No spreadsheet found with name "${title}".`
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
            text: `✅ Range "${range}" successfully updated in spreadsheet.`
          }],
          isError: false
        };

      } catch (error) {
        return {
          content: [{
            type: "text",
            text: "❌ Error trying to update Google Sheets spreadsheet."
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
                text: `❌ No spreadsheet found with name "${title}".`
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
              text: `❌ Tab "${sheetName}" not found in spreadsheet.`
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
            text: `🗑️ Row ${rowIndex + 1} removed from tab "${sheetName}".`
          }],
          isError: false
        };

      } catch (error) {
        return {
          content: [{
            type: "text",
            text: "❌ Error when trying to delete a row from the spreadsheet."
          }],
          isError: true
        };
      }
    }

    //Via api google drive
    // case "create_google_sheet": {
    //   try {
    //     const { title } = args;

    //     const res = await drive.files.create({
    //       requestBody: {
    //         name: title,
    //         mimeType: "application/vnd.google-apps.spreadsheet"
    //       },
    //       fields: "id, name"
    //     });

    //     return {
    //       content: [{
    //         type: "text",
    //         text: `✅ Spreadsheet "${res.data.name}" created successfully! ID: ${res.data.id}`
    //       }],
    //       isError: false
    //     };

    //   } catch (error) {
    //     return {
    //       content: [{
    //         type: "text",
    //         text: `❌ Error trying to create Google Sheets spreadsheet.`
    //       }],
    //       isError: true
    //     };
    //   }
    // }

    case "create_google_sheet": {
      try {
        const { title } = args;

        const sheets = google.sheets({ version: "v4" });

        const res = await sheets.spreadsheets.create({
          requestBody: {
            properties: {
              title: title,
              locale: "en_US"
            },
            sheets: [
              {
                properties: {
                  title: "Sheet1"
                }
              }
            ]
          }
        });

        return {
          content: [{
            type: "text",
            text: `✅ Spreadsheet "${res.data.properties?.title}" created successfully! ID: ${res.data.spreadsheetId}`
          }],
          isError: false
        };

      } catch (error) {
        console.error(error); // Boa prática: logar o erro completo para debug
        return {
          content: [{
            type: "text",
            text: "❌ Error trying to create spreadsheet"
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
                text: `❌ File named "${name}" not found.`
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
              text: "❌ You must provide the fileId or file name."
            }],
            isError: true
          };
        }

        await drive.files.delete({ fileId });

        return {
          content: [{
            type: "text",
            text: `🗑️File deleted successfully! ID: ${fileId}`
          }],
          isError: false
        };

      } catch (error) {
        return {
          content: [{
            type: "text",
            text: "❌ Error trying to delete file from Google Drive."
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
//npx -y @modelcontextprotocol/inspector dist/index.js  
