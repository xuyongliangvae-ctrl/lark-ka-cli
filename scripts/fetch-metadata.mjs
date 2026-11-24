import { writeFile, mkdir } from "node:fs/promises";
import { pruneAPICatalog } from "./catalog-surface.mjs";
const url =
  "https://open.feishu.cn/api/tools/open/api_definition?protocol=meta&client_version=1.0.48";
const response = await fetch(url, {
  signal: AbortSignal.timeout(30000),
  redirect: "error",
});
if (!response.ok) throw new Error(`Metadata HTTP ${response.status}`);
const envelope = await response.json();
const data = envelope.data;
if (!Array.isArray(data?.services) || !data.services.length)
  throw new Error("Empty metadata registry");
const retained = pruneAPICatalog(data);
await mkdir(new URL("../data/", import.meta.url), { recursive: true });
await writeFile(
  new URL("../data/api-metadata.json", import.meta.url),
  JSON.stringify(retained),
);
console.error(`Saved ${retained.services.length} retained API services`);
