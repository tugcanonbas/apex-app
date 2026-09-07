<script lang="ts">
	import VerdeIcon from '$lib/components/VerdeIcon.svelte';
	import type { StudyPhase } from '$lib/types';

	let {
		phase,
		isAdaptive
	}: {
		phase: StudyPhase;
		isAdaptive: boolean;
	} = $props();
</script>

{#if phase === 'near_arrival' || phase === 'arrival'}
	<section
		class="border-t border-[var(--hairline)] px-3 py-4"
		class:aic-focus-panel={isAdaptive}
		data-log-surface="boarding_checklist"
		data-log-target="boarding_checklist"
		data-log-type="checklist"
	>
		<p class="text-xs font-bold tracking-[0.16em] text-corduroy uppercase">Arrival check</p>
		<div
			class="mt-3 grid gap-2 font-bold text-forest"
			class:text-base={isAdaptive}
			class:text-sm={!isAdaptive}
		>
			<p class="flex items-center gap-2">
				<VerdeIcon name="id" size={16} />Vehicle details ready
			</p>
			<p class="flex items-center gap-2">
				<VerdeIcon name="shield" size={16} />Keep this screen nearby
			</p>
		</div>
	</section>
{/if}

<style>
	.aic-focus-panel {
		position: relative;
		border-top-color: rgba(54, 129, 108, 0.45);
	}

	.aic-focus-panel::before {
		content: '';
		position: absolute;
		inset: 1rem auto 1rem 0;
		width: 4px;
		border-radius: 999px;
		background: #36816c;
	}
</style>
