import { getState } from '$lib/server/study-store';

export async function load() {
	return {
		initialState: await getState()
	};
}
