import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createParticipant } from '$lib/server/study-store';

export const POST: RequestHandler = async ({ request }) => {
	try {
		const body = await request.json();
		const participant = await createParticipant(body);
		return json({ participant });
	} catch (error) {
		return json({ error: (error as Error).message }, { status: 400 });
	}
};
