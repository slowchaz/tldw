'use client';

import { useEffect, useRef, useState, useCallback } from 'react';

declare global {
	interface Window {
		YT: any;
		onYouTubeIframeAPIReady: () => void;
	}
}

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

function getYouTubeVideoId(input: string): string | null {
	const trimmed = input.trim();
	const idLike = /^[a-zA-Z0-9_-]{11}$/;
	if (idLike.test(trimmed)) return trimmed;

	try {
		const url = new URL(trimmed);
		if (url.hostname.includes('youtube.com')) {
			const v = url.searchParams.get('v');
			if (v && idLike.test(v)) return v;
		}
		if (url.hostname === 'youtu.be') {
			const pathMatch = url.pathname.match(/\/([a-zA-Z0-9_-]{11})/);
			if (pathMatch) return pathMatch[1];
		}
	} catch {
		// Not a URL; fall through
	}
	return null;
}

export default function Home() {
	const [url, setUrl] = useState('');
	const [loading, setLoading] = useState(false);
	const [transcript, setTranscript] = useState('');
	const [error, setError] = useState('');
	const [videoId, setVideoId] = useState<string>('');
	const [videoTitle, setVideoTitle] = useState<string>('');
	const [, setSegments] = useState<TranscriptSegment[]>([]);
	const [outline, setOutline] = useState<OutlineResponse | null>(null);
	const [outlineLoading, setOutlineLoading] = useState(false);

	const playerRef = useRef<any | null>(null);
	const [playerReady, setPlayerReady] = useState(false);

	const ensureYouTubeIframeAPI = () => {
		if (typeof window === 'undefined') return Promise.resolve();
		if (window.YT && window.YT.Player) return Promise.resolve();

		return new Promise<void>((resolve) => {
			const existingScript = document.querySelector(
				'script[src="https://www.youtube.com/iframe_api"]'
			) as HTMLScriptElement | null;
			if (!existingScript) {
				const tag = document.createElement('script');
				tag.src = 'https://www.youtube.com/iframe_api';
				const firstScriptTag = document.getElementsByTagName('script')[0];
				firstScriptTag?.parentNode?.insertBefore(tag, firstScriptTag);
			}
			window.onYouTubeIframeAPIReady = () => resolve();
			if (window.YT && window.YT.Player) resolve();
		});
	};

	const jumpTo = useCallback(
		(seconds: number) => {
			if (!seconds || !playerReady || !playerRef.current) return;

			try {
				playerRef.current.seekTo(seconds, true);
				if (typeof playerRef.current.playVideo === 'function') {
					playerRef.current.playVideo();
				}
			} catch (error) {
				console.error('Jump to timestamp failed:', error);
			}
		},
		[playerReady]
	);

	const extractTranscript = async () => {
		if (!url.trim()) {
			setError('Please enter a YouTube URL or video ID');
			return;
		}

		setLoading(true);
		setError('');
		setTranscript('');
		setSegments([]);
		setOutline(null);
		setVideoTitle('');

		const parsedId = getYouTubeVideoId(url.trim());
		setVideoId(parsedId || '');

		try {
			const response = await fetch('/api/transcript', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ url: url.trim() }),
			});

			const data = await response.json();

			if (data.success) {
				if (Array.isArray(data.segments)) {
					setSegments(data.segments);
					setTranscript(data.segments.map((s: TranscriptSegment) => s.text).join('\n'));
					void processOutline(data.segments, data.videoId || parsedId);
				}
				if (data.videoId) setVideoId(data.videoId);
				if (data.videoTitle) setVideoTitle(data.videoTitle);
			} else {
				setError(data.error || 'Failed to extract transcript');
			}
		} catch {
			setError('Network error: Failed to connect to transcript API');
		} finally {
			setLoading(false);
		}
	};

	const processOutline = async (
		currentSegments: TranscriptSegment[],
		_currentVideoId?: string
	) => {
		if (!currentSegments?.length) return;
		setOutlineLoading(true);

		try {
			const res = await fetch('/api/process-transcript', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ segments: currentSegments }),
			});
			const data = await res.json();
			if (data?.success && data?.outline?.items) {
				setOutline(data.outline);
			} else {
				setError(data?.error || 'Failed to process transcript outline');
			}
		} catch {
			setError('Network error: Failed to connect to processing API');
		} finally {
			setOutlineLoading(false);
		}
	};

	useEffect(() => {
		if (!transcript || !videoId) return;
		let cancelled = false;

		setPlayerReady(false);

		ensureYouTubeIframeAPI().then(() => {
			if (cancelled) return;
			if (playerRef.current) {
				try {
					playerRef.current.cueVideoById(videoId);
					setPlayerReady(true);
				} catch {}
				return;
			}
			try {
				playerRef.current = new window.YT.Player('player', {
					videoId,
					events: {
						onReady: () => {
							if (!cancelled) setPlayerReady(true);
						},
						onError: () => {
							if (!cancelled) setPlayerReady(false);
						},
					},
				});
			} catch {}
		});
		return () => {
			cancelled = true;
			setPlayerReady(false);
		};
	}, [transcript, videoId]);

	const formatSeconds = (totalSeconds: number) => {
		const s = Math.max(0, Math.floor(totalSeconds || 0));
		const hrs = Math.floor(s / 3600);
		const mins = Math.floor((s % 3600) / 60);
		const secs = s % 60;
		const two = (n: number) => String(n).padStart(2, '0');
		return hrs > 0
			? `${hrs}:${two(mins)}:${two(secs)}`
			: `${mins}:${two(secs)}`;
	};

	const reset = () => {
		setTranscript('');
		setSegments([]);
		setOutline(null);
		setVideoId('');
		setVideoTitle('');
		setUrl('');
		setError('');
		if (playerRef.current) {
			try {
				playerRef.current.destroy();
			} catch {}
			playerRef.current = null;
		}
		setPlayerReady(false);
	};

	if (!transcript) {
		return (
			<div className="min-h-screen flex items-center justify-center bg-gray-50">
				<div className="max-w-md w-full px-6">
					<div className="text-center mb-8">
						<h1 className="text-3xl font-bold text-gray-900 mb-2">TLDW</h1>
						<p className="text-gray-600">Turn long videos into digestible clips</p>
					</div>
					
					<div className="space-y-4">
						<input
							type="text"
							value={url}
							onChange={(e) => setUrl(e.target.value)}
							placeholder="YouTube URL or video ID"
							className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
							disabled={loading}
						/>
						
						<button
							onClick={extractTranscript}
							disabled={loading}
							className="w-full bg-blue-600 text-white py-3 px-4 rounded-lg hover:bg-blue-700 disabled:opacity-50"
						>
							{loading ? 'Processing...' : 'Extract Insights'}
						</button>
					</div>

					{error && (
						<div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg">
							<p className="text-red-800 text-sm">{error}</p>
						</div>
					)}
				</div>
			</div>
		);
	}

	return (
		<div className="min-h-screen bg-white">
			{/* Video Player */}
			<div className="bg-black">
				<div className="max-w-4xl mx-auto">
					<div className="aspect-video">
						<div id="player" className="w-full h-full" />
					</div>
				</div>
			</div>

			{/* Content */}
			<div className="max-w-2xl mx-auto px-6 py-8">
				{/* Header */}
				<div className="text-center mb-8">
					<h1 className="text-2xl font-bold text-gray-900 mb-2">
						{videoTitle || 'Video Analysis'}
					</h1>
					<div className="flex items-center justify-center space-x-4 text-sm text-gray-500">
						{outlineLoading && <span>Processing...</span>}
						<button onClick={reset} className="text-blue-600 hover:underline">
							New Video
						</button>
					</div>
				</div>

				{/* Hook Quote */}
				{outline?.hookQuote && (
					<div className="mb-8">
						<button
							onClick={() => jumpTo(outline.hookQuoteTimestamp)}
							className="block w-full text-left hover:bg-gray-50 p-4 rounded-lg transition-colors"
						>
							<blockquote className="text-lg italic text-gray-800 mb-2">
								"{outline.hookQuote}"
							</blockquote>
							<div className="text-sm text-gray-500">
								{formatSeconds(outline.hookQuoteTimestamp)}
							</div>
						</button>
					</div>
				)}

				{/* Divider */}
				{outline?.hookQuote && outline?.items?.length > 0 && (
					<div className="text-center mb-8">
						<span className="text-2xl text-gray-400">—</span>
					</div>
				)}

				{/* Insights */}
				{outline?.items && outline.items.length > 0 && (
					<div className="space-y-6">
						{outline.items.map((item, index) => (
							<div key={index} className="border-b border-gray-100 pb-6 last:border-b-0">
								<button
									onClick={() => jumpTo(item.start)}
									className="block w-full text-left hover:bg-gray-50 p-4 rounded-lg transition-colors"
								>
									<h3 className="text-xl font-bold text-gray-900 mb-3">
										{item.title}
									</h3>
									{item.directQuote && (
										<blockquote className="text-gray-700 italic mb-2">
											"{item.directQuote}"
										</blockquote>
									)}
									<div className="text-sm text-gray-500">
										{formatSeconds(item.start)}
									</div>
								</button>
							</div>
						))}
					</div>
				)}

				{!outline && !outlineLoading && (
					<div className="text-center text-gray-500">
						<p>No insights extracted yet.</p>
					</div>
				)}
			</div>
		</div>
	);
}