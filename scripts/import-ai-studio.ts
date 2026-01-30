/**
 * Import chat history from Google AI Studio export
 * 
 * Parses AI Studio JSON export and imports messages into Supabase.
 * Takes actual model responses (not thinking blocks).
 * 
 * Usage:
 *   # Set environment variables first:
 *   export SUPABASE_URL="https://xxx.supabase.co"
 *   export SUPABASE_KEY="your-service-role-key"
 *   
 *   # Run the script:
 *   npx ts-node scripts/import-ai-studio.ts <user_id> <path_to_export.json>
 * 
 * Example:
 *   npx ts-node scripts/import-ai-studio.ts 123456789 ~/Downloads/ai-studio-export.json
 */

import * as fs from 'fs';

// Read from environment variables
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

// Validate environment
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Error: Missing environment variables');
  console.error('Please set SUPABASE_URL and SUPABASE_KEY');
  console.error('');
  console.error('Example:');
  console.error('  export SUPABASE_URL="https://xxx.supabase.co"');
  console.error('  export SUPABASE_KEY="your-service-role-key"');
  process.exit(1);
}

// Parse command line arguments
const args = process.argv.slice(2);
if (args.length < 2) {
  console.error('Usage: npx ts-node scripts/import-ai-studio.ts <user_id> <path_to_export.json>');
  console.error('');
  console.error('Example:');
  console.error('  npx ts-node scripts/import-ai-studio.ts 123456789 ~/Downloads/ai-studio-export.json');
  process.exit(1);
}

const USER_ID = parseInt(args[0]);
const EXPORT_PATH = args[1];

if (isNaN(USER_ID)) {
  console.error('Error: user_id must be a number');
  process.exit(1);
}

interface Message {
  role: 'user' | 'model';
  content: string;
  timestamp: number;
}

async function supabaseQuery(table: string, method: string, body?: any, query?: string): Promise<any> {
  const url = `${SUPABASE_URL}/rest/v1/${table}${query || ''}`;
  const headers: Record<string, string> = {
    'apikey': SUPABASE_KEY!,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': method === 'POST' ? 'return=minimal' : 'return=representation',
  };

  const response = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Supabase error: ${response.status} ${text}`);
  }

  if (method === 'GET') {
    return response.json();
  }
  return null;
}

function extractActualResponse(text: string): string {
  // AI Studio sometimes includes thinking blocks, extract actual response
  
  // Pattern 1: <output>...</output> tags
  const outputMatch = text.match(/<output>([\s\S]*?)<\/output>/);
  if (outputMatch) {
    return outputMatch[1].trim();
  }

  // Pattern 2: Text after thinking block markers
  const thinkingEndMarkers = ['</thinking>', '---', '***'];
  for (const marker of thinkingEndMarkers) {
    const idx = text.lastIndexOf(marker);
    if (idx !== -1 && idx < text.length - marker.length - 50) {
      const afterMarker = text.slice(idx + marker.length).trim();
      if (afterMarker.length > 100) {
        return afterMarker;
      }
    }
  }

  // Pattern 3: If text starts with internal monologue indicators, try to find the actual response
  const internalIndicators = ['Okay,', 'Let me', 'I need to', 'Hmm,', 'So,', 'Alright,'];
  const startsWithInternal = internalIndicators.some(ind => text.startsWith(ind));
  
  if (startsWithInternal) {
    // Look for paragraph break that might indicate start of actual response
    const paragraphs = text.split(/\n\n+/);
    if (paragraphs.length > 2) {
      // Take the last substantial paragraphs (likely the actual response)
      const lastParagraphs = paragraphs.slice(-Math.ceil(paragraphs.length / 2));
      const joined = lastParagraphs.join('\n\n').trim();
      if (joined.length > 100) {
        return joined;
      }
    }
  }

  // No thinking detected, return as-is
  return text;
}

async function importHistory() {
  console.log(`Importing AI Studio history for user ${USER_ID}`);
  console.log(`Reading from: ${EXPORT_PATH}`);
  console.log('');

  // Read export file
  let exportData: any;
  try {
    const content = fs.readFileSync(EXPORT_PATH, 'utf-8');
    exportData = JSON.parse(content);
  } catch (error: any) {
    console.error(`Failed to read export file: ${error.message}`);
    process.exit(1);
  }

  // Parse messages from AI Studio format
  const messages: Message[] = [];
  
  // AI Studio export format varies, try different structures
  let rawMessages: any[] = [];
  
  if (Array.isArray(exportData)) {
    rawMessages = exportData;
  } else if (exportData.messages) {
    rawMessages = exportData.messages;
  } else if (exportData.contents) {
    rawMessages = exportData.contents;
  } else if (exportData.history) {
    rawMessages = exportData.history;
  } else {
    console.error('Unknown export format. Expected array or object with messages/contents/history field.');
    console.error('Keys found:', Object.keys(exportData));
    process.exit(1);
  }

  console.log(`Found ${rawMessages.length} raw messages`);

  // Process messages
  let baseTimestamp = Date.now() - rawMessages.length * 60000; // Space messages 1 minute apart
  
  for (let i = 0; i < rawMessages.length; i++) {
    const msg = rawMessages[i];
    
    // Extract role
    let role: 'user' | 'model';
    if (msg.role === 'user' || msg.role === 'human') {
      role = 'user';
    } else if (msg.role === 'model' || msg.role === 'assistant' || msg.role === 'ai') {
      role = 'model';
    } else {
      console.warn(`Skipping message with unknown role: ${msg.role}`);
      continue;
    }

    // Extract content
    let content: string;
    if (typeof msg.content === 'string') {
      content = msg.content;
    } else if (msg.parts && Array.isArray(msg.parts)) {
      content = msg.parts
        .filter((p: any) => p.text)
        .map((p: any) => p.text)
        .join('\n');
    } else if (msg.text) {
      content = msg.text;
    } else {
      console.warn(`Skipping message with no content at index ${i}`);
      continue;
    }

    // For model responses, extract actual response (skip thinking)
    if (role === 'model') {
      content = extractActualResponse(content);
    }

    // Skip empty messages
    if (!content.trim()) {
      continue;
    }

    messages.push({
      role,
      content: content.trim(),
      timestamp: baseTimestamp + i * 60000,
    });
  }

  console.log(`Processed ${messages.length} messages (after filtering)`);

  if (messages.length === 0) {
    console.log('No messages to import.');
    return;
  }

  // Check existing messages
  const existing = await supabaseQuery(
    'chat_history',
    'GET',
    undefined,
    `?user_id=eq.${USER_ID}&select=id&limit=1`
  );

  if (existing && existing.length > 0) {
    console.log('');
    console.log('Warning: User already has chat history in the database.');
    console.log('Importing will ADD to existing history, not replace it.');
    console.log('');
    console.log('Press Ctrl+C to cancel, or wait 5 seconds to continue...');
    await new Promise(resolve => setTimeout(resolve, 5000));
  }

  // Import in batches
  const BATCH_SIZE = 100;
  let imported = 0;

  for (let i = 0; i < messages.length; i += BATCH_SIZE) {
    const batch = messages.slice(i, i + BATCH_SIZE).map(msg => ({
      user_id: USER_ID,
      role: msg.role,
      content: msg.content,
      timestamp: msg.timestamp,
      is_compressed: false,
    }));

    await supabaseQuery('chat_history', 'POST', batch);
    imported += batch.length;
    console.log(`Imported ${imported}/${messages.length} messages...`);
  }

  console.log('');
  console.log(`Successfully imported ${imported} messages!`);
  console.log('');
  console.log('Summary:');
  console.log(`  User messages: ${messages.filter(m => m.role === 'user').length}`);
  console.log(`  Model responses: ${messages.filter(m => m.role === 'model').length}`);
}

importHistory().catch(error => {
  console.error('Import failed:', error);
  process.exit(1);
});
