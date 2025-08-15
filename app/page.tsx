'use client';

import { useEffect, useRef, useState, useMemo, useCallback } from 'react';

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

type Chapter = {
	start_time: number;
	end_time?: number;
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

// Content View Component - Same structure for mobile and desktop
function ContentView({
	outline,
	videoTitle,
	viewMode,
	setViewMode,
	selectedSectionIndex,
	setSelectedSectionIndex,
	currentSectionIndex,
	setCurrentSectionIndex,
	getCurrentActiveContent,
	selectTitle,
	selectInsight,
	formatRange,
	// Individual view props
	segments,
	currentVideoTime,
	jumpTo,
	touchStart,
	touchEnd,
	swipeDirection,
	isNavigating,
	onTouchStart,
	onTouchMove,
	onTouchEnd,
	formatSeconds,
	navigateToFlatIndex,
	getCurrentFlatIndex,
	createFlatNavigation,
}: any) {
	// Calculate video progress percentage
	const getVideoProgress = useMemo(() => {
		if (!segments.length || !currentVideoTime) return 0;

		// Get the total duration from the last segment
		const totalDuration = segments[segments.length - 1]?.end || 0;
		if (totalDuration === 0) return 0;

		// Calculate progress as percentage
		const progress = Math.min(
			100,
			Math.max(0, (currentVideoTime / totalDuration) * 100)
		);
		return progress;
	}, [segments, currentVideoTime]);

	return (
		<div className="content-view min-h-screen lg:min-h-0 lg:h-full bg-white">
			{/* Title Selection View */}
			{viewMode === 'titles' && (
				<div className="h-full">
					{outline?.items?.length ? (
						<div className="h-full flex flex-col">
							<div className="bg-black text-white py-8 px-8 text-center lg:py-6 flex-shrink-0">
								<h2 className="text-2xl font-bold text-white tracking-tight lg:text-xl">
									{videoTitle || 'CHOOSE A TOPIC'}
								</h2>
							</div>
							{/* Hook Quote Section */}
							{outline?.hookQuote && (
								<div className="bg-gray-50 px-8 py-8 border-b border-gray-200 lg:px-6 lg:py-6">
									<div className="max-w-3xl mx-auto lg:max-w-none text-center">
										<button
											type="button"
											onClick={() => jumpTo(outline.hookQuoteTimestamp)}
											className="group w-full hover:bg-gray-100 rounded-lg p-6 transition-all duration-200"
										>
											<div className="text-xs font-medium tracking-wider uppercase text-gray-500 mb-3">
												Hook Quote
											</div>
											<blockquote className="text-lg font-medium text-gray-800 italic leading-relaxed lg:text-base">
												"{outline.hookQuote}"
											</blockquote>
											<div className="text-xs font-medium tracking-wider uppercase text-gray-400 mt-3">
												{formatSeconds(outline.hookQuoteTimestamp)}
											</div>
										</button>
									</div>
								</div>
							)}
							<div className="flex-1 overflow-y-auto">
								<div className="max-w-3xl mx-auto lg:max-w-none">
									{outline.items.map((item: any, index: number) => (
										<div key={index}>
											<div
												className={`group transition-all duration-200 ${
													getCurrentActiveContent.itemIndex === index
														? 'bg-black text-white accent-highlight active'
														: 'hover:bg-gray-50 accent-highlight'
												}`}
											>
												<div className="px-8 lg:px-6">
													<button
														type="button"
														onClick={() => selectTitle(index)}
														className="w-full text-left py-8 lg:py-6"
													>
														<div className="flex items-start gap-6 lg:gap-4">
															<span
																className={`text-2xl font-medium min-w-[3rem] transition-colors lg:text-xl lg:min-w-[2.5rem] ${
																	getCurrentActiveContent.itemIndex === index
																		? 'text-white'
																		: 'text-gray-400'
																}`}
															>
																{String(index + 1).padStart(2, '0')}.
															</span>
															<div className="flex-1 min-w-0">
																<h3
																	className={`text-xl font-bold mb-3 leading-tight tracking-tight lg:text-lg lg:mb-2 ${
																		getCurrentActiveContent.itemIndex === index
																			? 'text-white'
																			: 'text-black'
																	}`}
																>
																	{item.title}
																</h3>
																<div className="flex items-center justify-between mb-3 lg:mb-2">
																	<span
																		className={`text-xs font-medium tracking-wider uppercase ${
																			getCurrentActiveContent.itemIndex ===
																			index
																				? 'text-gray-300'
																				: 'text-gray-500'
																		}`}
																	>
																		{formatRange(item.start, item.end)}
																	</span>
																</div>
																{item.directQuote && (
																	<p
																		className={`text-sm leading-relaxed font-normal italic ${
																			getCurrentActiveContent.itemIndex ===
																			index
																				? 'text-gray-300'
																				: 'text-gray-600'
																		}`}
																	>
																		"{item.directQuote}"
																	</p>
																)}
															</div>
														</div>
													</button>
												</div>
											</div>
											{index < outline.items.length - 1 && (
												<div className="border-b border-gray-200 lg:border-gray-300"></div>
											)}
										</div>
									))}
								</div>
							</div>
						</div>
					) : (
						<div className="h-full flex items-center justify-center">
							<p className="text-gray-400 font-medium tracking-wider uppercase text-sm">
								No insights available.
							</p>
						</div>
					)}
				</div>
			)}

			{/* Individual Insight View - Mobile/Tablet Only */}
			{viewMode === 'individual' && outline?.items?.length && (
				<div className="h-full relative overflow-hidden">
					{(() => {
						const activeContent = getCurrentActiveContent;

						// Get the currently playing item from the flat items array
						const currentItem =
							outline.items[activeContent.itemIndex] ||
							outline.items[0] ||
							null;

						return (
							<div className="h-full flex flex-col relative">
								{/* Right Side Controls - Navigation & Progress Bar */}
								<div className="absolute right-6 z-30 flex flex-col items-center top-1/2 -translate-y-1/2 lg:right-4">
									{/* Navigation Indicators */}
									<div className="flex flex-col items-center space-y-2 mb-6">
										<button
											type="button"
											onClick={() =>
												navigateToFlatIndex(getCurrentFlatIndex - 1)
											}
											className={`w-9 h-9 flex items-center justify-center rounded-full transition-all duration-200 hover:bg-gray-100 ${
												swipeDirection === 'down'
													? 'scale-110 text-black'
													: 'text-gray-400 hover:text-black'
											}`}
											aria-label="Previous insight"
										>
											<svg
												className="w-5 h-5"
												fill="none"
												stroke="currentColor"
												viewBox="0 0 24 24"
											>
												<path
													strokeLinecap="round"
													strokeLinejoin="round"
													strokeWidth={2.5}
													d="M5 15l7-7 7 7"
												/>
											</svg>
										</button>
										<div className="text-xs text-gray-400 font-medium tracking-wider lg:hidden">
											SWIPE
										</div>
										<button
											type="button"
											onClick={() =>
												navigateToFlatIndex(getCurrentFlatIndex + 1)
											}
											className={`w-9 h-9 flex items-center justify-center rounded-full transition-all duration-200 hover:bg-gray-100 ${
												swipeDirection === 'up'
													? 'scale-110 text-black'
													: 'text-gray-400 hover:text-black'
											}`}
											aria-label="Next insight"
										>
											<svg
												className="w-5 h-5"
												fill="none"
												stroke="currentColor"
												viewBox="0 0 24 24"
											>
												<path
													strokeLinecap="round"
													strokeLinejoin="round"
													strokeWidth={2.5}
													d="M19 9l-7 7-7-7"
												/>
											</svg>
										</button>
									</div>

									{/* Navigation Progress Bar */}
									<div className="flex flex-col items-center">
										<div className="h-48 w-1 bg-gray-200 rounded-full relative transition-all duration-150 lg:h-32">
											{/* Progress fill */}
											<div
												className="rounded-full w-full transition-all duration-300 ease-out bg-black"
												style={{
													height: `${getVideoProgress}%`,
													transition: 'height 0.3s ease-out',
												}}
											/>
											{/* Current position indicator */}
											<div
												className="absolute w-3 h-3 rounded-full -left-1 transform -translate-y-1/2 transition-all duration-150 bg-black"
												style={{
													top: `${getVideoProgress}%`,
												}}
											/>
										</div>
										<div className="text-xs font-medium mt-3 transition-colors duration-150 tracking-wider text-gray-400">
											{Math.round(getVideoProgress)}%
										</div>
									</div>
								</div>

								{/* Fixed Title at Top */}
								<div className="bg-black text-white py-8 px-8 relative z-20 lg:py-6 flex-shrink-0">
									<h2 className="text-2xl font-bold leading-tight text-center tracking-tight lg:text-xl">
										{currentItem?.title || videoTitle || 'Insights'}
									</h2>
								</div>

								{/* Scrollable Content Area */}
								<div
									className="flex-1 relative overflow-hidden"
									onTouchStart={onTouchStart}
									onTouchMove={onTouchMove}
									onTouchEnd={onTouchEnd}
								>
									<div
										className="h-full transition-all duration-150 ease-out"
										style={{
											transform: isNavigating
												? swipeDirection === 'up'
													? 'translateY(-20px)'
													: 'translateY(20px)'
												: 'translateY(0)',
											opacity: isNavigating ? 0.7 : 1,
										}}
									>
										<div className="flex items-center justify-center px-6 h-full relative">
											{/* Swipe hint on first load - Hidden on desktop */}
											{!isNavigating && getCurrentFlatIndex === 0 && (
												<div className="absolute top-8 left-1/2 transform -translate-x-1/2 bg-gray-100 text-gray-600 px-6 py-3 rounded-full text-xs font-medium tracking-wider uppercase animate-pulse lg:hidden">
													Swipe for more insights
												</div>
											)}

											{currentItem ? (
												<div className="w-full max-w-2xl lg:max-w-none">
													<button
														type="button"
														onClick={() => {
															// Only jump if this item is not already playing
															const activeContent = getCurrentActiveContent;
															const currentItemIndex = activeContent.itemIndex;

															// Check if the displayed item is the currently playing item
															const isCurrentlyPlaying =
																outline.items[currentItemIndex] === currentItem;

															if (!isCurrentlyPlaying && currentItem?.start) {
																jumpTo(currentItem.start);
															}
														}}
														className="w-full group"
													>
														<div className="p-12 transition-all lg:p-8">
															<div className="text-center mb-6 lg:mb-4">
																<h3 className="text-3xl font-bold mb-4 text-black leading-tight tracking-tight lg:text-2xl lg:mb-3">
																	{currentItem.title}
																</h3>
																<span className="text-xs text-gray-500 font-medium tracking-wider uppercase">
																	{formatRange(
																		currentItem.start,
																		currentItem.end
																	)}
																</span>
															</div>
															{currentItem.directQuote && (
																<blockquote className="leading-relaxed text-center text-lg text-gray-700 font-normal max-w-2xl mx-auto lg:text-base lg:leading-relaxed italic border-l-4 border-gray-300 pl-6">
																	"{currentItem.directQuote}"
																</blockquote>
															)}
														</div>
													</button>
												</div>
											) : (
												<div className="text-center text-gray-400">
													<p className="font-medium tracking-wider uppercase text-sm">
														No insights available for this section
													</p>
												</div>
											)}
										</div>
									</div>
								</div>
							</div>
						);
					})()}
				</div>
			)}
		</div>
	);
}

export default function Home() {
	const [url, setUrl] = useState('');
	const [loading, setLoading] = useState(false);
	const [transcript, setTranscript] = useState('');
	const [error, setError] = useState('');
	const [videoId, setVideoId] = useState<string>('');
	const [videoTitle, setVideoTitle] = useState<string>('');
	const [segments, setSegments] = useState<TranscriptSegment[]>([]);
	const [chapters, setChapters] = useState<Chapter[]>([]);
	const [outline, setOutline] = useState<OutlineResponse | null>(null);
	const [outlineLoading, setOutlineLoading] = useState(false);
	const [fromCache, setFromCache] = useState({
		transcript: false,
		outline: false,
	});
	const [currentVideoTime, setCurrentVideoTime] = useState(0);
	const [viewMode, setViewMode] = useState<'titles' | 'individual'>('titles');
	const [touchStart, setTouchStart] = useState<{ x: number; y: number } | null>(
		null
	);
	const [touchEnd, setTouchEnd] = useState<{ x: number; y: number } | null>(
		null
	);
	const [swipeDirection, setSwipeDirection] = useState<'up' | 'down' | null>(
		null
	);
	const [isNavigating, setIsNavigating] = useState(false);

	const playerRef = useRef<any | null>(null);
	const apiReadyPromiseRef = useRef<Promise<void> | null>(null);
	const [playerReady, setPlayerReady] = useState(false);
	const pendingJumpRef = useRef<number | null>(null);
	const touchStartTimeRef = useRef<number>(0);
	const lastNavigationTimeRef = useRef<number>(0);

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
		data: {
			segments: TranscriptSegment[];
			videoTitle?: string;
			chapters?: Chapter[];
		}
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
			setPlayerReady(false);
			pendingJumpRef.current = null;
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
		setChapters([]);
		setOutline(null);
		setVideoTitle('');
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
				if (cachedTranscript.videoTitle) {
					setVideoTitle(cachedTranscript.videoTitle);
				}
				if (cachedTranscript.chapters) {
					setChapters(cachedTranscript.chapters);
				}
				setFromCache((prev) => ({ ...prev, transcript: true }));
				setLoading(false);
				// Process outline (which will also check cache)
				void processOutline(
					cachedTranscript.segments,
					parsedId,
					cachedTranscript.chapters
				);
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
						videoTitle: data.videoTitle,
						chapters: (data.chapters as Chapter[]) || [],
					};
					setSegments(transcriptData.segments);
					setTranscript(transcriptData.segments.map((s) => s.text).join('\n'));
					setChapters(transcriptData.chapters);

					// Cache the transcript data
					if (data.videoId || parsedId) {
						setCachedTranscript(data.videoId || parsedId!, transcriptData);
					}

					// Kick off processing to outline with the received segments
					void processOutline(
						transcriptData.segments,
						data.videoId || parsedId,
						transcriptData.chapters
					);
				}
				if (data.videoId) {
					setVideoId(data.videoId);
				}
				if (data.videoTitle) {
					setVideoTitle(data.videoTitle);
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
		currentVideoId?: string,
		currentChapters: Chapter[] = []
	) => {
		if (!currentSegments?.length) return;
		setOutlineLoading(true);

		// Check cache first if we have a videoId
		const videoIdToUse = currentVideoId || videoId;
		if (videoIdToUse) {
			const cachedOutline = getCachedOutline(videoIdToUse);
			if (cachedOutline && Array.isArray(cachedOutline.items)) {
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
				body: JSON.stringify({
					segments: currentSegments,
					chapters: currentChapters,
				}),
			});
			const data = await res.json();
			if (data?.success && data?.outline?.items) {
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

	const jumpTo = useCallback(
		(seconds: number) => {
			if (!seconds) return;

			// If player is not ready, store the pending jump
			if (!playerReady || !playerRef.current) {
				pendingJumpRef.current = seconds;
				return;
			}

			try {
				playerRef.current.seekTo(seconds, true);
				if (typeof playerRef.current.playVideo === 'function') {
					playerRef.current.playVideo();
				}
				// Clear any pending jump since we successfully jumped
				pendingJumpRef.current = null;
			} catch {
				// Store as pending jump if API call fails
				pendingJumpRef.current = seconds;
			}
		},
		[playerReady]
	);

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

	// Swipe functionality - Smooth immediate navigation
	const minSwipeDistance = 15; // Lower threshold for more responsive navigation
	const quickSwipeDistance = 8; // Ultra-quick swipe for fast gestures
	const navigationDebounceMs = 100; // Reduced debounce for better responsiveness

	const onTouchStart = (e: React.TouchEvent) => {
		setTouchEnd(null);
		setTouchStart({
			x: e.targetTouches[0].clientX,
			y: e.targetTouches[0].clientY,
		});
		setSwipeDirection(null);
		setIsNavigating(false);
		// Store timestamp for velocity calculation
		touchStartTimeRef.current = Date.now();
	};

	const onTouchMove = (e: React.TouchEvent) => {
		if (!touchStart || isNavigating) return;

		// Time-based debouncing to prevent rapid navigation
		const now = Date.now();
		if (now - lastNavigationTimeRef.current < navigationDebounceMs) return;

		const currentTouch = {
			x: e.targetTouches[0].clientX,
			y: e.targetTouches[0].clientY,
		};

		setTouchEnd(currentTouch);

		const distanceY = touchStart.y - currentTouch.y;
		const distanceX = touchStart.x - currentTouch.x;
		const isVerticalSwipe = Math.abs(distanceY) > Math.abs(distanceX);

		// Calculate velocity for quick swipes
		const currentTime = Date.now();
		const timeElapsed = currentTime - touchStartTimeRef.current;
		const velocity = timeElapsed > 0 ? Math.abs(distanceY) / timeElapsed : 0;

		if (isVerticalSwipe) {
			// Quick navigation for fast swipes or longer distances
			const shouldNavigate =
				Math.abs(distanceY) > minSwipeDistance ||
				(Math.abs(distanceY) > quickSwipeDistance && velocity > 0.5);

			if (shouldNavigate) {
				// Record navigation time for debouncing
				lastNavigationTimeRef.current = now;

				// Simple immediate navigation
				setIsNavigating(true);

				if (distanceY > 0) {
					// Swipe up - next item
					setSwipeDirection('up');
					navigateToFlatIndex(getCurrentFlatIndex + 1);
				} else {
					// Swipe down - previous item
					setSwipeDirection('down');
					navigateToFlatIndex(getCurrentFlatIndex - 1);
				}

				// Quick reset after brief delay
				setTimeout(() => {
					setIsNavigating(false);
					setSwipeDirection(null);
				}, 100);
			} else if (Math.abs(distanceY) > 5) {
				// Show direction hint for smaller movements
				setSwipeDirection(distanceY > 0 ? 'up' : 'down');
			}
		}
	};

	const onTouchEnd = () => {
		// Clean up swipe direction if not navigating
		if (!isNavigating) {
			setSwipeDirection(null);
		}
	};

	const selectTitle = (itemIndex: number) => {
		// Go to individual view on mobile/tablet, stay in titles on desktop
		if (window.innerWidth < 1024) {
			setViewMode('individual');
		}

		// Only jump to video if this item is not already playing
		const activeContent = getCurrentActiveContent;
		const isAlreadyPlaying = activeContent.itemIndex === itemIndex;

		if (!isAlreadyPlaying) {
			const item = outline?.items?.[itemIndex];
			if (item?.start) {
				jumpTo(item.start);
			}
		}
	};

	// Reset states when outline changes
	useEffect(() => {
		setViewMode('titles');
		// Clear any pending jumps when outline changes
		pendingJumpRef.current = null;
	}, [outline]);

	// Handle going back to title selection
	useEffect(() => {
		if (viewMode === 'titles') {
			// Clear any pending jumps when going back to titles
			pendingJumpRef.current = null;
		}
	}, [viewMode]);

	// Get current active item based on video time
	const getCurrentActiveContent = useMemo(() => {
		if (!outline?.items?.length) {
			return { itemIndex: 0 };
		}

		// If no video time yet, return first item
		if (!currentVideoTime) {
			return { itemIndex: 0 };
		}

		// Find the item that contains the current time
		for (let i = 0; i < outline.items.length; i++) {
			const item = outline.items[i];
			const nextItem = outline.items[i + 1];

			// Check if current time is within this item
			const inItem =
				currentVideoTime >= item.start - 1 && // Add 1 second buffer before
				(!nextItem || currentVideoTime < nextItem.start);

			if (inItem) {
				return { itemIndex: i };
			}
		}

		// If we're beyond all items, return the last item
		const lastItemIndex = outline.items.length - 1;
		return { itemIndex: lastItemIndex };
	}, [outline, currentVideoTime]);

	// Navigation system - now simply works with the flat items array
	const createFlatNavigation = useMemo(() => {
		if (!outline?.items?.length) return [];
		return outline.items;
	}, [outline]);

	// Get current flat navigation index
	const getCurrentFlatIndex = useMemo(() => {
		const activeContent = getCurrentActiveContent;
		return activeContent.itemIndex;
	}, [getCurrentActiveContent]);

	// Navigate to flat index
	const navigateToFlatIndex = (index: number) => {
		if (!outline?.items?.length) return;

		const clampedIndex = Math.max(0, Math.min(index, outline.items.length - 1));
		const targetItem = outline.items[clampedIndex];

		if (!targetItem) return;

		// Jump to the timestamp
		if (targetItem.start) {
			jumpTo(targetItem.start);
		}
	};

	// Handle pending jumps when player becomes ready
	useEffect(() => {
		if (playerReady && pendingJumpRef.current) {
			jumpTo(pendingJumpRef.current);
		}
	}, [playerReady, jumpTo]);

	// Track video time
	useEffect(() => {
		if (!transcript || !videoId || !playerRef.current) return;

		const interval = setInterval(() => {
			try {
				if (
					playerRef.current &&
					typeof playerRef.current.getCurrentTime === 'function'
				) {
					const time = playerRef.current.getCurrentTime();
					setCurrentVideoTime(time || 0);
				}
			} catch {
				// Ignore errors
			}
		}, 500); // Update every 500ms for better responsiveness

		return () => clearInterval(interval);
	}, [transcript, videoId, playerRef.current]);

	useEffect(() => {
		if (!transcript || !videoId) return;
		let cancelled = false;

		// Reset player ready state when initializing
		setPlayerReady(false);

		ensureYouTubeIframeAPI().then(() => {
			if (cancelled) return;
			if (playerRef.current) {
				try {
					playerRef.current.cueVideoById(videoId);
					// Player is already initialized, mark as ready
					setPlayerReady(true);
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
						cc_load_policy: 1, // Force captions to show by default
						hl: 'en', // Set the interface language (optional)
					},
					events: {
						onReady: () => {
							if (!cancelled) {
								setPlayerReady(true);
							}
						},
						onError: () => {
							if (!cancelled) {
								setPlayerReady(false);
							}
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

	return (
		<div className="font-sans min-h-screen bg-white">
			{/* Input Section - Only shown when no transcript */}
			{!transcript && (
				<div className="bg-white min-h-screen flex items-center justify-center">
					<div className="w-full max-w-sm px-8">
						<div className="text-center mb-16">
							<h1 className="text-4xl font-bold text-black mb-4 tracking-tight">
								TLDW
							</h1>
							<p className="text-gray-600 font-normal tracking-wide text-sm">
								TURN LONG VIDEOS INTO DIGESTIBLE CLIPS
							</p>
						</div>

						<div className="space-y-8">
							<div className="relative">
								<input
									id="url"
									type="text"
									value={url}
									onChange={(e) => setUrl(e.target.value)}
									placeholder="YouTube URL"
									className="input-minimal w-full px-0 py-5 text-base font-normal"
									disabled={loading}
								/>
								{/* Subtle focus indicator */}
								<div className="absolute bottom-0 left-0 h-px bg-gray-900 scale-x-0 transition-transform duration-200 focus-within:scale-x-100"></div>
							</div>

							<button
								onClick={extractTranscript}
								disabled={loading}
								className="btn-primary w-full py-5 text-base font-medium tracking-wide"
							>
								{loading ? 'PROCESSING...' : 'GET CLIPS'}
							</button>

							{fromCache.transcript && (
								<div className="text-center pt-2">
									<span className="text-xs text-gray-500 font-medium tracking-wider uppercase">
										Loaded from cache
									</span>
								</div>
							)}
						</div>

						{error && (
							<div className="mt-8 text-center">
								<p className="text-red-600 text-sm font-medium">{error}</p>
							</div>
						)}
					</div>
				</div>
			)}

			{/* Main Content */}
			{transcript && (
				<div className="lg:flex lg:h-screen">
					{/* Video Section - Top on mobile, left side on desktop */}
					<div className="sticky top-0 z-10 bg-black lg:static lg:w-2/3 lg:flex-shrink-0 lg:flex lg:flex-col lg:h-screen">
						<div className="w-full aspect-video lg:flex-1 lg:flex lg:items-center lg:justify-center lg:aspect-auto">
							<div
								id="player"
								className="w-full h-full lg:w-full lg:h-auto lg:aspect-video lg:max-h-full"
							/>
						</div>

						{/* Video Controls/Info Bar */}
						<div className="bg-black px-8 py-4 lg:flex-shrink-0">
							<div className="flex items-center justify-between">
								<div className="flex items-center gap-4">
									{/* Precise back button - only show when not in title selection */}
									{viewMode !== 'titles' && (
										<button
											onClick={() => setViewMode('titles')}
											className="flex items-center justify-center w-8 h-8 text-white hover:text-gray-300 transition-all duration-150 hover:bg-white/10 rounded-full"
											aria-label="Back"
										>
											<svg
												className="w-5 h-5"
												fill="none"
												stroke="currentColor"
												viewBox="0 0 24 24"
											>
												<path
													strokeLinecap="round"
													strokeLinejoin="round"
													strokeWidth={2.5}
													d="M15 19l-7-7 7-7"
												/>
											</svg>
										</button>
									)}
									{fromCache.outline && (
										<span className="text-xs text-gray-400 font-medium tracking-wider uppercase">
											Cached
										</span>
									)}
									{outlineLoading && (
										<span className="text-xs text-gray-400 font-medium tracking-wider uppercase">
											Processing...
										</span>
									)}
								</div>
								<div className="flex items-center gap-6">
									{(fromCache.transcript || fromCache.outline) && (
										<button
											onClick={clearCache}
											className="text-xs text-gray-400 hover:text-white transition-colors font-medium tracking-wider uppercase"
										>
											Clear Cache
										</button>
									)}
									<button
										onClick={() => {
											setTranscript('');
											setSegments([]);
											setChapters([]);
											setOutline(null);
											setVideoId('');
											setVideoTitle('');
											setUrl('');
											setError('');
											setFromCache({ transcript: false, outline: false });
											setViewMode('titles');
											if (playerRef.current) {
												try {
													playerRef.current.destroy();
												} catch {}
												playerRef.current = null;
											}
											setPlayerReady(false);
										}}
										className="text-xs text-gray-400 hover:text-white transition-colors font-medium tracking-wider uppercase"
									>
										New Video
									</button>
								</div>
							</div>
						</div>
					</div>

					{/* Content Section - Full width below video on mobile, sidebar on desktop */}
					<div className="lg:w-1/3 lg:h-screen lg:overflow-hidden lg:flex-shrink-0">
						<ContentView
							outline={outline}
							videoTitle={videoTitle}
							viewMode={viewMode}
							setViewMode={setViewMode}
							getCurrentActiveContent={getCurrentActiveContent}
							selectTitle={selectTitle}
							formatRange={formatRange}
							segments={segments}
							currentVideoTime={currentVideoTime}
							jumpTo={jumpTo}
							touchStart={touchStart}
							touchEnd={touchEnd}
							swipeDirection={swipeDirection}
							isNavigating={isNavigating}
							onTouchStart={onTouchStart}
							onTouchMove={onTouchMove}
							onTouchEnd={onTouchEnd}
							formatSeconds={formatSeconds}
							navigateToFlatIndex={navigateToFlatIndex}
							getCurrentFlatIndex={getCurrentFlatIndex}
							createFlatNavigation={createFlatNavigation}
						/>
					</div>
				</div>
			)}
		</div>
	);
}
