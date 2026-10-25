# web-api-client

The generated Angular API classes, one per OpenAPI tag, with all request and
response types imported from `shared-contracts` (A-2.3, A-3.6). Regenerate with
`nx run web-api-client:generate`; never edit `src/generated`.

Tested with Vitest: `nx test web-api-client` checks the templates against
fixture OpenAPI documents and the generated classes against the contracts.
