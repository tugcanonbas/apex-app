import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	deleteRegisteredParticipant,
	getParticipant,
	updateRegisteredParticipant
} from '$lib/server/study-store';

export const GET: RequestHandler = async ({ params }) => {
	try {
		const participant = await getParticipant(params.id);
		return json({ participant });
	} catch (error) {
		return json({ error: (error as Error).message }, { status: 404 });
	}
};

export const PUT: RequestHandler = async ({ params, request }) => {
	try {
		const body = await request.json();
		const participant = await updateRegisteredParticipant(params.id, body);
		return json({ participant });
	} catch (error) {
		return json({ error: (error as Error).message }, { status: 400 });
	}
};

export const DELETE: RequestHandler = async ({ params }) => {
	try {
		await deleteRegisteredParticipant(params.id);
		return json({ ok: true });
	} catch (error) {
		return json({ error: (error as Error).message }, { status: 400 });
	}
};
