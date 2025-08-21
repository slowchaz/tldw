import { TranscriptSegment } from './database';

export interface SentenceSegment {
	text: string;
	start: number;
	end: number;
	originalSegmentIds: number[];
	wordCount: number;
	charStart?: number; // Character offset in original text
	charEnd?: number;
}

/**
 * Split transcript segments into sentence-level segments while preserving timestamps
 * Focus on maintaining coherent, complete thoughts rather than aggressive splitting
 */
export function splitIntoSentences(segments: TranscriptSegment[]): SentenceSegment[] {
	const sentences: SentenceSegment[] = [];
	
	for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex++) {
		const segment = segments[segmentIndex];
		
		// For coherency, prefer to keep segments whole unless they're clearly multiple complete thoughts
		const sentenceTexts = splitTextIntoSentences(segment.text);
		
		if (sentenceTexts.length === 1 || segment.text.length < 100) {
			// Keep as single unit if short or already one sentence
			sentences.push({
				text: segment.text.trim(),
				start: segment.start,
				end: segment.end,
				originalSegmentIds: [segmentIndex],
				wordCount: countWords(segment.text),
			});
		} else {
			// Only split longer segments with clear sentence boundaries
			const totalLength = segment.text.length;
			const duration = segment.end - segment.start;
			let currentCharOffset = 0;
			
			for (const sentenceText of sentenceTexts) {
				if (sentenceText.trim().length === 0) continue;
				
				// Skip very short fragments that likely need context
				if (countWords(sentenceText) < 5) {
					currentCharOffset += sentenceText.length;
					continue;
				}
				
				const sentenceLength = sentenceText.length;
				const proportion = sentenceLength / totalLength;
				const sentenceDuration = duration * proportion;
				
				const sentenceStart = segment.start + (duration * (currentCharOffset / totalLength));
				const sentenceEnd = sentenceStart + sentenceDuration;
				
				sentences.push({
					text: sentenceText.trim(),
					start: sentenceStart,
					end: sentenceEnd,
					originalSegmentIds: [segmentIndex],
					wordCount: countWords(sentenceText),
					charStart: currentCharOffset,
					charEnd: currentCharOffset + sentenceLength,
				});
				
				currentCharOffset += sentenceLength;
			}
		}
	}
	
	// Filter out short fragments and ensure minimum quality
	return sentences.filter(s => 
		s.text.length > 15 && // Minimum 15 characters (reduced from 20)
		s.wordCount >= 4 && // Minimum 4 words (reduced from 6)
		isCoherentThought(s.text)
	);
}

/**
 * Check if a sentence represents a coherent, standalone thought
 */
function isCoherentThought(text: string): boolean {
	const lowerText = text.toLowerCase().trim();
	
	// Reject fragments that clearly need context (relaxed - some insights start with connectors)
	const badStarters = [
		'and ', 'then ', 'also ', 'plus ',
		'or ', 'because ', 'since ', 'although ', 'though '
		// Removed 'but', 'so', 'however', 'therefore', 'thus', 'hence' - these can be good quote starters
	];
	
	if (badStarters.some(starter => lowerText.startsWith(starter))) {
		return false;
	}
	
	// Reject if it's mostly pronouns without clear referents
	const words = lowerText.split(/\s+/);
	const pronouns = ['he', 'she', 'it', 'they', 'this', 'that', 'these', 'those'];
	const pronounCount = words.filter(word => pronouns.includes(word)).length;
	
	if (pronounCount > words.length * 0.3) { // More than 30% pronouns
		return false;
	}
	
	// Must have at least one verb to be a complete thought
	const commonVerbs = ['is', 'are', 'was', 'were', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'can', 'make', 'makes', 'get', 'gets', 'go', 'goes', 'take', 'takes', 'want', 'wants', 'need', 'needs', 'think', 'thinks', 'know', 'knows', 'see', 'sees', 'come', 'comes'];
	const hasVerb = words.some(word => commonVerbs.includes(word) || word.endsWith('ing') || word.endsWith('ed'));
	
	if (!hasVerb) {
		return false;
	}
	
	return true;
}

/**
 * Remove sentences that are too close to each other in time to avoid duplicates
 */
export function deduplicateByTime(sentences: SentenceSegment[], windowSeconds: number = 30): SentenceSegment[] {
	if (sentences.length === 0) return sentences;
	
	const deduplicated: SentenceSegment[] = [sentences[0]]; // Always keep first
	
	for (let i = 1; i < sentences.length; i++) {
		const current = sentences[i];
		const lastKept = deduplicated[deduplicated.length - 1];
		
		// Keep if it's far enough from the last kept sentence
		if (current.start - lastKept.start >= windowSeconds) {
			deduplicated.push(current);
		} else {
			// If they're close, keep the one with higher quality (longer, more complete)
			const currentQuality = current.wordCount + (isCoherentThought(current.text) ? 5 : 0);
			const lastQuality = lastKept.wordCount + (isCoherentThought(lastKept.text) ? 5 : 0);
			
			if (currentQuality > lastQuality) {
				deduplicated[deduplicated.length - 1] = current; // Replace last with current
			}
			// Otherwise keep the existing one
		}
	}
	
	console.log(`Deduplicated from ${sentences.length} to ${deduplicated.length} sentences (removed ${sentences.length - deduplicated.length} temporal duplicates)`);
	return deduplicated;
}

/**
 * Split text into sentences using punctuation boundaries
 */
function splitTextIntoSentences(text: string): string[] {
	// Basic sentence splitting on periods, exclamation marks, question marks
	// This is a simple implementation - could be upgraded to spaCy/blingfire later
	
	const sentences: string[] = [];
	let currentSentence = '';
	let i = 0;
	
	while (i < text.length) {
		const char = text[i];
		currentSentence += char;
		
		// Check for sentence endings
		if (char === '.' || char === '!' || char === '?') {
			// Look ahead to see if this is likely a sentence end
			const nextChar = text[i + 1];
			const prevChar = text[i - 1];
			
			// Don't split on abbreviations like "Mr.", "Dr.", "etc."
			if (isLikelyAbbreviation(text, i)) {
				i++;
				continue;
			}
			
			// Don't split on numbers like "3.14"
			if (char === '.' && prevChar && /\d/.test(prevChar) && nextChar && /\d/.test(nextChar)) {
				i++;
				continue;
			}
			
			// This looks like a real sentence ending
			if (currentSentence.trim().length > 0) {
				sentences.push(currentSentence.trim());
				currentSentence = '';
			}
		}
		
		i++;
	}
	
	// Add any remaining text as a sentence
	if (currentSentence.trim().length > 0) {
		sentences.push(currentSentence.trim());
	}
	
	return sentences;
}

/**
 * Check if a period is likely part of an abbreviation
 */
function isLikelyAbbreviation(text: string, dotIndex: number): boolean {
	const commonAbbrevs = ['Mr', 'Mrs', 'Ms', 'Dr', 'Prof', 'Sr', 'Jr', 'etc', 'vs', 'e.g', 'i.e'];
	
	// Look at the word before the dot
	let wordStart = dotIndex - 1;
	while (wordStart > 0 && /[a-zA-Z]/.test(text[wordStart - 1])) {
		wordStart--;
	}
	
	const wordBeforeDot = text.slice(wordStart, dotIndex);
	
	// Check if it's a known abbreviation
	if (commonAbbrevs.some(abbrev => wordBeforeDot.toLowerCase() === abbrev.toLowerCase())) {
		return true;
	}
	
	// Check if it's a single uppercase letter (like "A." or "B.")
	if (wordBeforeDot.length === 1 && /[A-Z]/.test(wordBeforeDot)) {
		return true;
	}
	
	return false;
}

/**
 * Count words in text (simple whitespace-based)
 */
function countWords(text: string): number {
	return text.trim().split(/\s+/).filter(word => word.length > 0).length;
}

/**
 * Merge consecutive sentences that are very short to form more coherent segments
 * Also preserve context for quotes that might need surrounding information
 */
export function mergeShortSentences(sentences: SentenceSegment[], minWords: number = 10): SentenceSegment[] {
	const merged: SentenceSegment[] = [];
	let currentGroup: SentenceSegment[] = [];
	
	for (let i = 0; i < sentences.length; i++) {
		const sentence = sentences[i];
		currentGroup.push(sentence);
		
		const groupWordCount = currentGroup.reduce((sum, s) => sum + s.wordCount, 0);
		const groupDuration = currentGroup.length > 0 
			? currentGroup[currentGroup.length - 1].end - currentGroup[0].start 
			: 0;
		
		// Finalize group if:
		// 1. We have enough words AND it's a complete thought
		// 2. The duration is getting too long (> 15 seconds)
		// 3. This is the last sentence
		// 4. The next sentence starts a clearly new topic
		const isLastSentence = i === sentences.length - 1;
		const isLongDuration = groupDuration > 15;
		const hasEnoughWords = groupWordCount >= minWords;
		const nextSentenceNewTopic = !isLastSentence && isNewTopicStart(sentences[i + 1].text);
		
		if ((hasEnoughWords && (isLastSentence || isLongDuration || nextSentenceNewTopic)) || isLastSentence) {
			if (currentGroup.length === 1) {
				merged.push(currentGroup[0]);
			} else {
				// Merge the group with natural sentence boundaries
				const texts = currentGroup.map(s => s.text);
				const mergedText = texts.join(' ').replace(/\s+/g, ' ').trim();
				
				const mergedSentence: SentenceSegment = {
					text: mergedText,
					start: currentGroup[0].start,
					end: currentGroup[currentGroup.length - 1].end,
					originalSegmentIds: [...new Set(currentGroup.flatMap(s => s.originalSegmentIds))],
					wordCount: groupWordCount,
				};
				merged.push(mergedSentence);
			}
			currentGroup = [];
		}
	}
	
	return merged;
}

/**
 * Detect if a sentence likely starts a new topic/thought
 */
function isNewTopicStart(text: string): boolean {
	const lowerText = text.toLowerCase().trim();
	const topicStarters = [
		'now ', 'next ', 'another ', 'also ', 'additionally ', 'furthermore ',
		'moving on', 'let me ', 'let\'s ', 'the other ', 'on the other hand',
		'meanwhile', 'in contrast', 'however', 'but actually', 'actually',
		'you know what', 'here\'s the thing', 'the key is', 'what\'s interesting'
	];
	
	return topicStarters.some(starter => lowerText.startsWith(starter));
}

/**
 * Statistics helper for analyzing the sentence splitting results
 */
/**
 * PHASE 2: Heuristic scoring and pruning
 */
export function scoreSentence(sentence: SentenceSegment): number {
	let score = 0;
	const text = sentence.text.toLowerCase().trim();
	
	// Length scoring (6-28 words optimal for quotable content, less harsh penalties)
	if (sentence.wordCount < 4) score -= 8; // Reduced penalty from -10 to -8
	else if (sentence.wordCount > 40) score -= 5;
	else if (sentence.wordCount >= 6 && sentence.wordCount <= 28) score += 5;
	else if (sentence.wordCount >= 4 && sentence.wordCount <= 6) score += 2; // Small bonus for shorter insights
	
	// Standalone-ness: penalize unclear pronouns without referents
	const unclearPronouns = ['this', 'that', 'he', 'she', 'it'];
	for (const pronoun of unclearPronouns) {
		if (text.includes(` ${pronoun} `) && !hasNearbyNoun(text, pronoun)) {
			score -= 3;
		}
	}
	
	// Punchiness patterns
	if (isDeclartiveStatement(text)) score += 3;
	if (isImperative(text)) score += 4;
	if (hasContrastPattern(text)) score += 5;
	if (hasTriadPattern(text)) score += 3;
	
	// Information density (content word ratio)
	const contentWordRatio = calculateContentWordRatio(text);
	if (contentWordRatio > 0.55) score += 4;
	else if (contentWordRatio < 0.35) score -= 3;
	
	// Removed quote patterns - too domain-specific
	
	// Penalize filler words
	const fillers = ['um', 'uh', 'like you know', 'you know what i mean'];
	for (const filler of fillers) {
		if (text.includes(filler)) score -= 2;
	}
	
	return score;
}

function hasNearbyNoun(text: string, pronoun: string): boolean {
	const words = text.split(/\s+/);
	const pronounIndex = words.findIndex(w => w.toLowerCase() === pronoun);
	if (pronounIndex === -1) return true; // Be conservative
	
	// Look for nouns within 3 words before the pronoun
	const contextWords = words.slice(Math.max(0, pronounIndex - 3), pronounIndex);
	return contextWords.some(word => 
		/^[A-Z]/.test(word) || // Proper noun
		word.length > 6 // Likely content word
	);
}

function isDeclartiveStatement(text: string): boolean {
	return /\b(is|are|was|were|will be|has|have|had)\s+\w/.test(text) && 
		   !text.includes('?');
}

function isImperative(text: string): boolean {
	const imperativeStarters = ['do ', 'don\'t ', 'remember ', 'think about', 'consider', 'try to', 'make sure'];
	return imperativeStarters.some(starter => text.startsWith(starter));
}

function hasContrastPattern(text: string): boolean {
	const contrastPatterns = [
		/not .+ but .+/,
		/instead of .+ we/,
		/rather than .+/,
		/however .+/,
		/on the other hand/
	];
	return contrastPatterns.some(pattern => pattern.test(text));
}

function hasTriadPattern(text: string): boolean {
	// Look for "first, second, third" or similar patterns
	return /\b(first|second|third|one|two|three)[\s,]/.test(text) ||
		   /\d+[\s]*[:.]/.test(text); // numbered lists
}

function calculateContentWordRatio(text: string): number {
	const words = text.split(/\s+/).filter(w => w.length > 0);
	if (words.length === 0) return 0;
	
	const functionWords = new Set([
		'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with',
		'by', 'from', 'up', 'about', 'into', 'through', 'during', 'before', 'after',
		'above', 'below', 'between', 'among', 'is', 'are', 'was', 'were', 'be', 'been',
		'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should',
		'may', 'might', 'must', 'can', 'this', 'that', 'these', 'those', 'i', 'you',
		'he', 'she', 'it', 'we', 'they', 'me', 'him', 'her', 'us', 'them'
	]);
	
	const contentWords = words.filter(word => 
		!functionWords.has(word.toLowerCase()) && word.length > 2
	);
	
	return contentWords.length / words.length;
}



export interface Chapter {
	start_time: number;
	end_time?: number;
	title: string;
}

export function pruneSentences(sentences: SentenceSegment[], keepTop: number = 600, chapters?: Chapter[]): SentenceSegment[] {
	if (sentences.length === 0) return [];
	
	// Score all sentences
	const scoredSentences = sentences.map(sentence => ({
		...sentence,
		score: scoreSentence(sentence)
	}));
	
	const videoDuration = sentences[sentences.length - 1]?.start || 1;
	const stratifiedSelection: typeof scoredSentences = [];
	
	// TEMPORARILY DISABLE CHAPTER-AWARE SAMPLING TO TEST FRONT-LOADING FIX
	console.log('Chapter-aware sampling disabled for testing - using time-based quartile sampling');
	
	// Skip chapter-aware sampling and use time-based quartiles instead
	/*
	if (chapters && chapters.length > 1) {
		// CHAPTER-AWARE SAMPLING (DISABLED FOR TESTING)
		console.log(`Using chapter-aware sampling with ${chapters.length} chapters`);
		
		// Ensure chapters have end times
		const chaptersWithEnd = chapters.map((chapter, index) => ({
			...chapter,
			end_time: chapter.end_time || chapters[index + 1]?.start_time || videoDuration
		}));
		
		// Calculate chapter durations and allocate sentences proportionally
		const totalChapterDuration = chaptersWithEnd.reduce((sum, ch) => sum + (ch.end_time! - ch.start_time), 0);
		
		chaptersWithEnd.forEach((chapter, chapterIndex) => {
			const chapterDuration = chapter.end_time! - chapter.start_time;
			const proportion = chapterDuration / totalChapterDuration;
			const baseAllocation = Math.floor(keepTop * proportion);
			
			// Ensure each chapter gets at least some representation (min 5 sentences if it has content)
			const chapterSentences = scoredSentences.filter(s => 
				s.start >= chapter.start_time && s.start < chapter.end_time!
			);
			
			if (chapterSentences.length === 0) {
				console.log(`Chapter ${chapterIndex + 1} "${chapter.title}": No sentences found`);
				return;
			}
			
			const allocation = Math.max(5, Math.min(baseAllocation, chapterSentences.length));
			const selected = chapterSentences
				.sort((a, b) => b.score - a.score)
				.slice(0, allocation);
			
			stratifiedSelection.push(...selected);
			console.log(`Chapter "${chapter.title}" (${(chapterDuration/60).toFixed(1)}min): Selected ${selected.length} from ${chapterSentences.length} sentences`);
		});
		
		// Fill remaining slots with globally best scores
		const remaining = keepTop - stratifiedSelection.length;
		if (remaining > 0) {
			const alreadySelected = new Set(stratifiedSelection.map(s => `${s.start}-${s.text.substring(0, 20)}`));
			const globalBest = scoredSentences
				.filter(s => !alreadySelected.has(`${s.start}-${s.text.substring(0, 20)}`))
				.sort((a, b) => b.score - a.score)
				.slice(0, remaining);
			stratifiedSelection.push(...globalBest);
			console.log(`Added ${globalBest.length} additional globally top-scored sentences`);
		}
		
	} else {
	*/
	{
		// Time-based quartile sampling (testing to fix front-loading)
		console.log('Using time-based quartile sampling (chapter-aware disabled for testing)');
		const perQuartile = Math.floor(keepTop / 4);
		const quartiles: typeof scoredSentences[] = [[], [], [], []];
		
		// Distribute sentences into quartiles
		scoredSentences.forEach(sentence => {
			const quartileIndex = Math.min(3, Math.floor((sentence.start / videoDuration) * 4));
			quartiles[quartileIndex].push(sentence);
		});
		
		// Take top sentences from each quartile
		quartiles.forEach((quartile, index) => {
			const sorted = quartile.sort((a, b) => b.score - a.score);
			const taken = sorted.slice(0, perQuartile);
			stratifiedSelection.push(...taken);
			console.log(`Q${index + 1}: Selected ${taken.length} from ${quartile.length} sentences`);
		});
		
		// Fill remaining slots
		const remaining = keepTop - stratifiedSelection.length;
		if (remaining > 0) {
			const alreadySelected = new Set(stratifiedSelection.map(s => `${s.start}-${s.text.substring(0, 20)}`));
			const globalBest = scoredSentences
				.filter(s => !alreadySelected.has(`${s.start}-${s.text.substring(0, 20)}`))
				.sort((a, b) => b.score - a.score)
				.slice(0, remaining);
			stratifiedSelection.push(...globalBest);
			console.log(`Added ${globalBest.length} additional globally top-scored sentences`);
		}
	}
	
	// Sort final selection chronologically and remove score property
	let pruned = stratifiedSelection
		.sort((a, b) => a.start - b.start)
		.map(({ score, ...sentence }) => sentence); // Remove score from final output
	
	// DEDUPLICATION: Remove sentences too close to each other (same 30-second window)
	pruned = deduplicateByTime(pruned, 30);
	
	console.log(`Pruned from ${sentences.length} to ${pruned.length} sentences (${((1 - pruned.length / sentences.length) * 100).toFixed(1)}% reduction)`);
	
	// Log final distribution analysis
	console.log('=== FINAL SAMPLING ANALYSIS ===');
	console.log(`Total video duration: ${(videoDuration / 60).toFixed(1)} minutes`);
	console.log(`Final selection: ${pruned.length} sentences`);
	
	if (chapters && chapters.length > 1) {
		console.log('Chapter-based distribution:');
		const chaptersWithEnd = chapters.map((chapter, index) => ({
			...chapter,
			end_time: chapter.end_time || chapters[index + 1]?.start_time || videoDuration
		}));
		
		chaptersWithEnd.forEach((chapter) => {
			const inChapter = pruned.filter(s => s.start >= chapter.start_time && s.start < chapter.end_time!);
			if (inChapter.length > 0) {
				const sampleTimes = inChapter.slice(0, 2).map(s => `${(s.start/60).toFixed(1)}min`).join(', ');
				console.log(`  "${chapter.title}": ${inChapter.length} sentences (${sampleTimes})`);
			}
		});
	} else {
		// Show quartile distribution for time-based sampling
		const timeQuartiles = [0, 0.25, 0.5, 0.75, 1.0].map(q => q * videoDuration);
		for (let i = 0; i < 4; i++) {
			const start = timeQuartiles[i];
			const end = timeQuartiles[i + 1];
			const inQuartile = pruned.filter(s => s.start >= start && s.start < end);
			if (inQuartile.length > 0) {
				const sampleTimes = inQuartile.slice(0, 2).map(s => `${(s.start/60).toFixed(1)}min`).join(', ');
				console.log(`  Q${i + 1}: ${inQuartile.length} sentences (${sampleTimes})`);
			}
		}
	}
	
	console.log('=== END SAMPLING ANALYSIS ===');
	
	return pruned;
}

export function analyzeSentenceStats(
	originalSegments: TranscriptSegment[], 
	sentences: SentenceSegment[]
): {
	originalCount: number;
	sentenceCount: number;
	reductionRatio: number;
	avgWordsPerSentence: number;
	avgDurationPerSentence: number;
	totalDuration: number;
} {
	const totalDuration = originalSegments.length > 0 
		? originalSegments[originalSegments.length - 1].end - originalSegments[0].start 
		: 0;
	
	const avgWordsPerSentence = sentences.length > 0
		? sentences.reduce((sum, s) => sum + s.wordCount, 0) / sentences.length
		: 0;
	
	const avgDurationPerSentence = sentences.length > 0
		? sentences.reduce((sum, s) => sum + (s.end - s.start), 0) / sentences.length
		: 0;
	
	return {
		originalCount: originalSegments.length,
		sentenceCount: sentences.length,
		reductionRatio: originalSegments.length > 0 ? sentences.length / originalSegments.length : 0,
		avgWordsPerSentence,
		avgDurationPerSentence,
		totalDuration,
	};
}