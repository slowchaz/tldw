import { NextRequest, NextResponse } from 'next/server';

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
	const instruction = `You are given a timestamped transcript segmented by time ranges.
Create a concise, scannable outline suitable for quickly navigating a video.

Requirements:
- Return only strict JSON matching this TypeScript type (no extra text):
  { "sections": Array<{ "title": string; "start": number; "end"?: number; "items": Array<{ "title": string; "start": number; "end"?: number; "summary"?: string }> }> }
- 4-10 sections total. Each section should have a meaningful title and a representative start time (in seconds). Include end when clear.
- For each section, include 3-8 key items with short, action-oriented titles. Include start (and end if obvious).
- Prefer timestamps that align with the provided segment boundaries.
- Keep titles and summaries concise and useful.
`;

	// Keep payload size reasonable. Use the first N segments and sample across the rest if huge
	const MAX_SEGMENTS = 600; // conservative to avoid oversized requests
	let selected: TranscriptSegment[] = segments;
	if (segments.length > MAX_SEGMENTS) {
		const head = segments.slice(0, 300);
		const tail = segments.slice(-300);
		selected = [...head, ...tail];
	}

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

		const apiKey = process.env.OPENAI_API_KEY;
		if (!apiKey) {
			return NextResponse.json(
				{ error: 'Missing OPENAI_API_KEY server configuration' },
				{ status: 500 }
			);
		}

		const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';

		const prompt = buildPrompt(segments);

		const response = await fetch('https://api.openai.com/v1/chat/completions', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${apiKey}`,
			},
			body: JSON.stringify({
				model,
				messages: [
					{
						role: 'system',
						content:
							'You are a precise content structurer. Always return strict JSON only. No prose. No markdown.',
					},
					{ role: 'user', content: prompt },
				],
				temperature: 0.2,
				// Ask for a JSON object. If unsupported by a given model, the system instruction still requests JSON-only.
				response_format: { type: 'json_object' },
			}),
		});

		if (!response.ok) {
			const errText = await response.text();
			return NextResponse.json(
				{ error: 'LLM request failed', details: errText },
				{ status: 502 }
			);
		}

		const json = (await response.json()) as any;
		const content: string = json?.choices?.[0]?.message?.content ?? '';
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
