import { readFileSync } from 'fs';

const SUPABASE_URL = 'https://ylicjyyxyopjwnzfyhfj.supabase.co';
const SUPABASE_KEY = 'sb_secret_fY-w-MudEHDyXQ7DifP9GA_T3_TbOxQ';
const USER_ID = 606219663;

async function supabaseQuery(table: string, method: string, body?: any, query?: string) {
  const url = `${SUPABASE_URL}/rest/v1/${table}${query || ''}`;
  const response = await fetch(url, {
    method,
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': method === 'POST' ? 'return=representation' : 'return=minimal',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Supabase error: ${error}`);
  }
  
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

function isThinkingText(text: string): boolean {
  const thinkingPatterns = [
    /^\*\*[A-Z][a-z]+ing\s/,  // **Evaluating, **Analyzing, etc.
    /^I've been/,
    /^I'm now/,
    /^My focus/,
    /^I am/,
    /^The focus/,
  ];
  
  const trimmed = text.trim();
  return thinkingPatterns.some(p => p.test(trimmed));
}

async function main() {
  console.log('Reading AI Studio export...');
  const content = readFileSync('/Users/griga/Downloads/ai_studio_code.ts', 'utf-8');
  
  // Extract contents array from the file
  const contentsMatch = content.match(/const contents = \[([\s\S]*?)\n  \];/);
  if (!contentsMatch) {
    console.error('Could not find contents array');
    return;
  }
  
  // Parse messages manually
  const messages: Array<{ role: 'user' | 'model'; content: string; timestamp: number }> = [];
  
  // Find all role and text patterns
  const rolePattern = /role: '(user|model)'/g;
  const textPattern = /text: `([\s\S]*?)`(?:,|\s*})/g;
  
  let roleMatch;
  let textMatch;
  const roles: string[] = [];
  const texts: string[] = [];
  
  while ((roleMatch = rolePattern.exec(content)) !== null) {
    roles.push(roleMatch[1]);
  }
  
  while ((textMatch = textPattern.exec(content)) !== null) {
    texts.push(textMatch[1]);
  }
  
  console.log(`Found ${roles.length} roles and ${texts.length} text blocks`);
  
  // Process: each role may have multiple text parts
  let textIndex = 0;
  let baseTimestamp = Date.now() - (roles.length * 60000);
  
  for (let i = 0; i < roles.length; i++) {
    const role = roles[i] as 'user' | 'model';
    
    if (role === 'user') {
      // User messages have 1 text part
      if (textIndex < texts.length) {
        messages.push({
          role: 'user',
          content: texts[textIndex],
          timestamp: baseTimestamp + (messages.length * 60000),
        });
        textIndex++;
      }
    } else {
      // Model messages may have 2 text parts (thinking + response)
      // Skip thinking, take response
      let responseText = '';
      
      if (textIndex < texts.length) {
        const firstText = texts[textIndex];
        textIndex++;
        
        if (isThinkingText(firstText) && textIndex < texts.length) {
          // First was thinking, take second
          responseText = texts[textIndex];
          textIndex++;
        } else {
          // First was response
          responseText = firstText;
        }
      }
      
      if (responseText) {
        messages.push({
          role: 'model',
          content: responseText,
          timestamp: baseTimestamp + (messages.length * 60000),
        });
      }
    }
  }
  
  console.log(`\nProcessed ${messages.length} messages`);
  console.log('User messages:', messages.filter(m => m.role === 'user').length);
  console.log('Model messages:', messages.filter(m => m.role === 'model').length);
  
  // Show first few messages to verify
  console.log('\n--- First 3 messages preview ---');
  for (let i = 0; i < Math.min(3, messages.length); i++) {
    const m = messages[i];
    console.log(`\n[${m.role}]: ${m.content.substring(0, 100)}...`);
  }
  
  console.log('\n--- Clearing old data ---');
  
  // Clear all tables for user
  await supabaseQuery('chat_history', 'DELETE', null, `?user_id=eq.${USER_ID}`);
  console.log('Cleared chat_history');
  
  await supabaseQuery('chat_summaries', 'DELETE', null, `?user_id=eq.${USER_ID}`);
  console.log('Cleared chat_summaries');
  
  await supabaseQuery('long_term_memory', 'DELETE', null, `?user_id=eq.${USER_ID}`);
  console.log('Cleared long_term_memory');
  
  await supabaseQuery('user_settings', 'DELETE', null, `?user_id=eq.${USER_ID}`);
  console.log('Cleared user_settings');
  
  await supabaseQuery('last_sources', 'DELETE', null, `?user_id=eq.${USER_ID}`);
  console.log('Cleared last_sources');
  
  console.log('\n--- Importing messages ---');
  
  // Import in batches
  const batchSize = 50;
  for (let i = 0; i < messages.length; i += batchSize) {
    const batch = messages.slice(i, i + batchSize).map(m => ({
      user_id: USER_ID,
      role: m.role,
      content: m.content,
      timestamp: m.timestamp,
    }));
    
    await supabaseQuery('chat_history', 'POST', batch);
    console.log(`Imported ${Math.min(i + batchSize, messages.length)}/${messages.length}`);
  }
  
  console.log('\n✅ Done! Imported', messages.length, 'messages');
}

main().catch(console.error);
