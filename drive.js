import { spawn } from "node:child_process";
import { mintRoot, attenuate } from "./src/passport.js";

const srv = spawn("node", ["src/server.js"], { stdio: ["pipe","pipe","inherit"] });
let buf = "";
const pending = [];
srv.stdout.on("data", d => {
  buf += d.toString();
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0,i); buf = buf.slice(i+1);
    if (line.trim()) { const cb = pending.shift(); cb && cb(JSON.parse(line)); }
  }
});
const send = (msg) => new Promise(res => { pending.push(res); srv.stdin.write(JSON.stringify(msg)+"\n"); });

await send({jsonrpc:"2.0",id:1,method:"initialize",params:{protocolVersion:"2025-06-18",capabilities:{},clientInfo:{name:"drive",version:"0"}}});
srv.stdin.write(JSON.stringify({jsonrpc:"2.0",method:"notifications/initialized"})+"\n");

const tools = await send({jsonrpc:"2.0",id:2,method:"tools/list"});
console.log("TOOLS:", tools.result.tools.map(t=>t.name).join(", "));

const p0 = mintRoot({sub:"user:alice",caps:["listRepo:repoX","deleteFile:repoX","sendEmail:you"],budget:{ttl_seconds:120,max_spend:0.5,max_tool_calls:40,max_spawns:2}});
const p1 = attenuate(p0,{addActor:"agent:cleanup",caps:["deleteFile:repoX"],budget:{max_tool_calls:5,max_spend:0.2}});

const ok = await send({jsonrpc:"2.0",id:3,method:"tools/call",params:{name:"delete_file",arguments:{passport:p1,repo:"repoX",file:"old1.log"}}});
console.log("VALID CALL:", ok.result.content.map(c=>c.text).join(" "));

const denied = await send({jsonrpc:"2.0",id:4,method:"tools/call",params:{name:"send_email",arguments:{passport:p1,to:"you",body:"done"}}});
console.log("INJECTED CALL:", denied.result.content.map(c=>c.text).join(" "), "| isError:", denied.result.isError===true);

srv.kill();
