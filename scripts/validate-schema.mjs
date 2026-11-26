// schema/ingest.schema.json 自体の正しさと、schema/examples/*.json がそれに合うかを確認する
import Ajv2020 from "ajv/dist/2020.js";
import { readFileSync, readdirSync } from "node:fs";

const schema = JSON.parse(readFileSync(new URL("../schema/ingest.schema.json", import.meta.url), "utf8"));
const ajv = new Ajv2020({ allErrors: true, strict: false });
const validate = ajv.compile(schema);

const dir = new URL("../schema/examples/", import.meta.url);
let failed = 0;
for (const f of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
  const data = JSON.parse(readFileSync(new URL(f, dir), "utf8"));
  const expectInvalid = f.startsWith("invalid-");
  const ok = validate(data);
  if (ok === expectInvalid) {
    failed++;
    console.error(`NG ${f}: expected ${expectInvalid ? "invalid" : "valid"}`, validate.errors);
  } else {
    console.log(`ok ${f}`);
  }
}
process.exit(failed ? 1 : 0);
