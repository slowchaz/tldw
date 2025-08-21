// Quick test script for sentence processing
import { splitIntoSentences, mergeShortSentences, analyzeSentenceStats } from './lib/sentence-processor.js';

// Sample transcript segments (simulating VTT output)
const sampleSegments = [
  { start: 0, end: 3, text: "Hello everyone. Welcome to today's talk about creativity." },
  { start: 3, end: 7, text: "I want to start with a question. What makes someone creative?" },
  { start: 7, end: 12, text: "Most people think creativity is about talent. But that's wrong." },
  { start: 12, end: 18, text: "Creativity is actually about process. It's about how you think, not what you're born with." },
  { start: 18, end: 22, text: "Let me explain. The most creative people do three things differently." },
  { start: 22, end: 27, text: "First, they give themselves time. Second, they embrace mistakes." },
  { start: 27, end: 32, text: "Third, and this is crucial, they play with ideas like children." }
];

console.log('Testing sentence processing...\n');

// Test sentence splitting
const sentences = splitIntoSentences(sampleSegments);
console.log(`Original segments: ${sampleSegments.length}`);
console.log(`Extracted sentences: ${sentences.length}\n`);

console.log('Extracted sentences:');
sentences.forEach((s, i) => {
  console.log(`${i + 1}. [${s.start.toFixed(1)}s-${s.end.toFixed(1)}s] "${s.text}" (${s.wordCount} words)`);
});

// Test merging short sentences
console.log('\n--- Testing short sentence merging ---');
const merged = mergeShortSentences(sentences, 5);
console.log(`After merging sentences < 5 words: ${merged.length} sentences\n`);

merged.forEach((s, i) => {
  console.log(`${i + 1}. [${s.start.toFixed(1)}s-${s.end.toFixed(1)}s] "${s.text}" (${s.wordCount} words)`);
});

// Test statistics
console.log('\n--- Statistics ---');
const stats = analyzeSentenceStats(sampleSegments, merged);
console.log(stats);