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

OUTPUT FORMAT:
Return only the hook quote in quotation marks, nothing else.`;

	return `${instruction}\nTRANSCRIPT_SEGMENTS_JSON = ${JSON.stringify(
		segments
	)}`;
}

function parseHookQuote(content: string): string | null {
	try {
		// Look for the hook quote (should be the only quoted text in the response)
		const hookMatch = content.match(/"([^"]+)"/);
		if (!hookMatch) return null;

		return hookMatch[1].trim();
	} catch (error) {
		console.error('Error parsing hook quote:', error);
		return null;
	}
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

		// Use Hook Quote Hunter approach
		console.log('Using Hook Quote Hunter approach');

		// Prepare segments (sample if too large)
		const selectedSegments = prepareSegments(segments);

		// Single hook quote extraction call
		const hookQuotePrompt = buildHookQuotePrompt(selectedSegments);

		const hookQuoteResponse = await anthropic.messages.create({
			model: model,
			max_tokens: 3000,
			temperature: 1,
			thinking: {
				type: "enabled",
				budget_tokens: 2000
			},
			system:
				'You are a Hook Quote Hunter. Analyze the transcript carefully and return only the best hook quote in quotation marks.',
			messages: [
				{
					role: 'user',
					content: hookQuotePrompt,
				},
			],
		});

		console.log('Hook quote response:', JSON.stringify(hookQuoteResponse, null, 2));
		
		// Handle thinking response - the actual response might be in a different content block
		let hookQuoteContent: string = '';
		for (const content of hookQuoteResponse.content) {
			if (content.type === 'text') {
				hookQuoteContent = content.text;
				break;
			}
		}
		
		console.log('Hook quote content:', hookQuoteContent);

		// Parse the hook quote
		const hookQuote = parseHookQuote(hookQuoteContent);
		if (!hookQuote) {
			return NextResponse.json(
				{ error: 'Failed to parse hook quote response' },
				{ status: 500 }
			);
		}

		const finalOutline: OutlineResponse = {
			hookQuote: hookQuote,
			hookQuoteTimestamp: 0,
			items: [], // Will be populated by future prompts
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
