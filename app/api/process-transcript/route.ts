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

type OutlineItem = {
	title: string;
	start: number;
	end?: number;
	summary?: string;
};

type OutlineSection = {
	title: string;
	start: number;
	end?: number;
	items: OutlineItem[];
};

type OutlineResponse = {
	sections: OutlineSection[];
};

function buildInsightsPrompt(segments: TranscriptSegment[]): string {
	// Keep payload size reasonable. If too many segments, sample evenly across the entire video
	const MAX_SEGMENTS = 600; // conservative to avoid oversized requests
	let selected: TranscriptSegment[] = segments;
	if (segments.length > MAX_SEGMENTS) {
		const total = segments.length;
		const picks: TranscriptSegment[] = [];
		// Evenly spaced indices including first and last
		for (let i = 0; i < MAX_SEGMENTS; i++) {
			const idx = Math.round((i * (total - 1)) / (MAX_SEGMENTS - 1));
			picks.push(segments[idx]);
		}
		selected = picks;
	}

	// Calculate video duration for the prompt
	const videoDuration =
		selected.length > 0 ? Math.max(...selected.map((s) => s.end)) : 0;
	const durationMinutes = Math.round(videoDuration / 60);

	const instruction = `You are given a timestamped transcript from a ${durationMinutes}-minute video.
Extract the most insightful, quotable statements that people would want to share and discuss.

CRITICAL: Coverage must span the full ${durationMinutes}-minute video duration. Do not stop at early timestamps.

Your goal: Identify the key insights and memorable statements that capture the essence of what makes this content worth watching.

Requirements:
- Return only strict JSON matching this TypeScript type (no extra text):
  { "sections": Array<{ "title": string; "start": number; "end": number }> }
- 4-10 key insights distributed across the FULL video duration (0 to ~${videoDuration} seconds).
- CRITICAL: NO OVERLAPPING TIMESTAMPS. Each section must have distinct time ranges that don't overlap.
- Sections should be in chronological order with clear gaps between them.
- Section titles should be insightful, quotable statements that capture the core message (e.g., "Success is a system, not a goal", "The compound effect of small decisions", "Why expertise alone isn't enough")
- Focus on actionable insights, profound realizations, counter-intuitive truths, and memorable frameworks
- Use clear, direct language that feels authentic and substantive
- Each section should represent a coherent segment where this insight is discussed
- ENSURE coverage spans the entire video timeline with NO timestamp overlaps.
`;

	console.log(
		`Building outline for ${durationMinutes}-minute video with ${selected.length} segments (${segments.length} original)`
	);
	console.log(
		`Segment time range: ${selected[0]?.start || 0}s - ${
			selected[selected.length - 1]?.end || 0
		}s`
	);

	return `${instruction}\nTRANSCRIPT_SEGMENTS_JSON = ${JSON.stringify(
		selected
	)}`;
}

function buildContextPrompt(
	segments: TranscriptSegment[],
	insight: { title: string; start: number; end: number }
): string {
	// Filter segments to the relevant time range for this insight
	const relevantSegments = segments.filter(
		(s) => s.start >= insight.start && s.end <= insight.end
	);

	const instruction = `You are given a timestamped transcript segment and a main insight statement.
Generate supporting context items that explain and provide evidence for this insight.

INSIGHT: "${insight.title}"
TIME RANGE: ${insight.start}s - ${insight.end}s

Your goal: Create 3-8 supporting items that break down and explain this main insight using specific content from the transcript.

Requirements:
- Return only strict JSON matching this TypeScript type (no extra text):
  { "items": Array<{ "title": string; "start": number; "end"?: number; "summary": string }> }
- Items should have non-overlapping timestamps within the ${insight.start}s - ${insight.end}s range
- Item titles should be concise explanations that break down the main concept (e.g., "Daily habits matter more than motivation", "Small consistent actions compound over time")
- Summaries should provide specific context from the transcript that supports the main insight
- Keep summaries concise and easily digestible
- Items should be in chronological order within the time range
- Focus on concrete examples, evidence, or explanations that make the main insight more understandable
`;

	return `${instruction}\nTRANSCRIPT_SEGMENTS_JSON = ${JSON.stringify(
		relevantSegments
	)}`;
}

function safeParseInsights(
	content: string
): { sections: Array<{ title: string; start: number; end: number }> } | null {
	try {
		const parsed = JSON.parse(content);
		if (parsed && Array.isArray(parsed.sections)) return parsed;
	} catch {}
	// Try to extract outermost JSON object if the model added extra text
	const start = content.indexOf('{');
	const end = content.lastIndexOf('}');
	if (start !== -1 && end !== -1 && end > start) {
		try {
			const parsed = JSON.parse(content.slice(start, end + 1));
			if (parsed && Array.isArray(parsed.sections)) return parsed;
		} catch {}
	}
	return null;
}

function safeParseContext(content: string): { items: OutlineItem[] } | null {
	try {
		const parsed = JSON.parse(content);
		if (parsed && Array.isArray(parsed.items)) return parsed;
	} catch {}
	// Try to extract outermost JSON object if the model added extra text
	const start = content.indexOf('{');
	const end = content.lastIndexOf('}');
	if (start !== -1 && end !== -1 && end > start) {
		try {
			const parsed = JSON.parse(content.slice(start, end + 1));
			if (parsed && Array.isArray(parsed.items)) return parsed;
		} catch {}
	}
	return null;
}

export async function POST(request: NextRequest) {
	try {
		const body = await request.json();
		const segments: TranscriptSegment[] = Array.isArray(body?.segments)
			? body.segments
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

		// Step 1: Generate main insights
		const insightsPrompt = buildInsightsPrompt(segments);
		const insightsResponse = await anthropic.messages.create({
			model: model,
			max_tokens: 3000,
			temperature: 1,
			system:
				'You are an expert at extracting the most valuable, quotable insights from content. Generate clear, insightful titles that people would want to share and discuss. Focus on substance over sensationalism. Always return strict JSON only. No prose. No markdown.',
			messages: [
				{
					role: 'user',
					content: insightsPrompt,
				},
			],
		});

		const insightsContent: string =
			insightsResponse.content[0]?.type === 'text'
				? insightsResponse.content[0].text
				: '';
		const insights = safeParseInsights(insightsContent);
		if (!insights || !insights.sections?.length) {
			return NextResponse.json(
				{ error: 'Failed to parse insights response' },
				{ status: 500 }
			);
		}

		// Step 2: Generate context for each insight
		const sectionsWithItems: OutlineSection[] = [];
		for (const insight of insights.sections) {
			const contextPrompt = buildContextPrompt(segments, insight);
			const contextResponse = await anthropic.messages.create({
				model: model,
				max_tokens: 2000,
				temperature: 1,
				system:
					'You are an expert at providing clear, digestible context that explains insights. Generate supporting items that break down and explain the main concept using specific examples from the content. Always return strict JSON only. No prose. No markdown.',
				messages: [
					{
						role: 'user',
						content: contextPrompt,
					},
				],
			});

			const contextContent: string =
				contextResponse.content[0]?.type === 'text'
					? contextResponse.content[0].text
					: '';
			const context = safeParseContext(contextContent);

			sectionsWithItems.push({
				title: insight.title,
				start: insight.start,
				end: insight.end,
				items: context?.items || [],
			});
		}

		const finalOutline: OutlineResponse = {
			sections: sectionsWithItems,
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
