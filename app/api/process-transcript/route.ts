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

function buildPrompt(segments: TranscriptSegment[]): string {
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

	const instruction = `You are given a timestamped transcript segmented by time ranges from a ${durationMinutes}-minute video.
Create a concise, scannable outline suitable for quickly navigating the ENTIRE video duration.

CRITICAL: The outline must span the full ${durationMinutes}-minute video. Do not stop at early timestamps.

Requirements:
- Return only strict JSON matching this TypeScript type (no extra text):
  { "sections": Array<{ "title": string; "start": number; "end"?: number; "items": Array<{ "title": string; "start": number; "end"?: number; "summary"?: string }> }> }
- 4-10 sections total distributed across the FULL video duration (0 to ~${videoDuration} seconds).
- Each section should have a meaningful title and a representative start time (in seconds). Include end when clear.
- For each section, include 3-8 key items with short, action-oriented titles. Include start (and end if obvious).
- Prefer timestamps that align with the provided segment boundaries.
- Keep titles and summaries concise and useful.
- ENSURE sections cover the entire video timeline, not just the beginning.
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

function safeParseOutline(content: string): OutlineResponse | null {
	try {
		const parsed = JSON.parse(content);
		if (parsed && Array.isArray(parsed.sections))
			return parsed as OutlineResponse;
	} catch {}
	// Try to extract outermost JSON object if the model added extra text
	const start = content.indexOf('{');
	const end = content.lastIndexOf('}');
	if (start !== -1 && end !== -1 && end > start) {
		try {
			const parsed = JSON.parse(content.slice(start, end + 1));
			if (parsed && Array.isArray(parsed.sections))
				return parsed as OutlineResponse;
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

		const prompt = buildPrompt(segments);

		const anthropic = new Anthropic({
			apiKey: apiKey,
		});

		const response = await anthropic.messages.create({
			model: model,
			max_tokens: 4000,
			temperature: 1,
			system:
				'You are a precise content structurer. Always return strict JSON only. No prose. No markdown.',
			messages: [
				{
					role: 'user',
					content: prompt,
				},
			],
		});

		const content: string =
			response.content[0]?.type === 'text' ? response.content[0].text : '';
		const parsed = safeParseOutline(content);
		if (!parsed) {
			return NextResponse.json(
				{ error: 'Failed to parse LLM JSON response' },
				{ status: 500 }
			);
		}

		return NextResponse.json({ success: true, outline: parsed });
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
