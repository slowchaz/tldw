import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { 
	getProcessedContent, 
	saveProcessedContent
} from '../../../lib/database';
import { 
	splitIntoSentences, 
	mergeShortSentences, 
	analyzeSentenceStats,
	pruneSentences,
	Chapter
} from '../../../lib/sentence-processor';

export const runtime = 'nodejs';

type TranscriptSegment = {
	start: number;
	end: number;
	startTime: string;
	endTime: string;
	text: string;
};



type OutlineItem = {
	title: string;
	start: number;
	end?: number;
	directQuote: string;
};

type OutlineResponse = {
	hookQuote: string;
	hookQuoteTimestamp: number;
	items: OutlineItem[];
};

// Token estimation functions
function estimateTokens(text: string): number {
	// Rough estimation: ~4 characters per token for English text
	return Math.ceil(text.length / 4);
}

function estimateSegmentTokens(segments: TranscriptSegment[]): number {
	const json = JSON.stringify(segments);
	return estimateTokens(json);
}

// Chunking configuration
const CHUNK_SIZE = 800; // segments per chunk
const OVERLAP = 100; // segments to overlap between chunks

// Create overlapping chunks from segments
function createChunks(segments: TranscriptSegment[]): TranscriptSegment[][] {
	const chunks: TranscriptSegment[][] = [];
	
	for (let i = 0; i < segments.length; i += CHUNK_SIZE - OVERLAP) {
		const chunk = segments.slice(i, i + CHUNK_SIZE);
		
		// Skip if chunk is too small (less than 50 segments)
		if (chunk.length < 50 && chunks.length > 0) {
			// Merge small remaining chunk with the last chunk
			const lastChunk = chunks[chunks.length - 1];
			chunks[chunks.length - 1] = [...lastChunk, ...chunk];
			break;
		}
		
		chunks.push(chunk);
	}
	
	return chunks;
}

function prepareSegments(segments: TranscriptSegment[]): TranscriptSegment[] {
	// For backwards compatibility with smaller transcripts
	const totalTokens = estimateSegmentTokens(segments);
	const MAX_TOKENS = 45000; // Conservative limit

	if (totalTokens <= MAX_TOKENS) {
		return segments; // No chunking needed
	}

	// For large transcripts, this function is now used only for single-chunk processing
	// The main chunking logic is handled by createChunks()
	const MAX_SEGMENTS = 600;
	let selected: TranscriptSegment[] = segments;
	if (segments.length > MAX_SEGMENTS) {
		const total = segments.length;
		const picks: TranscriptSegment[] = [];
		for (let i = 0; i < MAX_SEGMENTS; i++) {
			const idx = Math.round((i * (total - 1)) / (MAX_SEGMENTS - 1));
			picks.push(segments[idx]);
		}
		selected = picks;
	}
	return selected;
}

// Hook Quote Hunter function
function buildHookQuotePrompt(segments: TranscriptSegment[]): string {
	const instruction = `You are a Hook Quote Hunter. Your job is to find THE perfect hook quote from this video transcript - the one quote that will stop people scrolling and make them want to read the entire write-up.

WHAT MAKES A GREAT HOOK QUOTE:
- Counterintuitive or surprising ("Creativity is not an ability that you either have or do not have")
- Challenges common assumptions
- Contains wisdom that feels fresh or unexpected
- Makes people think "Wait, what? Tell me more..."
- Captures the essence/thesis of the entire talk
- Stands alone as a complete thought
- 1-2 sentences maximum

EXAMPLES OF GREAT HOOKS:
- "Creativity is not an ability that you either have or do not have. It's absolutely unrelated to IQ, provided you are intelligent above a certain minimal level."
- "The most successful people I know are also the most bored people I know."
- "Your competition isn't other people. Your competition is your distractions."

YOUR TASK:
1. Read through the entire transcript
2. Look for moments where the speaker says something surprising, counterintuitive, or profound
3. Find quotes that capture the core message/thesis
4. Clean up any transcription errors while keeping the exact meaning
5. Select the ONE best hook quote
6. Note the exact timestamp where this quote occurs

OUTPUT FORMAT:
Return only strict JSON matching this format (no extra text):
{
  "hookQuote": "The exact hook quote text here",
  "timestamp": 123
}

Replace 123 with the actual timestamp in seconds from the transcript where the quote occurs.`;

	return `${instruction}\nTRANSCRIPT_SEGMENTS_JSON = ${JSON.stringify(
		segments
	)}`;
}

// Principle Distiller function
function buildPrincipleDistillerPrompt(segments: TranscriptSegment[]): string {
	const instruction = `You are a Principle Distiller. Your job is to extract 6-8 punchy, actionable principles from this video transcript that would work perfectly as Twitter thread headlines.

WHAT MAKES A GREAT PRINCIPLE:
- Short and punchy (3-8 words maximum)
- Written as imperatives/commands ("Find your inner child", "Escape 'normal' life")
- Universal and actionable (anyone can apply them)
- Thought-provoking and memorable
- NOT generic advice ("Be creative", "Work hard")
- Captures a specific insight from the transcript

EXAMPLES OF GREAT PRINCIPLES:
- "Find your inner child" (4 words)
- "Escape 'normal' life" (3 words)
- "Learn to tolerate the discomfort of not knowing" (8 words)
- "Give yourself time" (3 words)
- "Embrace mistakes as part of the process" (7 words)
- "Use your subconscious" (3 words)
- "Collaborate" (1 word)

EXAMPLES OF BAD PRINCIPLES:
- "Be more creative" (too generic)
- "Understanding the importance of creativity in modern workplaces" (too long, not imperative)
- "Think about thinking" (too vague)

YOUR TASK:
1. Read through the entire transcript
2. Identify 6-8 distinct, valuable insights
3. Convert each insight into a short, punchy imperative
4. Ensure each principle is actionable and memorable
5. Avoid overlap between principles

OUTPUT FORMAT:
Return only the principles, one per line, no additional text:`;

	return `${instruction}\nTRANSCRIPT_SEGMENTS_JSON = ${JSON.stringify(
		segments
	)}`;
}

function parseHookQuote(content: string): { quote: string; timestamp: number } | null {
	try {
		// Try to parse as JSON first
		const parsed = JSON.parse(content);
		if (parsed && typeof parsed.hookQuote === 'string' && typeof parsed.timestamp === 'number') {
			return { quote: parsed.hookQuote, timestamp: parsed.timestamp };
		}
	} catch {}
	
	// Try to extract JSON from response if Claude added extra text
	const jsonStart = content.indexOf('{');
	const jsonEnd = content.lastIndexOf('}');
	if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
		try {
			const parsed = JSON.parse(content.slice(jsonStart, jsonEnd + 1));
			if (parsed && typeof parsed.hookQuote === 'string' && typeof parsed.timestamp === 'number') {
				return { quote: parsed.hookQuote, timestamp: parsed.timestamp };
			}
		} catch {}
	}
	
	console.error('Failed to parse hook quote JSON:', content);
	return null;
}

function parsePrinciples(content: string): string[] {
	try {
		// Split by lines and filter out empty lines
		const lines = content.split('\n')
			.map(line => line.trim())
			.filter(line => line.length > 0)
			.filter(line => !line.startsWith('TRANSCRIPT_SEGMENTS_JSON')) // Remove any leftover prompt text
			.slice(0, 8); // Limit to max 8 principles

		return lines;
	} catch (error) {
		console.error('Error parsing principles:', error);
		return [];
	}
}

// Supporting Quotes function
function buildSupportingQuotesPrompt(
	segments: TranscriptSegment[],
	principles: string[]
): string {
	const principlesList = principles.map((p, i) => `${i + 1}. ${p}`).join('\n');

	const instruction = `You are a Quote Matcher. Your job is to find the perfect supporting quote from the transcript for each given principle. Each quote should directly support and illustrate the principle.

WHAT MAKES A GREAT SUPPORTING QUOTE:
- Directly relates to and supports the principle
- 1-2 sentences maximum (~50 words or less)
- Clean, grammatically correct (fix transcription errors)
- Stands alone and makes sense out of context
- Contains concrete examples or vivid language when possible
- NOT just a restatement of the principle

IMPORTANT: TEMPORAL DISTRIBUTION
- Select quotes that are distributed across the ENTIRE video timeline
- Avoid clustering all quotes from the beginning of the video
- Look for insights throughout the full transcript, not just early content
- The video may have valuable insights in the middle and end sections

EXAMPLES FROM JOHN CLEESE TALK:
Principle: "Find your inner child"
Good Quote: "Kenan McKinnon described [creativity] as an ability to play. He described the most creative as being childlike, for they were able to play with ideas and explore them, not for any immediate practical purpose, but just for enjoyment."

Principle: "Give yourself time"
Good Quote: "Before you make a decision, always ask yourself the question: When does this decision have to be made? And having answered that, defer the decision until then in order to give yourself maximum pondering time."

YOUR TASK:
For each principle provided:
1. Search the transcript for content that directly supports this principle
2. Find the best quote that illustrates or explains this concept
3. Clean up any transcription errors while preserving the exact meaning
4. Ensure the quote is concise but complete
5. Note the exact timestamp where this quote occurs
6. Consider the natural flow and progression of ideas as they appear chronologically in the video

PRINCIPLES TO MATCH:
${principlesList}

OUTPUT FORMAT:
Return only strict JSON matching this format (no extra text):
{
  "items": [
    {
      "title": "First principle title",
      "quote": "Supporting quote for first principle",
      "timestamp": 245
    },
    {
      "title": "Second principle title", 
      "quote": "Supporting quote for second principle",
      "timestamp": 567
    }
  ]
}

Replace the timestamps with actual seconds from the transcript where each quote occurs.`;

	return `${instruction}\nTRANSCRIPT_SEGMENTS_JSON = ${JSON.stringify(
		segments
	)}`;
}



function parseSupportingQuotes(content: string): { title: string; directQuote: string; timestamp: number }[] {
	try {
		// Try to parse as JSON first
		const parsed = JSON.parse(content);
		if (parsed && Array.isArray(parsed.items)) {
			return parsed.items.map((item: { title?: string; quote?: string; timestamp?: number }) => ({
				title: item.title || '',
				directQuote: item.quote || '',
				timestamp: item.timestamp || 0,
			}));
		}
	} catch {}
	
	// Try to extract JSON from response if Claude added extra text
	const jsonStart = content.indexOf('{');
	const jsonEnd = content.lastIndexOf('}');
	if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
		try {
			const parsed = JSON.parse(content.slice(jsonStart, jsonEnd + 1));
			if (parsed && Array.isArray(parsed.items)) {
				return parsed.items.map((item: { title?: string; quote?: string; timestamp?: number }) => ({
					title: item.title || '',
					directQuote: item.quote || '',
					timestamp: item.timestamp || 0,
				}));
			}
		} catch {}
	}
	
	console.error('Failed to parse supporting quotes JSON:', content);
	return [];
}

// Process a single chunk to extract principles and quotes
async function processChunk(
	chunk: TranscriptSegment[], 
	anthropic: Anthropic, 
	model: string,
	chunkIndex: number
): Promise<{ principles: string[]; quotes: { title: string; directQuote: string; timestamp: number }[] }> {
	console.log(`Processing chunk ${chunkIndex + 1} with ${chunk.length} segments`);
	
	// Build prompts for this chunk
	const principleDistillerPrompt = buildPrincipleDistillerPrompt(chunk);
	
	// Get principles for this chunk
	const principlesResponse = await anthropic.messages.create({
		model: model,
		max_tokens: 2000,
		temperature: 1,
		system: 'You are a Principle Distiller. Extract punchy, actionable principles that work as Twitter thread headlines.',
		messages: [
			{
				role: 'user',
				content: principleDistillerPrompt,
			},
		],
	});
	
	// Parse principles
	let principlesContent = '';
	for (const content of principlesResponse.content) {
		if (content.type === 'text') {
			principlesContent = content.text;
			break;
		}
	}
	
	console.log(`=== CHUNK ${chunkIndex + 1} PRINCIPLES LLM RESPONSE ===`);
	console.log('Raw response:', principlesContent);
	console.log('=== END CHUNK PRINCIPLES RESPONSE ===');
	
	const principles = parsePrinciples(principlesContent);
	console.log(`Chunk ${chunkIndex + 1} extracted principles:`, principles);
	
	if (principles.length === 0) {
		console.warn(`No principles found in chunk ${chunkIndex + 1}`);
		return { principles: [], quotes: [] };
	}
	
	// Get supporting quotes for principles in this chunk
	const supportingQuotesPrompt = buildSupportingQuotesPrompt(chunk, principles);
	
	const supportingQuotesResponse = await anthropic.messages.create({
		model: model,
		max_tokens: 3000,
		temperature: 1,
				system: 'You are a Quote Matcher. Find the best supporting quotes from the transcript for each principle and return only strict JSON with quotes and timestamps. IMPORTANT: Select quotes distributed across the entire video timeline, not just from early content. No extra text.',
		messages: [
			{
				role: 'user',
				content: supportingQuotesPrompt,
			},
		],
	});
	
	// Parse supporting quotes
	let supportingQuotesContent = '';
	for (const content of supportingQuotesResponse.content) {
		if (content.type === 'text') {
			supportingQuotesContent = content.text;
			break;
		}
	}
	
	console.log(`=== CHUNK ${chunkIndex + 1} SUPPORTING QUOTES LLM RESPONSE ===`);
	console.log('Raw response:', supportingQuotesContent);
	console.log('=== END CHUNK SUPPORTING QUOTES RESPONSE ===');
	
	const supportingQuotesItems = parseSupportingQuotes(supportingQuotesContent);
	console.log(`Chunk ${chunkIndex + 1} extracted quotes:`, supportingQuotesItems.map(q => ({ title: q.title, timestamp: q.timestamp, quote: q.directQuote.substring(0, 50) + '...' })));
	
	console.log(`Chunk ${chunkIndex + 1} extracted ${principles.length} principles and ${supportingQuotesItems.length} quotes`);
	
	return {
		principles,
		quotes: supportingQuotesItems
	};
}

// Merge results from multiple chunks
function mergeChunkResults(
	chunkResults: { principles: string[]; quotes: { title: string; directQuote: string; timestamp: number }[] }[]
): { principles: string[]; quotes: { title: string; directQuote: string; timestamp: number }[] } {
	const allPrinciples: string[] = [];
	const allQuotes: { title: string; directQuote: string; timestamp: number }[] = [];
	
	// Collect all principles and quotes
	for (const result of chunkResults) {
		allPrinciples.push(...result.principles);
		allQuotes.push(...result.quotes);
	}
	
	// Remove duplicate principles (case-insensitive)
	const uniquePrinciples: string[] = [];
	const seenPrinciples = new Set<string>();
	
	for (const principle of allPrinciples) {
		const normalized = principle.toLowerCase().trim();
		if (!seenPrinciples.has(normalized)) {
			seenPrinciples.add(normalized);
			uniquePrinciples.push(principle);
		}
	}
	
	// Remove duplicate quotes (by timestamp and similar content)
	const uniqueQuotes: { title: string; directQuote: string; timestamp: number }[] = [];
	const seenQuotes = new Set<string>();
	
	for (const quote of allQuotes) {
		// Create a key based on timestamp and first 50 chars of quote
		const key = `${quote.timestamp}-${quote.directQuote.substring(0, 50).toLowerCase()}`;
		if (!seenQuotes.has(key)) {
			seenQuotes.add(key);
			uniqueQuotes.push(quote);
		}
	}
	
	// Sort quotes by timestamp
	uniqueQuotes.sort((a, b) => a.timestamp - b.timestamp);
	
	// Limit to best 8 principles and 8 quotes
	const finalPrinciples = uniquePrinciples.slice(0, 8);
	const finalQuotes = uniqueQuotes.slice(0, 8);
	
	console.log(`Merged results: ${finalPrinciples.length} principles, ${finalQuotes.length} quotes`);
	
	return {
		principles: finalPrinciples,
		quotes: finalQuotes
	};
}


export async function POST(request: NextRequest) {
	try {
		const body = await request.json();
		const segments: TranscriptSegment[] = Array.isArray(body?.segments)
			? body.segments
			: [];

		const videoId: string = body?.videoId || '';

		console.log('Process-transcript request received:', {
			segmentsLength: segments.length,
			videoId: videoId || 'NO_VIDEO_ID',
			hasVideoId: !!videoId
		});

		if (!segments.length) {
			return NextResponse.json(
				{ error: 'segments are required' },
				{ status: 400 }
			);
		}

		// Check if we already have processed content for this video and get chapters
		let chapters: Chapter[] = [];
		if (videoId) {
			console.log('Checking database for existing processed content for videoId:', videoId);
			const existingContent = getProcessedContent(videoId);
			if (existingContent) {
				console.log('Found cached processed content for video:', videoId, {
					hookQuote: existingContent.hookQuote.substring(0, 50) + '...',
					principlesCount: existingContent.principles.length
				});
				return NextResponse.json({
					success: true,
					outline: {
						hookQuote: existingContent.hookQuote,
						hookQuoteTimestamp: existingContent.hookQuoteTimestamp,
						items: existingContent.principles,
					},
				}, {
					headers: {
						'Cache-Control': 'no-cache, no-store, must-revalidate',
						'Pragma': 'no-cache',
						'Expires': '0'
					}
				});
			} else {
				console.log('No cached processed content found for videoId:', videoId);
				// Get chapters from the transcript data
				const { getVideoWithContent } = await import('../../../lib/database');
				const videoData = getVideoWithContent(videoId);
				chapters = videoData.transcript?.chapters || [];
				if (chapters.length > 0) {
					console.log(`Found ${chapters.length} chapters in database:`, chapters.map(c => c.title));
				}
			}
		}

		const apiKey = process.env.ANTHROPIC_API_KEY;
		if (!apiKey) {
			return NextResponse.json(
				{ error: 'Missing ANTHROPIC_API_KEY server configuration' },
				{ status: 500 }
			);
		}

		const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514';
		const anthropic = new Anthropic({ apiKey: apiKey });

		// PHASE 1 & 2: Sentence processing and heuristic pruning
		console.log('=== PHASE 1+2: SENTENCE PROCESSING & PRUNING ===');
		const sentences = splitIntoSentences(segments);
		const mergedSentences = mergeShortSentences(sentences, 5);
		
		// PHASE 2: Heuristic pruning - this is where we get 70-85% cost reduction
		const prunedSentences = pruneSentences(mergedSentences, 400, chapters);
		
		const stats = analyzeSentenceStats(segments, prunedSentences);
		console.log('Final processing stats:', {
			originalSegments: stats.originalCount,
			afterPruning: stats.sentenceCount,
			reductionRatio: `${((1 - stats.reductionRatio) * 100).toFixed(1)}% reduction`,
			avgWordsPerSentence: stats.avgWordsPerSentence.toFixed(1),
			estimatedTokenReduction: `${((1 - stats.reductionRatio) * 100).toFixed(0)}%`
		});
		
		// Convert pruned sentences back to TranscriptSegment format for Claude
		const formatTimestamp = (seconds: number): string => {
			const hours = Math.floor(seconds / 3600);
			const minutes = Math.floor((seconds % 3600) / 60);
			const secs = Math.floor(seconds % 60);
			const ms = Math.floor((seconds % 1) * 1000);
			return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
		};
		
		const prunedSegments: TranscriptSegment[] = prunedSentences.map(s => ({
			start: s.start,
			end: s.end,
			startTime: formatTimestamp(s.start),
			endTime: formatTimestamp(s.end),
			text: s.text
		}));
		
		console.log(`Using ${prunedSegments.length} segments instead of ${segments.length} (${((prunedSegments.length / segments.length) * 100).toFixed(1)}% of original)`);
		console.log('=== END PHASE 1+2 ===');

		// Determine processing strategy based on PRUNED transcript size
		const totalTokens = estimateSegmentTokens(prunedSegments);
		const isLargeTranscript = totalTokens > 45000 || prunedSegments.length > 600;
		
		console.log(`After pruning: ${totalTokens} estimated tokens (was ~${estimateSegmentTokens(segments)} before pruning)`);

		let hookQuoteResult: { quote: string; timestamp: number };
		let finalItems: OutlineItem[];

		if (isLargeTranscript) {
			console.log(`Large transcript detected (${segments.length} segments, ~${totalTokens} tokens). Using chunking approach.`);
			
			// Create chunks from pruned segments
			const chunks = createChunks(prunedSegments);
			console.log(`Created ${chunks.length} chunks for processing`);
			
			// Process hook quote with pruned segments
			const hookQuoteSegments = prepareSegments(prunedSegments);
			const hookQuotePrompt = buildHookQuotePrompt(hookQuoteSegments);
			
			const hookQuoteResponse = await anthropic.messages.create({
				model: model,
				max_tokens: 3000,
				temperature: 1,
				system: 'You are a Hook Quote Hunter. Analyze the transcript carefully and return only strict JSON with the best hook quote and its timestamp. No extra text.',
				messages: [{ role: 'user', content: hookQuotePrompt }],
			});
			
			let hookQuoteContent = '';
			for (const content of hookQuoteResponse.content) {
				if (content.type === 'text') {
					hookQuoteContent = content.text;
					break;
				}
			}
			
			const parsedHookQuote = parseHookQuote(hookQuoteContent);
			if (!parsedHookQuote) {
				return NextResponse.json({ error: 'Failed to parse hook quote response' }, { status: 500 });
			}
			hookQuoteResult = parsedHookQuote;
			
			// Process chunks sequentially to avoid rate limits
			const chunkResults = [];
			for (let i = 0; i < chunks.length; i++) {
				try {
					const result = await processChunk(chunks[i], anthropic, model, i);
					chunkResults.push(result);
					
					// Add small delay between chunks to avoid rate limits
					if (i < chunks.length - 1) {
						await new Promise(resolve => setTimeout(resolve, 1000));
					}
				} catch (error) {
					console.error(`Error processing chunk ${i + 1}:`, error);
					// Continue with other chunks even if one fails
				}
			}
			
			// Merge results from all chunks
			const mergedResults = mergeChunkResults(chunkResults);
			
			// Create final items from merged results
			finalItems = mergedResults.quotes.length > 0 
				? mergedResults.quotes.map(item => ({
					title: item.title,
					start: item.timestamp,
					end: item.timestamp + 30,
					directQuote: item.directQuote,
				}))
				: mergedResults.principles.map(principle => ({
					title: principle,
					start: 0,
					end: 0,
					directQuote: '',
				}));
				
		} else {
			console.log(`Standard transcript size (${segments.length} segments). Using parallel approach.`);
			
			// Use existing parallel approach for smaller transcripts
			const selectedSegments = prepareSegments(prunedSegments);
			const hookQuotePrompt = buildHookQuotePrompt(selectedSegments);
			const principleDistillerPrompt = buildPrincipleDistillerPrompt(selectedSegments);

			const [hookQuoteResponse, principlesResponse] = await Promise.all([
				anthropic.messages.create({
					model: model,
					max_tokens: 3000,
					temperature: 1,
					system: 'You are a Hook Quote Hunter. Analyze the transcript carefully and return only strict JSON with the best hook quote and its timestamp. No extra text.',
					messages: [{ role: 'user', content: hookQuotePrompt }],
				}),
				anthropic.messages.create({
					model: model,
					max_tokens: 2000,
					temperature: 1,
					system: 'You are a Principle Distiller. Extract punchy, actionable principles that work as Twitter thread headlines.',
					messages: [{ role: 'user', content: principleDistillerPrompt }],
				})
			]);

			// Parse hook quote
			let hookQuoteContent = '';
			for (const content of hookQuoteResponse.content) {
				if (content.type === 'text') {
					hookQuoteContent = content.text;
					break;
				}
			}
			
			const parsedHookQuote = parseHookQuote(hookQuoteContent);
			if (!parsedHookQuote) {
				return NextResponse.json({ error: 'Failed to parse hook quote response' }, { status: 500 });
			}
			hookQuoteResult = parsedHookQuote;

			// Parse principles
			let principlesContent = '';
			for (const content of principlesResponse.content) {
				if (content.type === 'text') {
					principlesContent = content.text;
					break;
				}
			}
			
			console.log('=== SINGLE TRANSCRIPT PRINCIPLES LLM RESPONSE ===');
			console.log('Raw response:', principlesContent);
			console.log('=== END SINGLE TRANSCRIPT PRINCIPLES RESPONSE ===');
			
			const principles = parsePrinciples(principlesContent);
			console.log('Single transcript extracted principles:', principles);
			if (principles.length === 0) {
				return NextResponse.json({ error: 'Failed to parse principles response' }, { status: 500 });
			}

			// Find supporting quotes
			const supportingQuotesPrompt = buildSupportingQuotesPrompt(selectedSegments, principles);
			const supportingQuotesResponse = await anthropic.messages.create({
				model: model,
				max_tokens: 3000,
				temperature: 1,
				system: 'You are a Quote Matcher. Find the best supporting quotes from the transcript for each principle and return only strict JSON with quotes and timestamps. IMPORTANT: Select quotes distributed across the entire video timeline, not just from early content. No extra text.',
				messages: [{ role: 'user', content: supportingQuotesPrompt }],
			});

			let supportingQuotesContent = '';
			for (const content of supportingQuotesResponse.content) {
				if (content.type === 'text') {
					supportingQuotesContent = content.text;
					break;
				}
			}
			
			const supportingQuotesItems = parseSupportingQuotes(supportingQuotesContent);
			
			finalItems = supportingQuotesItems.length > 0 
				? supportingQuotesItems.map(item => ({
					title: item.title,
					start: item.timestamp,
					end: item.timestamp + 30,
					directQuote: item.directQuote,
				}))
				: principles.map(principle => ({
					title: principle,
					start: 0,
					end: 0,
					directQuote: '',
				}));
		}

		// Sort items chronologically by timestamp
		console.log('=== FINAL RESULTS BEFORE SORTING ===');
		console.log('Items:', finalItems.map(item => ({ title: item.title, start: item.start, quote: item.directQuote.substring(0, 50) + '...' })));
		finalItems = finalItems.sort((a, b) => a.start - b.start);
		console.log('=== FINAL RESULTS AFTER SORTING ===');
		console.log('Items:', finalItems.map(item => ({ title: item.title, start: item.start, quote: item.directQuote.substring(0, 50) + '...' })));
		
		// Log timestamp distribution analysis
		if (finalItems.length > 0) {
			const videoDuration = segments[segments.length - 1]?.end || 1;
			const timestamps = finalItems.map(item => item.start);
			const firstQuarter = timestamps.filter(t => t < videoDuration * 0.25).length;
			const secondQuarter = timestamps.filter(t => t >= videoDuration * 0.25 && t < videoDuration * 0.5).length;
			const thirdQuarter = timestamps.filter(t => t >= videoDuration * 0.5 && t < videoDuration * 0.75).length;
			const fourthQuarter = timestamps.filter(t => t >= videoDuration * 0.75).length;
			
			console.log('=== TIMESTAMP DISTRIBUTION ANALYSIS ===');
			console.log(`Video duration: ${(videoDuration / 60).toFixed(1)} minutes`);
			console.log(`Q1 (0-25%): ${firstQuarter} quotes`);
			console.log(`Q2 (25-50%): ${secondQuarter} quotes`);
			console.log(`Q3 (50-75%): ${thirdQuarter} quotes`);
			console.log(`Q4 (75-100%): ${fourthQuarter} quotes`);
			console.log('Quote timestamps (minutes):', timestamps.map(t => (t / 60).toFixed(1)));
			console.log('=== END TIMESTAMP ANALYSIS ===');
		}

		const finalOutline: OutlineResponse = {
			hookQuote: hookQuoteResult.quote,
			hookQuoteTimestamp: hookQuoteResult.timestamp,
			items: finalItems,
		};

		// Save processed content to database if we have a videoId
		if (videoId) {
			try {
				console.log('Attempting to save processed content for videoId:', videoId);
				const savedContent = saveProcessedContent({
					videoId,
					hookQuote: hookQuoteResult.quote,
					hookQuoteTimestamp: hookQuoteResult.timestamp,
					principles: finalItems,
				});
				console.log('Successfully saved processed content to database:', {
					videoId,
					savedContentId: savedContent.id,
					principlesCount: finalItems.length
				});
			} catch (dbError) {
				console.error('Failed to save processed content to database:', {
					videoId,
					error: dbError,
					errorMessage: dbError instanceof Error ? dbError.message : 'Unknown error',
					errorStack: dbError instanceof Error ? dbError.stack : undefined
				});
				// Continue without failing the request
			}
		} else {
			console.warn('No videoId provided, skipping database save');
		}

		return NextResponse.json({ success: true, outline: finalOutline }, {
			headers: {
				'Cache-Control': 'no-cache, no-store, must-revalidate',
				'Pragma': 'no-cache',
				'Expires': '0'
			}
		});
	} catch (error) {
		console.error('process-transcript error:', error);
		return NextResponse.json(
			{
				error:
					error instanceof Error
						? error.message
						: 'Failed to process transcript',
			},
			{ status: 500 }
		);
	}
}
