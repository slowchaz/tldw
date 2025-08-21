import { NextRequest, NextResponse } from 'next/server';
import { deleteVideo } from '../../../lib/database';

export const runtime = 'nodejs';

export async function DELETE(request: NextRequest) {
	try {
		const { videoId } = await request.json();

		if (!videoId) {
			return NextResponse.json({ error: 'videoId is required' }, { status: 400 });
		}

		const success = deleteVideo(videoId);

		if (success) {
			return NextResponse.json({ 
				success: true, 
				message: 'Cache deleted successfully' 
			}, {
				headers: {
					'Cache-Control': 'no-cache, no-store, must-revalidate',
					'Pragma': 'no-cache',
					'Expires': '0'
				}
			});
		} else {
			return NextResponse.json({ 
				error: 'Failed to delete cache or cache not found' 
			}, { 
				status: 404,
				headers: {
					'Cache-Control': 'no-cache, no-store, must-revalidate',
					'Pragma': 'no-cache',
					'Expires': '0'
				}
			});
		}
	} catch (error) {
		console.error('Delete cache error:', error);
		return NextResponse.json(
			{
				error: error instanceof Error ? error.message : 'Failed to delete cache',
			},
			{ status: 500 }
		);
	}
}