import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { deleteMap, getMap, saveMap } from '$lib/server/study-store';

export const GET: RequestHandler = async ({ params }) => {
	const map = await getMap(params.id);
	if (!map) return json({ error: 'Map not found' }, { status: 404 });
	return json({ map });
};

export const PUT: RequestHandler = async ({ request, params }) => {
	try {
		const body = await request.json();
		const map = await saveMap({ ...body, id: params.id });
		return json({ map });
	} catch (error) {
		return json({ error: (error as Error).message }, { status: 400 });
	}
};

export const DELETE: RequestHandler = async ({ params }) => {
	try {
		await deleteMap(params.id);
		return json({ ok: true });
	} catch (error) {
		return json({ error: (error as Error).message }, { status: 400 });
	}
};
