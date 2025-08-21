import { NextResponse } from 'next/server';
import { splitIntoSentences, mergeShortSentences, analyzeSentenceStats } from '../../../lib/sentence-processor';

export const runtime = 'nodejs';

export async function GET() {
	// Sample transcript segments for testing
	const sampleSegments = [
		{ start: 0, end: 3, startTime: '00:00:00.000', endTime: '00:00:03.000', text: "Hello everyone. Welcome to today's talk about creativity." },
		{ start: 3, end: 7, startTime: '00:00:03.000', endTime: '00:00:07.000', text: "I want to start with a question. What makes someone creative?" },
		{ start: 7, end: 12, startTime: '00:00:07.000', endTime: '00:00:12.000', text: "Most people think creativity is about talent. But that's wrong." },
		{ start: 12, end: 18, startTime: '00:00:12.000', endTime: '00:00:18.000', text: "Creativity is actually about process. It's about how you think, not what you're born with." },
		{ start: 18, end: 22, startTime: '00:00:18.000', endTime: '00:00:22.000', text: "Let me explain. The most creative people do three things differently." },
		{ start: 22, end: 27, startTime: '00:00:22.000', endTime: '00:00:27.000', text: "First, they give themselves time. Second, they embrace mistakes." },
		{ start: 27, end: 32, startTime: '00:00:27.000', endTime: '00:00:32.000', text: "Third, and this is crucial, they play with ideas like children." }
	];

	try {
		console.log('Testing sentence processing...');

		// Test sentence splitting
		const sentences = splitIntoSentences(sampleSegments);
		console.log(`Original segments: ${sampleSegments.length}`);
		console.log(`Extracted sentences: ${sentences.length}`);

		console.log('Extracted sentences:');
		sentences.forEach((s, i) => {
			console.log(`${i + 1}. [${s.start.toFixed(1)}s-${s.end.toFixed(1)}s] "${s.text}" (${s.wordCount} words)`);
		});

		// Test merging short sentences
		const merged = mergeShortSentences(sentences, 5);
		console.log(`After merging sentences < 5 words: ${merged.length} sentences`);

		// Test statistics
		const stats = analyzeSentenceStats(sampleSegments, merged);

		return NextResponse.json({
			success: true,
			results: {
				original: {
					count: sampleSegments.length,
					segments: sampleSegments
				},
				sentences: {
					count: sentences.length,
					data: sentences
				},
				merged: {
					count: merged.length,
					data: merged
				},
				statistics: stats
			}
		});

	} catch (error) {
		console.error('Sentence processing test error:', error);
		return NextResponse.json(
			{ error: error instanceof Error ? error.message : 'Failed to test sentence processing' },
			{ status: 500 }
		);
	}
}