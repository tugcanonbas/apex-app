<script lang="ts">
	import type { SessionStatus } from '$lib/types';
	import type { RideCopy } from './rideTypes';

	let {
		status,
		copy
	}: {
		status: SessionStatus;
		copy: RideCopy;
	} = $props();
</script>

<section
	class="mt-8 grid min-h-[calc(100dvh-9rem)] place-items-center text-center"
	data-log-surface="completion_screen"
	data-log-target={`completion:${status}`}
	data-log-type="completion_state"
>
	<div class="w-full">
		<p class="text-xs font-bold tracking-[0.16em] text-corduroy uppercase">{copy.eyebrow}</p>
		<h1 class="mt-4 text-3xl leading-tight font-bold text-forest">{copy.title}</h1>
		<p class="mt-4 text-sm leading-6 text-corduroy">{copy.body}</p>
		<p class="mt-6 border-t border-[var(--hairline)] pt-4 text-sm font-bold text-forest">
			{status === 'study_finished' ? 'All set' : 'Block Finished'}
		</p>
	</div>
</section>
