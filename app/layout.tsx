import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
	title: 'TLDW - Turn Long Videos Into Digestible Clips',
	description: 'Extract key insights from YouTube videos',
};

export default function RootLayout({
	children,
}: Readonly<{
	children: React.ReactNode;
}>) {
	return (
		<html lang="en">
			<body>
				{children}
			</body>
		</html>
	);
}
