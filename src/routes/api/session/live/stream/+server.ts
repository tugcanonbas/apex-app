import type { RequestHandler } from './$types';
import { getLiveState, subscribeLiveState } from '$lib/server/study-store';

function encodeLiveEvent(live: Awaited<ReturnType<typeof getLiveState>>): string {
	return `data: ${JSON.stringify({ live })}\n\n`;
}

export const GET: RequestHandler = async () => {
	const encoder = new TextEncoder();
	let unsubscribe: () => void = () => undefined;
	let heartbeat: ReturnType<typeof setInterval> | undefined;

	const stream = new ReadableStream<Uint8Array>({
		async start(controller) {
			controller.enqueue(encoder.encode('event: ready\ndata: {}\n\n'));
			const initial = await getLiveState();
			if (initial) controller.enqueue(encoder.encode(encodeLiveEvent(initial)));

			unsubscribe = subscribeLiveState((live) => {
				controller.enqueue(encoder.encode(encodeLiveEvent(live)));
			});
			heartbeat = setInterval(() => {
				controller.enqueue(encoder.encode(': keep-alive\n\n'));
			}, 15000);
		},
		cancel() {
			unsubscribe();
			if (heartbeat) clearInterval(heartbeat);
		}
	});

	return new Response(stream, {
		headers: {
			'content-type': 'text/event-stream',
			'cache-control': 'no-store, no-transform',
			connection: 'keep-alive',
			'x-accel-buffering': 'no'
		}
	});
};
