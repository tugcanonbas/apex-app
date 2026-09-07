import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getLiveState, updateLiveState } from '$lib/server/study-store';

export const GET: RequestHandler = async () => {
	try {
		return json(
			{ live: await getLiveState() },
			{
				headers: {
					'cache-control': 'no-store, max-age=0'
				}
			}
		);
	} catch (error) {
		return json({ error: (error as Error).message }, { status: 400 });
	}
};

export const POST: RequestHandler = async ({ request }) => {
	try {
		const body = await request.json();
		const live = await updateLiveState(body);
		return json({ live });
	} catch (error) {
		return json({ error: (error as Error).message }, { status: 400 });
	}
};
