import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { cleanupOpenApiDoc } from 'nestjs-zod';
import { writeFileSync } from 'node:fs';

/** Writes the OpenAPI document of the running application to `file` (A-3.1). */
export function writeOpenApi(app: INestApplication, file: string): void {
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder().setTitle('Front Burner API').setVersion('1').build(),
    { operationIdFactory: (_controller, method) => method }
  );
  writeFileSync(file, `${JSON.stringify(cleanupOpenApiDoc(document), null, 2)}\n`);
}
