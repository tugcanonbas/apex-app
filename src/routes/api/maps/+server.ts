import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listMaps, saveMap } from '$lib/server/study-store';

export async function GET() {
	return json({ maps: await listMaps() });
}

export const POST: RequestHandler = async ({ request }) => {
	try {
		const map = await saveMap(await request.json());
		return json({ map });
	} catch (error) {
		return json({ error: (error as Error).message }, { status: 400 });
	}
};
