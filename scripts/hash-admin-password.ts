import readline from 'node:readline';
import bcrypt from 'bcryptjs';

const BCRYPT_ROUNDS = 12;
const MIN_PASSWORD_LENGTH = 8;

function promptHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    const stdout = process.stdout;

    if (!stdin.isTTY) {
      const rl = readline.createInterface({ input: stdin, output: stdout });
      rl.question(question, (answer) => {
        rl.close();
        resolve(answer);
      });
      return;
    }

    stdout.write(question);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    let value = '';

    const onData = (ch: string) => {
      if (ch === '\r' || ch === '\n' || ch === '\u0004') {
        stdin.setRawMode(false);
        stdin.pause();
        stdin.removeListener('data', onData);
        stdout.write('\n');
        resolve(value);
      } else if (ch === '\u0003') {
        // Ctrl+C
        stdin.setRawMode(false);
        stdout.write('\nAborted.\n');
        process.exit(130);
      } else if (ch === '\u007f' || ch === '\b') {
        if (value.length > 0) {
          value = value.slice(0, -1);
          stdout.write('\b \b');
        }
      } else {
        value += ch;
        stdout.write('*');
      }
    };

    stdin.on('data', onData);
  });
}

async function main() {
  console.log('Crex Live Scorer — Admin Password Hash Generator (bcrypt, 12 rounds)\n');

  const password = await promptHidden('Enter admin password (min 8 chars): ');
  if (password.length < MIN_PASSWORD_LENGTH) {
    console.error(`\nError: Password must be at least ${MIN_PASSWORD_LENGTH} characters long.`);
    process.exit(1);
  }

  const confirm = await promptHidden('Confirm admin password: ');
  if (password !== confirm) {
    console.error('\nError: Passwords do not match.');
    process.exit(1);
  }

  const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  console.log('\nAdd the following line to your .env file (keep single quotes so $ is not expanded):');
  console.log(`ADMIN_PASSWORD_HASH='${hash}'\n`);
}

main().catch((err) => {
  console.error('Failed to generate password hash:', err?.message || err);
  process.exit(1);
});
