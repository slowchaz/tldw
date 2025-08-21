import Database from 'better-sqlite3';
import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';

export interface TranscriptSegment {
	start: number;
	end: number;
	startTime: string;
	endTime: string;
	text: string;
}

export interface Chapter {
	start_time: number;
	end_time?: number;
	title: string;
}

export interface OutlineItem {
	title: string;
	start: number;
	end?: number;
	directQuote: string;
}

export interface ProcessedContent {
	id?: number;
	videoId: string;
	hookQuote: string;
	hookQuoteTimestamp: number;
	principles: OutlineItem[];
	createdAt?: string;
}

export interface VideoRecord {
	id?: number;
	videoId: string;
	title: string;
	url: string;
	createdAt?: string;
	updatedAt?: string;
}

export interface TranscriptRecord {
	id?: number;
	videoId: string;
	segments: TranscriptSegment[];
	chapters?: Chapter[];
	createdAt?: string;
}

let db: Database.Database | null = null;

function getDatabase(): Database.Database {
	if (!db) {
		const dbPath = join(process.cwd(), 'data', 'tldw.db');
		console.log('Initializing database at path:', dbPath);
		
		// Ensure data directory exists
		const dataDir = join(process.cwd(), 'data');
		try {
			if (!existsSync(dataDir)) {
				mkdirSync(dataDir, { recursive: true });
				console.log('Created data directory:', dataDir);
			}
		} catch (error) {
			console.error('Failed to create data directory:', error);
		}
		
		db = new Database(dbPath);
		console.log('Database connection established');
		
		// Enable WAL mode for better performance
		db.pragma('journal_mode = WAL');
		
		initializeSchema();
		console.log('Database schema initialized');
	}
	return db;
}

function initializeSchema(): void {
	const db = getDatabase();
	
	// Create tables if they don't exist
	db.exec(`
		CREATE TABLE IF NOT EXISTS videos (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			video_id TEXT UNIQUE NOT NULL,
			title TEXT NOT NULL,
			url TEXT NOT NULL,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
		);

		CREATE TABLE IF NOT EXISTS transcripts (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			video_id TEXT NOT NULL,
			segments TEXT NOT NULL,
			chapters TEXT,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (video_id) REFERENCES videos (video_id)
		);

		CREATE TABLE IF NOT EXISTS processed_content (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			video_id TEXT NOT NULL,
			hook_quote TEXT NOT NULL,
			hook_quote_timestamp INTEGER NOT NULL,
			principles TEXT NOT NULL,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (video_id) REFERENCES videos (video_id)
		);

		CREATE INDEX IF NOT EXISTS idx_videos_video_id ON videos (video_id);
		CREATE INDEX IF NOT EXISTS idx_transcripts_video_id ON transcripts (video_id);
		CREATE INDEX IF NOT EXISTS idx_processed_content_video_id ON processed_content (video_id);
	`);
}

// Video operations
export function saveVideo(videoData: Omit<VideoRecord, 'id' | 'createdAt' | 'updatedAt'>): VideoRecord {
	const db = getDatabase();
	
	const stmt = db.prepare(`
		INSERT OR REPLACE INTO videos (video_id, title, url, updated_at)
		VALUES (?, ?, ?, CURRENT_TIMESTAMP)
	`);
	
	stmt.run(videoData.videoId, videoData.title, videoData.url);
	
	const selectStmt = db.prepare('SELECT * FROM videos WHERE video_id = ?');
	return selectStmt.get(videoData.videoId) as VideoRecord;
}

export function getVideo(videoId: string): VideoRecord | null {
	const db = getDatabase();
	
	const stmt = db.prepare('SELECT * FROM videos WHERE video_id = ?');
	return stmt.get(videoId) as VideoRecord | null;
}

// Transcript operations
export function saveTranscript(transcriptData: Omit<TranscriptRecord, 'id' | 'createdAt'>): TranscriptRecord {
	const db = getDatabase();
	
	const stmt = db.prepare(`
		INSERT OR REPLACE INTO transcripts (video_id, segments, chapters)
		VALUES (?, ?, ?)
	`);
	
	stmt.run(
		transcriptData.videoId,
		JSON.stringify(transcriptData.segments),
		transcriptData.chapters ? JSON.stringify(transcriptData.chapters) : null
	);
	
	const selectStmt = db.prepare('SELECT * FROM transcripts WHERE video_id = ?');
	const record = selectStmt.get(transcriptData.videoId) as {
		id: number;
		video_id: string;
		segments: string;
		chapters?: string;
		created_at: string;
	};
	
	return {
		id: record.id,
		videoId: record.video_id,
		segments: JSON.parse(record.segments),
		chapters: record.chapters ? JSON.parse(record.chapters) : undefined,
		createdAt: record.created_at,
	};
}

export function getTranscript(videoId: string): TranscriptRecord | null {
	const db = getDatabase();
	
	const stmt = db.prepare('SELECT * FROM transcripts WHERE video_id = ?');
	const record = stmt.get(videoId) as {
		id: number;
		video_id: string;
		segments: string;
		chapters?: string;
		created_at: string;
	} | undefined;
	
	if (!record) return null;
	
	return {
		id: record.id,
		videoId: record.video_id,
		segments: JSON.parse(record.segments),
		chapters: record.chapters ? JSON.parse(record.chapters) : undefined,
		createdAt: record.created_at,
	};
}

// Processed content operations
export function saveProcessedContent(contentData: Omit<ProcessedContent, 'id' | 'createdAt'>): ProcessedContent {
	const db = getDatabase();
	
	console.log('Saving processed content to database:', {
		videoId: contentData.videoId,
		hookQuoteLength: contentData.hookQuote.length,
		principlesCount: contentData.principles.length
	});
	
	const stmt = db.prepare(`
		INSERT OR REPLACE INTO processed_content (video_id, hook_quote, hook_quote_timestamp, principles)
		VALUES (?, ?, ?, ?)
	`);
	
	const principlesJson = JSON.stringify(contentData.principles);
	console.log('Principles JSON length:', principlesJson.length);
	
	const result = stmt.run(
		contentData.videoId,
		contentData.hookQuote,
		contentData.hookQuoteTimestamp,
		principlesJson
	);
	
	console.log('Database insert result:', {
		changes: result.changes,
		lastInsertRowid: result.lastInsertRowid
	});
	
	const selectStmt = db.prepare('SELECT * FROM processed_content WHERE video_id = ?');
	const record = selectStmt.get(contentData.videoId) as {
		id: number;
		video_id: string;
		hook_quote: string;
		hook_quote_timestamp: number;
		principles: string;
		created_at: string;
	};
	
	if (!record) {
		throw new Error(`Failed to retrieve saved processed content for videoId: ${contentData.videoId}`);
	}
	
	console.log('Successfully retrieved saved record from database');
	
	return {
		id: record.id,
		videoId: record.video_id,
		hookQuote: record.hook_quote,
		hookQuoteTimestamp: record.hook_quote_timestamp,
		principles: JSON.parse(record.principles),
		createdAt: record.created_at,
	};
}

export function getProcessedContent(videoId: string): ProcessedContent | null {
	const db = getDatabase();
	
	console.log('Querying database for processed content with videoId:', videoId);
	
	const stmt = db.prepare('SELECT * FROM processed_content WHERE video_id = ?');
	const record = stmt.get(videoId) as {
		id: number;
		video_id: string;
		hook_quote: string;
		hook_quote_timestamp: number;
		principles: string;
		created_at: string;
	} | undefined;
	
	if (!record) {
		console.log('No processed content found in database for videoId:', videoId);
		return null;
	}
	
	console.log('Found processed content in database:', {
		id: record.id,
		videoId: record.video_id,
		hookQuoteLength: record.hook_quote.length,
		principlesJsonLength: record.principles.length,
		createdAt: record.created_at
	});
	
	try {
		const principles = JSON.parse(record.principles);
		console.log('Successfully parsed principles JSON, count:', principles.length);
		
		return {
			id: record.id,
			videoId: record.video_id,
			hookQuote: record.hook_quote,
			hookQuoteTimestamp: record.hook_quote_timestamp,
			principles: principles,
			createdAt: record.created_at,
		};
	} catch (parseError) {
		console.error('Failed to parse principles JSON:', parseError);
		return null;
	}
}

// Combined operations
export function getVideoWithContent(videoId: string): {
	video: VideoRecord | null;
	transcript: TranscriptRecord | null;
	processedContent: ProcessedContent | null;
} {
	return {
		video: getVideo(videoId),
		transcript: getTranscript(videoId),
		processedContent: getProcessedContent(videoId),
	};
}

export function hasCompleteData(videoId: string): boolean {
	const { video, transcript, processedContent } = getVideoWithContent(videoId);
	return !!(video && transcript && processedContent);
}

// Delete functions
export function deleteVideo(videoId: string): boolean {
	const db = getDatabase();
	
	try {
		db.transaction(() => {
			// Delete in reverse dependency order to avoid foreign key constraints
			db.prepare('DELETE FROM processed_content WHERE video_id = ?').run(videoId);
			db.prepare('DELETE FROM transcripts WHERE video_id = ?').run(videoId);
			db.prepare('DELETE FROM videos WHERE video_id = ?').run(videoId);
		})();
		
		console.log('Successfully deleted all data for videoId:', videoId);
		return true;
	} catch (error) {
		console.error('Failed to delete video data:', error);
		return false;
	}
}

export function deleteProcessedContent(videoId: string): boolean {
	const db = getDatabase();
	
	try {
		const result = db.prepare('DELETE FROM processed_content WHERE video_id = ?').run(videoId);
		console.log('Deleted processed content for videoId:', videoId, 'Changes:', result.changes);
		return result.changes > 0;
	} catch (error) {
		console.error('Failed to delete processed content:', error);
		return false;
	}
}

export function deleteTranscript(videoId: string): boolean {
	const db = getDatabase();
	
	try {
		const result = db.prepare('DELETE FROM transcripts WHERE video_id = ?').run(videoId);
		console.log('Deleted transcript for videoId:', videoId, 'Changes:', result.changes);
		return result.changes > 0;
	} catch (error) {
		console.error('Failed to delete transcript:', error);
		return false;
	}
}

// Cleanup function for testing
export function closeDatabase(): void {
	if (db) {
		db.close();
		db = null;
	}
}