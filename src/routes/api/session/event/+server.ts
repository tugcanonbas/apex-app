import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { recordEvent } from '$lib/server/study-store';

export const POST: RequestHandler = async ({ request }) => {
	try {
		const body = await request.json();
		const session = await recordEvent(body);
		return json({ session });
	} catch (error) {
		return json({ error: (error as Error).message }, { status: 400 });
	}
};
