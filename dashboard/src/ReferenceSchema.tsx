import { asObject, fields, resolve, schemaType, text } from "./reference-model.js";
import type { ApiDocument } from "./reference-model.js";

export function ReferenceSchema({ document, schema, depth = 0 }: { document: ApiDocument; schema: unknown; depth?: number }) {
  const resolved = resolve(document, schema), rows = fields(document, schema), alternatives = resolved.oneOf ?? resolved.anyOf;
  if (depth >= 5) return <p className="reference-muted">Estrutura aninhada. Consulte o schema JSON para a definição completa.</p>;
  return <div className="reference-schema">
    {text(resolved.description) && <p>{text(resolved.description)}</p>}
    {rows.length ? rows.map(row => <details key={row.name} className="reference-schema-field">
      <summary><span><code>{row.name}</code><small>{schemaType(document, row.schema)}</small></span><span className={row.required ? "reference-required" : "reference-muted"}>{row.required ? "Obrigatório" : "Opcional"}</span></summary>
      <SchemaConstraints schema={resolve(document, row.schema)}/><ReferenceSchema document={document} schema={row.schema} depth={depth + 1}/>
    </details>) : Array.isArray(alternatives) ? alternatives.map((item, index) => <details key={index}><summary>Alternativa {index + 1} · {schemaType(document, item)}</summary><ReferenceSchema document={document} schema={item} depth={depth + 1}/></details>)
      : resolved.items !== undefined ? <details><summary>Itens da lista · {schemaType(document, resolved.items)}</summary><ReferenceSchema document={document} schema={resolved.items} depth={depth + 1}/></details>
      : <><p className="reference-muted">{schemaType(document, schema)}</p><SchemaConstraints schema={resolved}/></>}
  </div>;
}
function SchemaConstraints({ schema }: { schema: ReturnType<typeof asObject> }) {
  const constraints = [["Mínimo", schema.minimum], ["Máximo", schema.maximum], ["Mínimo exclusivo", schema.exclusiveMinimum], ["Máximo exclusivo", schema.exclusiveMaximum], ["Caracteres mínimos", schema.minLength], ["Caracteres máximos", schema.maxLength], ["Itens mínimos", schema.minItems], ["Itens máximos", schema.maxItems], ["Padrão", schema.pattern], ["Formato", schema.format]];
  return <>{Array.isArray(schema.enum) && <p className="reference-enum">Valores: {schema.enum.map((value, index) => <code key={index}>{JSON.stringify(value)}</code>)}</p>}
    {constraints.some(([, value]) => value !== undefined) && <dl className="reference-constraints">{constraints.filter(([, value]) => value !== undefined).map(([label, value]) => <div key={String(label)}><dt>{String(label)}</dt><dd><code>{String(value)}</code></dd></div>)}</dl>}
  </>;
}
