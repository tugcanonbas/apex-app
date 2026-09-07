import { json } from '@sveltejs/kit';
import { getState } from '$lib/server/study-store';

export async function GET() {
	return json(await getState(), {
		headers: {
			'cache-control': 'no-store, max-age=0'
		}
	});
}
