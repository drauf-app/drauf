import { parseArgs } from 'node:util';
import { loadDatabaseConfig } from '../config.js';
import { connectDatabase, runMigrations } from '../db/index.js';
import { seedDefaultHousehold } from '../db/seed.js';
import { createLocalUser } from '../users/service.js';

const USAGE =
  'usage: create-user <username> [--admin] [--display-name <name>]\n' +
  'The password is read from stdin (prompted on a terminal, piped otherwise).';

function readPasswordFromTty(): Promise<string> {
  return new Promise((resolve) => {
    process.stderr.write('Password: ');
    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let value = '';
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === '\n' || char === '\r' || char === '\u0004') {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off('data', onData);
          process.stderr.write('\n');
          resolve(value);
          return;
        }
        if (char === '\u0003') {
          process.stderr.write('\n');
          process.exit(130);
        }
        if (char === '\u007f' || char === '\b') {
          value = value.slice(0, -1);
        } else {
          value += char;
        }
      }
    };
    stdin.on('data', onData);
  });
}

async function readPasswordFromPipe(): Promise<string> {
  let input = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) {
    input += chunk;
  }
  return input.replace(/\r?\n$/, '');
}

const { values, positionals } = parseArgs({
  options: {
    admin: { type: 'boolean', default: false },
    'display-name': { type: 'string' },
  },
  allowPositionals: true,
});

const username = positionals[0];
if (username === undefined) {
  console.error(USAGE);
  process.exit(2);
}

const password = process.stdin.isTTY ? await readPasswordFromTty() : await readPasswordFromPipe();

const database = connectDatabase(loadDatabaseConfig());
try {
  await runMigrations(database);
  await seedDefaultHousehold(database);
  const result = await createLocalUser(database, {
    username,
    password,
    displayName: values['display-name'] ?? username,
    isAdmin: values.admin,
  });
  if (!result.ok) {
    console.error(`error: ${result.reason}`);
    process.exitCode = 1;
  } else {
    console.log(`created ${result.user.isAdmin ? 'admin ' : ''}user '${result.user.username}'`);
  }
} finally {
  await database.close();
}
