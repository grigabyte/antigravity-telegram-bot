/**
 * Import AI Studio history into Supabase (Fixed - takes actual responses, not thinking)
 * 
 * Usage: 
 * npx ts-node scripts/import-ai-studio.ts
 */

import * as fs from 'fs';

// Supabase config
const SUPABASE_URL = 'https://ylicjyyxyopjwnzfyhfj.supabase.co';
const SUPABASE_KEY = 'sb_secret_fY-w-MudEHDyXQ7DifP9GA_T3_TbOxQ';
const USER_ID = 606219663; // Your Telegram user ID

interface Message {
  role: 'user' | 'model';
  content: string;
  timestamp: number;
}

async function supabaseQuery(table: string, method: string, body?: any, query?: string): Promise<any> {
  const url = `${SUPABASE_URL}/rest/v1/${table}${query || ''}`;
  const headers: Record<string, string> = {
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': method === 'POST' ? 'return=representation' : 'return=minimal',
  };
  
  const response = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Supabase error: ${error}`);
  }
  
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

function isThinkingBlock(text: string): boolean {
  // English thinking patterns from Gemini
  const thinkingPatterns = [
    /^\*\*[A-Z][a-z]+(ing|ion|sis|ment)\s/m,  // **Analyzing, **Evaluating, etc.
    /^I'm (currently|now|focusing|analyzing|examining|revising)/m,
    /^My (focus|goal|current|aim)/m,
    /^I've been (examining|analyzing|digging|drilling)/m,
    /^I am (now|currently|presently)/m,
    /^The (process|focus|goal) has/m,
  ];
  
  // Check if text starts with thinking pattern
  for (const pattern of thinkingPatterns) {
    if (pattern.test(text.trim())) {
      return true;
    }
  }
  
  // Check if it's mostly English (thinking is in English, answers in Russian)
  const russianChars = (text.match(/[а-яё]/gi) || []).length;
  const latinChars = (text.match(/[a-z]/gi) || []).length;
  
  // If less than 10% Russian and has thinking markers, it's thinking
  if (russianChars < text.length * 0.1 && latinChars > text.length * 0.3) {
    if (text.includes('**') && (text.includes("I'm") || text.includes("I am") || text.includes("My "))) {
      return true;
    }
  }
  
  return false;
}

function parseAIStudioFile(content: string): Message[] {
  const messages: Message[] = [];
  const baseTimestamp = Date.now() - (365 * 24 * 60 * 60 * 1000);
  
  // Match role blocks with all their parts
  const roleBlockPattern = /\{\s*role:\s*'(user|model)',\s*parts:\s*\[([\s\S]*?)\],?\s*\}/g;
  
  let match;
  while ((match = roleBlockPattern.exec(content)) !== null) {
    const role = match[1] as 'user' | 'model';
    const partsBlock = match[2];
    
    // Extract all text parts
    const textPattern = /text:\s*`([\s\S]*?)`/g;
    const texts: string[] = [];
    
    let textMatch;
    while ((textMatch = textPattern.exec(partsBlock)) !== null) {
      let text = textMatch[1]
        .replace(/\\`/g, '`')
        .replace(/\\\$/g, '$')
        .trim();
      
      if (text.length > 10 && text !== 'INSERT_INPUT_HERE') {
        texts.push(text);
      }
    }
    
    if (texts.length === 0) continue;
    
    let finalText: string;
    
    if (role === 'user') {
      // User messages - take all parts combined
      finalText = texts.join('\n\n');
    } else {
      // Model messages - skip thinking blocks, take the actual response
      const nonThinkingTexts = texts.filter(t => !isThinkingBlock(t));
      
      if (nonThinkingTexts.length > 0) {
        // Take the longest non-thinking text (usually the actual answer)
        finalText = nonThinkingTexts.reduce((a, b) => a.length > b.length ? a : b);
      } else {
        // All texts are thinking? Skip this message
        continue;
      }
    }
    
    if (finalText.length < 20) continue;
    
    messages.push({
      role,
      content: finalText,
      timestamp: baseTimestamp + (messages.length * 60000),
    });
  }
  
  return messages;
}

async function main() {
  console.log('📚 AI Studio History Importer (v2 - Fixed)');
  console.log('============================================');
  
  const filePath = '/Users/griga/Downloads/ai_studio_code.ts';
  console.log(`\n📁 Reading: ${filePath}`);
  
  const fileContent = fs.readFileSync(filePath, 'utf-8');
  console.log(`📏 File size: ${(fileContent.length / 1024 / 1024).toFixed(2)} MB`);
  
  console.log('\n⏳ Parsing messages (skipping thinking blocks)...');
  const messages = parseAIStudioFile(fileContent);
  
  console.log(`\n✅ Found ${messages.length} messages`);
  
  if (messages.length === 0) {
    console.error('❌ No messages parsed!');
    process.exit(1);
  }
  
  // Stats
  const userMsgs = messages.filter(m => m.role === 'user').length;
  const modelMsgs = messages.filter(m => m.role === 'model').length;
  const totalChars = messages.reduce((sum, m) => sum + m.content.length, 0);
  
  console.log(`   👤 User: ${userMsgs}`);
  console.log(`   🤖 Model: ${modelMsgs}`);
  console.log(`   📏 Total: ${(totalChars / 1024 / 1024).toFixed(2)} MB`);
  
  // Sample
  console.log('\n📝 First USER message:');
  const firstUser = messages.find(m => m.role === 'user');
  if (firstUser) console.log(`   ${firstUser.content.substring(0, 150)}...`);
  
  console.log('\n📝 First MODEL response:');
  const firstModel = messages.find(m => m.role === 'model');
  if (firstModel) console.log(`   ${firstModel.content.substring(0, 150)}...`);
  
  // Verify no thinking blocks leaked
  const hasThinking = messages.some(m => 
    m.role === 'model' && m.content.startsWith('**') && m.content.includes("I'm")
  );
  if (hasThinking) {
    console.log('\n⚠️  Warning: Some thinking blocks may have leaked through!');
  } else {
    console.log('\n✅ No thinking blocks detected in model responses');
  }
  
  console.log('\n⚠️  This will REPLACE your existing chat history!');
  console.log('Starting in 5 seconds... Press Ctrl+C to cancel');
  await new Promise(resolve => setTimeout(resolve, 5000));
  
  // Clear existing history first
  console.log('\n🗑️  Clearing existing history...');
  await supabaseQuery('chat_history', 'DELETE', null, `?user_id=eq.${USER_ID}`);
  
  // Import in batches
  console.log('📤 Importing to Supabase...');
  
  let imported = 0;
  const batchSize = 50;
  const errors: string[] = [];
  
  for (let i = 0; i < messages.length; i += batchSize) {
    const batch = messages.slice(i, i + batchSize);
    
    const records = batch.map(msg => ({
      user_id: USER_ID,
      role: msg.role,
      content: msg.content,
      timestamp: msg.timestamp,
    }));
    
    try {
      await supabaseQuery('chat_history', 'POST', records);
      imported += batch.length;
    } catch (error: any) {
      errors.push(`Batch ${i}: ${error.message.substring(0, 100)}`);
      // Try individual inserts for failed batch
      for (const record of records) {
        try {
          await supabaseQuery('chat_history', 'POST', record);
          imported++;
        } catch { /* skip */ }
      }
    }
    
    process.stdout.write(`\r📤 Progress: ${imported}/${messages.length} (${((imported / messages.length) * 100).toFixed(1)}%)`);
    
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  
  console.log(`\n\n✅ Imported ${imported}/${messages.length} messages`);
  console.log(`📏 Total size: ${(totalChars / 1024 / 1024).toFixed(2)} MB`);
  
  if (errors.length > 0) {
    console.log(`\n⚠️  Errors (${errors.length}):`);
    errors.slice(0, 3).forEach(e => console.log(`   - ${e}`));
  }
  
  console.log('\n🎉 Done! Use /stats in the bot to check.');
}

main().catch(console.error);
