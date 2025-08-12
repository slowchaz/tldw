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
	const [fromCache, setFromCache] = useState({
		transcript: false,
		outline: false,
	});
	const [currentSectionIndex, setCurrentSectionIndex] = useState(0);
	const [touchStart, setTouchStart] = useState<{ x: number; y: number } | null>(
		null
	);
	const [touchEnd, setTouchEnd] = useState<{ x: number; y: number } | null>(
		null
	);

	const playerRef = useRef<any | null>(null);
	const apiReadyPromiseRef = useRef<Promise<void> | null>(null);

	// Cache utility functions
	const getCachedTranscript = (videoId: string) => {
		try {
			const cached = localStorage.getItem(`transcript_${videoId}`);
			return cached ? JSON.parse(cached) : null;
		} catch {
			return null;
		}
	};

	const setCachedTranscript = (
		videoId: string,
		data: { segments: TranscriptSegment[] }
	) => {
		try {
			localStorage.setItem(`transcript_${videoId}`, JSON.stringify(data));
		} catch {
			// Ignore storage errors
		}
	};

	const getCachedOutline = (videoId: string) => {
		try {
			const cached = localStorage.getItem(`outline_${videoId}`);
			return cached ? JSON.parse(cached) : null;
		} catch {
			return null;
		}
	};

	const setCachedOutline = (videoId: string, data: OutlineResponse) => {
		try {
			localStorage.setItem(`outline_${videoId}`, JSON.stringify(data));
		} catch {
			// Ignore storage errors
		}
	};

	const clearCache = () => {
		try {
			const keys = Object.keys(localStorage).filter(
				(key) => key.startsWith('transcript_') || key.startsWith('outline_')
			);
			keys.forEach((key) => localStorage.removeItem(key));
			setFromCache({ transcript: false, outline: false });
		} catch {
			// Ignore storage errors
		}
	};

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
		setFromCache({ transcript: false, outline: false });
		const parsedId = getYouTubeVideoId(url.trim());
		setVideoId(parsedId || '');

		// Check cache first
		if (parsedId) {
			const cachedTranscript = getCachedTranscript(parsedId);
			if (cachedTranscript && Array.isArray(cachedTranscript.segments)) {
				console.log('Loading transcript from cache for video:', parsedId);
				setSegments(cachedTranscript.segments);
				setTranscript(
					cachedTranscript.segments
						.map((s: TranscriptSegment) => s.text)
						.join('\n')
				);
				setFromCache((prev) => ({ ...prev, transcript: true }));
				setLoading(false);
				// Process outline (which will also check cache)
				void processOutline(cachedTranscript.segments, parsedId);
				return;
			}
		}

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
					const transcriptData = {
						segments: data.segments as TranscriptSegment[],
					};
					setSegments(transcriptData.segments);
					setTranscript(transcriptData.segments.map((s) => s.text).join('\n'));

					// Cache the transcript data
					if (data.videoId || parsedId) {
						setCachedTranscript(data.videoId || parsedId!, transcriptData);
					}

					// Kick off processing to outline with the received segments
					void processOutline(
						transcriptData.segments,
						data.videoId || parsedId
					);
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

	const processOutline = async (
		currentSegments: TranscriptSegment[],
		currentVideoId?: string
	) => {
		if (!currentSegments?.length) return;
		setOutlineLoading(true);

		// Check cache first if we have a videoId
		const videoIdToUse = currentVideoId || videoId;
		if (videoIdToUse) {
			const cachedOutline = getCachedOutline(videoIdToUse);
			if (cachedOutline && Array.isArray(cachedOutline.sections)) {
				console.log('Loading outline from cache for video:', videoIdToUse);
				setOutline(cachedOutline);
				setFromCache((prev) => ({ ...prev, outline: true }));
				setOutlineLoading(false);
				return;
			}
		}

		try {
			const res = await fetch('/api/process-transcript', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ segments: currentSegments }),
			});
			const data = await res.json();
			if (data?.success && data?.outline?.sections) {
				const outlineData = data.outline as OutlineResponse;
				setOutline(outlineData);

				// Cache the outline data
				if (videoIdToUse) {
					setCachedOutline(videoIdToUse, outlineData);
				}
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

	// Swipe functionality
	const minSwipeDistance = 50;

	const onTouchStart = (e: React.TouchEvent) => {
		setTouchEnd(null);
		setTouchStart({
			x: e.targetTouches[0].clientX,
			y: e.targetTouches[0].clientY,
		});
	};

	const onTouchMove = (e: React.TouchEvent) => {
		setTouchEnd({
			x: e.targetTouches[0].clientX,
			y: e.targetTouches[0].clientY,
		});
	};

	const onTouchEnd = () => {
		if (!touchStart || !touchEnd) return;

		const distanceX = touchStart.x - touchEnd.x;
		const distanceY = touchStart.y - touchEnd.y;
		const isVerticalSwipe = Math.abs(distanceY) > Math.abs(distanceX);

		if (isVerticalSwipe && Math.abs(distanceY) > minSwipeDistance) {
			if (distanceY > 0) {
				// Swipe up - next section
				navigateToSection(currentSectionIndex + 1);
			} else {
				// Swipe down - previous section
				navigateToSection(currentSectionIndex - 1);
			}
		}
	};

	const navigateToSection = (index: number) => {
		if (!outline?.sections?.length) return;

		const newIndex = Math.max(0, Math.min(index, outline.sections.length - 1));
		setCurrentSectionIndex(newIndex);

		// Auto-jump to the section's timestamp
		const section = outline.sections[newIndex];
		if (section?.start) {
			jumpTo(section.start);
		}
	};

	// Reset section index when outline changes
	useEffect(() => {
		setCurrentSectionIndex(0);
	}, [outline]);

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
		<div className="font-sans min-h-screen bg-black">
			{/* Input Section - Only shown when no transcript */}
			{!transcript && (
				<div className="bg-white min-h-screen flex items-center justify-center">
					<div className="w-full max-w-sm px-6">
						<div className="text-center mb-12">
							<h1 className="text-3xl font-normal text-black mb-3">TLDW</h1>
							<p className="text-gray-500">
								Turn long videos into digestible clips
							</p>
						</div>

						<div className="space-y-6">
							<input
								id="url"
								type="text"
								value={url}
								onChange={(e) => setUrl(e.target.value)}
								placeholder="YouTube URL"
								className="w-full px-0 py-4 border-0 border-b border-gray-200 focus:border-black focus:outline-none text-base bg-transparent"
								disabled={loading}
							/>

							<button
								onClick={extractTranscript}
								disabled={loading}
								className="w-full bg-black hover:bg-gray-800 disabled:bg-gray-400 text-white font-normal py-4 transition-colors text-base"
							>
								{loading ? 'Processing...' : 'Get Clips'}
							</button>

							{fromCache.transcript && (
								<div className="text-center">
									<span className="text-xs text-gray-500">
										Loaded from cache
									</span>
								</div>
							)}
						</div>

						{error && (
							<div className="mt-6 text-center">
								<p className="text-red-500 text-sm">{error}</p>
							</div>
						)}
					</div>
				</div>
			)}

			{/* Main Content - Video + Clips */}
			{transcript && (
				<div className="relative">
					{/* Fixed Video Player at Top */}
					<div className="sticky top-0 z-10 bg-black">
						<div className="w-full aspect-video">
							<div id="player" className="w-full h-full" />
						</div>

						{/* Video Controls/Info Bar */}
						<div className="bg-black border-b border-gray-900 px-6 py-3">
							<div className="flex items-center justify-between">
								<div className="flex items-center gap-3">
									{fromCache.outline && (
										<span className="text-xs text-gray-500">Cached</span>
									)}
									{outlineLoading && (
										<span className="text-xs text-gray-500">Processing...</span>
									)}
								</div>
								<div className="flex items-center gap-4">
									{(fromCache.transcript || fromCache.outline) && (
										<button
											onClick={clearCache}
											className="text-xs text-gray-500 hover:text-white transition-colors"
										>
											Clear Cache
										</button>
									)}
									<button
										onClick={() => {
											setTranscript('');
											setSegments([]);
											setOutline(null);
											setVideoId('');
											setUrl('');
											setError('');
											setFromCache({ transcript: false, outline: false });
										}}
										className="text-xs text-gray-500 hover:text-white transition-colors"
									>
										New Video
									</button>
								</div>
							</div>
						</div>
					</div>

					{/* Swipeable Clips Feed */}
					<div className="bg-white min-h-screen">
						{outline?.sections?.length ? (
							<div
								className="relative"
								onTouchStart={onTouchStart}
								onTouchMove={onTouchMove}
								onTouchEnd={onTouchEnd}
							>
								{/* Current Section Display */}
								{outline.sections[currentSectionIndex] && (
									<div className="px-6 py-8 min-h-[80vh] pb-24">
										{/* Section Header */}
										<button
											type="button"
											onClick={() =>
												jumpTo(outline.sections[currentSectionIndex].start)
											}
											className="w-full text-left mb-12 group"
										>
											<div className="flex items-start justify-between gap-6">
												<h2 className="text-2xl font-normal text-black leading-tight">
													{outline.sections[currentSectionIndex].title}
												</h2>
												<span className="text-sm text-gray-500 mt-1">
													{formatRange(
														outline.sections[currentSectionIndex].start,
														outline.sections[currentSectionIndex].end
													)}
												</span>
											</div>
										</button>

										{/* Section Items */}
										{!!outline.sections[currentSectionIndex].items?.length && (
											<div className="space-y-8">
												{outline.sections[currentSectionIndex].items.map(
													(item, j) => (
														<button
															key={j}
															type="button"
															onClick={() => jumpTo(item.start)}
															className="w-full text-left group"
														>
															<div className="pb-6 border-b border-gray-100 hover:border-gray-200 transition-colors">
																<div className="flex items-start justify-between gap-6 mb-3">
																	<h3 className="text-lg font-normal text-black">
																		{item.title}
																	</h3>
																	<span className="text-sm text-gray-400 mt-1">
																		{formatRange(item.start, item.end)}
																	</span>
																</div>
																{item.summary && (
																	<p className="text-gray-600 leading-relaxed">
																		{item.summary}
																	</p>
																)}
															</div>
														</button>
													)
												)}
											</div>
										)}
									</div>
								)}
							</div>
						) : (
							<div className="text-center py-16 text-gray-400">
								<p>No clips available.</p>
							</div>
						)}
					</div>
				</div>
			)}

			{/* Fixed Progress Bar at Bottom */}
			{transcript && outline?.sections?.length && (
				<div className="fixed bottom-0 left-0 right-0 z-30 bg-white/95 backdrop-blur-sm border-t border-gray-100 px-6 py-4">
					<div className="flex items-center justify-center gap-1 mb-2">
						{outline.sections.map((_, idx) => (
							<button
								key={idx}
								onClick={() => navigateToSection(idx)}
								className={`h-1 rounded-full transition-all ${
									idx === currentSectionIndex
										? 'bg-black w-8'
										: 'bg-gray-200 w-1 hover:bg-gray-300'
								}`}
							/>
						))}
					</div>
					<div className="text-xs text-gray-400 text-center">
						{currentSectionIndex + 1} of {outline.sections.length}
					</div>
				</div>
			)}
		</div>
	);
}
