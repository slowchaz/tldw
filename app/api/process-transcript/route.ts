import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

export const runtime = 'nodejs';

type TranscriptSegment = {
	start: number;
	end: number;
	startTime: string;
	endTime: string;
	text: string;
};

type Chapter = {
	start_time: number; // seconds
	end_time?: number; // seconds
	title: string;
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

// Function to find timestamp for a quote in transcript segments
function findQuoteTimestamp(quote: string, segments: TranscriptSegment[]): number {
	try {
		// Clean the quote for matching (remove extra punctuation, normalize spaces)
		const cleanQuote = quote.toLowerCase()
			.replace(/[.,!?;:]/g, '')
			.replace(/\s+/g, ' ')
			.trim();

		// First try exact match
		for (const segment of segments) {
			const cleanSegmentText = segment.text.toLowerCase()
				.replace(/[.,!?;:]/g, '')
				.replace(/\s+/g, ' ')
				.trim();
			
			if (cleanSegmentText.includes(cleanQuote)) {
				return segment.start;
			}
		}

		// If no exact match, try fuzzy matching (look for key phrases)
		const quoteWords = cleanQuote.split(' ').filter(word => word.length > 3);
		let bestMatch = { segment: null as TranscriptSegment | null, score: 0 };

		for (const segment of segments) {
			const cleanSegmentText = segment.text.toLowerCase()
				.replace(/[.,!?;:]/g, '')
				.replace(/\s+/g, ' ')
				.trim();
			
			let matchCount = 0;
			for (const word of quoteWords) {
				if (cleanSegmentText.includes(word)) {
					matchCount++;
				}
			}
			
			const score = matchCount / quoteWords.length;
			if (score > bestMatch.score && score > 0.5) {
				bestMatch = { segment, score };
			}
		}

		return bestMatch.segment ? bestMatch.segment.start : 0;
	} catch (error) {
		console.error('Error finding quote timestamp:', error);
		return 0;
	}
}

function parseSupportingQuotes(content: string): { title: string; directQuote: string; timestamp: number }[] {
	try {
		// Try to parse as JSON first
		const parsed = JSON.parse(content);
		if (parsed && Array.isArray(parsed.items)) {
			return parsed.items.map((item: any) => ({
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
				return parsed.items.map((item: any) => ({
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



export async function POST(request: NextRequest) {
	try {
		const body = await request.json();
		const segments: TranscriptSegment[] = Array.isArray(body?.segments)
			? body.segments
			: [];
		const chapters: Chapter[] = Array.isArray(body?.chapters)
			? body.chapters
			: [];

		if (!segments.length) {
			return NextResponse.json(
				{ error: 'segments are required' },
				{ status: 400 }
			);
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

		// Use parallel Hook Quote Hunter and Principle Distiller approach
		console.log('Using parallel Hook Quote Hunter and Principle Distiller approach');

		// Prepare segments (sample if too large)
		const selectedSegments = prepareSegments(segments);

		// Run both prompts in parallel
		const hookQuotePrompt = buildHookQuotePrompt(selectedSegments);
		const principleDistillerPrompt = buildPrincipleDistillerPrompt(selectedSegments);

		const [hookQuoteResponse, principlesResponse] = await Promise.all([
			anthropic.messages.create({
				model: model,
				max_tokens: 3000,
				temperature: 1,
				thinking: {
					type: "enabled",
					budget_tokens: 2000
				},
				system:
					'You are a Hook Quote Hunter. Analyze the transcript carefully and return only strict JSON with the best hook quote and its timestamp. No extra text.',
				messages: [
					{
						role: 'user',
						content: hookQuotePrompt,
					},
				],
			}),
			anthropic.messages.create({
				model: model,
				max_tokens: 2000,
				temperature: 1,
				thinking: {
					type: "enabled",
					budget_tokens: 1500
				},
				system:
					'You are a Principle Distiller. Extract punchy, actionable principles that work as Twitter thread headlines.',
				messages: [
					{
						role: 'user',
						content: principleDistillerPrompt,
					},
				],
			})
		]);

		// Parse hook quote
		let hookQuoteContent: string = '';
		for (const content of hookQuoteResponse.content) {
			if (content.type === 'text') {
				hookQuoteContent = content.text;
				break;
			}
		}
		
		const hookQuoteResult = parseHookQuote(hookQuoteContent);
		if (!hookQuoteResult) {
			return NextResponse.json(
				{ error: 'Failed to parse hook quote response' },
				{ status: 500 }
			);
		}

		// Parse principles
		let principlesContent: string = '';
		for (const content of principlesResponse.content) {
			if (content.type === 'text') {
				principlesContent = content.text;
				break;
			}
		}
		
		const principles = parsePrinciples(principlesContent);
		if (principles.length === 0) {
			return NextResponse.json(
				{ error: 'Failed to parse principles response' },
				{ status: 500 }
			);
		}

		// Step 3: Find supporting quotes for each principle
		console.log('Finding supporting quotes for principles...');
		const supportingQuotesPrompt = buildSupportingQuotesPrompt(selectedSegments, principles);

		const supportingQuotesResponse = await anthropic.messages.create({
			model: model,
			max_tokens: 3000,
			temperature: 1,
			thinking: {
				type: "enabled",
				budget_tokens: 2000
			},
			system:
				'You are a Quote Matcher. Find the best supporting quotes from the transcript for each principle and return only strict JSON with quotes and timestamps. No extra text.',
			messages: [
				{
					role: 'user',
					content: supportingQuotesPrompt,
				},
			],
		});

		// Parse supporting quotes
		let supportingQuotesContent: string = '';
		for (const content of supportingQuotesResponse.content) {
			if (content.type === 'text') {
				supportingQuotesContent = content.text;
				break;
			}
		}
		
		const supportingQuotesItems = parseSupportingQuotes(supportingQuotesContent);
		
		// If parsing fails, fall back to principles without quotes
		const finalItems = supportingQuotesItems.length > 0 
			? supportingQuotesItems.map(item => ({
				title: item.title,
				start: item.timestamp,
				end: item.timestamp + 30, // Add 30 seconds for quote duration
				directQuote: item.directQuote,
			}))
			: principles.map(principle => ({
				title: principle,
				start: 0,
				end: 0,
				directQuote: '', // Fallback if quote matching fails
			}));

		const finalOutline: OutlineResponse = {
			hookQuote: hookQuoteResult.quote,
			hookQuoteTimestamp: hookQuoteResult.timestamp,
			items: finalItems,
		};

		return NextResponse.json({ success: true, outline: finalOutline });
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
