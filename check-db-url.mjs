#!/usr/bin/env node
/**
 * Checks the SUPABASE_DB_URL secret's FORMAT without revealing the password.
 * Used by .github/workflows/database.yml before connecting.
 *
 *   SUPABASE_DB_URL=... node scripts/check-db-url.mjs
 *
 * Prints only safe facts (user, host, port, password length and character
 * classes) and a list of problems. Exit 1 if any problem is found.
 */

/**
 * @param {string} raw
 * @returns {{ ok: boolean, facts: Record<string, string | number | boolean>, problems: string[] }}
 */
export function inspectDbUrl(raw) {
  const problems = [];
  const facts = {};
  if (typeof raw !== 'string' || raw.length === 0) {
    return { ok: false, facts, problems: ['The secret is empty or not set.'] };
  }

  facts.totalLength = raw.length;
  if (raw !== raw.trim()) problems.push('The secret starts or ends with a space or line break. Paste it again without extra spaces/newlines.');
  const s = raw.trim();

  if (!/^postgres(ql)?:\/\//.test(s)) problems.push('It must start with postgresql://');
  if (/YOUR[-_]?PASSWORD/i.test(s)) problems.push('The placeholder text YOUR-PASSWORD / YOURPASSWORD is still in it. Replace it with the real password.');
  if (/[[\]]/.test(s)) problems.push('It contains square brackets [ ]. Remove the brackets around the password.');

  // user:password@host:port/db — split on the LAST @ so a raw @ inside the password is detectable.
  const m = /^postgres(?:ql)?:\/\/([^:/]+):(.*)@([^@:/]+)(?::(\d+))?\/([^?]+)(\?.*)?$/.exec(s);
  if (!m) {
    problems.push('Could not read user:password@host:port/database from it. Copy the Session pooler string again.');
    return { ok: false, facts, problems };
  }
  const [, user, password, host, port, database] = m;
  facts.user = user;
  facts.host = host;
  facts.port = port ?? '(none)';
  facts.database = database;
  facts.passwordLength = password.length;
  facts.passwordHasLetters = /[A-Za-z]/.test(password);
  facts.passwordHasDigits = /\d/.test(password);
  facts.passwordOnlyLettersDigits = /^[A-Za-z0-9]+$/.test(password);

  if (password.length === 0) problems.push('The password part is empty.');
  if (/@/.test(password)) problems.push('The password contains @ — this breaks the URL. Reset the password to letters and digits only.');
  if (/[\s]/.test(password)) problems.push('The password contains a space.');
  if (!facts.passwordOnlyLettersDigits && !/%[0-9A-Fa-f]{2}/.test(password)) {
    problems.push('The password contains special characters. Reset it to letters and digits only (or percent-encode them).');
  }
  if (!/^postgres\.[a-z0-9]{20}$/.test(user)) problems.push(`User "${user}" should look like postgres.<project-ref> for the Session pooler.`);
  if (!/\.pooler\.supabase\.com$/.test(host)) problems.push(`Host "${host}" is not a Supabase pooler host. Use the Session pooler string (GitHub cannot reach the direct host).`);
  if (port && port !== '5432') problems.push(`Port ${port}: the Session pooler uses 5432 (6543 is the transaction pooler, which migrations should not use).`);
  if (database !== 'postgres') problems.push(`Database "${database}" should be "postgres".`);

  return { ok: problems.length === 0, facts, problems };
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop());
if (isMain) {
  const { ok, facts, problems } = inspectDbUrl(process.env.SUPABASE_DB_URL ?? '');
  console.log('SUPABASE_DB_URL format check (password itself is never printed):');
  for (const [k, v] of Object.entries(facts)) console.log(`  ${k}: ${v}`);
  if (ok) {
    console.log('PASS format looks right. If the connection still fails, the password value itself is wrong');
    console.log('     (or was reset less than a few minutes ago — the pooler can take a moment to update).');
    process.exit(0);
  }
  for (const p of problems) console.log(`::error::${p}`);
  process.exit(1);
}
