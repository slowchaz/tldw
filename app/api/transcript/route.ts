import { NextRequest, NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';

export const runtime = 'nodejs';

const execAsync = promisify(exec);

function extractVideoId(url: string): string | null {
	// Handle various YouTube URL formats
	const patterns = [
		/(?:https?:\/\/)?(?:www\.)?youtube\.com\/watch\?v=([a-zA-Z0-9_-]{11})/,
		/(?:https?:\/\/)?youtu\.be\/([a-zA-Z0-9_-]{11})/,
		/(?:https?:\/\/)?(?:www\.)?youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
		/^([a-zA-Z0-9_-]{11})$/, // Direct video ID
	];

	for (const pattern of patterns) {
		const match = url.match(pattern);
		if (match) {
			return match[1];
		}
	}

	return null;
}

export async function POST(request: NextRequest) {
	try {
		const { url } = await request.json();

		if (!url) {
			return NextResponse.json({ error: 'URL is required' }, { status: 400 });
		}

		const videoId = extractVideoId(url);
		if (!videoId) {
			return NextResponse.json(
				{ error: 'Invalid YouTube URL or video ID' },
				{ status: 400 }
			);
		}

		// Use yt-dlp to extract captions
		const youtubeUrl = `https://www.youtube.com/watch?v=${videoId}`;
		const subtitleFile = `${videoId}.en.vtt`;
		// Enhanced yt-dlp command with anti-detection measures
		const command = `yt-dlp \
			--write-sub \
			--write-auto-sub \
			--sub-langs "en" \
			--skip-download \
			--sub-format "vtt" \
			--output "%(id)s.%(ext)s" \
			--user-agent "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" \
			--sleep-requests 1 \
			--sleep-subtitles 1 \
			--cookies "/app/cookies/youtube.txt" \
			"${youtubeUrl}"`;

		try {
			// Download the subtitle file with timeout and larger buffer
			console.log('Executing yt-dlp command:', command);
			const result = await execAsync(command, {
				timeout: 45000,
				maxBuffer: 1024 * 1024,
			});
			console.log('yt-dlp stdout:', result.stdout);
			console.log('yt-dlp stderr:', result.stderr);

			// Read the subtitle file without using exec to avoid maxBuffer limits
			const subtitleContent = await fs.readFile(subtitleFile, 'utf-8');

			// Clean up the subtitle file
			await execAsync(
				`rm -f "${videoId}"*.vtt "${videoId}"*.srt 2>/dev/null || true`
			);

			// Parse VTT content to extract text
			const lines = subtitleContent.split('\n');
			const transcriptLines: string[] = [];
			const seenText = new Set<string>(); // Avoid duplicate lines

			for (const line of lines) {
				const trimmedLine = line.trim();

				// Skip empty lines, timestamps, and VTT headers
				if (
					trimmedLine === '' ||
					trimmedLine.startsWith('WEBVTT') ||
					trimmedLine.includes('-->') ||
					trimmedLine.startsWith('NOTE') ||
					trimmedLine.startsWith('Kind:') ||
					trimmedLine.startsWith('Language:') ||
					/^\d+$/.test(trimmedLine) ||
					trimmedLine.includes('align:start position:') ||
					trimmedLine.includes('align:middle') ||
					trimmedLine.includes('align:end')
				) {
					continue;
				}

				// Clean up the line by removing ALL timestamp and formatting tags
				const cleanLine = trimmedLine
					.replace(/<\d{2}:\d{2}:\d{2}\.\d{3}>/g, '') // Remove timestamp tags
					.replace(/<c[^>]*>/g, '') // Remove <c> tags
					.replace(/<\/c>/g, '') // Remove </c> tags
					.replace(/<[^>]*>/g, '') // Remove any other HTML tags
					.replace(/\s+/g, ' ') // Normalize whitespace
					.trim();

				// Only add non-empty, unique lines
				if (cleanLine && cleanLine.length > 1 && !seenText.has(cleanLine)) {
					seenText.add(cleanLine);
					transcriptLines.push(cleanLine);
				}

				// Prevent memory issues with extremely large files
				if (transcriptLines.length > 10000) {
					console.warn('Transcript too long, truncating at 10000 lines');
					break;
				}
			}

			const transcriptText = transcriptLines.join(' ').slice(0, 50000); // Limit to 50k characters

			if (!transcriptText || transcriptText.trim() === '') {
				return NextResponse.json(
					{ error: 'No subtitles available for this video' },
					{ status: 404 }
				);
			}

			return NextResponse.json({
				success: true,
				videoId,
				transcript: transcriptText,
				extractedWith: 'yt-dlp',
			});
		} catch (execError: unknown) {
			console.error('yt-dlp execution error for video:', videoId);
			console.error(
				'Error details:',
				(execError as Error)?.message || execError
			);
			console.error('Full error object:', execError);
			// Clean up any leftover files
			try {
				await execAsync(
					`rm -f "${videoId}"*.vtt "${videoId}"*.srt 2>/dev/null || true`
				);
			} catch (cleanupError) {
				console.error('Cleanup error:', cleanupError);
			}

			return NextResponse.json(
				{
					error: 'Failed to extract subtitles with yt-dlp',
					videoId,
					details: (execError as Error)?.message || 'Unknown error',
				},
				{ status: 500 }
			);
		}
	} catch (error) {
		console.error('Transcript extraction error:', error);
		return NextResponse.json(
			{
				error:
					error instanceof Error
						? error.message
						: 'Failed to extract transcript',
			},
			{ status: 500 }
		);
	}
}
