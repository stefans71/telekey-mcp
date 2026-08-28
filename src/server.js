// A real MCP server (official SDK) whose tools are gated by the passport
// engine. Connect to it with the MCP Inspector or any MCP client over stdio.
//
//   npx @modelcontextprotocol/inspector node src/server.js
//
// Each tool call must carry a `passport` argument. The engine authorizes it
// against caps + budget before the tool body runs. This is the demonstrable,
// end-to-end version of the technical diagram.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { Engine, DeniedError } from "./engine.js";

const engine = new Engine();

const server = new McpServer({ name: "telekey-mcp", version: "0.1.0" });

const passportShape = z
  .object({
    sub: z.string(),
    act: z.array(z.string()),
    caps: z.array(z.string()),
    budget: z.record(z.number()),
    parent: z.string().nullable(),
    sig: z.string(),
  })
  .describe("Capability Passport carried on every call");

function gated(requestedCap, cost, body) {
  return async (args) => {
    try {
      const res = engine.authorizeCall(args.passport, requestedCap, cost);
      const out = body(args);
      return {
        content: [
          { type: "text", text: out },
          { type: "text", text: `\n[engine] allowed '${requestedCap}'  remaining=${JSON.stringify(res.remaining)}` },
        ],
      };
    } catch (e) {
      if (e instanceof DeniedError) {
        return {
          isError: true,
          content: [{ type: "text", text: `[engine] DENIED (${e.code}): ${e.message}` }],
        };
      }
      throw e;
    }
  };
}

server.registerTool(
  "list_repo",
  {
    description: "List files in a repo (requires cap listRepo:<repo>)",
    inputSchema: { passport: passportShape, repo: z.string() },
  },
  gated("listRepo:repoX", { spend: 0.01 }, (a) => `files in ${a.repo}: a.txt, b.txt, old1.log, old2.log`)
);

server.registerTool(
  "delete_file",
  {
    description: "Delete a file (requires cap deleteFile:<repo>)",
    inputSchema: { passport: passportShape, repo: z.string(), file: z.string() },
  },
  gated("deleteFile:repoX", { spend: 0.02 }, (a) => `deleted ${a.file} from ${a.repo}`)
);

server.registerTool(
  "send_email",
  {
    description: "Send an email summary (requires cap sendEmail:<addr>)",
    inputSchema: { passport: passportShape, to: z.string(), body: z.string() },
  },
  gated("sendEmail:you", { spend: 0.05 }, (a) => `email sent to ${a.to}`)
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("telekey-mcp server up on stdio");
