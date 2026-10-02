import { BoardsFeedbackStore } from '../src/server/boardsFeedbackStore';
let data = ''; for await (const chunk of process.stdin) data += chunk;
const archive = new BoardsFeedbackStore(); let count = 0;
for (const line of data.split('\n').filter(line => line.trim())) {
  const entry = JSON.parse(line);
  if (!entry.client?.user_id) continue;
  await archive.save(entry, entry.client.user_id, entry.author || 'Tester'); count++;
}
console.log(`Archived ${count} existing comments.`);
