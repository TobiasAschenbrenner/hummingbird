export function readConfig(environment: NodeJS.ProcessEnv = process.env) {
  const portValue = environment.PORT ?? '3000';
  const port = Number(portValue);
  if (!/^\d+$/.test(portValue) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be a whole number between 1 and 65535.');
  }

  const nodeEnv = environment.NODE_ENV ?? 'development';
  if (!['development', 'test', 'production'].includes(nodeEnv)) {
    throw new Error('NODE_ENV must be development, test, or production.');
  }

  const host = environment.HOST ?? (nodeEnv === 'production' ? '0.0.0.0' : '127.0.0.1');
  if (!['127.0.0.1', '0.0.0.0'].includes(host)) {
    throw new Error('HOST must be 127.0.0.1 or 0.0.0.0.');
  }

  const proxyValue = environment.TRUST_PROXY ?? '0';
  if (proxyValue !== 'loopback' && !/^[0-5]$/.test(proxyValue)) {
    throw new Error('TRUST_PROXY must be loopback or a hop count from 0 to 5.');
  }
  const trustProxy: number | 'loopback' =
    proxyValue === 'loopback' ? 'loopback' : Number(proxyValue);

  return { port, nodeEnv, host, trustProxy };
}
