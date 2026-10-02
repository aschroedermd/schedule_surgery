import { hashSimulatorPassword } from '../src/server/boardsTester';
// Read stdin so the password never appears in process arguments or shell history.
let password = '';
for await (const chunk of process.stdin) password += chunk;
password = password.replace(/\r?\n$/, '');
if (password.length < 1 || password.length > 1024) throw new Error('Use a simulator password of 1–1024 characters');
console.log(await hashSimulatorPassword(password));
