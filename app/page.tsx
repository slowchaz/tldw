'use client';

import { useState } from 'react';

export default function Home() {
	const [url, setUrl] = useState('');
	const [loading, setLoading] = useState(false);
	const [transcript, setTranscript] = useState('');
	const [error, setError] = useState('');

	const extractTranscript = async () => {
		if (!url.trim()) {
			setError('Please enter a YouTube URL or video ID');
			return;
		}

		setLoading(true);
		setError('');
		setTranscript('');

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
				setTranscript(data.transcript);
			} else {
				setError(data.error || 'Failed to extract transcript');
			}
		} catch (err) {
			setError('Network error: Failed to connect to transcript API');
		} finally {
			setLoading(false);
		}
	};

	return (
		<div className="font-sans min-h-screen p-8 max-w-4xl mx-auto">
			<main className="space-y-8">
				<div className="text-center">
					<h1 className="text-4xl font-bold text-gray-900 mb-4">
						TLDW - Too Long; Didn't Watch
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
						<h2 className="text-2xl font-semibold text-gray-900">Transcript</h2>
						<div className="p-4 bg-gray-50 border border-gray-200 rounded-lg">
							<p className="text-gray-800 leading-relaxed whitespace-pre-wrap">
								{transcript}
							</p>
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
