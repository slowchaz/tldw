import { NextRequest, NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import { 
	getVideoWithContent, 
	saveVideo, 
	saveTranscript
} from '../../../lib/database';

export const runtime = 'nodejs';

const execAsync = promisify(exec);

type TranscriptSegment = {
	start: number; // seconds
	end: number; // seconds
	startTime: string; // HH:MM:SS.mmm
	endTime: string; // HH:MM:SS.mmm
	text: string;
};

type Chapter = {
	start_time: number; // seconds
	end_time?: number; // seconds
	title: string;
};

function timeStringToSeconds(timeString: string): number {
	// Expected VTT timestamp: HH:MM:SS.mmm (hours are required in VTT)
	const match = timeString
		.trim()
		.match(/^(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/);
	if (!match) return 0;
	const hours = parseInt(match[1], 10) || 0;
	const minutes = parseInt(match[2], 10) || 0;
	const seconds = parseInt(match[3], 10) || 0;
	const milliseconds = parseInt(match[4] || '0', 10) || 0;
	return hours * 3600 + minutes * 60 + seconds + milliseconds / 1000;
}

function cleanVttText(line: string): string {
	return line
		.replace(/<\d{2}:\d{2}:\d{2}\.\d{3}>/g, '') // inline timestamp tags
		.replace(/<c[^>]*>/g, '') // <c> style tags
		.replace(/<\/c>/g, '')
		.replace(/<[^>]*>/g, '') // any remaining HTML-like tags
		.replace(/\s+/g, ' ')
		.trim();
}

function parseVttToSegments(vttContent: string): TranscriptSegment[] {
	const lines = vttContent.split('\n');
	const segments: TranscriptSegment[] = [];
	const seenText = new Set<string>();

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i].trim();

		// Skip headers, notes, and empty lines
		if (
			line === '' ||
			line.startsWith('WEBVTT') ||
			line.startsWith('NOTE') ||
			line.startsWith('Kind:') ||
			line.startsWith('Language:') ||
			/^\d+$/.test(line)
		) {
			continue;
		}

		// Timestamp cue line
		if (line.includes('-->')) {
			// Handle settings after timestamps, e.g., "align:start position:0%"
			const [rawStart, rest] = line.split('-->');
			const startTimeStr = rawStart.trim();
			const endTimeStr = (rest || '').trim().split(/\s+/)[0] || '';

			if (!startTimeStr || !endTimeStr) continue;

			const start = timeStringToSeconds(startTimeStr);
			const end = timeStringToSeconds(endTimeStr);

			// Gather text lines until next blank line or next cue
			let j = i + 1;
			const textLines: string[] = [];
			while (j < lines.length) {
				const content = lines[j].trim();
				if (content === '') break;
				if (content.includes('-->')) break; // next cue started without blank line
				if (
					content.startsWith('NOTE') ||
					content.startsWith('Kind:') ||
					content.startsWith('Language:') ||
					/^\d+$/.test(content)
				) {
					j++;
					continue;
				}
				const cleaned = cleanVttText(content);
				if (cleaned) textLines.push(cleaned);
				j++;
			}

			const text = cleanVttText(textLines.join(' '));
			if (text && !seenText.has(text)) {
				seenText.add(text);
				segments.push({
					start,
					end,
					startTime: startTimeStr,
					endTime: endTimeStr,
					text,
				});
			}

			i = j - 1; // continue after the consumed block
		}

		if (segments.length > 10000) break; // safety guard
	}

	return segments;
}

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
			return NextResponse.json({ error: 'URL is required' }, { 
				status: 400,
				headers: {
					'Cache-Control': 'no-cache, no-store, must-revalidate',
					'Pragma': 'no-cache',
					'Expires': '0'
				}
			});
		}

		const videoId = extractVideoId(url);
		if (!videoId) {
			return NextResponse.json(
				{ error: 'Invalid YouTube URL or video ID' },
				{ 
					status: 400,
					headers: {
						'Cache-Control': 'no-cache, no-store, must-revalidate',
						'Pragma': 'no-cache',
						'Expires': '0'
					}
				}
			);
		}

		// Check if we already have this video's transcript in the database
		const existingData = getVideoWithContent(videoId);
		if (existingData.video && existingData.transcript) {
			console.log('Found cached transcript for video:', videoId);
			return NextResponse.json({
				success: true,
				videoId,
				videoTitle: existingData.video.title,
				segments: existingData.transcript.segments,
				chapters: existingData.transcript.chapters || [],
				extractedWith: 'cache',
			}, {
				headers: {
					'Cache-Control': 'no-cache, no-store, must-revalidate',
					'Pragma': 'no-cache',
					'Expires': '0'
				}
			});
		}

		// Use yt-dlp to extract captions and video info
		const youtubeUrl = `https://www.youtube.com/watch?v=${videoId}`;
		const subtitleFile = `${videoId}.en.vtt`;
		// Enhanced yt-dlp command with anti-detection measures
		// Use environment-aware cookies path: Docker uses /app/cookies, local uses ./cookies
		const cookiesPath =
			process.env.NODE_ENV === 'production'
				? '/app/cookies/youtube.txt'
				: './cookies/youtube.txt';

		// First get video title and chapters
		let videoTitle = 'Unknown Video';
		let chapters: Chapter[] = [];
		try {
			const infoCommand = `yt-dlp --dump-json --no-warnings --cookies "${cookiesPath}" "${youtubeUrl}"`;
			console.log('Getting video info for title and chapters...');
			const infoResult = await execAsync(infoCommand, {
				timeout: 15000,
				maxBuffer: 1024 * 1024,
			});
			const videoInfo = JSON.parse(infoResult.stdout);
			videoTitle = videoInfo.title || 'Unknown Video';
			chapters = videoInfo.chapters || [];
			console.log('Video title:', videoTitle);
			console.log('Found chapters:', chapters.length);
			if (chapters.length > 0) {
				console.log('Chapter titles:', chapters.map((c) => c.title).join(', '));
			}
		} catch (titleError) {
			console.warn('Could not fetch video title and chapters:', titleError);
			// Continue without title and chapters
		}

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
		--cookies "${cookiesPath}" \
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

			// Parse VTT content to extract structured segments with timestamps
			const segments = parseVttToSegments(subtitleContent);

			if (!segments.length) {
				return NextResponse.json(
					{ error: 'No subtitles available for this video' },
					{ status: 404 }
				);
			}

			// Save video and transcript to database
			try {
				const youtubeUrl = `https://www.youtube.com/watch?v=${videoId}`;
				saveVideo({
					videoId,
					title: videoTitle,
					url: youtubeUrl,
				});

				saveTranscript({
					videoId,
					segments,
					chapters,
				});

				console.log('Saved video and transcript to database:', videoId);
			} catch (dbError) {
				console.error('Failed to save to database:', dbError);
				// Continue without failing the request
			}

			return NextResponse.json({
				success: true,
				videoId,
				videoTitle,
				segments,
				chapters,
				extractedWith: 'yt-dlp',
			}, {
				headers: {
					'Cache-Control': 'no-cache, no-store, must-revalidate',
					'Pragma': 'no-cache',
					'Expires': '0'
				}
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
