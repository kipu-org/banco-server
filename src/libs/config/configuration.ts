import { readFileSync } from 'fs';
import { load } from 'js-yaml';
import { join, resolve } from 'path';
import { z } from 'zod';

import { ConfigSchema } from './validation';

export default () => {
  const isProduction = process.env.NODE_ENV === 'production';
  const logLevel = process.env.LOG_LEVEL || 'silly';

  const yamlFilename = process.env.YAML_FILENAME || 'config.yaml';
  const configFilePath = join(resolve(), yamlFilename);

  const configYaml = load(readFileSync(configFilePath, 'utf8')) as Record<
    string,
    any
  >;

  const result = ConfigSchema.safeParse(configYaml);

  if (result.success === false) {
    if (result.error instanceof z.ZodError) {
      console.log('Config parsing issues: ', result.error.issues);
    } else {
      console.log(result.error);
    }

    throw new Error(`Invalid configuration file!`);
  }

  if (!isProduction) {
    console.log(result.data);
  }

  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error('No DATABASE_URL defined!');
  }

  const poolConfig = 'connection_limit=20&pool_timeout=30';
  const separator = databaseUrl.includes('?') ? '&' : '?';
  const prismaUrl = `${databaseUrl}${separator}${poolConfig}`;

  return {
    isProduction,
    logLevel,
    prismaUrl,
    ...configYaml,
  };
};
