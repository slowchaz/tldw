'use client';

import { useEffect, useRef, useState } from 'react';

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

function getYouTubeVideoId(input: string): string | null {
	const trimmed = input.trim();
	// If it's already a plain video ID
	const idLike = /^[a-zA-Z0-9_-]{11}$/;
	if (idLike.test(trimmed)) return trimmed;

	try {
		const url = new URL(trimmed);
		// Standard watch URL: https://www.youtube.com/watch?v=VIDEO_ID
		if (url.hostname.includes('youtube.com')) {
			const v = url.searchParams.get('v');
			if (v && idLike.test(v)) return v;
			// Shorts: https://www.youtube.com/shorts/VIDEO_ID
			const shortsMatch = url.pathname.match(/\/shorts\/([a-zA-Z0-9_-]{11})/);
			if (shortsMatch) return shortsMatch[1];
			// Embed: https://www.youtube.com/embed/VIDEO_ID
			const embedMatch = url.pathname.match(/\/embed\/([a-zA-Z0-9_-]{11})/);
			if (embedMatch) return embedMatch[1];
		}
		// youtu.be short link: https://youtu.be/VIDEO_ID
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
	const [segments, setSegments] = useState<TranscriptSegment[]>([]);
	const [outline, setOutline] = useState<OutlineResponse | null>(null);
	const [outlineLoading, setOutlineLoading] = useState(false);

	const playerRef = useRef<any | null>(null);
	const apiReadyPromiseRef = useRef<Promise<void> | null>(null);

	const ensureYouTubeIframeAPI = () => {
		if (typeof window === 'undefined') return Promise.resolve();
		if (window.YT && window.YT.Player) return Promise.resolve();
		if (apiReadyPromiseRef.current) return apiReadyPromiseRef.current;

		apiReadyPromiseRef.current = new Promise<void>((resolve) => {
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
			// If API loads very fast and YT is already present
			if (window.YT && window.YT.Player) resolve();
		});
		return apiReadyPromiseRef.current;
	};

	useEffect(() => {
		return () => {
			if (playerRef.current) {
				try {
					playerRef.current.destroy();
				} catch {}
				playerRef.current = null;
			}
		};
	}, []);

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
		const parsedId = getYouTubeVideoId(url.trim());
		setVideoId(parsedId || '');

		try {
			const response = await fetch('/api/transcript', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({ url: url.trim() }),
			});

			const data = await response.json();

			if (data.success) {
				if (Array.isArray(data.segments)) {
					setSegments(data.segments as TranscriptSegment[]);
					setTranscript(
						(data.segments as TranscriptSegment[]).map((s) => s.text).join('\n')
					);
					// Kick off processing to outline with the received segments
					void processOutline(data.segments as TranscriptSegment[]);
				}
				if (data.videoId) {
					setVideoId(data.videoId);
				}
			} else {
				setError(data.error || 'Failed to extract transcript');
			}
		} catch {
			setError('Network error: Failed to connect to transcript API');
		} finally {
			setLoading(false);
		}
	};

	const processOutline = async (currentSegments: TranscriptSegment[]) => {
		if (!currentSegments?.length) return;
		setOutlineLoading(true);
		try {
			const res = await fetch('/api/process-transcript', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ segments: currentSegments }),
			});
			const data = await res.json();
			if (data?.success && data?.outline?.sections) {
				setOutline(data.outline as OutlineResponse);
			} else {
				// Keep UI minimal; surface a generic error
				// eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
				setError(data?.error || 'Failed to process transcript outline');
			}
		} catch {
			setError('Network error: Failed to connect to processing API');
		} finally {
			setOutlineLoading(false);
		}
	};

	const jumpTo = (seconds: number) => {
		if (!seconds || !playerRef.current) return;
		try {
			playerRef.current.seekTo(seconds, true);
			if (typeof playerRef.current.playVideo === 'function') {
				playerRef.current.playVideo();
			}
		} catch {}
	};

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

	const formatRange = (start?: number, end?: number) => {
		if (typeof start !== 'number') return '';
		if (typeof end === 'number' && end > start) {
			return `${formatSeconds(start)}–${formatSeconds(end)}`;
		}
		return `${formatSeconds(start)}`;
	};

	useEffect(() => {
		if (!transcript || !videoId) return;
		let cancelled = false;
		ensureYouTubeIframeAPI().then(() => {
			if (cancelled) return;
			if (playerRef.current) {
				try {
					playerRef.current.cueVideoById(videoId);
				} catch {}
				return;
			}
			try {
				playerRef.current = new window.YT.Player('player', {
					videoId,
					playerVars: {
						modestbranding: 1,
						rel: 0,
						playsinline: 1,
					},
				});
			} catch {}
		});
		return () => {
			cancelled = true;
		};
	}, [transcript, videoId]);

	return (
		<div className="font-sans min-h-screen p-8 max-w-5xl mx-auto">
			<main className="space-y-8">
				<div className="text-center">
					<h1 className="text-4xl font-bold text-gray-900 mb-4">
						TLDW - Too Long; Didn&apos;t Watch
					</h1>
					<p className="text-lg text-gray-600">
						Extract transcripts from YouTube videos using yt-dlp
					</p>
				</div>

				<div className="space-y-4">
					<div>
						<label
							htmlFor="url"
							className="block text-sm font-medium text-gray-700 mb-2"
						>
							YouTube URL or Video ID
						</label>
						<input
							id="url"
							type="text"
							value={url}
							onChange={(e) => setUrl(e.target.value)}
							placeholder="https://www.youtube.com/watch?v=pzBi1nwDn8U or pzBi1nwDn8U"
							className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
							disabled={loading}
						/>
					</div>

					<button
						onClick={extractTranscript}
						disabled={loading}
						className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-medium py-2 px-4 rounded-lg transition-colors"
					>
						{loading ? 'Extracting...' : 'Extract Transcript'}
					</button>
				</div>

				{error && (
					<div className="p-4 bg-red-50 border border-red-200 rounded-lg">
						<p className="text-red-600">{error}</p>
					</div>
				)}

				{transcript && (
					<div className="space-y-4">
						<div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
							<div className="w-full">
								<div className="w-full aspect-video bg-black rounded-lg overflow-hidden">
									<div id="player" className="w-full h-full" />
								</div>
							</div>
							<div>
								{/* Outline */}
								<div className="space-y-4">
									<div className="flex items-center justify-between">
										<h2 className="text-2xl font-semibold text-gray-900">
											Outline
										</h2>
										{outlineLoading && (
											<span className="text-sm text-gray-500">Processing…</span>
										)}
									</div>
									{outline?.sections?.length ? (
										<div className="space-y-4">
											{outline.sections.map((section, idx) => (
												<div
													key={idx}
													className="relative rounded-xl border border-gray-200 bg-white shadow-sm hover:shadow-md transition-shadow group overflow-hidden"
												>
													<div className="absolute left-0 top-0 h-full w-1.5 bg-gradient-to-b from-blue-500/90 to-blue-400/60" />
													<button
														type="button"
														onClick={() => jumpTo(section.start)}
														className="w-full text-left px-4 pt-3 pb-2 flex items-start justify-between gap-3"
													>
														<div className="min-w-0">
															<div className="flex items-center gap-2">
																<span className="inline-flex items-center justify-center text-xs font-semibold text-blue-600 bg-blue-50 rounded-full px-2 py-0.5">
																	S{idx + 1}
																</span>
																<h3 className="font-semibold text-gray-900 truncate">
																	{section.title}
																</h3>
															</div>
														</div>
														<span className="shrink-0 inline-flex items-center text-[11px] font-medium text-gray-700 bg-gray-100 rounded-full px-2 py-0.5">
															{formatRange(section.start, section.end)}
														</span>
													</button>
													{!!section.items?.length && (
														<ul className="px-2 pb-2">
															{section.items.map((item, j) => (
																<li key={j} className="">
																	<button
																		type="button"
																		onClick={() => jumpTo(item.start)}
																		className="w-full text-left rounded-lg px-2 py-2 hover:bg-gray-50 transition flex items-start gap-2"
																	>
																		<span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-blue-500/70" />
																		<div className="min-w-0 flex-1">
																			<div className="flex items-center justify-between gap-3">
																				<p className="text-sm font-medium text-gray-900 truncate">
																					{item.title}
																				</p>
																				<span className="shrink-0 inline-flex items-center text-[10px] font-medium text-gray-700 bg-gray-100 rounded-full px-1.5 py-0.5">
																					{formatRange(item.start, item.end)}
																				</span>
																			</div>
																			{item.summary && (
																				<p className="mt-0.5 text-xs text-gray-600 line-clamp-2">
																					{item.summary}
																				</p>
																			)}
																		</div>
																	</button>
																</li>
															))}
														</ul>
													)}
												</div>
											))}
										</div>
									) : (
										<p className="text-sm text-gray-500">
											No outline available.
										</p>
									)}
								</div>

								{/* Transcript */}
								<h2 className="text-2xl font-semibold text-gray-900 mt-6 mb-2">
									Transcript
								</h2>
								<div className="p-4 bg-gray-50 border border-gray-200 rounded-lg max-h-[40vh] overflow-auto">
									<p className="text-gray-800 leading-relaxed whitespace-pre-wrap">
										{transcript}
									</p>
								</div>
							</div>
						</div>
					</div>
				)}
			</main>

			<footer className="mt-16 text-center">
				<p className="text-gray-500">
					Powered by{' '}
					<a
						href="https://github.com/yt-dlp/yt-dlp"
						target="_blank"
						rel="noopener noreferrer"
						className="text-blue-600 hover:underline"
					>
						yt-dlp
					</a>
				</p>
			</footer>
		</div>
	);
}
