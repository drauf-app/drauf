import { randomUUID } from 'node:crypto';
import { fastify } from 'fastify';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';

/**
 * Minimal in-process OIDC provider for tests: discovery, JWKS and token
 * endpoint. The authorize step is skipped — tests mint a code directly with
 * the claims the next token response should carry.
 */
export interface FakeIdp {
  issuer: string;
  clientId: string;
  /** Returns an authorization code whose token response will carry these claims. */
  createCode(claims: Record<string, unknown>): string;
  /** What GET {issuer}/picture serves — for avatar tests (#98). */
  setPicture(body: Buffer, contentType: string): void;
  close(): Promise<void>;
}

export async function startFakeIdp(): Promise<FakeIdp> {
  const { publicKey, privateKey } = await generateKeyPair('RS256', { extractable: true });
  const jwk = { ...(await exportJWK(publicKey)), kid: 'test', alg: 'RS256', use: 'sig' };
  const clientId = 'drauf-test';
  const codes = new Map<string, Record<string, unknown>>();
  let issuer = '';

  const app = fastify({ logger: false });
  app.addContentTypeParser(
    'application/x-www-form-urlencoded',
    { parseAs: 'string' },
    (_request, body, done) => done(null, Object.fromEntries(new URLSearchParams(body as string))),
  );

  app.get('/.well-known/openid-configuration', async () => ({
    issuer,
    authorization_endpoint: `${issuer}/authorize`,
    token_endpoint: `${issuer}/token`,
    jwks_uri: `${issuer}/jwks`,
    response_types_supported: ['code'],
    subject_types_supported: ['public'],
    id_token_signing_alg_values_supported: ['RS256'],
    code_challenge_methods_supported: ['S256'],
    grant_types_supported: ['authorization_code'],
  }));

  app.get('/jwks', async () => ({ keys: [jwk] }));

  let picture: { body: Buffer; contentType: string } = {
    body: Buffer.from('fake-png-bytes'),
    contentType: 'image/png',
  };
  app.get('/picture', async (_request, reply) => {
    reply.header('content-type', picture.contentType);
    return reply.send(picture.body);
  });

  app.post('/token', async (request, reply) => {
    const body = request.body as Record<string, string>;
    const claims = body.code === undefined ? undefined : codes.get(body.code);
    if (claims === undefined) {
      return reply.code(400).send({ error: 'invalid_grant' });
    }
    codes.delete(body.code as string);
    const { sub, ...rest } = claims;
    const idToken = await new SignJWT(rest)
      .setProtectedHeader({ alg: 'RS256', kid: 'test' })
      .setIssuer(issuer)
      .setAudience(clientId)
      .setSubject(sub as string)
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(privateKey);
    return {
      access_token: 'test-access-token',
      token_type: 'bearer',
      id_token: idToken,
      expires_in: 300,
    };
  });

  await app.listen({ host: '127.0.0.1', port: 0 });
  const address = app.addresses()[0];
  if (address === undefined) {
    throw new Error('fake idp did not bind');
  }
  issuer = `http://127.0.0.1:${address.port}`;

  return {
    issuer,
    clientId,
    createCode(claims) {
      const code = randomUUID();
      codes.set(code, claims);
      return code;
    },
    setPicture(body, contentType) {
      picture = { body, contentType };
    },
    close: () => app.close(),
  };
}
